-- =============================================================================
-- Aurora — 0023 ordem determinística no histórico de solicitações
--
-- DEFEITO QUE ESTA MIGRATION CORRIGE
--
-- Encontrado por um teste do EPIC-008 que leu o histórico de uma OS depois de
-- quatro transições feitas na mesma transação e recebeu as linhas embaralhadas.
--
-- Dentro de uma transação, `now()` devolve sempre o mesmo instante — é o horário
-- de início da transação, por definição. Quatro transições no mesmo COMMIT
-- ficam portanto com `changed_at` idêntico, e uma leitura ordenada por
-- `changed_at, id` cai no desempate pelo id, que é `gen_random_uuid()`. A linha
-- do tempo aparece fora de ordem, e a duração de cada estado sai zerada.
--
-- A 0021 já nasceu corrigida. Esta migration aplica a mesma correção ao
-- histórico de solicitações (0019), que foi escrito antes de o problema
-- aparecer.
--
-- POR QUE UMA MIGRATION NOVA, E NÃO A EDIÇÃO DA 0019
--
-- O migrator guarda o checksum de cada migration aplicada e recusa subir se uma
-- delas mudou depois de aplicada. Nenhum banco tem a 0019 aplicada hoje — o
-- remoto está bloqueado e os testes reconstroem do zero —, então editar seria
-- inofensivo agora e ensinaria o hábito errado. Migration aplicada é fato
-- consumado; corrigir fato consumado é acrescentar, não reescrever.
-- =============================================================================

ALTER TABLE aurora.service_request_status_history
  ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;

-- `clock_timestamp()` e não `now()`: aqui interessa quando o fato aconteceu, não
-- quando a transação começou.
ALTER TABLE aurora.service_request_status_history
  ALTER COLUMN changed_at SET DEFAULT clock_timestamp();

DROP INDEX IF EXISTS aurora.srsh_request_idx;
CREATE INDEX srsh_request_idx ON aurora.service_request_status_history (request_id, sequence);

-- A função da 0019 media a duração contra `max(changed_at)`, que pelo mesmo
-- motivo devolvia sempre o início da transação. Passa a ler a última linha por
-- sequência e a medir com relógio de parede.
CREATE OR REPLACE FUNCTION aurora.fn_service_request_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_seconds  bigint;
  v_last     timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft' THEN
      IF NEW.summary IS DISTINCT FROM OLD.summary OR NEW.description IS DISTINCT FROM OLD.description THEN
        RAISE EXCEPTION 'o relato do solicitante não é editável depois do envio; registre o diagnóstico na ordem de serviço'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.number IS DISTINCT FROM OLD.number THEN
      RAISE EXCEPTION 'o número da solicitação é imutável' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.version <> OLD.version THEN
        RAISE EXCEPTION 'a solicitação mudou desde que você a carregou; recarregue e tente de novo'
          USING ERRCODE = 'serialization_failure';
      END IF;
      NEW.version := OLD.version + 1;

      SELECT changed_at INTO v_last
        FROM aurora.service_request_status_history
       WHERE request_id = NEW.id ORDER BY sequence DESC LIMIT 1;
      v_seconds := EXTRACT(EPOCH FROM (clock_timestamp() - coalesce(v_last, OLD.created_at)))::bigint;

      INSERT INTO aurora.service_request_status_history
        (id, organization_id, request_id, from_status, to_status, changed_by, seconds_in_from)
      VALUES
        (gen_random_uuid(), NEW.organization_id, NEW.id, OLD.status, NEW.status,
         aurora.current_actor_id(), v_seconds);

      IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
        NEW.submitted_at := clock_timestamp();
      END IF;
      IF NEW.status = 'triage' AND NEW.first_response_at IS NULL THEN
        NEW.first_response_at := clock_timestamp();
        NEW.triaged_at := clock_timestamp();
        NEW.triaged_by := aurora.current_actor_id();
      END IF;
      IF NEW.status IN ('closed', 'rejected', 'duplicate', 'cancelled') AND NEW.closed_at IS NULL THEN
        NEW.closed_at := clock_timestamp();
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;
