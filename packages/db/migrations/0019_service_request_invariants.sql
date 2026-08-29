-- =============================================================================
-- Aurora — 0019 invariantes da solicitação, RLS e auditoria · EPIC-007
-- =============================================================================

-- -----------------------------------------------------------------------------
-- O relato do cliente é imutável depois do envio.
--
-- Na referência, a descrição original do solicitante era sobrescrita pelo
-- técnico. Com ela sumia a única evidência do que o cliente de fato pediu — e,
-- em disputa sobre escopo, quem perdia era sempre o cliente, porque o registro
-- só guardava a versão de quem editou por último.
--
-- O diagnóstico do técnico não é impedido: ele vive na OS, que é outro
-- registro. É exatamente a separação que o ADR-002 comprou.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_service_request_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_seconds  bigint;
  v_last     timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft' THEN
      IF NEW.summary IS DISTINCT FROM OLD.summary OR NEW.description IS DISTINCT FROM OLD.description THEN
        RAISE EXCEPTION 'o relato do solicitante não é editável depois do envio; registre o diagnóstico na ordem de serviço'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.number IS DISTINCT FROM OLD.number THEN
      RAISE EXCEPTION 'o número da solicitação é imutável' USING ERRCODE = 'check_violation';
    END IF;

    -- Concorrência otimista: dois coordenadores triando a mesma solicitação ao
    -- mesmo tempo não podem sobrescrever a decisão um do outro em silêncio.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.version <> OLD.version THEN
        RAISE EXCEPTION 'a solicitação mudou desde que você a carregou; recarregue e tente de novo'
          USING ERRCODE = 'serialization_failure';
      END IF;
      NEW.version := OLD.version + 1;

      SELECT max(changed_at) INTO v_last
        FROM aurora.service_request_status_history WHERE request_id = NEW.id;
      v_seconds := EXTRACT(EPOCH FROM (now() - coalesce(v_last, OLD.created_at)))::bigint;

      INSERT INTO aurora.service_request_status_history
        (id, organization_id, request_id, from_status, to_status, changed_by, seconds_in_from)
      VALUES
        (gen_random_uuid(), NEW.organization_id, NEW.id, OLD.status, NEW.status,
         aurora.current_actor_id(), v_seconds);

      -- Carimbos derivados do próprio estado, para não depender de a aplicação
      -- lembrar de preenchê-los em todos os caminhos de escrita.
      IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
        NEW.submitted_at := now();
      END IF;
      IF NEW.status = 'triage' AND NEW.first_response_at IS NULL THEN
        NEW.first_response_at := now();
        NEW.triaged_at := now();
        NEW.triaged_by := aurora.current_actor_id();
      END IF;
      IF NEW.status IN ('closed', 'rejected', 'duplicate', 'cancelled') AND NEW.closed_at IS NULL THEN
        NEW.closed_at := now();
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER service_requests_guard BEFORE UPDATE ON aurora.service_requests
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_service_request_guard();

CREATE TRIGGER service_requests_touch BEFORE UPDATE ON aurora.service_requests
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Primeira linha do histórico.
--
-- Sem ela, a solicitação nasceria sem registro de origem e a primeira transição
-- mediria a duração a partir de `created_at` de um estado que ninguém declarou.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_service_request_born() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO aurora.service_request_status_history
    (id, organization_id, request_id, from_status, to_status, changed_by, seconds_in_from)
  VALUES
    (gen_random_uuid(), NEW.organization_id, NEW.id, NULL, NEW.status, aurora.current_actor_id(), 0);
  RETURN NULL;
END
$fn$;

CREATE TRIGGER service_requests_born AFTER INSERT ON aurora.service_requests
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_service_request_born();

-- -----------------------------------------------------------------------------
-- O catálogo certo para cada campo.
--
-- `reported_failure_code_id` e `rejection_reason_id` apontam ambos para
-- `catalog_items`, então a chave estrangeira sozinha aceitaria um motivo de
-- recusa no lugar de um sintoma. O gatilho fecha essa porta.
--
-- É a contrapartida honesta do ADR-028: consolidar catálogos numa tabela só
-- barateia tudo, menos isto — e isto tem de ser pago, não ignorado.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_service_request_catalogs() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE v_catalog text;
BEGIN
  IF NEW.reported_failure_code_id IS NOT NULL THEN
    SELECT catalog_key INTO v_catalog FROM aurora.catalog_items WHERE id = NEW.reported_failure_code_id;
    IF v_catalog IS DISTINCT FROM 'failure_symptom' THEN
      RAISE EXCEPTION 'o sintoma relatado deve vir do catálogo failure_symptom, e veio de %', coalesce(v_catalog, 'nenhum')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.rejection_reason_id IS NOT NULL THEN
    SELECT catalog_key INTO v_catalog FROM aurora.catalog_items WHERE id = NEW.rejection_reason_id;
    IF v_catalog IS DISTINCT FROM 'rejection_reason' THEN
      RAISE EXCEPTION 'o motivo de recusa deve vir do catálogo rejection_reason, e veio de %', coalesce(v_catalog, 'nenhum')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER service_requests_catalogs BEFORE INSERT OR UPDATE ON aurora.service_requests
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_service_request_catalogs();

-- -----------------------------------------------------------------------------
-- Coerência de cliente entre solicitação, local e ativo.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_service_request_scope() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE v_customer uuid;
BEGIN
  IF NEW.location_id IS NOT NULL THEN
    SELECT customer_id INTO v_customer FROM aurora.locations WHERE id = NEW.location_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'local inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_customer <> NEW.customer_id THEN
      RAISE EXCEPTION 'o local informado pertence a outro cliente' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.asset_id IS NOT NULL THEN
    SELECT customer_id INTO v_customer FROM aurora.assets WHERE id = NEW.asset_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ativo inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_customer <> NEW.customer_id THEN
      RAISE EXCEPTION 'o ativo informado pertence a outro cliente' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER service_requests_scope BEFORE INSERT OR UPDATE ON aurora.service_requests
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_service_request_scope();

-- -----------------------------------------------------------------------------
-- RLS, auditoria e permissões
-- -----------------------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['number_sequences', 'service_requests', 'service_request_status_history']
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

-- Histórico de estado não se apaga nem se edita: é registro, não rascunho.
-- (O GRANT acima já não dá DELETE; o UPDATE é revogado aqui.)
REVOKE UPDATE ON aurora.service_request_status_history FROM aurora_app;

CREATE TRIGGER service_requests_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.service_requests
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('number');

GRANT EXECUTE ON FUNCTION aurora.next_number(uuid, text, integer) TO aurora_app;
