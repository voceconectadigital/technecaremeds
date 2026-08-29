-- =============================================================================
-- Aurora — 0028 dois defeitos encontrados pelos testes do EPIC-010
--
-- DEFEITO 1 — O GUARDA DE OS FECHADA BLOQUEAVA A PRÓPRIA REABERTURA
--
-- `fn_work_order_closed_guard` (0022) recusava QUALQUER update numa OS fechada.
-- Mas reabrir é uma transição declarada no grafo (`closed → in_progress`), com
-- permissão própria (`work_order.reopen`) e justificativa obrigatória. O guarda
-- tornava impossível o caminho que a SPEC §10 descreve em detalhe.
--
-- A regra correta é mais estreita do que "nada muda": OS fechada é somente
-- leitura QUANTO AOS CAMPOS. Mudar de situação continua sendo assunto do grafo,
-- que já recusa transição não declarada e já exige a permissão.
--
-- DEFEITO 2 — "VIOLADO" NÃO DEVE PARAR O RELÓGIO
--
-- A varredura marcava `state = 'breached'` ao vencer o prazo, e a restrição
-- `sla_clocks_stopped_has_elapsed` recusava, corretamente: um relógio em estado
-- final precisa dizer quando parou e quanto durou.
--
-- Mas estourar o prazo não encerra nada — o trabalho continua, e o tempo real
-- só se sabe na conclusão. `breached_at` é um CARIMBO, não um estado terminal.
-- O estado final é decidido no encerramento, comparando com o prazo congelado.
-- Confundir os dois faria o relatório perder a diferença entre "estourou e foi
-- resolvido em três dias" e "estourou".
-- =============================================================================

CREATE OR REPLACE FUNCTION aurora.fn_work_order_closed_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status_category <> 'closed' THEN
    RETURN NEW;
  END IF;

  -- Sair de "Fechada" é transição, e transição é assunto do grafo: o gatilho
  -- `work_orders_transition` já recusa a que não estiver declarada, e o motor
  -- de domínio já exige `work_order.reopen` e a justificativa.
  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    RETURN NEW;
  END IF;

  IF coalesce(current_setting('aurora.allow_closed_edit', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'ordem de serviço fechada é somente leitura; editar exige work_order.edit_closed'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$fn$;

-- `breached` deixa de ser estado: passa a ser só o carimbo `breached_at`.
-- Um relógio que estourou continua correndo até alguém concluir o trabalho.
ALTER TABLE aurora.sla_clocks DROP CONSTRAINT sla_clocks_stopped_has_elapsed;
ALTER TABLE aurora.sla_clocks
  ADD CONSTRAINT sla_clocks_stopped_has_elapsed CHECK (
    state IN ('running', 'paused') OR stopped_at IS NOT NULL
  ),
  -- Estado final coerente com o carimbo: quem terminou depois do prazo tem de
  -- ter o carimbo, e quem terminou dentro não pode tê-lo.
  ADD CONSTRAINT sla_clocks_breach_consistent CHECK (
    state <> 'met' OR breached_at IS NULL
  );

COMMENT ON COLUMN aurora.sla_clocks.breached_at IS
  'Quando o prazo foi ultrapassado. NÃO encerra o relógio: o trabalho continua, e o estado final sai da conclusão.';
