-- Téchne Care — impacto da 0092 e da API da PR #57, ANTES de publicar (25/11/2026). SOMENTE LEITURA.
-- Rodar com PGOPTIONS='-c default_transaction_read_only=on' e psql -X -v ON_ERROR_STOP=1, como dono do banco
-- (a leitura é de todas as organizações). Funciona no estado da 0091: nenhuma coluna da 0092 é lida.
-- "Hoje" é o dia no fuso de cada organização, como no código. As linhas trazem nome de cliente: tratar como dado do cliente.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

\echo '== 0. migrations (0091 aplicada? 0092 ainda não?)'
SELECT count(*) AS migrations, max(name) AS ultima,
       (SELECT applied_at FROM aurora.schema_migrations WHERE name = '0091_indices_de_desempenho.sql') AS aplicada_0091,
       (SELECT applied_at FROM aurora.schema_migrations WHERE name LIKE '0092%') AS aplicada_0092
  FROM aurora.schema_migrations;

\echo '== 0b. índices da 0091 (esperado: 3, válidos)'
SELECT c.relname AS indice, i.indisvalid AS valido
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'aurora' AND c.relname IN ('wo_org_created_idx', 'sla_clocks_stopped_idx', 'wosh_org_changed_idx')
 ORDER BY 1;

\echo '== 1. contratos que PARAM o atendimento assim que a API subir (vencidos ou suspensos)'
WITH hoje AS (SELECT id, (now() AT TIME ZONE COALESCE(timezone, 'America/Sao_Paulo'))::date AS d FROM aurora.organizations)
SELECT o.name AS organizacao, c.name AS cliente, ct.number, ct.status::text, ct.starts_on, ct.ends_on, ct.auto_renew,
       EXISTS (SELECT 1 FROM aurora.contracts v
                WHERE v.customer_id = ct.customer_id AND v.archived_at IS NULL AND v.status = 'active'
                  AND v.starts_on <= h.d AND (v.ends_on IS NULL OR v.ends_on >= h.d)) AS cliente_tem_outro_valido
  FROM aurora.contracts ct
  JOIN hoje h ON h.id = ct.organization_id
  JOIN aurora.organizations o ON o.id = ct.organization_id
  JOIN aurora.customers c ON c.id = ct.customer_id
 WHERE ct.archived_at IS NULL AND ct.starts_on <= h.d
   AND (ct.status IN ('suspended', 'expired')
        OR (ct.status = 'active' AND ct.ends_on < h.d))
 ORDER BY 1, 2, ct.ends_on;

\echo '== 2. EQUIPAMENTOS bloqueados (a mesma regra de service_block: cobertos só por contrato parado)'
WITH hoje AS (SELECT id, (now() AT TIME ZONE COALESCE(timezone, 'America/Sao_Paulo'))::date AS d FROM aurora.organizations),
cobertos AS (
  SELECT a.id AS asset_id, a.name AS equipamento, a.customer_id, ct.number,
         (ct.status IN ('suspended', 'expired') OR ct.ends_on < h.d) IS TRUE AS parado
    FROM aurora.assets a
    JOIN hoje h ON h.id = a.organization_id
    JOIN aurora.contracts ct ON ct.customer_id = a.customer_id AND ct.archived_at IS NULL
                            AND ct.status IN ('active', 'suspended', 'expired') AND ct.starts_on <= h.d
    JOIN aurora.contract_coverages cv ON cv.contract_id = ct.id
   WHERE a.deleted_at IS NULL
     AND (cv.kind = 'customer'
          OR (cv.kind = 'asset' AND a.id = cv.asset_id)
          OR (cv.kind = 'asset_category' AND a.asset_category_id = cv.asset_category_id)
          OR (cv.kind = 'location_subtree'
              AND EXISTS (SELECT 1 FROM aurora.locations l WHERE l.id = cv.location_id AND a.location_path LIKE l.path || '%')
              AND (cv.asset_category_id IS NULL OR a.asset_category_id = cv.asset_category_id))))
SELECT c.name AS cliente, k.equipamento, string_agg(DISTINCT k.number, ', ') AS contratos
  FROM cobertos k JOIN aurora.customers c ON c.id = k.customer_id
 GROUP BY c.name, k.asset_id, k.equipamento
