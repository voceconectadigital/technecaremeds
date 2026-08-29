-- =============================================================================
-- Aurora — 0015 invariantes do ativo, RLS e auditoria · EPIC-005
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Projeção dos identificadores únicos.
--
-- O gatilho decide QUAIS linhas existem em `asset_identifiers`, conforme a
-- configuração da organização; o índice único da 0014 decide se elas podem
-- coexistir. Duas importações simultâneas com o mesmo número de série colidem
-- no índice, não numa leitura que já passou.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_asset_identifiers() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_fields  text[];
  v_scope   text;
  v_key     uuid;
  v_field   text;
  v_value   text;
  v_norm    text;
BEGIN
  SELECT asset_unique_fields, asset_unique_scope INTO v_fields, v_scope
    FROM aurora.organizations WHERE id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organização inexistente' USING ERRCODE = 'foreign_key_violation';
  END IF;

  v_key := CASE WHEN v_scope = 'customer' THEN NEW.customer_id ELSE NEW.organization_id END;

  DELETE FROM aurora.asset_identifiers WHERE asset_id = NEW.id;

  -- Ativo excluído logicamente sai da projeção: o número de série de um ativo
  -- na lixeira não deve bloquear o cadastro do substituto.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  FOREACH v_field IN ARRAY v_fields LOOP
    v_value := CASE v_field
                 WHEN 'tag'           THEN NEW.tag
                 WHEN 'serial_number' THEN NEW.serial_number
                 WHEN 'asset_number'  THEN NEW.asset_number
               END;
    -- Campo vazio não participa da unicidade: exigir preenchimento é outra
    -- decisão, e obrigar aqui faria a importação recusar linhas legítimas de um
    -- ativo que de fato não tem patrimônio.
    CONTINUE WHEN v_value IS NULL OR btrim(v_value) = '';

    v_norm := replace(aurora.normalize_label(v_value), ' ', '');
    CONTINUE WHEN v_norm = '';

    INSERT INTO aurora.asset_identifiers (organization_id, asset_id, field, scope_key, value_normalized)
    VALUES (NEW.organization_id, NEW.id, v_field, v_key, v_norm);
  END LOOP;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER assets_identifiers AFTER INSERT OR UPDATE ON aurora.assets
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_asset_identifiers();

