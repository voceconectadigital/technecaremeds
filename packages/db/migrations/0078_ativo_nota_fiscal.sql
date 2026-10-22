-- =============================================================================
-- 0078 — número da nota fiscal de aquisição do ativo (conversa com o cliente, 21/10/2026)
--
-- O cadastro de ativo já guarda valor de compra, data de aquisição e vida útil
-- (0014). Faltava o número da nota fiscal de aquisição, que o cliente pediu junto
-- com o valor do bem para a depreciação automática. É dado financeiro: a API só o
-- devolve a quem tem `asset.read_financials`, como o valor de compra.
-- =============================================================================

ALTER TABLE aurora.assets ADD COLUMN IF NOT EXISTS acquisition_invoice text;

ALTER TABLE aurora.assets
  ADD CONSTRAINT assets_acquisition_invoice_not_blank
  CHECK (acquisition_invoice IS NULL OR length(btrim(acquisition_invoice)) > 0);