HAVING bool_and(k.parado)
 ORDER BY 1, 2;

\echo '== 3. OS ABERTAS que ficam só para consulta'
WITH hoje AS (SELECT id, (now() AT TIME ZONE COALESCE(timezone, 'America/Sao_Paulo'))::date AS d FROM aurora.organizations),
cand AS (
  SELECT w.id, w.number, w.title, w.status_category::text AS situacao, w.customer_id, ct.number AS contrato,
         (ct.status IN ('suspended', 'expired') OR ct.ends_on < h.d) IS TRUE AS parado
    FROM aurora.work_orders w
    JOIN hoje h ON h.id = w.organization_id
    LEFT JOIN aurora.assets a ON a.id = w.asset_id
    JOIN aurora.contracts ct ON ct.customer_id = w.customer_id AND ct.archived_at IS NULL
                            AND ct.status IN ('active', 'suspended', 'expired') AND ct.starts_on <= h.d
   WHERE w.status_category NOT IN ('closed', 'cancelled')
     AND (w.asset_id IS NULL OR EXISTS (
           SELECT 1 FROM aurora.contract_coverages cv
            WHERE cv.contract_id = ct.id
              AND (cv.kind = 'customer'
                   OR (cv.kind = 'asset' AND a.id = cv.asset_id)
                   OR (cv.kind = 'asset_category' AND a.asset_category_id = cv.asset_category_id)
                   OR (cv.kind = 'location_subtree'
                       AND EXISTS (SELECT 1 FROM aurora.locations l WHERE l.id = cv.location_id AND a.location_path LIKE l.path || '%')
                       AND (cv.asset_category_id IS NULL OR a.asset_category_id = cv.asset_category_id))))))
SELECT c.name AS cliente, k.number, k.title, k.situacao, string_agg(DISTINCT k.contrato, ', ') AS contratos,
       (SELECT count(*) FROM aurora.time_entries te WHERE te.work_order_id = k.id AND te.ended_at IS NULL) AS cronometros_abertos
  FROM cand k JOIN aurora.customers c ON c.id = k.customer_id
 GROUP BY c.name, k.id, k.number, k.title, k.situacao
HAVING bool_and(k.parado)
 ORDER BY 1, 2;

\echo '== 4. solicitações em aberto de clientes sem nenhum contrato válido (e com contrato parado)'
WITH hoje AS (SELECT id, (now() AT TIME ZONE COALESCE(timezone, 'America/Sao_Paulo'))::date AS d FROM aurora.organizations)
SELECT c.name AS cliente, sr.number, sr.status::text AS situacao, sr.summary
  FROM aurora.service_requests sr
  JOIN hoje h ON h.id = sr.organization_id
  JOIN aurora.customers c ON c.id = sr.customer_id
 WHERE sr.status::text NOT IN ('fulfilled', 'closed', 'cancelled', 'rejected', 'duplicate')
   AND EXISTS (SELECT 1 FROM aurora.contracts p WHERE p.customer_id = sr.customer_id AND p.archived_at IS NULL
                AND p.starts_on <= h.d AND (p.status IN ('suspended', 'expired') OR (p.status = 'active' AND p.ends_on < h.d)))
   AND NOT EXISTS (SELECT 1 FROM aurora.contracts v WHERE v.customer_id = sr.customer_id AND v.archived_at IS NULL
                AND v.status = 'active' AND v.starts_on <= h.d AND (v.ends_on IS NULL OR v.ends_on >= h.d))
 ORDER BY 1, 2;

\echo '== 5. contratos que a PRIMEIRA varredura diária (03:23 UTC) renovaria'
WITH hoje AS (SELECT id, (now() AT TIME ZONE COALESCE(timezone, 'America/Sao_Paulo'))::date AS d FROM aurora.organizations)
SELECT c.name AS cliente, ct.number, ct.starts_on, ct.ends_on, (ct.ends_on - ct.starts_on + 1) AS dias_do_prazo
  FROM aurora.contracts ct JOIN hoje h ON h.id = ct.organization_id JOIN aurora.customers c ON c.id = ct.customer_id
 WHERE ct.archived_at IS NULL AND ct.status = 'active' AND ct.auto_renew AND ct.ends_on <= h.d + 1
 ORDER BY ct.ends_on;

