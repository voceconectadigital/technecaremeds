-- =============================================================================
-- Aurora — 0022 invariantes da ordem de serviço, RLS e auditoria · EPIC-008
--
-- O que estes gatilhos garantem, e nenhuma camada acima garantiria sozinha:
--
--  · a categoria gravada na OS é sempre a da situação apontada — não dá para
--    ter uma OS em situação "Aguardando" com categoria `in_progress`
--  · toda mudança de situação passa pelo GRAFO da organização
--  · toda mudança grava histórico com a duração no estado anterior
--  · OS fechada é somente leitura, salvo permissão especial
--  · o snapshot é tirado uma vez e nunca reescrito
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Categoria derivada e snapshot tirado uma vez.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_work_order_derive() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_category aurora.status_category;
  v_requires boolean;
  v_asset    record;
  v_location record;
BEGIN
  SELECT category, requires_wait_reason INTO v_category, v_requires
    FROM aurora.work_order_statuses WHERE id = NEW.status_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'situação inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.status_category := v_category;
  NEW.status_requires_reason := v_requires;

  IF TG_OP = 'INSERT' OR NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    NEW.status_changed_at := now();
  END IF;

  -- Snapshot só no nascimento. Refazê-lo depois faria a transferência de um
  -- ativo reescrever onde o serviço aconteceu — exatamente o que a coluna
  -- existe para impedir.
  IF TG_OP = 'INSERT' THEN
    IF NEW.asset_id IS NOT NULL THEN
      SELECT name, serial_number INTO v_asset FROM aurora.assets WHERE id = NEW.asset_id;
      NEW.asset_name_snapshot   := v_asset.name;
      NEW.asset_serial_snapshot := v_asset.serial_number;
    END IF;
    IF NEW.location_id IS NOT NULL THEN
      SELECT name, path INTO v_location FROM aurora.locations WHERE id = NEW.location_id;
      NEW.location_name_snapshot := v_location.name;
      NEW.location_path_snapshot := v_location.path;
    END IF;
  ELSE
    IF NEW.asset_name_snapshot IS DISTINCT FROM OLD.asset_name_snapshot
       OR NEW.location_path_snapshot IS DISTINCT FROM OLD.location_path_snapshot THEN
      RAISE EXCEPTION 'o retrato do ativo e do local na abertura da OS não é editável'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER work_orders_derive BEFORE INSERT OR UPDATE ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_work_order_derive();

-- -----------------------------------------------------------------------------
-- Toda mudança de situação passa pelo grafo.
--
-- Este é o gatilho que torna a máquina de estados uma garantia e não uma
-- convenção. O motor em TypeScript dá a mensagem boa, com a lista de saídas
-- possíveis; este aqui garante que ninguém pule o motor — nem uma correção
-- manual, nem uma importação, nem o código que alguém escrever no ano que vem.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_work_order_transition() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_exists   boolean;
  v_from     text;
  v_to       text;
  v_possiveis text;
  v_last     timestamptz;
  v_seconds  bigint;
BEGIN
  IF NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
    RETURN NEW;
  END IF;

  IF NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'a ordem de serviço mudou desde que você a carregou; recarregue e tente de novo'
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM aurora.work_order_status_transitions
     WHERE from_status_id = OLD.status_id AND to_status_id = NEW.status_id
  ) INTO v_exists;

  IF NOT v_exists THEN
    SELECT label INTO v_from FROM aurora.work_order_statuses WHERE id = OLD.status_id;
    SELECT label INTO v_to   FROM aurora.work_order_statuses WHERE id = NEW.status_id;
    SELECT string_agg(s.label, ', ' ORDER BY s.position) INTO v_possiveis
      FROM aurora.work_order_status_transitions t
      JOIN aurora.work_order_statuses s ON s.id = t.to_status_id
     WHERE t.from_status_id = OLD.status_id;
    RAISE EXCEPTION 'transição de "%" para "%" não está declarada; a partir de "%" as situações possíveis são: %',
      v_from, v_to, v_from, coalesce(v_possiveis, 'nenhuma — é uma situação final')
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.version := OLD.version + 1;

  SELECT changed_at INTO v_last
    FROM aurora.work_order_status_history
   WHERE work_order_id = NEW.id ORDER BY sequence DESC LIMIT 1;
  v_seconds := EXTRACT(EPOCH FROM (clock_timestamp() - coalesce(v_last, OLD.created_at)))::bigint;

  INSERT INTO aurora.work_order_status_history
    (id, organization_id, work_order_id, from_status_id, to_status_id,
     from_category, to_category, wait_reason_id, changed_by, seconds_in_from, note)
  VALUES
    (gen_random_uuid(), NEW.organization_id, NEW.id, OLD.status_id, NEW.status_id,
     OLD.status_category, NEW.status_category,
     -- O motivo registrado é o do estado que TERMINA, não o do que começa: é
     -- assim que "tempo esperando peça" fica somável.
     OLD.wait_reason_id, aurora.current_actor_id(), v_seconds, NEW.wait_note);

  -- Carimbos derivados da categoria de destino.
  IF NEW.status_category = 'in_progress' AND NEW.started_at IS NULL THEN
    NEW.started_at := now();
  END IF;
  IF NEW.status_category = 'review' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  END IF;
  IF NEW.status_category = 'done' AND NEW.validated_at IS NULL THEN
    NEW.validated_at := now();
  END IF;
  IF NEW.status_category IN ('closed', 'cancelled') AND NEW.closed_at IS NULL THEN
    NEW.closed_at := now();
  END IF;

  -- Sair de `waiting` limpa o motivo: mantê-lo faria a OS parecer bloqueada
  -- por algo que já foi resolvido, e a restrição da 0021 já recusaria a linha.
  IF NEW.status_category <> 'waiting' THEN
    NEW.wait_reason_id := NULL;
    NEW.wait_note := NULL;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER work_orders_transition BEFORE UPDATE ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_work_order_transition();

