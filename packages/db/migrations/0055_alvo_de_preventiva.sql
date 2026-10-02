-- =============================================================================
-- Aurora — 0055 preventiva por modelo, fabricante e criticidade; e o alvo
-- passa a respeitar o cliente do plano
-- Auditoria de gap V2 §9 e P1.4 · PLAT §4 "planos por família, risco e
-- fabricante"
--
-- ─────────────────────────────────────────────────────────────────────────────
-- FILTROS SOBRE O ALVO, E NÃO TIPOS NOVOS DE ALVO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- O alvo continua sendo expressão (0029): um ativo, uma categoria (família) ou
-- uma subárvore de locais. A tarefa ganha três FILTROS opcionais que se somam
-- (E lógico) a qualquer um deles:
--
--   · modelo        — "os monitores modelo X da UTI";
--   · fabricante    — "todos os ventiladores do fabricante Y";
--   · criticidade   — "as bombas de criticidade alta".
--
-- Filtro, e não tipo de alvo, porque é assim que o pedido chega: família E
-- fabricante E risco. Um tipo de alvo por combinação seria uma explosão de
-- casos; filtros compõem.
--
-- A CRITICIDADE É IGUALDADE, não "a partir de". Ordenar níveis de risco e
-- decidir que "alta" inclui "crítica" é regra do cliente (VAL-C/VAL-E de
-- risco), não do sistema. Quem quiser dois níveis cadastra duas tarefas.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O DEFEITO CORRIGIDO NO CAMINHO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A função da 0029 resolvia o alvo SEM olhar o cliente do plano. Um plano do
-- Hospital A com alvo "categoria Ventilador" alcançava também os ventiladores
-- do Hospital B da mesma prestadora — e a OS nascia em nome do cliente do
-- plano, com o equipamento de outro cliente. Agora o alvo é sempre recortado
-- pelo cliente do plano.
-- =============================================================================

ALTER TABLE aurora.plan_tasks
  ADD COLUMN IF NOT EXISTS filter_asset_model_id  uuid,
  ADD COLUMN IF NOT EXISTS filter_manufacturer_id uuid,
  ADD COLUMN IF NOT EXISTS filter_criticality_id  uuid;

ALTER TABLE aurora.plan_tasks DROP CONSTRAINT IF EXISTS plan_tasks_filter_model_org_fk;
ALTER TABLE aurora.plan_tasks
  ADD CONSTRAINT plan_tasks_filter_model_org_fk
    FOREIGN KEY (filter_asset_model_id, organization_id)
    REFERENCES aurora.asset_models (id, organization_id) ON DELETE RESTRICT;
ALTER TABLE aurora.plan_tasks DROP CONSTRAINT IF EXISTS plan_tasks_filter_manufacturer_org_fk;
ALTER TABLE aurora.plan_tasks
  ADD CONSTRAINT plan_tasks_filter_manufacturer_org_fk
    FOREIGN KEY (filter_manufacturer_id, organization_id)
    REFERENCES aurora.manufacturers (id, organization_id) ON DELETE RESTRICT;
ALTER TABLE aurora.plan_tasks DROP CONSTRAINT IF EXISTS plan_tasks_filter_criticality_org_fk;
ALTER TABLE aurora.plan_tasks
  ADD CONSTRAINT plan_tasks_filter_criticality_org_fk
    FOREIGN KEY (filter_criticality_id, organization_id)
    REFERENCES aurora.criticality_levels (id, organization_id) ON DELETE RESTRICT;

-- Alvo "um ativo" com filtro não faz sentido: o ativo já é o alvo inteiro.
ALTER TABLE aurora.plan_tasks DROP CONSTRAINT IF EXISTS plan_tasks_filters_need_scope;
ALTER TABLE aurora.plan_tasks
  ADD CONSTRAINT plan_tasks_filters_need_scope CHECK (
    target_kind <> 'asset'
    OR (filter_asset_model_id IS NULL AND filter_manufacturer_id IS NULL AND filter_criticality_id IS NULL)
  );

CREATE OR REPLACE FUNCTION aurora.resolve_plan_task_assets(p_task_id uuid)
RETURNS TABLE (asset_id uuid)
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  WITH t AS (
    SELECT pt.target_kind, pt.target_asset_id, pt.target_category_id, pt.target_location_id,
           pt.filter_asset_model_id, pt.filter_manufacturer_id, pt.filter_criticality_id,
           p.customer_id
      FROM aurora.plan_tasks pt
      JOIN aurora.maintenance_plans p ON p.id = pt.plan_id
     WHERE pt.id = p_task_id
  ),
  raiz AS (
    SELECT l.path FROM aurora.locations l, t
     WHERE t.target_kind = 'location_subtree' AND l.id = t.target_location_id
  )
  SELECT a.id
    FROM aurora.assets a
    CROSS JOIN t
    LEFT JOIN aurora.asset_models am ON am.id = a.asset_model_id
   WHERE a.deleted_at IS NULL
     AND a.status NOT IN ('decommissioned', 'disposed')
     -- o equipamento é do cliente do plano (o defeito da 0029)
     AND a.customer_id = t.customer_id
     AND (
       (t.target_kind = 'asset'            AND a.id = t.target_asset_id)
       OR (t.target_kind = 'asset_category' AND a.asset_category_id = t.target_category_id)
       OR (t.target_kind = 'location_subtree'
           AND EXISTS (SELECT 1 FROM raiz r WHERE a.location_path LIKE r.path || '%')
           AND (t.target_category_id IS NULL OR a.asset_category_id = t.target_category_id))
     )
     AND (t.filter_asset_model_id  IS NULL OR a.asset_model_id   = t.filter_asset_model_id)
     AND (t.filter_manufacturer_id IS NULL OR am.manufacturer_id = t.filter_manufacturer_id)
     AND (t.filter_criticality_id  IS NULL OR a.criticality_id   = t.filter_criticality_id)
   ORDER BY a.name
$fn$;

GRANT EXECUTE ON FUNCTION aurora.resolve_plan_task_assets(uuid) TO aurora_app, aurora_readonly;
