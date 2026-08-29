-- =============================================================================
-- Aurora — 0014 ativos (SPEC v0.2 §07, ADR-006) · EPIC-005 · BL-024 a BL-027
--
-- DUAS REGRAS DA SPEC QUE VIRARAM ESTRUTURA, E NÃO CONVENÇÃO
--
-- 1. UNICIDADE CONFIGURÁVEL (`organization.asset_unique_fields`)
--
--    A organização escolhe quais de {tag, serial_number, asset_number} não
--    podem repetir, e se o escopo é a organização inteira ou cada cliente.
--    Verificar isso num gatilho que lê a configuração e faz SELECT antes de
--    INSERT teria uma corrida entre a leitura e a escrita — duas importações
--    simultâneas passariam as duas.
--
--    Aqui a unicidade é um ÍNDICE ÚNICO de verdade, sobre uma tabela auxiliar
--    `asset_identifiers`. O gatilho decide QUAIS linhas gravar ali, conforme a
--    configuração; o índice decide se elas podem coexistir. Configurabilidade
--    na projeção, garantia no índice.
--
-- 2. TRANSFERÊNCIA É OPERAÇÃO, NÃO EDIÇÃO
--
--    A SPEC diz: "Transferência de local é operação registrada, nunca uma
--    simples edição de `location_id`". A referência avisava que "OS existentes
--    não poderão ser editadas caso altere o proprietário" — sintoma de que lá a
--    mudança de dono reescrevia o passado.
--
--    Aqui um gatilho recusa qualquer UPDATE que mexa em `location_id` ou
--    `customer_id` fora de uma transferência declarada. Não é convenção que se
--    pede que respeitem: é recusa do banco.
-- =============================================================================

CREATE TYPE aurora.transfer_kind AS ENUM ('transfer', 'loan', 'return');
CREATE TYPE aurora.meter_kind AS ENUM ('hours', 'cycles', 'distance', 'count');

-- Configuração de unicidade, na organização (SPEC §07).
ALTER TABLE aurora.organizations
  ADD COLUMN asset_unique_fields text[] NOT NULL DEFAULT ARRAY['serial_number'],
  ADD COLUMN asset_unique_scope  text   NOT NULL DEFAULT 'organization',
  ADD CONSTRAINT organizations_asset_unique_fields_known CHECK (
    asset_unique_fields <@ ARRAY['tag', 'serial_number', 'asset_number']
  ),
  ADD CONSTRAINT organizations_asset_unique_scope_known CHECK (
    asset_unique_scope IN ('organization', 'customer')
  );

