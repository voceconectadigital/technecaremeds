-- =============================================================================
-- Aurora — 0065 execução guiada da OS (reunião 16/10/2026, Fase 5)
--
-- 1. `work_order_visits` — CHECK-IN e CHECK-OUT pontuais. Uma linha por evento:
--    quem, qual OS, cliente/local (cópia do momento), quando, e a posição do
--    aparelho (latitude, longitude, precisão) QUANDO o navegador a deu. Se a
--    pessoa recusou ou o aparelho não tem, o registro é MANUAL com
--    justificativa auditável. Não há rastreamento contínuo: só estes dois
--    instantes. Append-only — a aplicação insere e lê, nunca altera.
--    O check-in abre o cronômetro (time_entries) e o check-out o fecha: as
--    HORAS deixam de ser digitadas no começo do trabalho.
--
-- 2. Relatório da OS ("Preencher Ordem de Serviço"): descrição do serviço,
--    observações, RESULTADO OPERACIONAL (liberado / parado — situação de uso do
--    equipamento, NÃO veredito metrológico) e parecer final.
--
-- 3. `work_order_customer_parts` — peça FORNECIDA PELO CLIENTE, descrita à mão
--    e auditada. Peça de estoque continua pelo razão (`stock_movements` com
--    `ref_type = 'work_order'`): nenhuma baixa silenciosa.
--
-- 4. Situação "Negada" (`denied`, categoria `cancelled`) e o rascunho fora do
--    quadro, para as organizações existentes.
-- =============================================================================

CREATE TABLE aurora.work_order_visits (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  work_order_id     uuid NOT NULL,
  membership_id     uuid NOT NULL,
  kind              text NOT NULL,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  latitude          numeric(9, 6),
  longitude         numeric(9, 6),
  accuracy_m        numeric(10, 2),
  position_source   text NOT NULL,
  justification     text,
  customer_id       uuid,
  location_id       uuid,
  time_entry_id     uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_order_visits_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT work_order_visits_wo_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT work_order_visits_membership_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT work_order_visits_kind CHECK (kind IN ('check_in', 'check_out')),
  CONSTRAINT work_order_visits_source CHECK (position_source IN ('device', 'manual')),
  CONSTRAINT work_order_visits_device_has_position CHECK (
    position_source <> 'device'
    OR (latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
        AND (accuracy_m IS NULL OR accuracy_m >= 0))
  ),
  CONSTRAINT work_order_visits_manual_justified CHECK (
    position_source <> 'manual'
    OR (latitude IS NULL AND longitude IS NULL AND length(btrim(coalesce(justification, ''))) >= 10)
  )
);
CREATE INDEX work_order_visits_wo_idx ON aurora.work_order_visits (work_order_id, occurred_at);
CREATE INDEX work_order_visits_org_idx ON aurora.work_order_visits (organization_id);
CREATE TRIGGER work_order_visits_audit AFTER INSERT OR UPDATE OR DELETE
  ON aurora.work_order_visits FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('kind', 'position_source');

CREATE TABLE aurora.work_order_customer_parts (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  work_order_id     uuid NOT NULL,
  description       text NOT NULL,
  quantity          numeric(12, 3) NOT NULL,
  unit              text,
  notes             text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_order_customer_parts_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT work_order_customer_parts_wo_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT work_order_customer_parts_desc CHECK (length(btrim(description)) BETWEEN 3 AND 300),
  CONSTRAINT work_order_customer_parts_qty CHECK (quantity > 0)
);
CREATE INDEX work_order_customer_parts_wo_idx ON aurora.work_order_customer_parts (work_order_id);
CREATE INDEX work_order_customer_parts_org_idx ON aurora.work_order_customer_parts (organization_id);
CREATE TRIGGER work_order_customer_parts_audit AFTER INSERT OR UPDATE OR DELETE
  ON aurora.work_order_customer_parts FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('description');

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_order_visits', 'work_order_customer_parts']
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
    -- Append-only: registro de presença e de peça do cliente não se reescreve.
    EXECUTE format('GRANT SELECT, INSERT ON aurora.%I TO aurora_app', t);
    EXECUTE format('GRANT SELECT ON aurora.%I TO aurora_readonly', t);
  END LOOP;
END
$do$;

ALTER TABLE aurora.work_orders
  ADD COLUMN IF NOT EXISTS service_description  text,
  ADD COLUMN IF NOT EXISTS service_observations text,
  ADD COLUMN IF NOT EXISTS operational_result   text,
  ADD COLUMN IF NOT EXISTS final_opinion        text,
  ADD COLUMN IF NOT EXISTS service_report_updated_at timestamptz;
ALTER TABLE aurora.work_orders
  ADD CONSTRAINT work_orders_operational_result_valid
    CHECK (operational_result IS NULL OR operational_result IN ('released', 'stopped'));

-- Situação "Negada" para as organizações existentes (as novas: provisionWorkOrderStates).
INSERT INTO aurora.work_order_statuses
  (id, organization_id, key, label, customer_label, category, color, position, is_system)
SELECT gen_random_uuid(), o.id, 'denied', 'Negada', 'Negado', 'cancelled'::aurora.status_category,
       '#a50e0e', 11, true
  FROM aurora.organizations o
 WHERE EXISTS (SELECT 1 FROM aurora.work_order_statuses s WHERE s.organization_id = o.id)
   AND NOT EXISTS (
     SELECT 1 FROM aurora.work_order_statuses s WHERE s.organization_id = o.id AND s.key = 'denied'
   );

INSERT INTO aurora.work_order_status_transitions
  (organization_id, from_status_id, to_status_id, permission_key, required_fields, note)
SELECT f.organization_id, f.id, t.id, 'work_order.cancel', '{cancellation_reason}'::text[],
       'atendimento negado, com motivo obrigatório'
  FROM aurora.work_order_statuses f
  JOIN aurora.work_order_statuses t ON t.organization_id = f.organization_id AND t.key = 'denied'
 WHERE f.key IN ('open', 'scheduled', 'in_analysis', 'waiting')
ON CONFLICT (from_status_id, to_status_id) DO NOTHING;

-- "Rascunho" deixa de ser coluna do quadro (o histórico continua).
UPDATE aurora.work_order_statuses SET visible_on_board = false WHERE key = 'draft';
