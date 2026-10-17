-- =============================================================================
-- Aurora — 0071 INTEGRIDADE de estoque e orçamento (pente-fino de 17/10/2026)
--
--   · `stock_reservations.quote_id`: a reserva feita pela APROVAÇÃO de um
--     orçamento passa a saber de qual orçamento ela é. Sem o elo, cancelar ou
--     faturar um orçamento mexia em TODAS as reservas abertas da OS — inclusive
--     as do campo e as de outro orçamento — e a peça saía do estoque duas vezes.
--     Reservas antigas recebem o elo quando a OS tem exatamente UM orçamento
--     aprovado/em execução com aquela peça (o único caso sem ambiguidade);
--   · estorno único: um movimento só pode ser estornado uma vez. A conferência
--     da aplicação lia antes de gravar, e dois estornos simultâneos passavam os
--     dois; o índice único parcial é quem garante;
--   · totais do orçamento congelados fora do rascunho: desconto geral,
--     acréscimos e impostos só mudam com o orçamento em `draft` — mesma regra
--     que as linhas já tinham (`fn_quote_items_frozen`). Proposta enviada muda
--     por revisão, nunca por edição.
--
-- ADITIVA: não remove nada que já existe.
-- =============================================================================

ALTER TABLE aurora.stock_reservations ADD COLUMN IF NOT EXISTS quote_id uuid;
ALTER TABLE aurora.stock_reservations
  ADD CONSTRAINT reservations_quote_org_fk
  FOREIGN KEY (quote_id, organization_id)
  REFERENCES aurora.quotes (id, organization_id);
CREATE INDEX IF NOT EXISTS reservations_quote_idx ON aurora.stock_reservations (quote_id)
  WHERE quote_id IS NOT NULL;

-- Elo retroativo, só onde não há dúvida: reserva aberta, ainda não consumida,
-- numa OS com UM orçamento aprovado/em execução que tem aquela peça.
UPDATE aurora.stock_reservations r
   SET quote_id = q.id
  FROM aurora.quotes q
 WHERE r.quote_id IS NULL
   AND r.released_at IS NULL
   AND r.consumed_qty < r.qty
   AND q.organization_id = r.organization_id
   AND q.work_order_id = r.work_order_id
   AND q.status IN ('approved', 'in_execution')
   AND EXISTS (SELECT 1 FROM aurora.quote_items i
                WHERE i.quote_id = q.id AND i.kind = 'part' AND i.item_id = r.item_id)
   AND (SELECT count(*) FROM aurora.quotes q2
         WHERE q2.organization_id = r.organization_id
           AND q2.work_order_id = r.work_order_id
           AND q2.status IN ('approved', 'in_execution')) = 1;

-- O razão é imutável: se um banco já tiver um estorno duplicado (o defeito que
-- este índice impede), a migration NÃO apaga nada e NÃO trava a implantação —
-- avisa e segue sem o índice; a conferência da aplicação continua valendo, e o
-- caso vai para correção manual por movimento de ajuste.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM aurora.stock_movements WHERE reverses_id IS NOT NULL
              GROUP BY reverses_id HAVING count(*) > 1) THEN
    RAISE WARNING 'estorno duplicado já existe em aurora.stock_movements: índice movements_reverses_once_uq não criado';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS movements_reverses_once_uq
      ON aurora.stock_movements (reverses_id) WHERE reverses_id IS NOT NULL;
  END IF;
END
$do$;

CREATE FUNCTION aurora.fn_quote_totals_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.general_discount_cents, NEW.general_discount_percent,
       NEW.additions_cents,        NEW.taxes_cents
     ) IS DISTINCT FROM (
       OLD.general_discount_cents, OLD.general_discount_percent,
       OLD.additions_cents,        OLD.taxes_cents
     ) THEN
    RAISE EXCEPTION 'orçamento já enviado não muda desconto, acréscimo nem imposto: revise para criar uma versão nova'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;
ALTER FUNCTION aurora.fn_quote_totals_frozen() OWNER TO aurora_owner;

-- Nome depois de `quotes_guard` (ordem alfabética): compara o valor JÁ
-- recalculado pelo guarda com o anterior.
CREATE TRIGGER quotes_totals_frozen BEFORE UPDATE ON aurora.quotes
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_quote_totals_frozen();
