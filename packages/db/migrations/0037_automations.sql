-- =============================================================================
-- Aurora — 0037 automações (SPEC v0.2 §24) · EPIC-024
--
-- Os "Robôs" da referência têm 2 modelos, 2 gatilhos e 1 ação real. O problema
-- não é o tamanho: é que uma automação que só sabe fazer uma coisa obriga a
-- organização a pedir desenvolvimento para cada regra nova — e o resultado é
-- que ninguém pede, e o trabalho continua sendo feito à mão.
--
-- AS SALVAGUARDAS SÃO O PRODUTO
--   Basta uma regra mal escrita para a equipe inteira receber trezentos
--   e-mails numa tarde, e depois disso ninguém liga automação nenhuma. Quatro
--   coisas são obrigatórias e estão no esquema, não na aplicação:
--
--     · a regra guarda `last_run_at` e o contador da janela — o limite não
--       depende de alguém lembrar de contar;
--     · a quarentena é ESTADO, com motivo escrito, e não uma flag muda;
--     · `rule_runs` registra entrada, condições, ações e resultado — sem log,
--       automação é caixa-preta que age sozinha no dado de outra pessoa;
--     · a simulação é exigida antes de ativar, e o carimbo fica na regra.
-- =============================================================================

CREATE TYPE aurora.trigger_kind AS ENUM ('event', 'schedule', 'condition_watch');
CREATE TYPE aurora.rule_state AS ENUM ('draft', 'active', 'paused', 'quarantined');
CREATE TYPE aurora.run_outcome AS ENUM (
  'matched', 'skipped_conditions', 'skipped_recursion', 'skipped_rate_limit', 'failed'
);

CREATE TABLE aurora.automation_rules (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  state             aurora.rule_state NOT NULL DEFAULT 'draft',
  /** Ordem de execução entre regras que casam com o mesmo evento. */
  priority          integer NOT NULL DEFAULT 100,

  trigger_kind      aurora.trigger_kind NOT NULL DEFAULT 'event',
  /** Tipo de evento que dispara, quando o gatilho é de evento. */
  trigger_event     text,
  /** Expressão cron e fuso, quando o gatilho é agendado. */
  trigger_cron      text,
  trigger_timezone  text,

  conditions        jsonb,

  /** Limite por janela (§24). */
  rate_max          integer NOT NULL DEFAULT 100,
  rate_window_minutes integer NOT NULL DEFAULT 60,

  quarantined_at    timestamptz,
  quarantine_reason text,

  /** Carimbo da simulação obrigatória — ativar sem simular é recusado. */
  simulated_at      timestamptz,
  simulated_matches integer,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,

  CONSTRAINT rules_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT rules_rate_sane CHECK (rate_max > 0 AND rate_window_minutes BETWEEN 1 AND 1440),
  CONSTRAINT rules_conditions_shape CHECK (
    conditions IS NULL OR jsonb_typeof(conditions) = 'object'
  ),
  -- Cada espécie de gatilho tem o seu campo, e só o seu: uma regra de evento
  -- com cron guardado é uma regra que alguém vai achar que roda no horário.
  CONSTRAINT rules_trigger_shape CHECK (
    (trigger_kind = 'event' AND trigger_event IS NOT NULL AND trigger_cron IS NULL)
    OR (trigger_kind = 'schedule' AND trigger_cron IS NOT NULL AND trigger_event IS NULL)
    OR (trigger_kind = 'condition_watch' AND trigger_event IS NULL AND trigger_cron IS NULL)
  ),
  CONSTRAINT rules_quarantine_has_reason CHECK (
    state <> 'quarantined' OR (quarantined_at IS NOT NULL AND quarantine_reason IS NOT NULL)
  ),
  CONSTRAINT rules_name_uq UNIQUE (organization_id, name),
  CONSTRAINT rules_id_org_uq UNIQUE (id, organization_id)
);
CREATE INDEX rules_active_event_idx
  ON aurora.automation_rules (organization_id, trigger_event, priority)
  WHERE state = 'active' AND trigger_kind = 'event';

CREATE TABLE aurora.automation_actions (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  rule_id           uuid NOT NULL,
  position          integer NOT NULL,
  kind              text NOT NULL,
  params            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT actions_params_shape CHECK (jsonb_typeof(params) = 'object'),
  CONSTRAINT actions_position_uq UNIQUE (rule_id, position),
  CONSTRAINT actions_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT actions_rule_org_fk
    FOREIGN KEY (rule_id, organization_id)
    REFERENCES aurora.automation_rules (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX actions_rule_idx ON aurora.automation_actions (rule_id, position);

-- -----------------------------------------------------------------------------
-- Log de execução — a exigência do §24 que impede a caixa-preta.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.rule_runs (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  rule_id           uuid NOT NULL,
  event_id          uuid,
  event_type        text NOT NULL,
  aggregate_id      uuid,
  outcome           aurora.run_outcome NOT NULL,
  /** O que foi avaliado e o que foi feito, para alguém poder conferir depois. */
  facts             jsonb,
  actions_run       jsonb NOT NULL DEFAULT '[]'::jsonb,
  error             text,
  duration_ms       integer,
  ran_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT runs_actions_shape CHECK (jsonb_typeof(actions_run) = 'array'),
  CONSTRAINT runs_rule_org_fk
    FOREIGN KEY (rule_id, organization_id)
    REFERENCES aurora.automation_rules (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX runs_rule_time_idx ON aurora.rule_runs (rule_id, ran_at DESC);
CREATE INDEX runs_window_idx ON aurora.rule_runs (rule_id, ran_at)
  WHERE outcome = 'matched';
CREATE INDEX runs_org_idx ON aurora.rule_runs (organization_id, ran_at DESC);

CREATE TRIGGER rules_touch BEFORE UPDATE ON aurora.automation_rules
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER rules_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.automation_rules
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['automation_rules', 'automation_actions', 'rule_runs']
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
