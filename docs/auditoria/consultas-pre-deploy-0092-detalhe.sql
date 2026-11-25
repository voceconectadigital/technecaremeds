-- Téchne Care — detalhe do contrato e dos planos afetados pela 0092 (25/11/2026). SOMENTE LEITURA.
-- Complementa consultas-pre-deploy-0092.sql. Mesmo modo de rodar. Não lê valores financeiros nem dados de pessoas.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';

\echo '== A. o contrato e o que a renovação preserva'
SELECT ct.number, ct.status::text, ct.kind::text, ct.starts_on, ct.ends_on, ct.auto_renew, ct.service_frequency,
       ct.fixed_team_packages, ct.payment_terms, ct.billing_model::text, ct.billing_model_informed,
       (ct.sla_policy_id IS NOT NULL) AS tem_sla, (ct.monthly_value IS NOT NULL) AS tem_valor,
       c.contract_starts_on AS cadastro_inicio, c.contract_ends_on AS cadastro_fim, ct.updated_at
  FROM aurora.contracts ct JOIN aurora.customers c ON c.id = ct.customer_id
 WHERE ct.archived_at IS NULL ORDER BY ct.number;

\echo '== B. coberturas e períodos medidos'
SELECT ct.number, cv.kind::text AS cobertura, count(*) AS n FROM aurora.contracts ct
  JOIN aurora.contract_coverages cv ON cv.contract_id = ct.id GROUP BY 1, 2;
SELECT ct.number, count(p.id) AS periodos FROM aurora.contracts ct
  LEFT JOIN aurora.contract_periods p ON p.contract_id = ct.id GROUP BY 1;

\echo '== C. planos ativos: alvo e procedimento de cada tarefa'
SELECT p.name AS plano, p.auto_generate, p.anchor_date, t.id AS tarefa, t.target_kind::text AS alvo, t.checklist_template_key AS principal,
       t.extra_checklist_template_keys AS adicionais, t.frequency_unit::text AS unidade, t.frequency_interval AS a_cada,
       (SELECT count(*) FROM aurora.resolve_plan_task_assets(t.id)) AS equipamentos,
       (SELECT count(DISTINCT a.asset_category_id) FROM aurora.resolve_plan_task_assets(t.id) r
          JOIN aurora.assets a ON a.id = r.asset_id) AS categorias
  FROM aurora.maintenance_plans p JOIN aurora.plan_tasks t ON t.plan_id = p.id AND t.archived_at IS NULL
 WHERE p.archived_at IS NULL AND p.is_active ORDER BY p.name;

\echo '== D. equipamentos que cada tarefa alcança'
SELECT p.name AS plano, a.name AS equipamento, g.name AS categoria
  FROM aurora.maintenance_plans p JOIN aurora.plan_tasks t ON t.plan_id = p.id AND t.archived_at IS NULL
 CROSS JOIN LATERAL aurora.resolve_plan_task_assets(t.id) r
  JOIN aurora.assets a ON a.id = r.asset_id JOIN aurora.asset_categories g ON g.id = a.asset_category_id
 WHERE p.archived_at IS NULL AND p.is_active ORDER BY 1, 3, 2;

\echo '== E. OS geradas pelos planos: situação e checklist que receberam'
SELECT p.name AS plano, w.number, w.status_category::text AS situacao, a.name AS equipamento, c.seq, i.due_at::date AS vence,
       (SELECT string_agg(cr.template_key, ' + ' ORDER BY cr.template_key) FROM aurora.checklist_responses cr
         WHERE cr.work_order_id = w.id) AS checklists,
       (SELECT count(*) FROM aurora.checklist_answers ca JOIN aurora.checklist_responses cr ON cr.id = ca.response_id
         WHERE cr.work_order_id = w.id) AS respostas
  FROM aurora.plan_cycle_items i JOIN aurora.plan_cycles c ON c.id = i.cycle_id
  JOIN aurora.maintenance_plans p ON p.id = c.plan_id AND p.archived_at IS NULL AND p.is_active
  JOIN aurora.assets a ON a.id = i.asset_id
  LEFT JOIN aurora.work_orders w ON w.id = i.work_order_id
 ORDER BY p.name, c.seq, w.number;

\echo '== F. procedimentos publicados'
SELECT DISTINCT ON (key) key, title, version, COALESCE(procedure_kind::text, 'preventiva') AS tipo
  FROM aurora.checklist_templates WHERE status = 'published' ORDER BY key, version DESC;

\echo '== G. as 12 OS em aberto do cliente: já têm check-in, hora apontada ou resposta?'
SELECT w.number, w.status_category::text AS situacao, w.source::text AS origem,
       (SELECT count(*) FROM aurora.work_order_visits v WHERE v.work_order_id = w.id) AS visitas,
       (SELECT count(*) FROM aurora.time_entries te WHERE te.work_order_id = w.id) AS horas,
       (SELECT count(*) FROM aurora.checklist_answers ca JOIN aurora.checklist_responses cr ON cr.id = ca.response_id
         WHERE cr.work_order_id = w.id) AS respostas,
       w.scheduled_start::date AS agendada
  FROM aurora.work_orders w
 WHERE w.status_category NOT IN ('closed', 'cancelled', 'done', 'review')
   AND w.customer_id IN (SELECT customer_id FROM aurora.contracts WHERE number = 'CT-2026-00001')
 ORDER BY w.number;

ROLLBACK;
