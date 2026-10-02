-- =============================================================================
-- Aurora — 0047 a medição deixa de ser sobrescrita sem rastro
-- Auditoria de gap V2 §29 e P0.1 · PLAT §11 "auditoria imutável para medições"
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O DEFEITO QUE ESTA MIGRATION FECHA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `answerChecklistItem` gravava com `ON CONFLICT (response_id, item_id) DO
-- UPDATE`. Responder de novo o mesmo item — o técnico corrigindo um valor, a
-- fila offline reenviando com outro corpo — SUBSTITUÍA o valor anterior, e
-- `checklist_answers` não tinha gatilho de auditoria. Uma pressão medida em
-- 18 cmH₂O e "corrigida" para 25 não deixava sinal nenhum de que um dia foi 18.
--
-- Para checklist de rotina isso já era ruim. Para MEDIÇÃO é inaceitável: o
-- valor original é a evidência, e a correção é um FATO NOVO sobre ela — não a
-- substituição dela.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O DESENHO: LINHA CORRENTE + HISTÓRICO APPEND-ONLY
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A alternativa era "uma linha por leitura, com `superseded_by`", e foi
-- descartada por compatibilidade: toda consulta que hoje lê
-- `checklist_answers` (o bloco de conclusão em 0025, o estado do checklist, o
-- pacote de campo) teria de ganhar um filtro "só a vigente", e a primeira que
-- esquecesse contaria duas vezes o mesmo item.
--
-- Então:
--
--   · `checklist_answers` continua sendo a resposta VIGENTE, uma por item, e
--     ganha `revision` (1, 2, 3…). Nenhum leitor existente muda.
--   · `checklist_answer_revisions` guarda cada versão SUBSTITUÍDA, inteira,
--     com quem e quando a substituiu. Só o gatilho escreve; a aplicação só lê.
--   · O gatilho é BEFORE UPDATE: a versão anterior entra no histórico NA MESMA
--     instrução que a substitui. Não há caminho que atualize sem arquivar.
--   · `aurora_app` perde DELETE em `checklist_answers`: a resposta não some por
--     comando. (A exclusão em cascata da organização continua funcionando — a
--     FK do histórico é NO ACTION, conferida no fim da instrução.)
--   · `fn_audit` passa a cobrir `checklist_answers`, como cobre OS e documento.
--
-- Reenviar o MESMO valor não cria revisão: a aplicação filtra no `DO UPDATE`
-- e, se ainda assim nada mudou, o gatilho devolve a linha antiga intacta.
-- Revisão é correção, não eco.
-- =============================================================================

ALTER TABLE aurora.checklist_answers
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
  -- Por que o valor foi corrigido. Opcional: o fluxo de campo existente não
  -- manda motivo, e exigir quebraria a fila de quem já tem trabalho no aparelho.
  ADD COLUMN IF NOT EXISTS correction_reason text;

ALTER TABLE aurora.checklist_answers
  DROP CONSTRAINT IF EXISTS ca_revision_positive;
ALTER TABLE aurora.checklist_answers
  ADD CONSTRAINT ca_revision_positive CHECK (revision >= 1);

CREATE TABLE aurora.checklist_answer_revisions (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  answer_id         uuid NOT NULL,
  response_id       uuid NOT NULL,
  item_id           uuid NOT NULL,
  /** A revisão que ESTA linha era antes de ser substituída. */
  revision          integer NOT NULL,
  value_text        text,
  value_number      numeric,
  value_boolean     boolean,
  value_options     text[],
  value_date        date,
  verdict           aurora.checklist_verdict NOT NULL,
  photo_count       integer NOT NULL,
  note              text,
  correction_reason text,
  measured_by       uuid,
  measured_at       timestamptz NOT NULL,
  /** Quem e quando substituiu — o ato de corrigir é ele mesmo um fato. */
  superseded_at     timestamptz NOT NULL DEFAULT now(),
  superseded_by     uuid,
  CONSTRAINT car_revision_positive CHECK (revision >= 1),
  CONSTRAINT car_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT car_answer_revision_uq UNIQUE (answer_id, revision),
  -- NO ACTION, e não CASCADE: a resposta não pode sumir levando o histórico.
  CONSTRAINT car_answer_org_fk
    FOREIGN KEY (answer_id, organization_id)
    REFERENCES aurora.checklist_answers (id, organization_id),
  CONSTRAINT car_response_org_fk
    FOREIGN KEY (response_id, organization_id)
    REFERENCES aurora.checklist_responses (id, organization_id)
);
CREATE INDEX car_answer_idx   ON aurora.checklist_answer_revisions (answer_id, revision);
CREATE INDEX car_response_idx ON aurora.checklist_answer_revisions (response_id);
CREATE INDEX car_org_idx      ON aurora.checklist_answer_revisions (organization_id);

