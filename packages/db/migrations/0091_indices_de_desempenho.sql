-- =============================================================================
-- Aurora — 0091 índices de desempenho (auditoria corretiva de 23/11/2026, PERF-01/10/11)
--
-- SÓ ÍNDICES, SÓ ADITIVA. Nenhuma tabela, coluna, dado, política ou permissão muda; a API anterior
-- funciona igual com eles (rollback = não precisa desfazer; se quiser, DROP INDEX dos três).
--
-- Cada índice existe por uma consulta medida, e só por ela. Medição: PGlite (PostgreSQL 16.4),
-- 10 organizações, a maior com 50 mil OS / 5 mil ativos / 150 mil transições de situação; sob
-- `aurora_app` com RLS, 15 execuções após 3 de aquecimento (p50). Detalhe e método em
-- docs/auditoria/RELATORIO_SEGURANCA_PERFORMANCE.md.
--
-- 1. Lista de OS SEM filtro (`GET /v1/work-orders`, a tela padrão): `ORDER BY created_at DESC
--    LIMIT n`. Os índices existentes têm `customer_id` ou `status_category` antes de `created_at`,
--    então o banco lia a organização inteira para devolver 100 linhas. 131 ms → 0,5 ms.
--
-- 2. SLA cumprido no período (`slaCompliance`, Painel e relatórios — 12× na série mensal):
--    `stopped_at` numa faixa. Só havia (organization_id, kind, state). 13,5 ms → 1,8 ms.
--
-- 3. Tempo por situação / por motivo de espera (`timeByStatus`, relatórios): `changed_at` numa
--    faixa. Só havia (organization_id) e (work_order_id, sequence). 94 ms → 55 ms (p95 165 → 64).
--
-- Tamanho/escrita: três índices B-tree de duas colunas; `work_order_status_history` e
-- `sla_clocks` só recebem INSERT/UPDATE pontual. Em produção as tabelas são pequenas: a criação
-- leva segundos (CREATE INDEX comum bloqueia escrita nessas tabelas durante a construção — por
-- isso a publicação recomenda horário de pouco uso; CONCURRENTLY não roda dentro da transação
-- do migrator).
-- =============================================================================

CREATE INDEX IF NOT EXISTS wo_org_created_idx
  ON aurora.work_orders (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sla_clocks_stopped_idx
  ON aurora.sla_clocks (organization_id, stopped_at)
  WHERE state IN ('met', 'breached');

CREATE INDEX IF NOT EXISTS wosh_org_changed_idx
  ON aurora.work_order_status_history (organization_id, changed_at);
