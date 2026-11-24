-- =============================================================================
-- Téchne Care — consultas de impacto ANTES de publicar a 0092 e a API desta rodada
-- (respostas do Anderson de 24/11/2026). SÓ LEITURA: nenhuma linha é alterada.
--
-- Rodar como dono do banco (ou com RLS desligado para leitura), no banco de produção,
-- depois do backup e ANTES de publicar a API nova. O resultado diz quem passará a ficar
-- "somente consulta" (D-4) e quem a varredura diária renovaria (D-7) no primeiro dia.
-- =============================================================================

-- 1. D-4 · Clientes que FICARÃO BLOQUEADOS assim que a API nova subir: têm contrato
--    vencido (pela data ou marcado) ou suspenso, e NENHUM contrato válido hoje.
--    Para liberar um deles sem renovar: encerrar o contrato vencido (encerrado não bloqueia).
SELECT o.name AS organizacao, c.name AS cliente, ct.number AS contrato, ct.status::text,
       ct.starts_on, ct.ends_on
  FROM aurora.contracts ct
  JOIN aurora.customers c ON c.id = ct.customer_id
  JOIN aurora.organizations o ON o.id = ct.organization_id
 WHERE ct.archived_at IS NULL
   AND ct.status IN ('active', 'suspended', 'expired')
   AND ct.starts_on <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
   AND (ct.status IN ('suspended', 'expired')
        OR (ct.ends_on IS NOT NULL AND ct.ends_on < (now() AT TIME ZONE 'America/Sao_Paulo')::date))
   AND NOT EXISTS (
     SELECT 1 FROM aurora.contracts v
      WHERE v.customer_id = ct.customer_id AND v.archived_at IS NULL AND v.status = 'active'
        AND v.starts_on <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
        AND (v.ends_on IS NULL OR v.ends_on >= (now() AT TIME ZONE 'America/Sao_Paulo')::date))
 ORDER BY o.name, c.name, ct.ends_on;

-- 2. D-4 · OS ainda abertas desses clientes (não poderão ser executadas nem concluídas).
SELECT c.name AS cliente, w.number, w.title, w.status_category::text
  FROM aurora.work_orders w
  JOIN aurora.customers c ON c.id = w.customer_id
 WHERE w.status_category NOT IN ('done', 'closed', 'cancelled', 'review')
   AND w.customer_id IN (
     SELECT ct.customer_id FROM aurora.contracts ct
      WHERE ct.archived_at IS NULL AND ct.status IN ('active', 'suspended', 'expired')
        AND (ct.status IN ('suspended', 'expired')
             OR (ct.ends_on IS NOT NULL AND ct.ends_on < (now() AT TIME ZONE 'America/Sao_Paulo')::date)))
 ORDER BY c.name, w.number;

-- 3. D-7 · Contratos que a varredura diária RENOVARIA no primeiro dia (vigentes, com
--    renovação automática, término até hoje). Conferir com o Anderson antes de publicar.
SELECT ct.number, c.name AS cliente, ct.starts_on, ct.ends_on, ct.auto_renew
  FROM aurora.contracts ct JOIN aurora.customers c ON c.id = ct.customer_id
 WHERE ct.archived_at IS NULL AND ct.status = 'active' AND ct.auto_renew
   AND ct.ends_on IS NOT NULL AND ct.ends_on <= (now() AT TIME ZONE 'America/Sao_Paulo')::date;

-- 4. D-7 · Combinação que a regra nova recusa na edição: renovação automática sem término.
--    (A varredura simplesmente ignora; a tela, ao salvar, grava "sem renovação".)
SELECT ct.number, c.name AS cliente, ct.status::text
  FROM aurora.contracts ct JOIN aurora.customers c ON c.id = ct.customer_id
 WHERE ct.archived_at IS NULL AND ct.auto_renew AND ct.ends_on IS NULL;

-- 5. D-3 · OS abertas que, ao serem concluídas, passarão a pedir hora de início e de término.
SELECT count(*) AS os_abertas_que_pedirao_horas
  FROM aurora.work_orders
 WHERE status_category IN ('open', 'scheduled', 'in_progress', 'waiting')
   AND (service_started_at IS NULL OR service_ended_at IS NULL);
-- (Antes da 0092 as colunas não existem: rodar esta só DEPOIS da migration, ou trocar
--  a condição por "true" para contar todas as abertas.)

-- 6. Planos · planos ativos cuja âncora já ficou mais de um período para trás (não mudam;
--    a recusa de data retroativa vale só para plano NOVO pelo assistente).
SELECT p.name, p.anchor_date, count(t.id) AS tarefas
  FROM aurora.maintenance_plans p JOIN aurora.plan_tasks t ON t.plan_id = p.id AND t.archived_at IS NULL
 WHERE p.archived_at IS NULL AND p.is_active
 GROUP BY p.id ORDER BY p.anchor_date;
