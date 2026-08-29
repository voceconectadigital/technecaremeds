-- =============================================================================
-- Aurora — 0035 tabela de fato de OS (SPEC v0.2 §25) · EPIC-021
--
-- A REGRA DE OURO DO §25
--   "O domínio transacional nunca é consultado diretamente por um painel de 12
--    meses. Foi exatamente esse acoplamento que produziu telas de 30 segundos
--    no sistema de referência."
--
-- A SPEC descreve as tabelas de fato como "populadas de forma incremental a
-- partir dos eventos de domínio", com latência de minutos. Aqui elas são
-- mantidas por GATILHO, e a diferença merece ser dita:
--
--   · o publicador de eventos precisa de agendador durável, que por sua vez
--     precisa de PostgreSQL real — dependência ainda em aberto (ADR-022);
--   · manter por gatilho não tem latência nenhuma: o fato nasce na mesma
--     transação do dado, e não há janela em que o painel discorde da lista;
--   · é o mesmo desenho já usado em `stock_balances` desde o EPIC-015 —
--     projeção mantida por gatilho a partir da fonte —, então não é um segundo
--     jeito de fazer a mesma coisa dentro do sistema.
--
--   O preço é o custo por escrita, que num CMMS é ordens de grandeza menor que
--   o custo de leitura: uma OS é escrita algumas dezenas de vezes na vida e
--   lida em todo painel, todo dia.
--
-- A tabela é DESNORMALIZADA de propósito: nome de cliente, caminho do local e
-- chave de sistema da natureza ficam gravados. Um painel de doze meses que
-- precisasse juntar cinco tabelas seria exatamente a tela de trinta segundos
-- que este épico existe para não repetir.
-- =============================================================================

CREATE TABLE aurora.fact_work_order (
  work_order_id       uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,

  customer_id         uuid,
  location_id         uuid,
  location_path       text NOT NULL DEFAULT '',
  asset_id            uuid,
  asset_category_id   uuid,
  team_id             uuid,
  assignee_membership_id uuid,

  /** `preventive`, `corrective`… — a chave de sistema da natureza, não o rótulo. */
  work_order_type_key text,
  priority            text NOT NULL,
  status_category     text NOT NULL,

  opened_at           timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  closed_at           timestamptz,
  cancelled           boolean NOT NULL DEFAULT false,

  /** Minutos corridos entre abertura e conclusão. Nulo enquanto não concluída. */
  resolution_minutes  integer,
  /** Minutos apontados, mantidos pelo gatilho de apontamento. */
  labor_minutes       integer NOT NULL DEFAULT 0,

  reschedule_count    integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fact_wo_resolution_non_negative CHECK (
    resolution_minutes IS NULL OR resolution_minutes >= 0
  ),
  CONSTRAINT fact_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE CASCADE
);

-- Os índices são os das perguntas que o painel faz, e não os das chaves.
CREATE INDEX fact_wo_org_opened_idx ON aurora.fact_work_order (organization_id, opened_at);
CREATE INDEX fact_wo_org_completed_idx ON aurora.fact_work_order (organization_id, completed_at)
  WHERE completed_at IS NOT NULL;
CREATE INDEX fact_wo_backlog_idx ON aurora.fact_work_order (organization_id, opened_at)
  WHERE completed_at IS NULL AND NOT cancelled;
CREATE INDEX fact_wo_asset_idx ON aurora.fact_work_order (organization_id, asset_id, opened_at)
  WHERE asset_id IS NOT NULL;
CREATE INDEX fact_wo_customer_idx ON aurora.fact_work_order (organization_id, customer_id, completed_at);
CREATE INDEX fact_wo_assignee_idx
  ON aurora.fact_work_order (organization_id, assignee_membership_id, completed_at)
  WHERE assignee_membership_id IS NOT NULL;
CREATE INDEX fact_wo_path_idx ON aurora.fact_work_order (location_path text_pattern_ops);

-- -----------------------------------------------------------------------------
-- Projeção da OS.
--
-- `opened_at` NÃO é `created_at`: rascunho não é demanda aberta. A OS entra no
-- fato com a data em que deixou de ser rascunho — e é por isso que a coluna é
-- preenchida na transição, não na criação.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_fact_work_order() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE
  v_tipo text;
  v_cat  uuid;
  v_open timestamptz;
