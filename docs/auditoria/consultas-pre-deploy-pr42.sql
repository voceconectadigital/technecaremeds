-- Téchne Care — consultas de leitura pré-deploy da PR #42 (CHECKLIST_PRE_PUBLICACAO_PR42.md §1).
-- SÓ LEITURA: a sessão abre com default_transaction_read_only=on e tudo roda numa transação
-- READ ONLY terminada em ROLLBACK. Nenhuma linha devolvida contém dado pessoal nem credencial:
-- só nomes de organização e de regra, tags normalizadas e contagens.
--
-- Onde rodar: no node do runtime de produção, dentro do contêiner do PostgreSQL, pelo socket local:
--   ssh apps-us-east-01 "docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' \
--     hp-pgv-pe0b9asx-db-1 psql -X -v ON_ERROR_STOP=1 -U postgres -d aurora" < consultas-pre-deploy-pr42.sql

\pset pager off
\pset footer on
BEGIN TRANSACTION READ ONLY;
SHOW transaction_read_only;

\echo '== 1. Automações por evento ativas (passam a disparar depois do deploy)'
SELECT o.name AS organizacao, r.name AS regra, r.trigger_event, r.state::text AS situacao,
       (SELECT string_agg(a.kind, ', ' ORDER BY a.position) FROM aurora.automation_actions a WHERE a.rule_id = r.id) AS acoes
  FROM aurora.automation_rules r
  JOIN aurora.organizations o ON o.id = r.organization_id
 WHERE r.trigger_kind = 'event' AND r.state = 'active' AND r.quarantined_at IS NULL
 ORDER BY o.name, r.name;

\echo '== 2. Duplicidades em rule_runs que fariam a 0088 falhar (esperado: 0 linhas)'
SELECT rule_id, event_id, count(*) AS vezes
  FROM aurora.rule_runs
 WHERE event_id IS NOT NULL
 GROUP BY rule_id, event_id HAVING count(*) > 1;
SELECT count(*) AS execucoes_com_evento FROM aurora.rule_runs WHERE event_id IS NOT NULL;

\echo '== 3. Tags repetidas (a 0089 marca e não falha)'
SELECT o.name AS organizacao, replace(aurora.normalize_label(a.tag), ' ', '') AS tag_normalizada,
       count(*) AS equipamentos
  FROM aurora.assets a
  JOIN aurora.organizations o ON o.id = a.organization_id
 WHERE a.deleted_at IS NULL AND a.tag IS NOT NULL
   AND replace(aurora.normalize_label(a.tag), ' ', '') <> ''
 GROUP BY o.name, tag_normalizada HAVING count(*) > 1
 ORDER BY o.name, equipamentos DESC;

\echo '== 4. Modo de cada organização (hospital sem recursos customizados perde o orçamento)'
SELECT o.name AS organizacao, o.usage_mode::text AS modo, o.enabled_features AS recursos,
       (SELECT count(*) FROM aurora.quotes q WHERE q.organization_id = o.id) AS orcamentos_existentes
  FROM aurora.organizations o
 WHERE o.deleted_at IS NULL
 ORDER BY o.name;

\echo '== 5. Regras ativas com ação de mudar situação (podem concluir OS sem parecer)'
SELECT o.name AS organizacao, r.name AS regra, r.trigger_kind::text AS gatilho, r.trigger_event,
       a.params ->> 'statusKey' AS para_situacao
  FROM aurora.automation_rules r
  JOIN aurora.automation_actions a ON a.rule_id = r.id
  JOIN aurora.organizations o ON o.id = r.organization_id
 WHERE r.state = 'active' AND a.kind = 'change_status'
 ORDER BY o.name, r.name;

ROLLBACK;