\echo '== 5b. já marcados como vencidos com renovação automática: NÃO renovam sozinhos (decidir um a um)'
SELECT c.name AS cliente, ct.number, ct.starts_on, ct.ends_on
  FROM aurora.contracts ct JOIN aurora.customers c ON c.id = ct.customer_id
 WHERE ct.archived_at IS NULL AND ct.status = 'expired' AND ct.auto_renew ORDER BY ct.ends_on;

\echo '== 5c. renovação automática sem término (a varredura ignora; ao editar, a tela grava sem renovação)'
SELECT c.name AS cliente, ct.number, ct.status::text
  FROM aurora.contracts ct JOIN aurora.customers c ON c.id = ct.customer_id
 WHERE ct.archived_at IS NULL AND ct.auto_renew AND ct.ends_on IS NULL ORDER BY 1, 2;

\echo '== 5d. próximos 60 dias: quem vence sem renovação automática (vai parar) e quem renova'
WITH hoje AS (SELECT id, (now() AT TIME ZONE COALESCE(timezone, 'America/Sao_Paulo'))::date AS d FROM aurora.organizations)
SELECT c.name AS cliente, ct.number, ct.ends_on, ct.auto_renew
  FROM aurora.contracts ct JOIN hoje h ON h.id = ct.organization_id JOIN aurora.customers c ON c.id = ct.customer_id
 WHERE ct.archived_at IS NULL AND ct.status = 'active' AND ct.ends_on BETWEEN h.d AND h.d + 60 ORDER BY ct.ends_on;

\echo '== 6. OS ainda não concluídas que passam a pedir hora de início e de término (fora o laudo de obsolescência)'
SELECT w.status_category::text AS situacao, count(*) AS os
  FROM aurora.work_orders w LEFT JOIN aurora.catalog_items t ON t.id = w.work_order_type_id
 WHERE w.status_category NOT IN ('review', 'done', 'closed', 'cancelled') AND t.system_key IS DISTINCT FROM 'obsolescence'
 GROUP BY 1 ORDER BY 1;

\echo '== 7. app de campo: pessoas que enviaram operações nos últimos 30 dias e conclusões pela fila'
SELECT count(DISTINCT membership_id) AS pessoas, count(*) AS operacoes,
       count(*) FILTER (WHERE route LIKE '%transitions%') AS mudancas_de_situacao, max(received_at) AS ultima
  FROM aurora.client_operations WHERE received_at > now() - interval '30 days';

\echo '== 8. planos ativos e automáticos dos clientes que ficam parados (o ciclo abre sem OS até regularizar)'
WITH hoje AS (SELECT id, (now() AT TIME ZONE COALESCE(timezone, 'America/Sao_Paulo'))::date AS d FROM aurora.organizations)
SELECT c.name AS cliente, p.name AS plano, p.auto_generate, count(t.id) AS tarefas
  FROM aurora.maintenance_plans p
  JOIN hoje h ON h.id = p.organization_id
  JOIN aurora.customers c ON c.id = p.customer_id
  JOIN aurora.plan_tasks t ON t.plan_id = p.id AND t.archived_at IS NULL
 WHERE p.archived_at IS NULL AND p.is_active
   AND EXISTS (SELECT 1 FROM aurora.contracts x WHERE x.customer_id = p.customer_id AND x.archived_at IS NULL
                AND x.starts_on <= h.d AND (x.status IN ('suspended', 'expired') OR (x.status = 'active' AND x.ends_on < h.d)))
   AND NOT EXISTS (SELECT 1 FROM aurora.contracts v WHERE v.customer_id = p.customer_id AND v.archived_at IS NULL
                AND v.status = 'active' AND v.starts_on <= h.d AND (v.ends_on IS NULL OR v.ends_on >= h.d))
 GROUP BY c.name, p.id ORDER BY 1, 2;

\echo '== 9. contratos com Equipe Fixa 3 a 10 (composição ainda a detalhar pelo Anderson)'
SELECT c.name AS cliente, ct.number, ct.fixed_team_packages
  FROM aurora.contracts ct JOIN aurora.customers c ON c.id = ct.customer_id
 WHERE ct.archived_at IS NULL AND ct.fixed_team_packages && ARRAY[3, 4, 5, 6, 7, 8, 9, 10]::smallint[] ORDER BY 1, 2;

ROLLBACK;