BEGIN
  SELECT ci.system_key INTO v_tipo
    FROM aurora.catalog_items ci WHERE ci.id = NEW.work_order_type_id;

  SELECT a.asset_category_id INTO v_cat
    FROM aurora.assets a WHERE a.id = NEW.asset_id;

  -- Abertura é a saída do rascunho. Um rascunho que nunca foi publicado não
  -- representa demanda e não deve engordar o volume do mês.
  v_open := CASE WHEN NEW.status_category = 'draft' THEN NULL ELSE NEW.created_at END;

  INSERT INTO aurora.fact_work_order (
    work_order_id, organization_id, customer_id, location_id, location_path,
    asset_id, asset_category_id, team_id, assignee_membership_id,
    work_order_type_key, priority, status_category,
    opened_at, started_at, completed_at, closed_at, cancelled,
    resolution_minutes, reschedule_count, updated_at
  )
  VALUES (
    NEW.id, NEW.organization_id, NEW.customer_id, NEW.location_id,
    COALESCE(NEW.location_path_snapshot, ''),
    NEW.asset_id, v_cat, NEW.team_id, NEW.assignee_membership_id,
    v_tipo, NEW.priority::text, NEW.status_category::text,
    v_open, NEW.started_at, NEW.completed_at, NEW.closed_at,
    NEW.status_category = 'cancelled',
    CASE WHEN NEW.completed_at IS NOT NULL AND v_open IS NOT NULL
         THEN GREATEST(0, (EXTRACT(EPOCH FROM (NEW.completed_at - v_open)) / 60)::integer)
         ELSE NULL END,
    NEW.reschedule_count, now()
  )
  ON CONFLICT (work_order_id) DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    location_id = EXCLUDED.location_id,
    location_path = EXCLUDED.location_path,
    asset_id = EXCLUDED.asset_id,
    asset_category_id = EXCLUDED.asset_category_id,
    team_id = EXCLUDED.team_id,
    assignee_membership_id = EXCLUDED.assignee_membership_id,
    work_order_type_key = EXCLUDED.work_order_type_key,
    priority = EXCLUDED.priority,
    status_category = EXCLUDED.status_category,
    -- A abertura, uma vez registrada, não se apaga: uma OS publicada e depois
    -- devolvida a rascunho continua tendo sido demanda naquele dia.
    opened_at = COALESCE(aurora.fact_work_order.opened_at, EXCLUDED.opened_at),
    started_at = EXCLUDED.started_at,
    completed_at = EXCLUDED.completed_at,
    closed_at = EXCLUDED.closed_at,
    cancelled = EXCLUDED.cancelled,
    resolution_minutes = CASE
      WHEN EXCLUDED.completed_at IS NOT NULL
       AND COALESCE(aurora.fact_work_order.opened_at, EXCLUDED.opened_at) IS NOT NULL
      THEN GREATEST(0, (EXTRACT(EPOCH FROM (
             EXCLUDED.completed_at - COALESCE(aurora.fact_work_order.opened_at, EXCLUDED.opened_at)
           )) / 60)::integer)
      ELSE NULL END,
    reschedule_count = EXCLUDED.reschedule_count,
    updated_at = now();

  RETURN NULL;
END
$fn$;

CREATE TRIGGER work_orders_fact AFTER INSERT OR UPDATE ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_fact_work_order();

-- -----------------------------------------------------------------------------
-- As horas apontadas entram no fato pelo mesmo caminho.
--
-- Recalculado por soma, e não incrementado: apontamento se corrige, se apaga e
-- se reabre, e um contador incremental erraria em cada um desses casos sem
-- ninguém perceber. A soma é sobre poucas linhas por OS.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_fact_labor_minutes() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE v_wo uuid := COALESCE(NEW.work_order_id, OLD.work_order_id);
BEGIN
  UPDATE aurora.fact_work_order f
     SET labor_minutes = COALESCE((
           SELECT sum(EXTRACT(EPOCH FROM (t.ended_at - t.started_at)) / 60)::integer
             FROM aurora.time_entries t
            WHERE t.work_order_id = v_wo AND t.ended_at IS NOT NULL
         ), 0),
         updated_at = now()
   WHERE f.work_order_id = v_wo;

  RETURN NULL;
END
$fn$;

CREATE TRIGGER time_entries_fact
  AFTER INSERT OR UPDATE OR DELETE ON aurora.time_entries
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_fact_labor_minutes();

-- -----------------------------------------------------------------------------
-- Reconstrução completa do fato.
--
-- Existe porque toda projeção precisa de um caminho de volta: se um gatilho for
-- adicionado depois de a tabela já ter dados, ou se alguém desconfiar do
-- número, a resposta não pode ser "confie". Roda em uma transação e é
-- idempotente.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.rebuild_fact_work_order(p_organization_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE v_total bigint;
BEGIN
  DELETE FROM aurora.fact_work_order WHERE organization_id = p_organization_id;

  INSERT INTO aurora.fact_work_order (
    work_order_id, organization_id, customer_id, location_id, location_path,
    asset_id, asset_category_id, team_id, assignee_membership_id,
    work_order_type_key, priority, status_category,
    opened_at, started_at, completed_at, closed_at, cancelled,
    resolution_minutes, labor_minutes, reschedule_count
  )
  SELECT w.id, w.organization_id, w.customer_id, w.location_id,
         COALESCE(w.location_path_snapshot, ''),
         w.asset_id, a.asset_category_id, w.team_id, w.assignee_membership_id,
         ci.system_key, w.priority::text, w.status_category::text,
         CASE WHEN w.status_category = 'draft' THEN NULL ELSE w.created_at END,
         w.started_at, w.completed_at, w.closed_at,
         w.status_category = 'cancelled',
         CASE WHEN w.completed_at IS NOT NULL AND w.status_category <> 'draft'
              THEN GREATEST(0, (EXTRACT(EPOCH FROM (w.completed_at - w.created_at)) / 60)::integer)
              ELSE NULL END,
         COALESCE((
           SELECT sum(EXTRACT(EPOCH FROM (t.ended_at - t.started_at)) / 60)::integer
             FROM aurora.time_entries t
            WHERE t.work_order_id = w.id AND t.ended_at IS NOT NULL
         ), 0),
         w.reschedule_count
    FROM aurora.work_orders w
    LEFT JOIN aurora.assets a ON a.id = w.asset_id
    LEFT JOIN aurora.catalog_items ci ON ci.id = w.work_order_type_id
   WHERE w.organization_id = p_organization_id;

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END
$fn$;

GRANT EXECUTE ON FUNCTION aurora.rebuild_fact_work_order(uuid) TO aurora_app;

ALTER TABLE aurora.fact_work_order OWNER TO aurora_owner;
ALTER TABLE aurora.fact_work_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.fact_work_order FORCE  ROW LEVEL SECURITY;
CREATE POLICY fact_work_order_tenant_isolation ON aurora.fact_work_order FOR ALL
  USING (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.fact_work_order TO aurora_app;
GRANT SELECT ON aurora.fact_work_order TO aurora_readonly;