-- -----------------------------------------------------------------------------
-- O gatilho que arquiva antes de substituir.
--
-- SECURITY DEFINER porque `aurora_app` não escreve no histórico — e não deve:
-- um histórico que a aplicação pode escrever é um histórico que a aplicação
-- pode forjar. Dono `aurora_owner`, `search_path` fixo. A RLS continua valendo
-- (FORCE): o arquivamento só entra na organização do contexto.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_checklist_answer_revision() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  -- Identidade da resposta é imutável: mover uma resposta para outro item ou
  -- outra resposta-mãe seria reescrever a quem a evidência se refere.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.response_id IS DISTINCT FROM OLD.response_id
     OR NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    RAISE EXCEPTION 'a identidade de uma resposta de checklist é imutável'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Nada de substância mudou: devolve a linha como estava, sem revisão nova.
  IF NEW.value_text    IS NOT DISTINCT FROM OLD.value_text
     AND NEW.value_number  IS NOT DISTINCT FROM OLD.value_number
     AND NEW.value_boolean IS NOT DISTINCT FROM OLD.value_boolean
     AND NEW.value_options IS NOT DISTINCT FROM OLD.value_options
     AND NEW.value_date    IS NOT DISTINCT FROM OLD.value_date
     AND NEW.verdict       IS NOT DISTINCT FROM OLD.verdict
     AND NEW.photo_count   IS NOT DISTINCT FROM OLD.photo_count
     AND NEW.note          IS NOT DISTINCT FROM OLD.note THEN
    RETURN OLD;
  END IF;

  INSERT INTO aurora.checklist_answer_revisions
    (id, organization_id, answer_id, response_id, item_id, revision,
     value_text, value_number, value_boolean, value_options, value_date,
     verdict, photo_count, note, correction_reason, measured_by, measured_at,
     superseded_at, superseded_by)
  VALUES
    (gen_random_uuid(), OLD.organization_id, OLD.id, OLD.response_id, OLD.item_id, OLD.revision,
     OLD.value_text, OLD.value_number, OLD.value_boolean, OLD.value_options, OLD.value_date,
     OLD.verdict, OLD.photo_count, OLD.note, OLD.correction_reason, OLD.measured_by, OLD.measured_at,
     now(), aurora.current_actor_id());

  -- A revisão é contada pelo banco, nunca recebida.
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END
$fn$;
ALTER FUNCTION aurora.fn_checklist_answer_revision() OWNER TO aurora_owner;

CREATE TRIGGER checklist_answers_revision BEFORE UPDATE ON aurora.checklist_answers
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_checklist_answer_revision();

/** Histórico não se altera nem se apaga — nem pelo dono, fora da cascata da organização. */
CREATE FUNCTION aurora.fn_checklist_answer_revision_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'o histórico de uma medição não se altera' USING ERRCODE = 'check_violation';
END
$fn$;

CREATE TRIGGER checklist_answer_revisions_immutable
  BEFORE UPDATE ON aurora.checklist_answer_revisions
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_checklist_answer_revision_immutable();

-- A resposta entra na trilha de auditoria como OS e documento já entram.
CREATE TRIGGER checklist_answers_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.checklist_answers
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('verdict');

-- -----------------------------------------------------------------------------
-- RLS e privilégios
-- -----------------------------------------------------------------------------
DO $do$
BEGIN
  ALTER TABLE aurora.checklist_answer_revisions OWNER TO aurora_owner;
  ALTER TABLE aurora.checklist_answer_revisions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE aurora.checklist_answer_revisions FORCE  ROW LEVEL SECURITY;
  CREATE POLICY checklist_answer_revisions_tenant_isolation ON aurora.checklist_answer_revisions FOR ALL
    USING (organization_id = aurora.current_organization_id())
    WITH CHECK (organization_id = aurora.current_organization_id());

  -- A aplicação LÊ o histórico; quem escreve é o gatilho.
  GRANT SELECT ON aurora.checklist_answer_revisions TO aurora_app;
  GRANT SELECT ON aurora.checklist_answer_revisions TO aurora_readonly;

  -- A resposta não se apaga por comando da aplicação.
  REVOKE DELETE ON aurora.checklist_answers FROM aurora_app;
END
$do$;
