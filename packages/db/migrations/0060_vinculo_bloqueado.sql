-- =============================================================================
-- Aurora — 0060 situação "bloqueado" do vínculo (reunião 16/10/2026, Fase 1)
--
-- SÓ VOCABULÁRIO, E EM ARQUIVO PRÓPRIO, pelo mesmo motivo da 0050: o PostgreSQL
-- aceita `ALTER TYPE … ADD VALUE` dentro de transação, mas não deixa USAR o
-- valor novo na mesma transação. A 0061 é quem passa a usá-lo.
--
-- `blocked` é diferente de `suspended`: suspensão é pausa administrativa
-- (afastamento, fim de contrato); bloqueio é corte por segurança ou política.
-- As duas NÃO acessam — a resolução de vínculo (`find_memberships_for_email`,
-- 0005) só devolve `status = 'active'`, então a próxima requisição de quem foi
-- suspenso ou bloqueado é recusada no servidor, com qualquer token.
-- =============================================================================

ALTER TYPE aurora.membership_status ADD VALUE IF NOT EXISTS 'blocked';
