-- Leitura pré-deploy da rodada de contratos e SLA (0090). SOMENTE LEITURA.
-- Executar com PGOPTIONS='-c default_transaction_read_only=on'; termina em ROLLBACK.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';

\echo '== versão e migrations'
SELECT current_setting('server_version') AS pg;
SELECT max(name) AS ultima_migration, count(*) AS total FROM aurora.schema_migrations;

\echo '== objetos que a 0090 cria (devem NÃO existir)'
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'aurora' AND table_name = 'contracts'
   AND column_name IN ('service_frequency','fixed_team_packages','payment_terms','billing_model_informed');
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'aurora' AND proname IN ('resolve_sla_policy_source','smallint_array_has_no_duplicates');
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'billing_model' ORDER BY enumsortorder;
SELECT conname FROM pg_constraint WHERE conname LIKE 'contracts_%valid';

\echo '== organizações'
SELECT count(*) AS organizacoes FROM aurora.organizations;

\echo '== contratos existentes'
SELECT status::text, kind::text, billing_model::text, count(*) FROM aurora.contracts GROUP BY 1,2,3 ORDER BY 1,2,3;
SELECT count(*) FILTER (WHERE sla_policy_id IS NOT NULL) AS com_sla_geral,
       count(*) FILTER (WHERE archived_at IS NOT NULL) AS arquivados,
       count(*) AS total
  FROM aurora.contracts;
SELECT kind::text AS cobertura, count(*) FROM aurora.contract_coverages GROUP BY 1;
SELECT count(*) AS overrides_criticidade FROM aurora.contract_sla_overrides;

\echo '== políticas de SLA e padrões'
SELECT count(*) AS politicas, count(*) FILTER (WHERE is_default) AS padrao, count(*) FILTER (WHERE archived_at IS NOT NULL) AS arquivadas
  FROM aurora.sla_policies;
SELECT count(*) FILTER (WHERE default_sla_policy_id IS NOT NULL) AS org_com_padrao FROM aurora.organizations;
SELECT count(*) FILTER (WHERE default_sla_policy_id IS NOT NULL) AS clientes_com_padrao,
       count(*) FILTER (WHERE contract_starts_on IS NOT NULL) AS clientes_com_vigencia,
       count(*) AS clientes
  FROM aurora.customers;
SELECT count(*) FILTER (WHERE sla_policy_id IS NOT NULL) AS ativos_com_excecao,
       count(*) FILTER (WHERE NOT sla_enabled) AS ativos_sla_desligado,
       count(*) AS ativos
  FROM aurora.assets WHERE deleted_at IS NULL;

\echo '== relógios de SLA abertos (não devem mudar com a 0090)'
SELECT count(*) AS relogios_abertos FROM aurora.sla_clocks WHERE stopped_at IS NULL;

ROLLBACK;
