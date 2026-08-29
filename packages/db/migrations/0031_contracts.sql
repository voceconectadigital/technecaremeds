-- =============================================================================
-- Aurora — 0031 contratos (SPEC v0.2 §17) · EPIC-017
--
-- Na referência, contrato é cadastro documental: nome, apelido, contratante,
-- datas. Aqui é o instrumento que governa SLA, escopo, preço e medição.
--
-- DUAS DECISÕES ESTRUTURAIS
--
-- 1. COBERTURA É EXPRESSÃO, NÃO LISTA
--    "Todos os ativos da categoria Ventilador na subárvore UTI" continua
--    valendo para o ventilador que chegar amanhã. Uma lista marcada a mão
--    envelhece no dia seguinte e ninguém percebe — e o ativo que ficou de fora
--    é justamente o que vai gerar a discussão sobre quem paga o conserto.
--
--    O preço dessa escolha é que dois contratos podem passar a disputar o mesmo
--    ativo sem ninguém ter feito nada. A validação na escrita pega o conflito
--    entre os ativos que existem hoje; o desempate por especificidade
--    (`contract_for_asset`) resolve o que nasce depois, de forma determinística.
--
-- 2. O PERÍODO DE MEDIÇÃO É DERIVADO E DEPOIS CONGELADO
--    Enquanto aberto, o período se recalcula a partir dos fatos — OS, horas,
--    peças, relógios de SLA. Fechado, vira número gravado. Sem o congelamento,
--    reabrir uma OS de março mudaria a fatura de março que o cliente já pagou.
-- =============================================================================

CREATE TYPE aurora.contract_kind AS ENUM (
  'full_service', 'preventive_only', 'on_demand', 'rental', 'loan', 'warranty'
);
CREATE TYPE aurora.contract_status AS ENUM (
  'draft', 'active', 'suspended', 'expired', 'terminated'
);
CREATE TYPE aurora.billing_model AS ENUM ('fixed_monthly', 'per_asset', 'per_call', 'hybrid');
CREATE TYPE aurora.coverage_kind AS ENUM (
  'customer', 'location_subtree', 'asset_category', 'asset'
);

