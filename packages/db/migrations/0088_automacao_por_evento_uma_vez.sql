-- =============================================================================
-- Aurora — 0088 automação por EVENTO roda uma vez por evento (AUT-07, 29/10/2026)
--
--   AUT-07 "gatilhos de movimentação em Kanban: eventos condicionados a mudanças reais,
--           sem loops nem duplicação de notificações"
--
-- Mover a OS de coluna no quadro é uma transição de situação: grava `work_order.*` no outbox
-- na mesma transação. O publicador do outbox entrega cada evento às automações que o escutam
-- (`apps/workers`, destino `automacoes`). A entrega é AO MENOS UMA VEZ — o publicador repete o
-- lote que falhou —, então a idempotência tem de estar no banco, e não na esperança:
--
--   · uma execução por (regra, evento): o índice único abaixo. O motor confere antes de agir e
--     grava o log com ON CONFLICT DO NOTHING; a segunda entrega do mesmo evento não age de novo
--     e não manda o aviso de novo.
--
-- Execuções sem evento (agendadas, que usam `schedule_slot`, e o registro da OS criada por
-- automação) não têm `event_id` e ficam fora do índice.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS runs_rule_event_uq
  ON aurora.rule_runs (rule_id, event_id) WHERE event_id IS NOT NULL;
