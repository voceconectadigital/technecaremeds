-- Téchne Care — leitura de produção antes do deploy da PR #48 (23/11/2026). SOMENTE LEITURA.
-- Rodar com PGOPTIONS='-c default_transaction_read_only=on' e psql -X -v ON_ERROR_STOP=1.
-- Não devolve nome de pessoa, e-mail nem conteúdo de certificado: só contagens.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';

\echo '== migrations'
SELECT count(*) AS migrations, max(name) AS ultima FROM aurora.schema_migrations;

\echo '== organizações'
SELECT count(*) AS organizacoes FROM aurora.organizations;

\echo '== registros de qualidade por tipo e cliente (vivos)'
SELECT kind, (customer_id IS NULL) AS sem_cliente, (asset_id IS NULL) AS sem_ativo,
       count(*) AS registros, count(file_key) AS com_arquivo
  FROM aurora.quality_records WHERE deleted_at IS NULL
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo '== vínculos ativos por assento e escopo de cliente'
SELECT m.seat_type::text AS assento, ms.customer_scope::text AS escopo_cliente,
       ms.location_scope::text AS escopo_local, count(*) AS vinculos
  FROM aurora.memberships m JOIN aurora.membership_scopes ms ON ms.membership_id = m.id
 WHERE m.status = 'active'
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo '== vínculos de portal com document.read (quem alcançaria GET /quality-records)'
SELECT count(DISTINCT m.id) AS vinculos_portal_com_document_read
  FROM aurora.memberships m
 WHERE m.status = 'active' AND m.seat_type = 'portal'
   AND EXISTS (SELECT 1 FROM aurora.effective_permissions(m.id) p WHERE p.permission_key = 'document.read');

\echo '== registros de qualidade de EQUIPAMENTO fora do setor de algum vínculo restrito (o que a PR #48 fecha)'
SELECT count(*) AS pares_registro_vinculo_fora_do_setor
  FROM aurora.quality_records q
  JOIN aurora.assets a ON a.id = q.asset_id
  JOIN aurora.memberships m ON m.organization_id = q.organization_id AND m.status = 'active'
  JOIN aurora.membership_scopes ms ON ms.membership_id = m.id AND ms.location_scope = 'listed'
 WHERE q.deleted_at IS NULL AND a.location_id IS NOT NULL
   AND a.location_id NOT IN (SELECT location_id FROM aurora.accessible_location_ids(m.id));

\echo '== índices da 0091 (devem estar ausentes antes do deploy)'
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'aurora' AND indexname IN ('wo_org_created_idx', 'sla_clocks_stopped_idx', 'wosh_org_changed_idx');

\echo '== volumes (para comparar depois)'
SELECT (SELECT count(*) FROM aurora.work_orders) AS os,
       (SELECT count(*) FROM aurora.assets) AS ativos,
       (SELECT count(*) FROM aurora.sla_clocks WHERE state = 'running') AS relogios_abertos,
       (SELECT count(*) FROM aurora.sla_clocks WHERE state = 'running' AND breached_at IS NOT NULL) AS relogios_abertos_estourados,
       (SELECT count(*) FROM aurora.quality_records WHERE deleted_at IS NULL) AS registros_qualidade,
       (SELECT count(*) FROM aurora.automation_rules) AS regras_automacao,
       (SELECT count(*) FROM aurora.contracts) AS contratos;

ROLLBACK;
