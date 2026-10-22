-- =============================================================================
-- Aurora — 0079 vocabulário: assinatura pela sessão autenticada
-- Conversa com o cliente, 21/10/2026: "avaliar antes e depois assinar automático".
--
-- SÓ VOCABULÁRIO, E EM ARQUIVO PRÓPRIO (mesma razão da 0050): o PostgreSQL não deixa
-- USAR um valor novo de enum na transação em que ele nasce. O CHECK que o aceita e a
-- tabela de avaliações ficam na 0080.
--
--   · `session` — a pessoa já está identificada pela sessão (e-mail verificado no
--     login). A assinatura registra o resumo do que foi assinado, o e-mail, o IP e o
--     agente de quem assinou, e não finge ser mais do que é: não é ICP-Brasil e não
--     afirma validade jurídica.
-- =============================================================================

ALTER TYPE aurora.signature_method ADD VALUE IF NOT EXISTS 'session';
