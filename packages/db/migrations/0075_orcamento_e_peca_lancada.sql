-- =============================================================================
-- Aurora — 0075 PEÇA LANÇADA EM CAMPO ANTES DA APROVAÇÃO DO ORÇAMENTO (PF-34)
--
-- O defeito: o técnico registra a peça na OS (consumo de campo, fora de
-- qualquer reserva de orçamento) e DEPOIS o orçamento com essa peça é aprovado.
-- A aprovação reservava a quantidade inteira de novo e o faturamento baixava
-- essa reserva — a mesma peça saía do estoque duas vezes.
--
-- A decisão (integridade primeiro, conservadora): na aprovação, cada linha de
-- peça reserva só o que AINDA NÃO foi consumido na mesma OS, para o mesmo item,
-- fora da reserva de um orçamento vivo. O valor cobrado do cliente NÃO muda —
-- a peça foi usada e é paga; só o movimento de estoque deixa de duplicar.
--
--   · `quote_items.field_consumed_qty`: quanto da linha já tinha sido lançado
--     em campo quando o orçamento foi aprovado (e, portanto, não foi
--     reservado). É o registro do "abatimento": o consumo que abateu um
--     orçamento não abate um segundo orçamento da mesma OS;
--   · `fn_quote_items_frozen` passa a aceitar a atualização SÓ desta coluna
--     fora do rascunho — é a aprovação que a grava, e a linha enviada continua
--     congelada em todo o resto (descrição, quantidade, preço, totais);
--   · elo das reservas de aprovação ANTERIORES à 0071 que ela deixou sem
--     orçamento (OS com 2+ orçamentos aprovados): sem o elo, o faturamento
--     (que só baixa as reservas DO orçamento) e a revisão (que só solta as
--     dele) nunca as tocavam, e o disponível minguava para sempre. Ver o fim
--     deste arquivo.
--
-- ADITIVA no esquema: não remove nada que já existe. Linhas antigas ficam com
-- 0 (nada abatido), que é exatamente o comportamento anterior.
-- =============================================================================

ALTER TABLE aurora.quote_items
  ADD COLUMN IF NOT EXISTS field_consumed_qty numeric(12,3) NOT NULL DEFAULT 0;
ALTER TABLE aurora.quote_items
  ADD CONSTRAINT quote_items_field_consumed_within
  CHECK (field_consumed_qty >= 0 AND field_consumed_qty <= quantity);

-- Mesma função de 0032 (a última definição), com UMA exceção. O resto fica igual:
--   · em rascunho: INSERT, UPDATE e DELETE liberados;
--   · fora do rascunho: INSERT e DELETE recusados; UPDATE que mexa em qualquer
--     outra coluna recusado; UPDATE que não muda nada também recusado (como antes).
-- A exceção: com o orçamento APROVADO — é a aprovação que grava o abatimento —
-- um UPDATE que muda `field_consumed_qty` e NADA além dela passa.
CREATE OR REPLACE FUNCTION aurora.fn_quote_items_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE v_status aurora.quote_status;
BEGIN
  SELECT status INTO v_status FROM aurora.quotes
   WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);

  IF v_status IS DISTINCT FROM 'draft' THEN
    IF TG_OP = 'UPDATE'
       AND v_status = 'approved'
       AND NEW.field_consumed_qty IS DISTINCT FROM OLD.field_consumed_qty
       AND (to_jsonb(NEW) - 'field_consumed_qty') = (to_jsonb(OLD) - 'field_consumed_qty') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'orçamento já enviado não se edita: revise para criar uma versão nova'
      USING ERRCODE = '23514';
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$fn$;

