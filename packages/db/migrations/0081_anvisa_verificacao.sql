-- =============================================================================
-- Aurora — 0081 verificação do registro ANVISA do equipamento
-- Conversa com o cliente, 21/10/2026: "registro ANVISA no cadastro do ativo … ver se há
-- notificações e qual a proibição de uso do equipamento … informando através de mensagens".
--
-- O QUE ISTO É E O QUE NÃO É. O produto ainda não consulta a ANVISA sozinho: não há fonte
-- oficial escolhida, nem frequência, nem limite de uso definidos. O que existe é o REGISTRO da
-- verificação — quem olhou, quando, o que encontrou (regular, alerta ou uso proibido) — e o
-- aviso às pessoas certas quando o resultado é alerta ou proibição. Quando uma fonte automática
-- for escolhida, ela grava nestas mesmas colunas.
-- =============================================================================

ALTER TABLE aurora.assets
  ADD COLUMN IF NOT EXISTS anvisa_status     text,
  ADD COLUMN IF NOT EXISTS anvisa_note       text,
  ADD COLUMN IF NOT EXISTS anvisa_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS anvisa_checked_by uuid;

ALTER TABLE aurora.assets
  ADD CONSTRAINT assets_anvisa_status_valid
    CHECK (anvisa_status IS NULL OR anvisa_status IN ('regular', 'alert', 'prohibited')),
  ADD CONSTRAINT assets_anvisa_note_len
    CHECK (anvisa_note IS NULL OR length(anvisa_note) <= 1000),
  -- Status sem data de verificação seria uma afirmação sem quando.
  ADD CONSTRAINT assets_anvisa_checked_together
    CHECK ((anvisa_status IS NULL) = (anvisa_checked_at IS NULL));
