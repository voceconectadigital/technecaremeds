-- =============================================================================
-- 0075 — indicadores e fuso (pendências do pente-fino de 17/10/2026)
--
-- PF-56 — o e-mail das automações (relatório agendado, lembrete) passa pelas
-- MESMAS preferências de notificação do resto do sistema (`decideDelivery`):
-- canal desligado, e-mail não verificado ou bloqueado → entrega SUPRIMIDA, com
-- o motivo na própria entrega; a notificação da caixa de entrada continua.
--
-- O relatório entregue guarda o estado do e-mail dele (`email_state`). Sem
-- este valor, o relatório cujo e-mail foi suprimido continuaria dizendo
-- "na fila" — e nunca sairia.
--
-- Fuso (PF-51): nada a migrar. O fuso já é da organização
-- (`organizations.timezone`, padrão `America/Sao_Paulo`, desde a 0001).
-- =============================================================================

ALTER TABLE aurora.automation_report_outputs
  DROP CONSTRAINT IF EXISTS outputs_email_state_valid;

ALTER TABLE aurora.automation_report_outputs
  ADD CONSTRAINT outputs_email_state_valid
  CHECK (email_state IN ('queued_no_transport', 'queued', 'sent', 'failed', 'suppressed'));
