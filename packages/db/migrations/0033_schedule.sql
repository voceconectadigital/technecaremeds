-- =============================================================================
-- Aurora — 0033 agenda (SPEC v0.2 §13) · EPIC-012
--
-- Esta migration é pequena de propósito. A programação já vive na OS
-- (`scheduled_start`, `scheduled_end`, responsável, equipe) desde a 0021, e a
-- agenda é uma PROJEÇÃO disso — ADR-011. Um evento de agenda separado criaria
-- duas fontes de verdade e a obrigação de sincronizá-las, e é sempre a
-- sincronização que falha calada.
--
-- O que falta, e é o que entra aqui:
--
--   · a CONTAGEM de reagendamentos, que o §13 pede como sinal operacional;
--   · o carimbo de quando a janela foi invalidada, que alimenta o balde
--     "Reagendar" do painel lateral;
--   · o motivo da janela do local, para o aviso dizer POR QUE não cabe.
-- =============================================================================

ALTER TABLE aurora.work_orders ADD COLUMN reschedule_count integer NOT NULL DEFAULT 0;
ALTER TABLE aurora.work_orders ADD COLUMN window_invalidated_at timestamptz;
ALTER TABLE aurora.work_orders ADD COLUMN window_invalidated_reason text;

ALTER TABLE aurora.work_orders
  ADD CONSTRAINT work_orders_reschedule_non_negative CHECK (reschedule_count >= 0);

CREATE INDEX work_orders_scheduled_idx
  ON aurora.work_orders (organization_id, scheduled_start)
  WHERE scheduled_start IS NOT NULL AND status_category NOT IN ('closed', 'cancelled');

CREATE INDEX work_orders_unscheduled_idx
  ON aurora.work_orders (organization_id, created_at)
  WHERE scheduled_start IS NULL AND status_category NOT IN ('closed', 'cancelled');

CREATE INDEX work_orders_assignee_window_idx
  ON aurora.work_orders (organization_id, assignee_membership_id, scheduled_start)
  WHERE assignee_membership_id IS NOT NULL AND scheduled_start IS NOT NULL;

-- -----------------------------------------------------------------------------
-- O motivo da janela de atendimento do local.
--
-- O §13 pede o aviso "UTI só libera equipamento entre 14 h e 16 h" — com a
-- frase, não só com o horário. Um aviso que diz apenas "fora da janela" faz o
-- coordenador abrir outra tela para descobrir qual janela é, e cada tela a mais
-- é um passo na direção de ele desistir e ligar para o técnico.
-- -----------------------------------------------------------------------------
-- calendar_id já existe em locations desde a 0008; o que falta é a frase.
ALTER TABLE aurora.locations ADD COLUMN service_window_note text;

-- -----------------------------------------------------------------------------
-- Contagem de reagendamentos.
--
-- No gatilho, e não na aplicação, porque a janela pode mudar por vários
-- caminhos — a tela do coordenador, o arrasto no calendário, a geração de
-- ciclo preventivo, uma correção em lote. Contar em um deles seria contar em
-- alguns, e um número que conta "alguns" é pior que número nenhum: parece
-- confiável.
--
-- A PRIMEIRA marcação não conta. Marcar a janela pela primeira vez é agendar;
-- reagendar é mudar o que já estava marcado. Somar a primeira faria toda OS
-- programada nascer com um reagendamento no histórico.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_work_order_reschedule() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start
     AND OLD.scheduled_start IS NOT NULL
     AND NEW.scheduled_start IS NOT NULL THEN
    NEW.reschedule_count := OLD.reschedule_count + 1;
  END IF;

  -- Mexer na janela resolve, por definição, a pendência de reagendamento: o
  -- balde "Reagendar" existe para pedir uma decisão, e a decisão foi tomada.
  IF NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start THEN
    NEW.window_invalidated_at := NULL;
    NEW.window_invalidated_reason := NULL;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER work_orders_reschedule BEFORE UPDATE ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_work_order_reschedule();

-- -----------------------------------------------------------------------------
-- Ausência criada depois invalida a janela que a atravessa.
--
-- Este é o caso que a agenda da referência não cobre e que produz o telefonema:
-- o técnico entra de férias, e as OS que estavam marcadas para ele naquela
-- semana continuam marcadas, sem ninguém saber. Aqui elas caem no balde
-- "Reagendar" no mesmo instante, com o motivo escrito.
--
-- Marca, e NÃO desagenda: apagar a janela sozinho jogaria fora a informação de
-- quando aquilo estava previsto, que é justamente o que o coordenador usa para
-- remarcar perto da data original.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_absence_invalidates_windows() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF NEW.kind NOT IN ('vacation', 'leave') THEN
    RETURN NULL;
  END IF;

  UPDATE aurora.work_orders w
     SET window_invalidated_at = now(),
         window_invalidated_reason =
           format('a pessoa entrou em %s de %s a %s',
                  CASE NEW.kind WHEN 'vacation' THEN 'férias' ELSE 'afastamento' END,
                  to_char(NEW.starts_at, 'DD/MM'), to_char(NEW.ends_at, 'DD/MM'))
   WHERE w.assignee_membership_id = NEW.membership_id
     AND w.scheduled_start IS NOT NULL
     AND w.started_at IS NULL
     AND w.status_category NOT IN ('closed', 'cancelled')
     AND w.scheduled_start < NEW.ends_at
     -- Janela sem fim marcado é um ponto no tempo, não um intervalo vazio: sem
     -- o segundo somado, a OS marcada exatamente no instante em que a ausência
     -- começa escaparia da comparação.
     AND NEW.starts_at < COALESCE(w.scheduled_end, w.scheduled_start + interval '1 second');

  RETURN NULL;
END
$fn$;

CREATE TRIGGER availability_blocks_invalidate
  AFTER INSERT ON aurora.availability_blocks
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_absence_invalidates_windows();