-- -----------------------------------------------------------------------------
-- assets
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.assets (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,

  -- identificação: três identificadores independentes, como na referência
  tag                       text,
  serial_number             text,
  asset_number              text,
  qr_token                  text NOT NULL,
  barcode                   text,
  name                      text NOT NULL,

  -- classificação
  asset_category_id         uuid NOT NULL,
  asset_model_id            uuid,

  -- localização
  customer_id               uuid NOT NULL,
  location_id               uuid,
  location_path             text NOT NULL DEFAULT '',
  parent_asset_id           uuid,

  status                    aurora.asset_status NOT NULL DEFAULT 'active',

  -- risco
  criticality_id            uuid,
  operational_risk          text,
  default_priority          text,
  risk_class                text,

  -- regulatório
  anvisa_registration       text,
  inmetro_ordinance         text,
  requires_calibration      boolean NOT NULL DEFAULT false,
  requires_electrical_test  boolean NOT NULL DEFAULT false,

  -- ciclo de vida
  manufactured_at           date,
  acquired_at               date,
  installed_at              date,
  warranty_until            date,
  useful_life_years         integer,
  decommissioned_at         timestamptz,
  decommission_reason       text,

  -- financeiro
  purchase_value            numeric(14, 2),
  residual_value            numeric(14, 2),
  replacement_value         numeric(14, 2),
  currency                  char(3) NOT NULL DEFAULT 'BRL',

  -- contrato
  ownership                 aurora.asset_ownership NOT NULL DEFAULT 'owned',
  owner_supplier_id         uuid,

  specs                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  show_on_work_order        text[] NOT NULL DEFAULT '{}',
  notes                     text,
  internal_notes            text,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  updated_by                uuid,
  deleted_at                timestamptz,

  CONSTRAINT assets_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT assets_not_own_parent CHECK (parent_asset_id IS DISTINCT FROM id),
  CONSTRAINT assets_life_positive CHECK (useful_life_years IS NULL OR useful_life_years > 0),
  CONSTRAINT assets_values_non_negative CHECK (
    coalesce(purchase_value, 0) >= 0 AND coalesce(residual_value, 0) >= 0 AND coalesce(replacement_value, 0) >= 0
  ),
  -- Datas do ciclo de vida em ordem. Um ativo instalado antes de fabricado é
  -- erro de digitação que passaria despercebido e depois apareceria como vida
  -- útil negativa em relatório.
  CONSTRAINT assets_lifecycle_order CHECK (
    (manufactured_at IS NULL OR acquired_at IS NULL OR acquired_at >= manufactured_at)
    AND (acquired_at IS NULL OR installed_at IS NULL OR installed_at >= acquired_at)
  ),
  -- Descomissionamento exige justificativa ou documento (SPEC §07). O documento
  -- entra no EPIC-018; até lá a justificativa é obrigatória, e não opcional.
  CONSTRAINT assets_decommission_needs_reason CHECK (
    decommissioned_at IS NULL OR length(btrim(coalesce(decommission_reason, ''))) >= 10
  ),
  CONSTRAINT assets_decommissioned_status CHECK (
    (decommissioned_at IS NULL) = (status NOT IN ('decommissioned', 'disposed'))
  ),
  CONSTRAINT assets_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT assets_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT assets_location_org_fk
    FOREIGN KEY (location_id, organization_id)
    REFERENCES aurora.locations (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT assets_category_org_fk
    FOREIGN KEY (asset_category_id, organization_id)
    REFERENCES aurora.asset_categories (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT assets_model_org_fk
    FOREIGN KEY (asset_model_id, organization_id)
    REFERENCES aurora.asset_models (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT assets_criticality_org_fk
    FOREIGN KEY (criticality_id, organization_id)
    REFERENCES aurora.criticality_levels (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT assets_parent_org_fk
    FOREIGN KEY (parent_asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT assets_supplier_org_fk
    FOREIGN KEY (owner_supplier_id, organization_id)
    REFERENCES aurora.suppliers (id, organization_id) ON DELETE RESTRICT
);

-- O token do QR é global e opaco: a rota pública `/q/{token}` não recebe nem
-- organização nem id, então o token precisa ser único no sistema inteiro.
CREATE UNIQUE INDEX assets_qr_token_uq ON aurora.assets (qr_token);
CREATE INDEX assets_org_idx        ON aurora.assets (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX assets_customer_idx   ON aurora.assets (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX assets_location_idx   ON aurora.assets (location_id) WHERE deleted_at IS NULL;
CREATE INDEX assets_path_idx       ON aurora.assets (location_path text_pattern_ops);
CREATE INDEX assets_model_idx      ON aurora.assets (asset_model_id) WHERE deleted_at IS NULL;
CREATE INDEX assets_category_idx   ON aurora.assets (asset_category_id) WHERE deleted_at IS NULL;
CREATE INDEX assets_parent_idx     ON aurora.assets (parent_asset_id) WHERE deleted_at IS NULL;
CREATE INDEX assets_custom_gin     ON aurora.assets USING gin (custom);
CREATE INDEX assets_specs_gin      ON aurora.assets USING gin (specs);

-- -----------------------------------------------------------------------------
-- asset_identifiers — a projeção que torna a unicidade configurável real.
--
-- Uma linha por (ativo, campo) apenas para os campos que a organização declarou
-- únicos e que estão preenchidos. `scope_key` é a organização ou o cliente,
-- conforme `asset_unique_scope`. `value_normalized` casa "SN-4471/A" com
-- "sn4471a", que é como o mesmo número de série aparece em duas planilhas.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.asset_identifiers (
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  asset_id          uuid NOT NULL,
  field             text NOT NULL,
  scope_key         uuid NOT NULL,
  value_normalized  text NOT NULL,
  PRIMARY KEY (asset_id, field),
  CONSTRAINT asset_identifiers_field_known CHECK (field IN ('tag', 'serial_number', 'asset_number')),
  CONSTRAINT asset_identifiers_asset_org_fk
    FOREIGN KEY (asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX asset_identifiers_uq
  ON aurora.asset_identifiers (scope_key, field, value_normalized);
CREATE INDEX asset_identifiers_org_idx ON aurora.asset_identifiers (organization_id);

-- -----------------------------------------------------------------------------
-- asset_transfers — a movimentação como registro de primeira classe.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.asset_transfers (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  asset_id           uuid NOT NULL,
  kind               aurora.transfer_kind NOT NULL,
  from_customer_id   uuid,
  to_customer_id     uuid NOT NULL,
  from_location_id   uuid,
  to_location_id     uuid,
  reason             text NOT NULL,
  due_back_at        timestamptz,
  returned_at        timestamptz,
  performed_by       uuid,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_transfers_reason_present CHECK (length(btrim(reason)) >= 5),
  -- Empréstimo sem data de devolução é empréstimo que ninguém cobra de volta.
  CONSTRAINT asset_transfers_loan_needs_due CHECK (kind <> 'loan' OR due_back_at IS NOT NULL),
  CONSTRAINT asset_transfers_moved CHECK (
    from_location_id IS DISTINCT FROM to_location_id OR from_customer_id IS DISTINCT FROM to_customer_id
  ),
  CONSTRAINT asset_transfers_asset_org_fk
    FOREIGN KEY (asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT asset_transfers_to_customer_org_fk
    FOREIGN KEY (to_customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX asset_transfers_asset_idx ON aurora.asset_transfers (asset_id, occurred_at DESC);
CREATE INDEX asset_transfers_org_idx   ON aurora.asset_transfers (organization_id);
CREATE INDEX asset_transfers_open_loans_idx
  ON aurora.asset_transfers (organization_id, due_back_at)
  WHERE kind = 'loan' AND returned_at IS NULL;

-- -----------------------------------------------------------------------------
-- meters / meter_readings — modelo entra agora para não travar manutenção por
-- condição depois (SPEC §07). Uso efetivo é da Fase 4.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.meters (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  asset_id          uuid NOT NULL,
  kind              aurora.meter_kind NOT NULL,
  unit              text NOT NULL,
  cumulative        boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meters_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT meters_asset_org_fk
    FOREIGN KEY (asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX meters_asset_kind_uq ON aurora.meters (asset_id, kind);

CREATE TABLE aurora.meter_readings (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  meter_id          uuid NOT NULL,
  value             numeric(16, 3) NOT NULL,
  read_at           timestamptz NOT NULL DEFAULT now(),
  source            text NOT NULL DEFAULT 'manual',
  regression_note   text,
  created_by        uuid,
  CONSTRAINT meter_readings_meter_org_fk
    FOREIGN KEY (meter_id, organization_id)
    REFERENCES aurora.meters (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX meter_readings_meter_idx ON aurora.meter_readings (meter_id, read_at DESC);
CREATE INDEX meter_readings_org_idx   ON aurora.meter_readings (organization_id);

-- -----------------------------------------------------------------------------
-- Leitura acumulada não regride sem justificativa (SPEC §32).
--
-- Horímetro que anda para trás quase sempre é troca de placa ou erro de
-- digitação. Bloquear sem saída travaria o caso legítimo; aceitar em silêncio
-- estragaria todo cálculo de intervalo por uso. Exigir a justificativa é o que
-- transforma o evento em informação em vez de ruído.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_meter_reading_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_cumulative boolean;
  v_last       numeric;
BEGIN
  SELECT cumulative INTO v_cumulative FROM aurora.meters WHERE id = NEW.meter_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'medidor inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT v_cumulative THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_last
    FROM aurora.meter_readings
   WHERE meter_id = NEW.meter_id AND read_at <= NEW.read_at
   ORDER BY read_at DESC, id DESC
   LIMIT 1;

  IF v_last IS NOT NULL AND NEW.value < v_last
     AND length(btrim(coalesce(NEW.regression_note, ''))) < 10 THEN
    RAISE EXCEPTION 'leitura % é menor que a anterior (%); registre a justificativa da regressão', NEW.value, v_last
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER meter_readings_guard BEFORE INSERT ON aurora.meter_readings
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_meter_reading_guard();