-- -----------------------------------------------------------------------------
-- OS fechada é somente leitura.
--
-- "Somente leitura, salvo permissão especial" (§10). A permissão especial é
-- `work_order.edit_closed`, e a checagem é aqui porque a regra tem de valer
-- para todo caminho de escrita, não só para a rota que existe hoje.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_work_order_closed_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status_category = 'closed'
     AND coalesce(current_setting('aurora.allow_closed_edit', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'ordem de serviço fechada é somente leitura; reabrir exige work_order.reopen, editar exige work_order.edit_closed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER work_orders_closed_guard BEFORE UPDATE ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_work_order_closed_guard();

CREATE TRIGGER work_orders_touch BEFORE UPDATE ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();

-- Primeira linha do histórico, pelo mesmo motivo da 0019.
CREATE FUNCTION aurora.fn_work_order_born() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO aurora.work_order_status_history
    (id, organization_id, work_order_id, from_status_id, to_status_id,
     from_category, to_category, changed_by, seconds_in_from)
  VALUES
    (gen_random_uuid(), NEW.organization_id, NEW.id, NULL, NEW.status_id,
     NULL, NEW.status_category, aurora.current_actor_id(), 0);
  RETURN NULL;
END
$fn$;

CREATE TRIGGER work_orders_born AFTER INSERT ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_work_order_born();

-- -----------------------------------------------------------------------------
-- A natureza vem do catálogo certo.
-- Mesma contrapartida do ADR-028 já paga na 0019.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_work_order_catalogs() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE v_catalog text;
BEGIN
  SELECT catalog_key INTO v_catalog FROM aurora.catalog_items WHERE id = NEW.work_order_type_id;
  IF v_catalog IS DISTINCT FROM 'work_order_type' THEN
    RAISE EXCEPTION 'a natureza da OS deve vir do catálogo work_order_type, e veio de %', coalesce(v_catalog, 'nenhum')
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.cause_failure_code_id IS NOT NULL THEN
    SELECT catalog_key INTO v_catalog FROM aurora.catalog_items WHERE id = NEW.cause_failure_code_id;
    IF v_catalog IS DISTINCT FROM 'failure_cause' THEN
      RAISE EXCEPTION 'a causa identificada deve vir do catálogo failure_cause' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.action_code_id IS NOT NULL THEN
    SELECT catalog_key INTO v_catalog FROM aurora.catalog_items WHERE id = NEW.action_code_id;
    IF v_catalog IS DISTINCT FROM 'failure_action' THEN
      RAISE EXCEPTION 'a ação executada deve vir do catálogo failure_action' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.reported_failure_code_id IS NOT NULL THEN
    SELECT catalog_key INTO v_catalog FROM aurora.catalog_items WHERE id = NEW.reported_failure_code_id;
    IF v_catalog IS DISTINCT FROM 'failure_symptom' THEN
      RAISE EXCEPTION 'o sintoma relatado deve vir do catálogo failure_symptom' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER work_orders_catalogs BEFORE INSERT OR UPDATE ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_work_order_catalogs();

-- -----------------------------------------------------------------------------
-- Tempo por motivo de espera — a pergunta que o ADR-004 tornou possível.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.wait_time_by_reason(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (wait_reason_key text, wait_reason_label text, pauses_sla boolean, total_seconds bigint, occurrences bigint)
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  SELECT w.key, w.label, w.pauses_sla, sum(h.seconds_in_from)::bigint, count(*)::bigint
    FROM aurora.work_order_status_history h
    JOIN aurora.wait_reasons w ON w.id = h.wait_reason_id
   WHERE h.from_category = 'waiting'
     AND h.changed_at >= p_from AND h.changed_at < p_to
   GROUP BY w.key, w.label, w.pauses_sla
   ORDER BY sum(h.seconds_in_from) DESC
$fn$;

GRANT EXECUTE ON FUNCTION aurora.wait_time_by_reason(timestamptz, timestamptz) TO aurora_app, aurora_readonly;

-- -----------------------------------------------------------------------------
-- RLS, auditoria e permissões
-- -----------------------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_orders', 'work_order_status_history', 'work_order_comments']
  LOOP
    EXECUTE format('ALTER TABLE aurora.%I OWNER TO aurora_owner', t);
    EXECUTE format('ALTER TABLE aurora.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE aurora.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON aurora.%I FOR ALL
         USING (organization_id = aurora.current_organization_id())
         WITH CHECK (organization_id = aurora.current_organization_id())',
      t || '_tenant_isolation', t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON aurora.%I TO aurora_app', t);
    EXECUTE format('GRANT SELECT ON aurora.%I TO aurora_readonly', t);
  END LOOP;
END
$do$;

REVOKE UPDATE ON aurora.work_order_status_history FROM aurora_app;
GRANT DELETE ON aurora.work_order_comments TO aurora_app;

CREATE TRIGGER work_orders_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('title');
CREATE TRIGGER work_order_comments_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.work_order_comments
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('visibility');
