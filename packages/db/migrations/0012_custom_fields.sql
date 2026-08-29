-- =============================================================================
-- Aurora — 0012 campos personalizados (SPEC v0.2 §29, ADR-009 · EPIC-004)
--
-- O valor mora em `entidade.custom jsonb`; a DEFINIÇÃO mora aqui, tipada. É o
-- meio-termo do ADR-009: EAV puro destrói a legibilidade das consultas, coluna
-- real por tenant é inviável com centenas de organizações, e `jsonb` sem
-- definição é o que a referência fazia com o checklist — impossível de validar,
-- de listar em coluna e de usar em relatório.
--
-- O que esta migration garante e o motor de validação sozinho não garantiria:
--   · `key` imutável depois de criada (renomear é criar outro campo e migrar)
--   · no máximo 50 definições por entidade por organização
--   · unicidade da chave por entidade, inclusive contra definição arquivada
-- =============================================================================

CREATE TYPE aurora.custom_field_kind AS ENUM (
  'text', 'number', 'boolean', 'date', 'select', 'multi_select', 'user', 'asset', 'currency', 'url'
);

CREATE TABLE aurora.custom_field_definitions (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  entity_type       text NOT NULL,
  key               text NOT NULL,
  label             text NOT NULL,
  help_text         text NOT NULL DEFAULT '',
  field_group       text,
  position          integer NOT NULL DEFAULT 0,
  kind              aurora.custom_field_kind NOT NULL,
  options           text[] NOT NULL DEFAULT '{}',
  min_value         numeric,
  max_value         numeric,
  regex             text,
  unit              text,
  required          boolean NOT NULL DEFAULT false,
  default_value     jsonb,
  applies_when      jsonb,
  searchable        boolean NOT NULL DEFAULT false,
  reportable        boolean NOT NULL DEFAULT true,
  visible_to_portal boolean NOT NULL DEFAULT false,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  CONSTRAINT custom_fields_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT custom_fields_entity_known CHECK (
    entity_type IN ('asset', 'work_order', 'customer', 'location', 'service_request', 'supplier')
  ),
  CONSTRAINT custom_fields_label_present CHECK (length(btrim(label)) > 0),
  CONSTRAINT custom_fields_range_order CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value),
  -- Seleção sem opção é um campo que ninguém consegue preencher; opção em campo
  -- que não é seleção é configuração que nunca será lida. Os dois são erro de
  -- configuração, e erro de configuração deve falhar onde foi configurado.
  CONSTRAINT custom_fields_options_coherent CHECK (
    (kind IN ('select', 'multi_select') AND cardinality(options) > 0)
    OR (kind NOT IN ('select', 'multi_select') AND cardinality(options) = 0)
  ),
  CONSTRAINT custom_fields_regex_only_text CHECK (regex IS NULL OR kind = 'text'),
  -- `applies_when` é objeto, não lista nem escalar: o formato pobre é
  -- deliberado (ver packages/domain/src/custom-fields.ts)
  CONSTRAINT custom_fields_applies_when_object CHECK (
    applies_when IS NULL OR jsonb_typeof(applies_when) = 'object'
  )
);

-- A chave é única mesmo contra definição arquivada: reaproveitá-la faria os
-- valores antigos guardados em `custom` passarem a ser lidos como se fossem do
-- campo novo — dado velho reinterpretado silenciosamente é pior que dado
-- perdido, porque ninguém percebe.
CREATE UNIQUE INDEX custom_fields_key_uq
  ON aurora.custom_field_definitions (organization_id, entity_type, key);
CREATE INDEX custom_fields_entity_idx
  ON aurora.custom_field_definitions (organization_id, entity_type, position)
  WHERE archived_at IS NULL;

-- -----------------------------------------------------------------------------
-- Guarda: chave imutável, tipo imutável e limite de 50 por entidade.
--
-- O tipo entra na lista porque mudar `text` para `number` deixaria todo valor
-- já gravado inválido de uma vez — e a validação passaria a recusar registros
-- que ninguém tocou.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_custom_field_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE v_count integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.key IS DISTINCT FROM OLD.key THEN
      RAISE EXCEPTION 'a chave "%" é imutável; para renomear, crie outro campo e migre os valores', OLD.key
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.entity_type IS DISTINCT FROM OLD.entity_type THEN
      RAISE EXCEPTION 'um campo não muda de entidade' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'o tipo do campo "%" é imutável: mudá-lo invalidaria os valores já gravados', OLD.key
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    SELECT count(*) INTO v_count
      FROM aurora.custom_field_definitions
     WHERE organization_id = NEW.organization_id
       AND entity_type = NEW.entity_type
       AND archived_at IS NULL
       AND id <> NEW.id;
    IF NEW.archived_at IS NULL AND v_count >= 50 THEN
      RAISE EXCEPTION 'limite de 50 campos personalizados por entidade atingido em "%"; arquive um campo antes de criar outro',
        NEW.entity_type
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER custom_fields_guard BEFORE INSERT OR UPDATE ON aurora.custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_custom_field_guard();

CREATE TRIGGER custom_fields_touch BEFORE UPDATE ON aurora.custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();

CREATE TRIGGER custom_fields_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('label');

-- -----------------------------------------------------------------------------
-- Índices GIN nas colunas `custom` existentes (§29).
--
-- As entidades que ainda não existem (assets, work_orders, service_requests)
-- ganham o seu na migration que as criar. Colocar aqui um índice para tabela
-- futura seria escrever migration que não roda.
-- -----------------------------------------------------------------------------
CREATE INDEX customers_custom_gin ON aurora.customers USING gin (custom);
CREATE INDEX locations_custom_gin ON aurora.locations USING gin (custom);
CREATE INDEX suppliers_custom_gin ON aurora.suppliers USING gin (custom);

-- -----------------------------------------------------------------------------
-- RLS e permissões
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.custom_field_definitions OWNER TO aurora_owner;
ALTER TABLE aurora.custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.custom_field_definitions FORCE  ROW LEVEL SECURITY;
CREATE POLICY custom_fields_tenant_isolation ON aurora.custom_field_definitions FOR ALL
  USING (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.custom_field_definitions TO aurora_app;
GRANT SELECT ON aurora.custom_field_definitions TO aurora_readonly;
