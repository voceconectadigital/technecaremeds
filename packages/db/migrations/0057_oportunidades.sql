-- =============================================================================
-- Aurora — 0057 oportunidade (núcleo)
-- Auditoria de gap V2 §27 e P1.7 · PLAT §4 e §5 "Oportunidade: necessidade,
-- ativo, prazo, origem, fornecedor, prioridade, autorização comercial"
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SÓ O NÚCLEO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Registro da necessidade, de onde ela veio, sobre qual equipamento, até
-- quando, com que prioridade, com qual fornecedor (opcional) — e o ATO de
-- autorização comercial, com permissão própria e trilha. Catálogo, cotação
-- avançada, mercado de equipamentos, comprador hospitalar e loja são FUTURO e
-- não estão aqui (PLAT §4 "evolução"; pedidos NS-012 a NS-014).
--
-- A oportunidade NÃO É ORÇAMENTO. O orçamento (`quotes`) é o desfecho: quando
-- a oportunidade autorizada vira proposta, ela aponta para o orçamento e passa
-- a `converted`. Um não substitui o outro.
--
-- Não há valor monetário: preço é do orçamento. Uma oportunidade com valor
-- estimado digitado à mão seria o primeiro número a vazar para onde não deve.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O GRAFO
-- ─────────────────────────────────────────────────────────────────────────────
--
--   identified ──► qualified ──► authorized ──► converted
--        │              │              └──────► cancelled
--        │              └─► declined
--        └──────────────┴─► cancelled
--
-- Quem pode cada aresta mora no domínio (`OPPORTUNITY_TRANSITIONS`); o banco
-- recusa aresta que não está no grafo e grava o histórico de toda mudança.
-- =============================================================================

CREATE TYPE aurora.opportunity_status AS ENUM (
  'identified', 'qualified', 'authorized', 'declined', 'converted', 'cancelled'
);

CREATE TYPE aurora.opportunity_origin AS ENUM (
  'work_order', 'service_request', 'inspection', 'obsolescence', 'customer_request', 'other'
);

