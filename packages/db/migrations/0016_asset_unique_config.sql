-- =============================================================================
-- Aurora — 0016 mudança da configuração de unicidade de ativos · EPIC-005
--
-- DEFEITO QUE ESTA MIGRATION CORRIGE
--
-- Encontrado pelo teste "mudar a configuração passa a valer para o próximo
-- cadastro", que passou quando deveria falhar.
--
-- `asset_identifiers` (0014) é uma projeção construída no momento em que o
-- ativo é gravado, conforme a configuração vigente NAQUELE momento. Trocar
-- `asset_unique_fields` depois não reprojetava nada. Consequência: a
-- organização marcava "patrimônio é único", a interface confirmava, e os
-- 27 mil ativos já cadastrados continuavam com patrimônio repetido — invisíveis.
-- A regra valia só para o que viesse depois, e ninguém era avisado disso.
--
-- Configuração que parece aplicada e não está é pior que configuração ausente:
-- a ausente ninguém confia, a falsa todo mundo confia.
--
-- CORREÇÃO
--
-- Mudar a configuração REPROJETA todos os ativos da organização, na mesma
-- transação. Se houver duplicata preexistente, a operação falha — corretamente:
-- não dá para declarar único um campo que já está repetido. E, para que a
-- recusa seja útil em vez de apenas correta, existe uma função que lista os
-- conflitos ANTES, para a interface mostrar o que precisa ser resolvido.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Conflitos que uma configuração causaria, sem aplicá-la.
--
-- É a pergunta que a tela de configuração precisa fazer antes de deixar alguém
-- clicar em salvar: "quais patrimônios estão repetidos hoje?".
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.asset_identifier_conflicts(
  p_organization_id uuid,
  p_fields          text[],
  p_scope           text
)
RETURNS TABLE (field text, value_normalized text, asset_count bigint, sample_names text[])
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  WITH projecao AS (
    SELECT
      f.field,
      CASE WHEN p_scope = 'customer' THEN a.customer_id ELSE a.organization_id END AS scope_key,
      replace(aurora.normalize_label(
        CASE f.field
          WHEN 'tag'           THEN a.tag
          WHEN 'serial_number' THEN a.serial_number
          WHEN 'asset_number'  THEN a.asset_number
        END
      ), ' ', '') AS value_normalized,
      a.name
    FROM aurora.assets a
    CROSS JOIN unnest(p_fields) AS f(field)
    WHERE a.organization_id = p_organization_id
      AND a.deleted_at IS NULL
  )
  SELECT p.field, p.value_normalized, count(*) AS asset_count,
         (array_agg(p.name ORDER BY p.name))[1:5] AS sample_names
    FROM projecao p
   WHERE p.value_normalized <> ''
   GROUP BY p.field, p.scope_key, p.value_normalized
  HAVING count(*) > 1
   ORDER BY count(*) DESC, p.field
$fn$;

-- -----------------------------------------------------------------------------
-- Reprojeta todos os ativos de uma organização.
--
-- Uma única instrução para as três operações — apagar, projetar, deixar o
-- índice decidir — em vez de um laço por ativo. Numa organização com 27 mil
-- ativos a diferença é entre um comando e 27 mil.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.rebuild_asset_identifiers(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE
  v_fields text[];
  v_scope  text;
  v_count  integer;
BEGIN
  SELECT asset_unique_fields, asset_unique_scope INTO v_fields, v_scope
    FROM aurora.organizations WHERE id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organização inexistente' USING ERRCODE = 'foreign_key_violation';
  END IF;

  DELETE FROM aurora.asset_identifiers WHERE organization_id = p_organization_id;

  INSERT INTO aurora.asset_identifiers (organization_id, asset_id, field, scope_key, value_normalized)
  SELECT
    a.organization_id,
    a.id,
    f.field,
    CASE WHEN v_scope = 'customer' THEN a.customer_id ELSE a.organization_id END,
    replace(aurora.normalize_label(
      CASE f.field
        WHEN 'tag'           THEN a.tag
        WHEN 'serial_number' THEN a.serial_number
        WHEN 'asset_number'  THEN a.asset_number
      END
    ), ' ', '')
  FROM aurora.assets a
  CROSS JOIN unnest(v_fields) AS f(field)
  WHERE a.organization_id = p_organization_id
    AND a.deleted_at IS NULL
    AND replace(aurora.normalize_label(
          CASE f.field
            WHEN 'tag'           THEN a.tag
            WHEN 'serial_number' THEN a.serial_number
            WHEN 'asset_number'  THEN a.asset_number
          END
        ), ' ', '') <> '';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

-- -----------------------------------------------------------------------------
-- A mudança de configuração dispara a reprojeção.
--
-- Não é um passo que alguém precisa lembrar de executar depois: é o mesmo
-- comando. Ou a configuração vale para o acervo inteiro, ou ela não é salva.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_asset_unique_config_changed() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_conflitos text;
BEGIN
  IF NEW.asset_unique_fields IS NOT DISTINCT FROM OLD.asset_unique_fields
     AND NEW.asset_unique_scope IS NOT DISTINCT FROM OLD.asset_unique_scope THEN
    RETURN NULL;
  END IF;

  -- A recusa vem antes, com a lista, porque "violação de índice único" não diz
  -- a ninguém QUAL patrimônio está repetido nem em quais ativos.
  SELECT string_agg(format('%s "%s" em %s ativos', c.field, c.value_normalized, c.asset_count), '; ')
    INTO v_conflitos
    FROM aurora.asset_identifier_conflicts(NEW.id, NEW.asset_unique_fields, NEW.asset_unique_scope) c;

  IF v_conflitos IS NOT NULL THEN
    RAISE EXCEPTION 'não é possível exigir unicidade: já existem valores repetidos — %', v_conflitos
      USING ERRCODE = 'unique_violation';
  END IF;

  PERFORM aurora.rebuild_asset_identifiers(NEW.id);
  RETURN NULL;
END
$fn$;

CREATE TRIGGER organizations_asset_unique_config
  AFTER UPDATE OF asset_unique_fields, asset_unique_scope ON aurora.organizations
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_asset_unique_config_changed();

GRANT EXECUTE ON FUNCTION aurora.asset_identifier_conflicts(uuid, text[], text) TO aurora_app, aurora_readonly;
GRANT EXECUTE ON FUNCTION aurora.rebuild_asset_identifiers(uuid) TO aurora_app;