CREATE TABLE aurora.contracts (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  number            text NOT NULL,
  customer_id       uuid NOT NULL,
  kind              aurora.contract_kind NOT NULL,
  status            aurora.contract_status NOT NULL DEFAULT 'draft',
  title             text,

  starts_on         date NOT NULL,
  /** Vigência aberta é legítima: comodato e garantia de fabricante costumam ser. */
  ends_on           date,
  auto_renew        boolean NOT NULL DEFAULT false,
  renewal_notice_days integer NOT NULL DEFAULT 30,
  adjustment_index  text,

  /** Degrau 2 da cascata de SLA (§11) — abaixo do ativo, acima do cliente. */
  sla_policy_id     uuid,

  billing_model     aurora.billing_model NOT NULL DEFAULT 'fixed_monthly',
  monthly_value     numeric(14,2),
  currency          text NOT NULL DEFAULT 'BRL',
  /** Franquias do período. NULL = sem franquia, que é diferente de zero. */
  included_calls    integer,
  included_hours    numeric(10,2),
  overage_call_rate numeric(14,2),
  overage_hour_rate numeric(14,2),

  /**
   * Regra de glosa. Sem valor configurado NÃO há cálculo de desconto: a
   * auditoria não confirmou fórmula nenhuma na referência, e inventar uma
   * escreveria no sistema uma cláusula que não está em contrato algum.
   */
  penalty_percent_per_breach numeric(6,3),
  penalty_cap_percent        numeric(6,3),

  /** Meta contratada, quando existe — usada só para comparar, nunca para punir sozinha. */
  sla_target_percent      numeric(5,2),
  plan_target_percent     numeric(5,2),

  notes             text,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,

  CONSTRAINT contracts_number_present CHECK (length(btrim(number)) > 0),
  CONSTRAINT contracts_range_sane CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT contracts_notice_sane CHECK (renewal_notice_days BETWEEN 0 AND 365),
  CONSTRAINT contracts_values_positive CHECK (
    (monthly_value     IS NULL OR monthly_value     >= 0) AND
    (included_calls    IS NULL OR included_calls    >= 0) AND
    (included_hours    IS NULL OR included_hours    >= 0) AND
    (overage_call_rate IS NULL OR overage_call_rate >= 0) AND
    (overage_hour_rate IS NULL OR overage_hour_rate >= 0)
  ),
  CONSTRAINT contracts_penalty_sane CHECK (
    (penalty_percent_per_breach IS NULL OR penalty_percent_per_breach > 0) AND
    (penalty_cap_percent IS NULL OR (penalty_cap_percent > 0 AND penalty_cap_percent <= 100))
  ),
  CONSTRAINT contracts_targets_sane CHECK (
    (sla_target_percent  IS NULL OR sla_target_percent  BETWEEN 0 AND 100) AND
    (plan_target_percent IS NULL OR plan_target_percent BETWEEN 0 AND 100)
  ),
  CONSTRAINT contracts_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT contracts_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT contracts_sla_policy_org_fk
    FOREIGN KEY (sla_policy_id, organization_id)
    REFERENCES aurora.sla_policies (id, organization_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX contracts_number_uq ON aurora.contracts (organization_id, number);
CREATE INDEX contracts_customer_idx ON aurora.contracts (organization_id, customer_id, status);
CREATE INDEX contracts_ends_idx ON aurora.contracts (organization_id, ends_on)
  WHERE status = 'active' AND ends_on IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Cobertura — a expressão de ativos.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.contract_coverages (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  contract_id       uuid NOT NULL,
  kind              aurora.coverage_kind NOT NULL,
  asset_id          uuid,
  location_id       uuid,
  asset_category_id uuid,
  /** Especificidade congelada na escrita — desempate determinístico. */
  specificity       integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,

  CONSTRAINT coverages_shape CHECK (
    (kind = 'customer'         AND asset_id IS NULL AND location_id IS NULL AND asset_category_id IS NULL) OR
    (kind = 'asset'            AND asset_id IS NOT NULL AND location_id IS NULL) OR
    (kind = 'asset_category'   AND asset_category_id IS NOT NULL AND asset_id IS NULL AND location_id IS NULL) OR
    (kind = 'location_subtree' AND location_id IS NOT NULL AND asset_id IS NULL)
  ),
  CONSTRAINT coverages_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT coverages_contract_org_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES aurora.contracts (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT coverages_asset_org_fk
    FOREIGN KEY (asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT coverages_location_org_fk
    FOREIGN KEY (location_id, organization_id)
    REFERENCES aurora.locations (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT coverages_category_org_fk
    FOREIGN KEY (asset_category_id, organization_id)
    REFERENCES aurora.asset_categories (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX coverages_contract_idx ON aurora.contract_coverages (organization_id, contract_id);

-- -----------------------------------------------------------------------------
-- Serviços incluídos — quais naturezas de OS o contrato cobre.
--
-- A linha existir significa "coberto"; `billed_separately` marca a natureza que
-- o contrato prevê mas fatura à parte. Sem essa distinção, "não está na lista"
-- serviria para duas coisas diferentes — fora do escopo e dentro do escopo com
-- cobrança — e a medição não saberia qual delas foi.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.contract_services (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  contract_id       uuid NOT NULL,
  work_order_type_id uuid NOT NULL,
  billed_separately boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,

  CONSTRAINT contract_services_uq UNIQUE (contract_id, work_order_type_id),
  CONSTRAINT contract_services_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT contract_services_contract_org_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES aurora.contracts (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT contract_services_type_org_fk
    FOREIGN KEY (work_order_type_id, organization_id)
    REFERENCES aurora.catalog_items (id, organization_id) ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- SLA por criticidade — o refinamento previsto em §17.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.contract_sla_overrides (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  contract_id         uuid NOT NULL,
  criticality_level_id uuid NOT NULL,
  sla_policy_id       uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,

  CONSTRAINT sla_overrides_uq UNIQUE (contract_id, criticality_level_id),
  CONSTRAINT sla_overrides_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT sla_overrides_contract_org_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES aurora.contracts (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT sla_overrides_criticality_org_fk
    FOREIGN KEY (criticality_level_id, organization_id)
    REFERENCES aurora.criticality_levels (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT sla_overrides_policy_org_fk
    FOREIGN KEY (sla_policy_id, organization_id)
    REFERENCES aurora.sla_policies (id, organization_id) ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- Período de medição.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.contract_periods (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  contract_id       uuid NOT NULL,
  /** Competência `YYYY-MM`. Texto, e não data, porque é um mês, não um dia. */
  period            text NOT NULL,
  starts_on         date NOT NULL,
  ends_on           date NOT NULL,

  work_order_count  integer NOT NULL DEFAULT 0,
  labor_minutes     integer NOT NULL DEFAULT 0,
  parts_cost        numeric(14,2) NOT NULL DEFAULT 0,
  sla_total         integer NOT NULL DEFAULT 0,
  sla_met           integer NOT NULL DEFAULT 0,
  plan_expected     integer NOT NULL DEFAULT 0,
  plan_done         integer NOT NULL DEFAULT 0,

  overage_calls     integer NOT NULL DEFAULT 0,
  overage_hours     numeric(10,2) NOT NULL DEFAULT 0,
  overage_amount    numeric(14,2) NOT NULL DEFAULT 0,
  /** Glosa calculada. NULL = sem regra configurada, que não é o mesmo que zero. */
  penalty_amount    numeric(14,2),

  closed_at         timestamptz,
  closed_by         uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT periods_period_shape CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT periods_counts_sane CHECK (
    sla_met <= sla_total AND plan_done <= plan_expected AND labor_minutes >= 0
  ),
  CONSTRAINT periods_uq UNIQUE (contract_id, period),
  CONSTRAINT periods_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT periods_contract_org_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES aurora.contracts (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX periods_open_idx ON aurora.contract_periods (organization_id, contract_id)
  WHERE closed_at IS NULL;

-- -----------------------------------------------------------------------------
-- Vínculo da OS com o contrato.
--
-- Congelado na abertura, pela mesma razão que a política de SLA é (§11): trocar
-- o contrato amanhã não pode reescrever sob qual acordo o atendimento de ontem
-- foi feito.
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.work_orders ADD COLUMN contract_id uuid;
ALTER TABLE aurora.work_orders ADD CONSTRAINT work_orders_contract_org_fk
  FOREIGN KEY (contract_id, organization_id)
  REFERENCES aurora.contracts (id, organization_id) ON DELETE SET NULL;
CREATE INDEX work_orders_contract_idx ON aurora.work_orders (organization_id, contract_id)
  WHERE contract_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Resolução da cobertura: quais ativos um contrato cobre hoje.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.resolve_contract_assets(p_contract_id uuid)
RETURNS TABLE (asset_id uuid)
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  SELECT DISTINCT a.id
    FROM aurora.contracts ct
    JOIN aurora.contract_coverages cv ON cv.contract_id = ct.id
    JOIN aurora.assets a ON a.customer_id = ct.customer_id
   WHERE ct.id = p_contract_id
     AND a.deleted_at IS NULL
     AND a.status NOT IN ('decommissioned', 'disposed')
     AND (
       cv.kind = 'customer'
       OR (cv.kind = 'asset'          AND a.id = cv.asset_id)
       OR (cv.kind = 'asset_category' AND a.asset_category_id = cv.asset_category_id)
       OR (cv.kind = 'location_subtree' AND EXISTS (
             SELECT 1 FROM aurora.locations l
              WHERE l.id = cv.location_id AND a.location_path LIKE l.path || '%')
           AND (cv.asset_category_id IS NULL OR a.asset_category_id = cv.asset_category_id))
     )
$fn$;

GRANT EXECUTE ON FUNCTION aurora.resolve_contract_assets(uuid) TO aurora_app, aurora_readonly;

-- -----------------------------------------------------------------------------
-- O contrato que responde por um ativo numa data — UMA linha, sempre.
--
-- A regra da SPEC é "um ativo em um contrato por vez numa dada data", e ela é
-- validada na escrita. Mas a cobertura é expressão: o ativo que for cadastrado
-- amanhã pode casar com dois contratos sem ninguém ter feito nada. Devolver os
-- dois e deixar a aplicação escolher faria a política de SLA de uma OS depender
-- da ordem de leitura do banco — pior que uma regra discutível, porque é uma
-- regra invisível.
--
-- Vence quem nomeia mais de perto (`specificity`), e o empate cai no contrato
-- que começou depois: entre dois acordos igualmente específicos, o mais recente
-- é o que as partes negociaram por último.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.contract_for_asset(p_asset_id uuid, p_on date)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  SELECT ct.id
    FROM aurora.contracts ct
    JOIN aurora.contract_coverages cv ON cv.contract_id = ct.id
    JOIN aurora.assets a ON a.id = p_asset_id AND a.customer_id = ct.customer_id
   WHERE ct.status = 'active'
     AND ct.starts_on <= p_on
     AND (ct.ends_on IS NULL OR ct.ends_on >= p_on)
     AND (
       cv.kind = 'customer'
       OR (cv.kind = 'asset'          AND a.id = cv.asset_id)
       OR (cv.kind = 'asset_category' AND a.asset_category_id = cv.asset_category_id)
       OR (cv.kind = 'location_subtree' AND EXISTS (
             SELECT 1 FROM aurora.locations l
              WHERE l.id = cv.location_id AND a.location_path LIKE l.path || '%')
           AND (cv.asset_category_id IS NULL OR a.asset_category_id = cv.asset_category_id))
     )
   ORDER BY cv.specificity DESC, ct.starts_on DESC, ct.id
   LIMIT 1
$fn$;

GRANT EXECUTE ON FUNCTION aurora.contract_for_asset(uuid, date) TO aurora_app, aurora_readonly;

-- -----------------------------------------------------------------------------
-- A OS nasce carimbada com o contrato que responde por ela.
--
-- No gatilho, e não na aplicação, porque OS nasce por três caminhos — manual,
-- a partir de solicitação e gerada por plano — e o que vale para um tem de
-- valer para os três. Carimbar em um só lugar da aplicação seria descobrir
-- meses depois que as OS preventivas não tinham contrato.
--
-- Só no INSERT: pela mesma razão que a política de SLA é congelada (§11),
-- trocar o contrato amanhã não pode reescrever sob qual acordo o atendimento de
-- ontem foi feito.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_work_order_contract() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF NEW.contract_id IS NULL AND NEW.asset_id IS NOT NULL THEN
    NEW.contract_id := aurora.contract_for_asset(NEW.asset_id, CURRENT_DATE);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER work_orders_contract BEFORE INSERT ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_work_order_contract();

-- -----------------------------------------------------------------------------
-- Cascata de SLA, agora com o degrau do contrato (§11).
--
-- A ordem prometida em 0027 é cumprida aqui sem mudar quem já dependia dela:
-- ativo → contrato → cliente → organização. O `override` por criticidade entra
-- dentro do degrau do contrato, porque é refinamento do mesmo acordo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aurora.resolve_sla_policy(p_asset_id uuid, p_customer_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  WITH contrato AS (
    SELECT aurora.contract_for_asset(p_asset_id, CURRENT_DATE) AS id
  )
  SELECT COALESCE(
    (SELECT a.sla_policy_id FROM aurora.assets a WHERE a.id = p_asset_id),
    (SELECT o.sla_policy_id
       FROM aurora.contract_sla_overrides o, contrato, aurora.assets a
      WHERE o.contract_id = contrato.id
        AND a.id = p_asset_id
        AND o.criticality_level_id = a.criticality_id),
    (SELECT ct.sla_policy_id FROM aurora.contracts ct, contrato WHERE ct.id = contrato.id),
    (SELECT c.default_sla_policy_id FROM aurora.customers c WHERE c.id = p_customer_id),
    (SELECT o.default_sla_policy_id FROM aurora.organizations o
      WHERE o.id = aurora.current_organization_id())
  )
$fn$;

-- -----------------------------------------------------------------------------
-- Guardas.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_contract_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('terminated', 'expired')
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND (NEW.starts_on, NEW.ends_on, NEW.customer_id, NEW.monthly_value)
         IS DISTINCT FROM (OLD.starts_on, OLD.ends_on, OLD.customer_id, OLD.monthly_value) THEN
    -- Contrato encerrado é o registro do que valeu. Reescrever a vigência de um
    -- contrato terminado mudaria, retroativamente, sob qual acordo cada OS do
    -- passado foi executada.
    RAISE EXCEPTION 'contrato % está encerrado: vigência e valores não se alteram', OLD.number
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER contracts_guard BEFORE UPDATE ON aurora.contracts
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_contract_guard();

CREATE FUNCTION aurora.fn_contract_period_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF OLD.closed_at IS NOT NULL THEN
    -- Período fechado é a fatura que o cliente recebeu. Recalcular depois faria
    -- reabrir uma OS de março mudar o número de março — e o cliente teria em
    -- mãos dois relatórios diferentes do mesmo mês, ambos emitidos por nós.
    RAISE EXCEPTION 'período % já está fechado e não se recalcula nem se apaga', OLD.period
      USING ERRCODE = '23514';
  END IF;

  -- Em DELETE não existe NEW: devolver NEW cancelaria a operação em silêncio,
  -- que é o modo mais discreto de um gatilho mentir sobre o que fez.
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END
$fn$;

CREATE TRIGGER contract_periods_guard BEFORE UPDATE OR DELETE ON aurora.contract_periods
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_contract_period_guard();

CREATE TRIGGER contracts_touch BEFORE UPDATE ON aurora.contracts
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER contract_periods_touch BEFORE UPDATE ON aurora.contract_periods
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER contracts_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.contracts
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('number');
CREATE TRIGGER contract_coverages_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.contract_coverages
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('kind', 'contract_id');
CREATE TRIGGER contract_periods_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.contract_periods
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('period', 'contract_id');

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contracts', 'contract_coverages', 'contract_services',
    'contract_sla_overrides', 'contract_periods'
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
