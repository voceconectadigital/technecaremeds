-- =============================================================================
-- Aurora — 0072 integridade da ordem de serviço (pente-fino 17/10/2026)
--
-- 1. A OS NÃO MISTURA CLIENTES
--    A solicitação confere, desde a 0019, que local e ativo pertencem ao
--    cliente dela (`fn_service_request_scope`). A OS não conferia: um ativo do
--    cliente B podia entrar numa OS do cliente A — pela criação manual ou pelos
--    `targets` do aceite —, e o gatilho da 0031 carimbava na OS de A o
--    CONTRATO de B (o contrato sai do cliente do ativo). Este gatilho espelha
--    o da solicitação, com a mesma semântica e o mesmo SQLSTATE (23514 → 422).
--
--    SECURITY INVOKER (o padrão): lê ativo e local sob a RLS de quem escreve,
--    que é a mesma organização da OS. Ativo ou local inexistente continua
--    sendo problema da chave estrangeira, não deste gatilho.
--
--    Só confere quando cliente, local ou ativo MUDAM. Uma OS antiga cujo ativo
--    foi transferido depois continua editável nos outros campos: o retrato do
--    momento da abertura não vira erro retroativo.
--
-- 2. O CRONÔMETRO ABERTO SEMPRE PODE SER FECHADO
--    `fn_time_entry_guard` (0025) recusava QUALQUER escrita em apontamento de
--    OS fechada ou cancelada — inclusive fechar o cronômetro que ficou aberto.
--    Com check-in feito e a OS negada/cancelada/fechada em seguida, o check-out
--    era recusado, o apontamento ficava aberto para sempre e, pelo índice
--    `te_one_open_per_person` (0025), a pessoa não conseguia mais abrir
--    cronômetro em OS nenhuma.
--
--    A função é substituída mantendo tudo igual, exceto: um UPDATE que só
--    FECHA um apontamento aberto (muda `ended_at` de nulo para um instante, e
--    no máximo a observação) passa pela guarda de OS encerrada. Fechar não
--    reescreve custo consolidado: registra quando o trabalho parou. A guarda
--    de sobreposição continua valendo para ele.
--
--    O índice único parcial `te_one_open_per_person` já existe desde a 0025
--    (um cronômetro aberto por pessoa); nada a criar aqui. A aplicação passa a
--    recusar o segundo cronômetro com mensagem clara antes de bater nele.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Coerência de cliente entre OS, local e ativo.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_work_order_scope() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE v_customer uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
     AND NEW.location_id IS NOT DISTINCT FROM OLD.location_id
     AND NEW.asset_id    IS NOT DISTINCT FROM OLD.asset_id THEN
    RETURN NEW;
  END IF;

  IF NEW.location_id IS NOT NULL THEN
    SELECT customer_id INTO v_customer FROM aurora.locations WHERE id = NEW.location_id;
    IF FOUND AND v_customer IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'o local informado pertence a outro cliente; a OS só aceita local do próprio cliente'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.asset_id IS NOT NULL THEN
    SELECT customer_id INTO v_customer FROM aurora.assets WHERE id = NEW.asset_id;
    IF FOUND AND v_customer IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'o ativo informado pertence a outro cliente; a OS só aceita equipamento do próprio cliente'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

-- Mesmo momento (BEFORE) dos demais gatilhos da OS; a ordem alfabética entre
-- eles não importa aqui: este só recusa, não altera a linha.
CREATE TRIGGER work_orders_scope
  BEFORE INSERT OR UPDATE OF customer_id, location_id, asset_id ON aurora.work_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_work_order_scope();

-- -----------------------------------------------------------------------------
-- 2. Guarda do apontamento — idêntica à da 0025, salvo o fechamento.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aurora.fn_time_entry_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_conflito record;
  v_categoria aurora.status_category;
  v_so_fecha boolean := false;
BEGIN
  IF NEW.ended_at IS NOT NULL THEN
    SELECT te.id, te.started_at, te.ended_at INTO v_conflito
      FROM aurora.time_entries te
     WHERE te.membership_id = NEW.membership_id
       AND te.id <> NEW.id
       AND te.started_at < NEW.ended_at
       AND coalesce(te.ended_at, 'infinity'::timestamptz) > NEW.started_at
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'já existe apontamento desta pessoa entre % e %', v_conflito.started_at, v_conflito.ended_at
        USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;

  -- Fechar o cronômetro aberto: só `ended_at` (e talvez a observação) muda.
  IF TG_OP = 'UPDATE' THEN
    v_so_fecha := OLD.ended_at IS NULL
      AND NEW.ended_at IS NOT NULL
      AND NEW.id              IS NOT DISTINCT FROM OLD.id
      AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
      AND NEW.work_order_id   IS NOT DISTINCT FROM OLD.work_order_id
      AND NEW.membership_id   IS NOT DISTINCT FROM OLD.membership_id
      AND NEW.started_at      IS NOT DISTINCT FROM OLD.started_at
      AND NEW.source          IS NOT DISTINCT FROM OLD.source
      AND NEW.hourly_cost     IS NOT DISTINCT FROM OLD.hourly_cost
      AND NEW.currency        IS NOT DISTINCT FROM OLD.currency
      AND NEW.approved_at     IS NOT DISTINCT FROM OLD.approved_at
      AND NEW.approved_by     IS NOT DISTINCT FROM OLD.approved_by;
  END IF;

  -- Apontar hora em OS fechada reescreveria um custo já consolidado.
  IF NOT v_so_fecha THEN
    SELECT status_category INTO v_categoria FROM aurora.work_orders WHERE id = NEW.work_order_id;
    IF v_categoria IN ('closed', 'cancelled') THEN
      RAISE EXCEPTION 'não se aponta hora em ordem de serviço % ', v_categoria
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;
