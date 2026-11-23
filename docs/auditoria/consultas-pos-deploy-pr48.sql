-- Téchne Care — leitura de produção DEPOIS do deploy da PR #48 (23/11/2026). SOMENTE LEITURA.
-- Rodar com PGOPTIONS='-c default_transaction_read_only=on' e psql -X -v ON_ERROR_STOP=1.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';

\echo '== migrations (esperado: 91, até 0091)'
SELECT count(*) AS migrations, max(name) AS ultima,
       (SELECT applied_at FROM aurora.schema_migrations WHERE name = '0091_indices_de_desempenho.sql') AS aplicada_em
  FROM aurora.schema_migrations;

\echo '== índices da 0091 (esperado: 3, válidos)'
SELECT c.relname AS indice, i.indisvalid AS valido, i.indisready AS pronto,
       pg_size_pretty(pg_relation_size(c.oid)) AS tamanho, pg_get_indexdef(c.oid) AS definicao
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'aurora' AND c.relname IN ('wo_org_created_idx', 'sla_clocks_stopped_idx', 'wosh_org_changed_idx')
 ORDER BY 1;

\echo '== volumes (comparar com a leitura pré-deploy)'
SELECT (SELECT count(*) FROM aurora.work_orders) AS os,
       (SELECT count(*) FROM aurora.assets) AS ativos,
       (SELECT count(*) FROM aurora.sla_clocks WHERE state = 'running') AS relogios_abertos,
       (SELECT count(*) FROM aurora.sla_clocks WHERE state = 'running' AND breached_at IS NOT NULL) AS relogios_abertos_estourados,
       (SELECT count(*) FROM aurora.quality_records WHERE deleted_at IS NULL) AS registros_qualidade,
       (SELECT count(*) FROM aurora.automation_rules) AS regras_automacao,
       (SELECT count(*) FROM aurora.contracts) AS contratos,
       (SELECT count(*) FROM aurora.organizations) AS organizacoes;

\echo '== plano da lista de OS sem filtro (deve usar wo_org_created_idx sob RLS)'
SET LOCAL ROLE aurora_app;
SELECT set_config('aurora.organization_id', (SELECT id::text FROM aurora.organizations LIMIT 1), true) IS NOT NULL AS contexto;
EXPLAIN (COSTS OFF) SELECT w.id FROM aurora.work_orders w ORDER BY w.created_at DESC LIMIT 100;
RESET ROLE;

ROLLBACK;