-- -----------------------------------------------------------------------------
-- Localização derivada e transferência obrigatória.
--
-- `location_path` é denormalizado a partir do local (SPEC §32) para que filtrar
-- ativos por subárvore seja um LIKE indexado, sem junção com a árvore.
--
-- E mudar `location_id` ou `customer_id` fora de uma transferência declarada é
-- recusado. A marca é uma configuração local de transação, posta pela função
-- `aurora.transfer_asset`: morre no COMMIT, não vaza para a próxima requisição
-- e não pode ser deixada ligada por engano.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_asset_location() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_path text;
  v_loc_customer uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.location_id IS DISTINCT FROM OLD.location_id
          OR NEW.customer_id IS DISTINCT FROM OLD.customer_id)
     AND current_setting('aurora.transfer_in_progress', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'mudança de local ou de cliente exige transferência registrada, não edição direta'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.location_id IS NULL THEN
    NEW.location_path := '';
  ELSE
    SELECT path, customer_id INTO v_path, v_loc_customer
      FROM aurora.locations WHERE id = NEW.location_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'local inexistente, arquivado ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_loc_customer <> NEW.customer_id THEN
      RAISE EXCEPTION 'o local pertence a outro cliente que o ativo' USING ERRCODE = 'check_violation';
    END IF;
    NEW.location_path := v_path;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER assets_location BEFORE INSERT OR UPDATE ON aurora.assets
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_asset_location();

-- -----------------------------------------------------------------------------
-- Hierarquia pai/filho: conjunto (ventilador → circuito, torre → câmera).
--
-- Dois níveis, pela terceira vez neste esquema e pela mesma razão: com
-- profundidade 2 o ciclo é impossível por construção. Conjunto de conjunto de
-- conjunto não é um caso real de inventário; é um modelo que ninguém consegue
-- ler na tela.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_asset_parent_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_parent_parent uuid;
  v_parent_customer uuid;
BEGIN
  IF NEW.parent_asset_id IS NULL THEN RETURN NEW; END IF;

  SELECT parent_asset_id, customer_id INTO v_parent_parent, v_parent_customer
    FROM aurora.assets WHERE id = NEW.parent_asset_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ativo pai inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_parent_parent IS NOT NULL THEN
    RAISE EXCEPTION 'conjunto de ativos aceita no máximo dois níveis' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM aurora.assets a WHERE a.parent_asset_id = NEW.id AND a.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'este ativo já tem componentes e não pode virar componente de outro'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_parent_customer <> NEW.customer_id THEN
    RAISE EXCEPTION 'o ativo pai pertence a outro cliente' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER assets_parent_guard BEFORE INSERT OR UPDATE ON aurora.assets
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_asset_parent_guard();

-- -----------------------------------------------------------------------------
-- Transferência: o único caminho legítimo para mover um ativo.
--
-- Move o ativo, move os componentes junto (um circuito não fica no setor antigo
-- quando o ventilador muda de andar) e registra a movimentação. Tudo na mesma
-- transação: ou o registro e o movimento acontecem juntos, ou nenhum acontece.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.transfer_asset(
  p_asset_id     uuid,
  p_to_location  uuid,
  p_reason       text,
  p_kind         aurora.transfer_kind DEFAULT 'transfer',
  p_due_back_at  timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE
  v_org        uuid;
  v_from_loc   uuid;
  v_from_cust  uuid;
  v_to_cust    uuid;
  v_transfer   uuid;
  v_status     aurora.asset_status;
BEGIN
  SELECT organization_id, location_id, customer_id, status
    INTO v_org, v_from_loc, v_from_cust, v_status
    FROM aurora.assets WHERE id = p_asset_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ativo inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status IN ('decommissioned', 'disposed') THEN
    RAISE EXCEPTION 'ativo descomissionado não é transferido; reative antes se for o caso'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT customer_id INTO v_to_cust FROM aurora.locations
   WHERE id = p_to_location AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'local de destino inexistente, arquivado ou fora do seu acesso'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF p_to_location = v_from_loc THEN
    RAISE EXCEPTION 'o ativo já está neste local' USING ERRCODE = 'check_violation';
  END IF;

  -- Identificador nascendo no banco: exceção estreita e justificada à regra do
  -- ADR-024. A transferência é uma função do banco, e obrigar quem a chama a
  -- passar um id só para satisfazer a regra transferiria para a aplicação uma
  -- responsabilidade que não é dela. Não é v7 e não precisa ser:
  -- `asset_transfers` é ordenada por `occurred_at`, nunca por id, e o id não
  -- aparece em URL nem em ordenação de página.
  v_transfer := gen_random_uuid();

  INSERT INTO aurora.asset_transfers
    (id, organization_id, asset_id, kind, from_customer_id, to_customer_id,
     from_location_id, to_location_id, reason, due_back_at, performed_by)
  VALUES
    (v_transfer, v_org, p_asset_id, p_kind, v_from_cust, v_to_cust,
     v_from_loc, p_to_location, p_reason, p_due_back_at, aurora.current_actor_id());

  PERFORM set_config('aurora.transfer_in_progress', 'on', true);

  UPDATE aurora.assets
     SET location_id = p_to_location,
         customer_id = v_to_cust,
         status = CASE WHEN p_kind = 'loan' THEN 'loaned'::aurora.asset_status ELSE status END,
         updated_by = aurora.current_actor_id()
   WHERE id = p_asset_id;

  -- Os componentes acompanham o conjunto.
  UPDATE aurora.assets
     SET location_id = p_to_location,
         customer_id = v_to_cust,
         updated_by = aurora.current_actor_id()
   WHERE parent_asset_id = p_asset_id AND deleted_at IS NULL;

  PERFORM set_config('aurora.transfer_in_progress', 'off', true);
  RETURN v_transfer;
END
$fn$;

-- -----------------------------------------------------------------------------
-- Descomissionar encerra o empréstimo pendente, se houver.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_asset_decommission() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.decommissioned_at IS NOT NULL AND OLD.decommissioned_at IS NULL THEN
    UPDATE aurora.asset_transfers
       SET returned_at = NEW.decommissioned_at
     WHERE asset_id = NEW.id AND kind = 'loan' AND returned_at IS NULL;
  END IF;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER assets_decommission AFTER UPDATE ON aurora.assets
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_asset_decommission();

-- -----------------------------------------------------------------------------
-- touch, auditoria, RLS, permissões
-- -----------------------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asset_categories', 'criticality_levels', 'manufacturers', 'asset_models', 'assets']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON aurora.%I FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at()',
                   t || '_touch', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'asset_categories', 'criticality_levels', 'manufacturers', 'asset_models',
    'assets', 'asset_identifiers', 'asset_transfers', 'meters', 'meter_readings'
  ]
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
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.%I TO aurora_app', t);
    EXECUTE format('GRANT SELECT ON aurora.%I TO aurora_readonly', t);
  END LOOP;
END
$do$;

CREATE TRIGGER asset_categories_audit  AFTER INSERT OR UPDATE OR DELETE ON aurora.asset_categories  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER criticality_audit       AFTER INSERT OR UPDATE OR DELETE ON aurora.criticality_levels FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER manufacturers_audit     AFTER INSERT OR UPDATE OR DELETE ON aurora.manufacturers     FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER asset_models_audit      AFTER INSERT OR UPDATE OR DELETE ON aurora.asset_models      FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER assets_audit            AFTER INSERT OR UPDATE OR DELETE ON aurora.assets            FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER asset_transfers_audit   AFTER INSERT OR UPDATE           ON aurora.asset_transfers   FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('reason');

-- `asset_identifiers` é projeção derivada: auditá-la duplicaria, com outro
-- nome, o que a trilha de `assets` já registra.

GRANT EXECUTE ON FUNCTION aurora.transfer_asset(uuid, uuid, text, aurora.transfer_kind, timestamptz) TO aurora_app;
GRANT EXECUTE ON FUNCTION aurora.merge_manufacturers(uuid, uuid) TO aurora_app;