-- -----------------------------------------------------------------------------
-- Reservas de aprovação sem orçamento (legado da 0071).
--
-- A 0071 só ligou a reserva antiga ao orçamento quando a OS tinha UM orçamento
-- aprovado/em execução. Com dois ou mais, a reserva ficou com `quote_id` nulo:
-- o faturamento (só as reservas do orçamento) não a baixa, a revisão não a
-- solta, e só o cancelamento da OS a libera — numa OS que fecha normalmente, o
-- disponível fica preso para sempre.
--
-- POR QUE UM ELO NO DADO, E NÃO UMA REGRA NO FATURAMENTO. Na aplicação, reserva
-- só nasce de dois jeitos: pela aprovação do orçamento, e pelo lançamento de
-- campo, que reserva e consome a quantidade inteira na mesma hora (nunca fica
-- pendente). Desde a 0071 toda reserva de aprovação leva o orçamento. Então o
-- conjunto "aberta, com pendente, sem orçamento" é FINITO e só existe no dado
-- antigo — corrigido aqui uma vez, nada no código precisa adivinhar de quem é
-- uma reserva (e adivinhar errado, no faturamento, baixaria peça de outro).
--
-- A MARCA, sem heurística de "um orçamento só": a aprovação grava
-- `quotes.decided_at := now()` (gatilho da 0032) e a reserva nasce com
-- `created_at DEFAULT now()` NA MESMA TRANSAÇÃO — `now()` é o instante da
-- transação, então os dois valores são IGUAIS. Exige também a mesma OS e uma
-- linha de peça daquele item no orçamento. Mais de um candidato → não liga
-- (fica como estava, e o aviso abaixo conta).
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE pf34_elo_legado ON COMMIT DROP AS
SELECT r.id AS reservation_id, (array_agg(q.id))[1] AS quote_id
  FROM aurora.stock_reservations r
  JOIN aurora.quotes q
    ON q.organization_id = r.organization_id
   AND q.work_order_id = r.work_order_id
   AND q.decided_at = r.created_at
 WHERE r.quote_id IS NULL
   AND r.released_at IS NULL
   AND r.consumed_qty < r.qty
   AND EXISTS (SELECT 1 FROM aurora.quote_items i
                WHERE i.quote_id = q.id AND i.kind = 'part' AND i.item_id = r.item_id)
 GROUP BY r.id
HAVING count(*) = 1;

UPDATE aurora.stock_reservations r
   SET quote_id = e.quote_id
  FROM pf34_elo_legado e
 WHERE r.id = e.reservation_id;

-- Ligada a uma versão SUPERADA (revisada depois da 0071, que só soltou as
-- reservas com elo): é o que a revisão teria feito — solta o pendente.
CREATE TEMP TABLE pf34_soltar ON COMMIT DROP AS
SELECT r.id, r.item_id, r.warehouse_id, (r.qty - r.consumed_qty) AS pendente
  FROM aurora.stock_reservations r
  JOIN pf34_elo_legado e ON e.reservation_id = r.id
  JOIN aurora.quotes q ON q.id = r.quote_id
 WHERE q.status IN ('superseded', 'cancelled');

UPDATE aurora.stock_balances b
   SET reserved = b.reserved - s.total
  FROM (SELECT item_id, warehouse_id, sum(pendente) AS total
          FROM pf34_soltar GROUP BY item_id, warehouse_id) s
 WHERE b.item_id = s.item_id AND b.warehouse_id = s.warehouse_id;

UPDATE aurora.stock_reservations r
   SET released_at = now()
  FROM pf34_soltar s
 WHERE r.id = s.id;

-- O que NÃO se corrige sozinho vira aviso, para correção manual (ajuste de
-- estoque com justificativa) — a migration não inventa movimento no razão:
--   · ligada a orçamento JÁ faturado/encerrado depois da 0071 (a baixa daquela
--     peça não aconteceu);
--   · sem marca única (não ligada).
DO $do$
DECLARE
  v_faturado integer;
  v_sem_elo  integer;
BEGIN
  SELECT count(*) INTO v_faturado
    FROM aurora.stock_reservations r
    JOIN pf34_elo_legado e ON e.reservation_id = r.id
    JOIN aurora.quotes q ON q.id = r.quote_id
   WHERE q.status IN ('invoiced', 'closed');
  SELECT count(*) INTO v_sem_elo
    FROM aurora.stock_reservations r
   WHERE r.quote_id IS NULL AND r.released_at IS NULL AND r.consumed_qty < r.qty;
  IF v_faturado > 0 THEN
    RAISE WARNING '0075: % reserva(s) antiga(s) de orçamento já faturado seguem abertas — conferir e ajustar o estoque', v_faturado;
  END IF;
  IF v_sem_elo > 0 THEN
    RAISE WARNING '0075: % reserva(s) aberta(s) sem orçamento e sem marca única — conferir manualmente', v_sem_elo;
  END IF;
END
$do$;
