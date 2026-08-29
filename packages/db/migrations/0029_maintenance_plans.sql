-- =============================================================================
-- Aurora — 0029 planos de manutenção preventiva (SPEC v0.2 §12) · EPIC-013
--
-- DUAS CORREÇÕES ESTRUTURAIS SOBRE O MODELO DA REFERÊNCIA
--
-- 1. FREQUÊNCIA É DA TAREFA, NÃO DO PLANO
--    Lá, ter preventiva semestral e calibração anual no mesmo equipamento exige
--    dois planos. O tenant auditado tem 826 planos, muitos deles duplicatas do
--    mesmo escopo com ritmos diferentes — e cada duplicata é um lugar a mais
--    onde alguém pode esquecer de incluir o equipamento novo.
--
-- 2. ALVO É UMA EXPRESSÃO, NÃO UMA LISTA DE CAIXAS MARCADAS
--    As flags P/C/E da referência viram alvos declarativos: "todos os ativos da
--    categoria Ventilador pulmonar na subárvore UTI". O ventilador que chegar
--    amanhã entra sozinho no escopo. Uma lista marcada à mão envelhece no dia
--    seguinte, e a preventiva que não acontece é a que ninguém sabia que devia.
-- =============================================================================

CREATE TYPE aurora.plan_target_kind AS ENUM ('asset', 'asset_category', 'location_subtree');
CREATE TYPE aurora.plan_trigger AS ENUM ('calendar', 'meter', 'condition');
CREATE TYPE aurora.frequency_unit AS ENUM ('day', 'week', 'month', 'quarter', 'semester', 'year');
CREATE TYPE aurora.plan_cycle_status AS ENUM ('planned', 'open', 'closed');
CREATE TYPE aurora.cycle_item_status AS ENUM ('pending', 'generated', 'done', 'skipped', 'overdue');

