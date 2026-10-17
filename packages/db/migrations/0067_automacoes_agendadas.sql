-- =============================================================================
-- Aurora — 0067 automações AGENDADAS (reunião 16/10/2026, Fase 10)
--
-- Sem motor novo: o motor da 0037 ganha o que faltava para o gatilho
-- `schedule` rodar de verdade.
--
--   · `activated_at` — a regra agendada não dispara passadas de ANTES de ser
--     ligada (senão ligar às 09:00 uma regra "todo dia 08:00" dispararia na
--     hora, por uma passada que ninguém pediu);
--   · `rule_runs.schedule_slot` + índice ÚNICO (regra, passada) — idempotência:
--     duas varreduras simultâneas, ou a retentativa de uma que caiu, não
--     disparam a mesma passada duas vezes;
--   · `automation_tasks` — tarefa, 5W2H e PDCA. Não é um Kanban paralelo: é o
--     plano de ação que a regra gera. Tarefa operacional sobre equipamento
--     continua sendo OS (ação `create_work_order`), no quadro que já existe;
--   · `automation_report_outputs` — o relatório agendado, gerado no recorte de
--     escopo de CADA destinatário. O e-mail fica na fila: não há transporte de
--     e-mail configurado (BLOQUEADO — INFRA), e nada aqui finge envio.
-- =============================================================================

ALTER TABLE aurora.automation_rules ADD COLUMN IF NOT EXISTS activated_at timestamptz;
UPDATE aurora.automation_rules SET activated_at = updated_at WHERE state = 'active' AND activated_at IS NULL;

ALTER TABLE aurora.rule_runs ADD COLUMN IF NOT EXISTS schedule_slot timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS runs_schedule_slot_uq
  ON aurora.rule_runs (rule_id, schedule_slot) WHERE schedule_slot IS NOT NULL;
CREATE INDEX IF NOT EXISTS rules_active_schedule_idx
  ON aurora.automation_rules (organization_id)
  WHERE state = 'active' AND trigger_kind = 'schedule';

CREATE TABLE aurora.automation_tasks (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  rule_id             uuid,
  schedule_slot       timestamptz,
  method              text NOT NULL,
  /** O quê (What). */
  title               text NOT NULL,
  /** Por quê (Why). */
  why                 text,
  /** Onde (Where). */
  where_text          text,
  /** Como (How). */
  how                 text,
  /** Quanto (How much), em centavos — nunca ponto flutuante. */
  how_much_cents      bigint,
  /** Quem (Who). */
  owner_membership_id uuid NOT NULL,
  /** Quando (When). */
  due_date            date,
  pdca_phase          text,
  state               text NOT NULL DEFAULT 'open',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  completed_by        uuid,

  CONSTRAINT tasks_method_valid CHECK (method IN ('task', '5w2h', 'pdca')),
  CONSTRAINT tasks_title_present CHECK (length(btrim(title)) > 0),
  CONSTRAINT tasks_state_valid CHECK (state IN ('open', 'done', 'cancelled')),
  CONSTRAINT tasks_pdca_phase CHECK (
    (method = 'pdca' AND pdca_phase IN ('plan', 'do', 'check', 'act'))
    OR (method <> 'pdca' AND pdca_phase IS NULL)
  ),
  CONSTRAINT tasks_5w2h_complete CHECK (
    method <> '5w2h' OR (why IS NOT NULL AND where_text IS NOT NULL AND how IS NOT NULL)
  ),
  CONSTRAINT tasks_how_much_non_negative CHECK (how_much_cents IS NULL OR how_much_cents >= 0),
  CONSTRAINT tasks_done_has_when CHECK (state <> 'done' OR completed_at IS NOT NULL),
  CONSTRAINT tasks_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT tasks_slot_uq UNIQUE (rule_id, schedule_slot),
  CONSTRAINT tasks_rule_org_fk
    FOREIGN KEY (rule_id, organization_id) REFERENCES aurora.automation_rules (id, organization_id),
  CONSTRAINT tasks_owner_org_fk
    FOREIGN KEY (owner_membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id)
);
CREATE INDEX tasks_owner_idx ON aurora.automation_tasks (owner_membership_id, state, due_date);
CREATE INDEX tasks_org_idx ON aurora.automation_tasks (organization_id, state);

CREATE TABLE aurora.automation_report_outputs (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  rule_id                  uuid NOT NULL,
  schedule_slot            timestamptz NOT NULL,
  recipient_membership_id  uuid NOT NULL,
  tier                     text NOT NULL,
  filters                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  sections                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  notification_id          uuid,
  /** `queued_no_transport` até existir provedor de e-mail. */
  email_state              text NOT NULL DEFAULT 'queued_no_transport',
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT outputs_tier_valid CHECK (tier IN ('basic', 'advanced', 'expert')),
  CONSTRAINT outputs_email_state_valid CHECK (email_state IN ('queued_no_transport', 'queued', 'sent', 'failed')),
  CONSTRAINT outputs_sections_shape CHECK (jsonb_typeof(sections) = 'array'),
  CONSTRAINT outputs_slot_uq UNIQUE (rule_id, schedule_slot, recipient_membership_id),
  CONSTRAINT outputs_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT outputs_rule_org_fk
    FOREIGN KEY (rule_id, organization_id)
    REFERENCES aurora.automation_rules (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT outputs_recipient_org_fk
    FOREIGN KEY (recipient_membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX outputs_recipient_idx ON aurora.automation_report_outputs (recipient_membership_id, created_at DESC);

CREATE TRIGGER tasks_touch BEFORE UPDATE ON aurora.automation_tasks
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER tasks_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.automation_tasks
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('title');

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['automation_tasks', 'automation_report_outputs']
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
END
$do$;
-- A tarefa muda de estado (aberta → concluída); a saída de relatório é registro.
GRANT SELECT, INSERT, UPDATE ON aurora.automation_tasks TO aurora_app;
GRANT SELECT, INSERT ON aurora.automation_report_outputs TO aurora_app;