CREATE TABLE aurora.opportunities (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  customer_id           uuid NOT NULL,
  asset_id              uuid,
  work_order_id         uuid,
  service_request_id    uuid,
  supplier_id           uuid,
  quote_id              uuid,
  origin                aurora.opportunity_origin NOT NULL,
  title                 text NOT NULL,
  need                  text NOT NULL,
  priority              aurora.request_priority NOT NULL DEFAULT 'none',
  due_on                date,
  status                aurora.opportunity_status NOT NULL DEFAULT 'identified',
  authorized_at         timestamptz,
  authorized_by         uuid,
  authorization_note    text,
  closed_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_by            uuid,
  CONSTRAINT opp_title_present CHECK (length(btrim(title)) >= 3),
  CONSTRAINT opp_need_present CHECK (length(btrim(need)) >= 5),
  -- A origem que aponta registro aponta o registro certo.
  CONSTRAINT opp_origin_link CHECK (
    (origin <> 'work_order' OR work_order_id IS NOT NULL)
    AND (origin <> 'service_request' OR service_request_id IS NOT NULL)
  ),
  -- Autorizada tem carimbo de quem e quando; convertida aponta o orçamento.
  CONSTRAINT opp_authorized_stamped CHECK (
    status NOT IN ('authorized', 'converted') OR (authorized_at IS NOT NULL AND authorized_by IS NOT NULL)
  ),
  CONSTRAINT opp_converted_has_quote CHECK (status <> 'converted' OR quote_id IS NOT NULL),
  CONSTRAINT opp_declined_has_reason CHECK (
    status NOT IN ('declined', 'cancelled') OR (closed_reason IS NOT NULL AND length(btrim(closed_reason)) >= 10)
  ),
  CONSTRAINT opp_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT opp_customer_org_fk FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT opp_asset_org_fk FOREIGN KEY (asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT opp_wo_org_fk FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT opp_sr_org_fk FOREIGN KEY (service_request_id, organization_id)
    REFERENCES aurora.service_requests (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT opp_supplier_org_fk FOREIGN KEY (supplier_id, organization_id)
    REFERENCES aurora.suppliers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT opp_quote_org_fk FOREIGN KEY (quote_id, organization_id)
    REFERENCES aurora.quotes (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT opp_authorized_by_org_fk FOREIGN KEY (authorized_by, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX opp_org_status_idx ON aurora.opportunities (organization_id, status, due_on);
CREATE INDEX opp_customer_idx   ON aurora.opportunities (customer_id);
CREATE INDEX opp_asset_idx      ON aurora.opportunities (asset_id) WHERE asset_id IS NOT NULL;

CREATE TABLE aurora.opportunity_status_history (
  id               uuid PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  opportunity_id   uuid NOT NULL,
  from_status      aurora.opportunity_status,
  to_status        aurora.opportunity_status NOT NULL,
  note             text,
  changed_by       uuid,
  changed_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT osh_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT osh_opp_org_fk FOREIGN KEY (opportunity_id, organization_id)
    REFERENCES aurora.opportunities (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX osh_opp_idx ON aurora.opportunity_status_history (opportunity_id, changed_at);

-- -----------------------------------------------------------------------------
-- O grafo, no banco: aresta fora dele é recusada, toda mudança vira histórico.
-- -----------------------------------------------------------------------------
-- O grafo e a imutabilidade: ANTES da gravação, para recusar cedo.
CREATE FUNCTION aurora.fn_opportunity_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'identified' THEN
      RAISE EXCEPTION 'oportunidade nasce identificada' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.origin IS DISTINCT FROM OLD.origin THEN
    RAISE EXCEPTION 'cliente e origem de uma oportunidade não mudam' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'identified' AND NEW.status IN ('qualified', 'cancelled'))
      OR (OLD.status = 'qualified' AND NEW.status IN ('authorized', 'declined', 'cancelled'))
      OR (OLD.status = 'authorized' AND NEW.status IN ('converted', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'oportunidade não vai de "%" para "%"', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.status IN ('declined', 'converted', 'cancelled') THEN
    RAISE EXCEPTION 'oportunidade encerrada não se edita' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER opportunities_guard BEFORE INSERT OR UPDATE ON aurora.opportunities
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_opportunity_guard();

-- A trilha: DEPOIS da gravação (a linha precisa existir para a FK do
-- histórico), e SECURITY DEFINER — o histórico é escrito SÓ por aqui; a
-- aplicação não tem INSERT nele, e por isso não forja uma autorização que não
-- houve.
CREATE FUNCTION aurora.fn_opportunity_history() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO aurora.opportunity_status_history
      (id, organization_id, opportunity_id, from_status, to_status, note, changed_by)
    VALUES (gen_random_uuid(), NEW.organization_id, NEW.id,
            CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status,
            NULLIF(current_setting('aurora.transition_note', true), ''), aurora.current_actor_id());
  END IF;
  RETURN NULL;
END
$fn$;
ALTER FUNCTION aurora.fn_opportunity_history() OWNER TO aurora_owner;

CREATE TRIGGER opportunities_history AFTER INSERT OR UPDATE ON aurora.opportunities
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_opportunity_history();
CREATE TRIGGER opportunities_touch BEFORE UPDATE ON aurora.opportunities
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER opportunities_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.opportunities
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('title');

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['opportunities', 'opportunity_status_history']
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
    EXECUTE format('GRANT SELECT ON aurora.%I TO aurora_readonly', t);
  END LOOP;
  -- Oportunidade não se apaga: encerra-se com motivo.
  GRANT SELECT, INSERT, UPDATE ON aurora.opportunities TO aurora_app;
  -- O histórico é escrito pelo gatilho (dono); a aplicação só lê.
  GRANT SELECT ON aurora.opportunity_status_history TO aurora_app;
END
$do$;