CREATE TABLE aurora.maintenance_plans (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  description           text NOT NULL DEFAULT '',
  customer_id           uuid NOT NULL,
  team_id               uuid,
  is_active             boolean NOT NULL DEFAULT true,
  auto_generate         boolean NOT NULL DEFAULT true,
  /** Ativos que entram no escopo depois do início do ciclo entram já neste? */
  include_late_assets   boolean NOT NULL DEFAULT false,
  anchor_date           date NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_by            uuid,
  archived_at           timestamptz,
  CONSTRAINT plans_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT plans_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT plans_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT plans_team_org_fk
    FOREIGN KEY (team_id, organization_id)
    REFERENCES aurora.teams (id, organization_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX plans_name_uq
  ON aurora.maintenance_plans (organization_id, lower(btrim(name))) WHERE archived_at IS NULL;
CREATE INDEX plans_active_idx
  ON aurora.maintenance_plans (organization_id) WHERE is_active AND archived_at IS NULL;

-- -----------------------------------------------------------------------------
-- plan_tasks — o que fazer, em que ritmo, sobre quem.
--
-- Cada tarefa tem a SUA frequência. É a correção nº 1, como coluna.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.plan_tasks (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  plan_id                 uuid NOT NULL,
  name                    text NOT NULL,

  -- alvo declarativo
  target_kind             aurora.plan_target_kind NOT NULL,
  target_asset_id         uuid,
  target_category_id      uuid,
  target_location_id      uuid,

  work_order_type_id      uuid NOT NULL,
  checklist_template_key  text,

  trigger                 aurora.plan_trigger NOT NULL DEFAULT 'calendar',
  frequency_unit          aurora.frequency_unit NOT NULL,
  frequency_interval      integer NOT NULL DEFAULT 1,
  lead_time_days          integer NOT NULL DEFAULT 7,
  tolerance_days          integer NOT NULL DEFAULT 3,
  estimated_duration_min  integer,

  default_team_id         uuid,
  default_assignee_id     uuid,
  position                integer NOT NULL DEFAULT 0,
  archived_at             timestamptz,

  CONSTRAINT plan_tasks_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT plan_tasks_interval_positive CHECK (frequency_interval >= 1),
  CONSTRAINT plan_tasks_lead_non_negative CHECK (lead_time_days >= 0),
  CONSTRAINT plan_tasks_tolerance_non_negative CHECK (tolerance_days >= 0),
  -- O alvo tem de apontar para exatamente aquilo que o tipo declara. Sem isto,
  -- uma tarefa de categoria com `target_asset_id` preenchido e categoria vazia
  -- resolveria para nenhum ativo — e a preventiva simplesmente não aconteceria,
  -- sem erro nenhum.
  CONSTRAINT plan_tasks_target_coherent CHECK (
    (target_kind = 'asset'            AND target_asset_id IS NOT NULL AND target_location_id IS NULL)
    OR (target_kind = 'asset_category' AND target_category_id IS NOT NULL AND target_asset_id IS NULL)
    OR (target_kind = 'location_subtree' AND target_location_id IS NOT NULL AND target_asset_id IS NULL)
  ),
  CONSTRAINT plan_tasks_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT plan_tasks_plan_org_fk
    FOREIGN KEY (plan_id, organization_id)
    REFERENCES aurora.maintenance_plans (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT plan_tasks_asset_org_fk
    FOREIGN KEY (target_asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT plan_tasks_category_org_fk
    FOREIGN KEY (target_category_id, organization_id)
    REFERENCES aurora.asset_categories (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT plan_tasks_location_org_fk
    FOREIGN KEY (target_location_id, organization_id)
    REFERENCES aurora.locations (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT plan_tasks_type_org_fk
    FOREIGN KEY (work_order_type_id, organization_id)
    REFERENCES aurora.catalog_items (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT plan_tasks_team_org_fk
    FOREIGN KEY (default_team_id, organization_id)
    REFERENCES aurora.teams (id, organization_id) ON DELETE SET NULL
);
CREATE INDEX plan_tasks_plan_idx ON aurora.plan_tasks (plan_id, position) WHERE archived_at IS NULL;
CREATE INDEX plan_tasks_org_idx  ON aurora.plan_tasks (organization_id);

CREATE TABLE aurora.plan_cycles (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  plan_id           uuid NOT NULL,
  task_id           uuid NOT NULL,
  seq               integer NOT NULL,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  status            aurora.plan_cycle_status NOT NULL DEFAULT 'planned',
  expected_count    integer NOT NULL DEFAULT 0,
  done_count        integer NOT NULL DEFAULT 0,
  opened_at         timestamptz,
  closed_at         timestamptz,
  CONSTRAINT plan_cycles_window CHECK (ends_at > starts_at),
  CONSTRAINT plan_cycles_seq_positive CHECK (seq >= 1),
  CONSTRAINT plan_cycles_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT plan_cycles_task_org_fk
    FOREIGN KEY (task_id, organization_id)
    REFERENCES aurora.plan_tasks (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT plan_cycles_plan_org_fk
    FOREIGN KEY (plan_id, organization_id)
    REFERENCES aurora.maintenance_plans (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX plan_cycles_task_seq_uq ON aurora.plan_cycles (task_id, seq);
CREATE INDEX plan_cycles_plan_idx ON aurora.plan_cycles (plan_id, starts_at);
CREATE INDEX plan_cycles_org_idx  ON aurora.plan_cycles (organization_id);

CREATE TABLE aurora.plan_cycle_items (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  cycle_id          uuid NOT NULL,
  task_id           uuid NOT NULL,
  asset_id          uuid NOT NULL,
  due_at            timestamptz NOT NULL,
  status            aurora.cycle_item_status NOT NULL DEFAULT 'pending',
  work_order_id     uuid,
  skip_reason       text,
  skipped_by        uuid,
  skipped_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Dispensar sem justificativa transformaria a dispensa na saída fácil para
  -- melhorar o indicador de conformidade.
  CONSTRAINT cycle_items_skip_needs_reason CHECK (
    status <> 'skipped' OR length(btrim(coalesce(skip_reason, ''))) >= 10
  ),
  CONSTRAINT cycle_items_generated_has_wo CHECK (status <> 'generated' OR work_order_id IS NOT NULL),
  CONSTRAINT cycle_items_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT cycle_items_cycle_org_fk
    FOREIGN KEY (cycle_id, organization_id)
    REFERENCES aurora.plan_cycles (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT cycle_items_task_org_fk
    FOREIGN KEY (task_id, organization_id)
    REFERENCES aurora.plan_tasks (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT cycle_items_asset_org_fk
    FOREIGN KEY (asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT cycle_items_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE SET NULL
);
-- Um item por (ciclo, ativo): gerar duas vezes o mesmo ciclo não pode duplicar
-- a preventiva do mesmo equipamento.
CREATE UNIQUE INDEX cycle_items_cycle_asset_uq ON aurora.plan_cycle_items (cycle_id, asset_id);
CREATE INDEX cycle_items_cycle_idx ON aurora.plan_cycle_items (cycle_id, status);
CREATE INDEX cycle_items_asset_idx ON aurora.plan_cycle_items (asset_id, due_at DESC);
CREATE INDEX cycle_items_org_idx   ON aurora.plan_cycle_items (organization_id);

-- -----------------------------------------------------------------------------
-- Resolução do alvo — a correção nº 2, como função.
--
-- Ativo descomissionado, baixado ou excluído logicamente fica de fora (§12). Se
-- já havia OS gerada para ele, quem cancela é a aplicação, com motivo — o banco
-- só diz quem está no escopo hoje.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.resolve_plan_task_assets(p_task_id uuid)
RETURNS TABLE (asset_id uuid)
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  WITH t AS (
    SELECT target_kind, target_asset_id, target_category_id, target_location_id
      FROM aurora.plan_tasks WHERE id = p_task_id
  ),
  raiz AS (
    SELECT l.path FROM aurora.locations l, t
     WHERE t.target_kind = 'location_subtree' AND l.id = t.target_location_id
  )
  SELECT a.id
    FROM aurora.assets a, t
   WHERE a.deleted_at IS NULL
     AND a.status NOT IN ('decommissioned', 'disposed')
     AND (
       (t.target_kind = 'asset'            AND a.id = t.target_asset_id)
       OR (t.target_kind = 'asset_category' AND a.asset_category_id = t.target_category_id)
       OR (t.target_kind = 'location_subtree'
           AND EXISTS (SELECT 1 FROM raiz r WHERE a.location_path LIKE r.path || '%')
           AND (t.target_category_id IS NULL OR a.asset_category_id = t.target_category_id))
     )
   ORDER BY a.name
$fn$;

GRANT EXECUTE ON FUNCTION aurora.resolve_plan_task_assets(uuid) TO aurora_app, aurora_readonly;

-- -----------------------------------------------------------------------------
-- Item de ciclo acompanha a OS.
--
-- Sem isto, a conformidade dependeria de alguém lembrar de marcar o item como
-- concluído depois de fechar a OS — e o indicador mediria a disciplina de
-- marcar, não a de executar.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_cycle_item_follows_work_order() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status_category IS NOT DISTINCT FROM OLD.status_category THEN
    RETURN NULL;
  END IF;

  IF NEW.status_category IN ('done', 'closed') THEN
    UPDATE aurora.plan_cycle_items
       SET status = 'done'
     WHERE work_order_id = NEW.id AND status <> 'skipped';
    UPDATE aurora.plan_cycles c
       SET done_count = (
             SELECT count(*) FROM aurora.plan_cycle_items i
              WHERE i.cycle_id = c.id AND i.status = 'done'
           )
     WHERE c.id IN (SELECT cycle_id FROM aurora.plan_cycle_items WHERE work_order_id = NEW.id);
  ELSIF NEW.status_category = 'cancelled' THEN
    -- A OS cancelada devolve o item para "pendente": o trabalho continua
    -- previsto, e alguém precisa decidir se refaz ou dispensa. Deixá-lo como
    -- "gerado" faria o item parecer resolvido.
    UPDATE aurora.plan_cycle_items
       SET status = 'pending', work_order_id = NULL
     WHERE work_order_id = NEW.id AND status = 'generated';
  END IF;

  RETURN NULL;
END
$fn$;

CREATE TRIGGER work_orders_cycle_item AFTER UPDATE ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_cycle_item_follows_work_order();

CREATE TRIGGER plans_touch BEFORE UPDATE ON aurora.maintenance_plans
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER plans_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.maintenance_plans
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER plan_tasks_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.plan_tasks
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER cycle_items_audit AFTER UPDATE ON aurora.plan_cycle_items
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('status', 'id');

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['maintenance_plans', 'plan_tasks', 'plan_cycles', 'plan_cycle_items']
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
