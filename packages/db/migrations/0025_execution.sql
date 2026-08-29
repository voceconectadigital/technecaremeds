-- =============================================================================
-- Aurora — 0025 execução: horas, anexos e assinaturas (SPEC v0.2 §12, EPIC-011)
--
-- TRÊS DECISÕES
--
-- 1. CUSTO CONGELADO NO APONTAMENTO
--    A hora apontada guarda o valor/hora vigente naquele momento. Reajustar a
--    tabela de custo não pode reescrever o custo de uma OS fechada mês passado
--    — que é o que aconteceria se o cálculo fosse feito por junção na hora de
--    ler. Fechamento de mês que muda sozinho é fechamento que ninguém assina.
--
-- 2. APONTAMENTO NÃO SE SOBREPÕE PARA A MESMA PESSOA
--    Duas OS "em execução" pela mesma pessoa no mesmo minuto é impossível no
--    mundo físico e, se aceito, dobra a hora faturada. Restrição, não aviso.
--
-- 3. ASSINATURA GUARDA O HASH DO QUE FOI ASSINADO
--    Sem isso, "o cliente assinou" é uma afirmação sem objeto: a OS pode ter
--    mudado depois. Com o hash, dá para provar o que estava escrito no momento
--    da assinatura — e detectar se mudou.
-- =============================================================================

CREATE TYPE aurora.time_entry_source AS ENUM ('timer', 'manual', 'import');
CREATE TYPE aurora.attachment_purpose AS ENUM (
  'before', 'after', 'evidence', 'document', 'signature', 'other'
);
CREATE TYPE aurora.signature_method AS ENUM ('drawn', 'email_code');
CREATE TYPE aurora.signer_role AS ENUM ('technician', 'customer', 'supervisor');

-- -----------------------------------------------------------------------------
-- time_entries
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.time_entries (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  work_order_id     uuid NOT NULL,
  membership_id     uuid NOT NULL,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  source            aurora.time_entry_source NOT NULL DEFAULT 'manual',
  note              text,
  -- Custo congelado: o valor/hora vigente quando a hora foi apontada.
  hourly_cost       numeric(12, 2),
  currency          char(3) NOT NULL DEFAULT 'BRL',
  approved_at       timestamptz,
  approved_by       uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  CONSTRAINT te_order CHECK (ended_at IS NULL OR ended_at > started_at),
  CONSTRAINT te_cost_non_negative CHECK (hourly_cost IS NULL OR hourly_cost >= 0),
  -- Um apontamento aberto por pessoa; ver o índice parcial abaixo. Este CHECK
  -- garante que um apontamento fechado tenha duração positiva.
  CONSTRAINT te_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT te_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT te_membership_org_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX te_wo_idx  ON aurora.time_entries (work_order_id, started_at);
CREATE INDEX te_org_idx ON aurora.time_entries (organization_id, started_at);
CREATE INDEX te_membership_idx ON aurora.time_entries (membership_id, started_at DESC);

-- Um cronômetro aberto por pessoa. Dois abertos significam duas OS em execução
-- ao mesmo tempo pela mesma pessoa — impossível no mundo físico e, se aceito,
-- dobra a hora faturada.
CREATE UNIQUE INDEX te_one_open_per_person
  ON aurora.time_entries (membership_id) WHERE ended_at IS NULL;

-- -----------------------------------------------------------------------------
-- attachments — arquivo com FINALIDADE.
--
-- `purpose` existe porque "foto de antes" e "foto de depois" não são a mesma
-- coisa, e o bloco de conclusão precisa distinguir. Na referência, anexo era
-- anexo: verificar se havia foto de depois exigia abrir e olhar.
--
-- O binário não vive aqui. `storage_key` aponta para o objeto no armazenamento;
-- o banco guarda a identidade, a finalidade e o hash.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.attachments (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  work_order_id     uuid,
  checklist_answer_id uuid,
  purpose           aurora.attachment_purpose NOT NULL DEFAULT 'other',
  storage_key       text NOT NULL,
  file_name         text NOT NULL,
  content_type      text NOT NULL,
  byte_size         bigint NOT NULL,
  sha256            text,
  taken_at          timestamptz,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  uploaded_by       uuid,
  CONSTRAINT att_size_positive CHECK (byte_size > 0),
  CONSTRAINT att_sha_format CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  -- Anexo solto não existe: ou pertence a uma OS, ou a uma resposta de item.
  CONSTRAINT att_has_owner CHECK (work_order_id IS NOT NULL OR checklist_answer_id IS NOT NULL),
  CONSTRAINT att_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT att_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT att_answer_org_fk
    FOREIGN KEY (checklist_answer_id, organization_id)
    REFERENCES aurora.checklist_answers (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX att_storage_key_uq ON aurora.attachments (storage_key);
CREATE INDEX att_wo_purpose_idx ON aurora.attachments (work_order_id, purpose);
CREATE INDEX att_answer_idx     ON aurora.attachments (checklist_answer_id);
CREATE INDEX att_org_idx        ON aurora.attachments (organization_id);

-- -----------------------------------------------------------------------------
-- signatures
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.signatures (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  work_order_id     uuid NOT NULL,
  signer_role       aurora.signer_role NOT NULL,
  signer_name       text NOT NULL,
  signer_document   text,
  signer_email      text,
  method            aurora.signature_method NOT NULL,
  -- O que foi assinado, resumido. Sem isto, "o cliente assinou" é afirmação sem
  -- objeto: a OS pode ter mudado depois e não haveria como saber.
  signed_content_sha256 text NOT NULL,
  attachment_id     uuid,
  signed_at         timestamptz NOT NULL DEFAULT now(),
  client_ip         text,
  user_agent        text,
  CONSTRAINT sig_name_present CHECK (length(btrim(signer_name)) >= 2),
  CONSTRAINT sig_sha_format CHECK (signed_content_sha256 ~ '^[0-9a-f]{64}$'),
  -- Assinatura desenhada tem a imagem; assinatura por código tem o e-mail que a
  -- recebeu. Uma sem a outra é assinatura sem prova de origem.
  CONSTRAINT sig_evidence_present CHECK (
    (method = 'drawn' AND attachment_id IS NOT NULL)
    OR (method = 'email_code' AND signer_email IS NOT NULL)
  ),
  CONSTRAINT sig_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT sig_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT sig_attachment_org_fk
    FOREIGN KEY (attachment_id, organization_id)
    REFERENCES aurora.attachments (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX sig_wo_idx  ON aurora.signatures (work_order_id, signed_at);
CREATE INDEX sig_org_idx ON aurora.signatures (organization_id);

-- -----------------------------------------------------------------------------
-- Apontamento não se sobrepõe.
--
-- O índice parcial acima cobre o cronômetro aberto; este gatilho cobre o
-- lançamento manual com intervalo fechado, que o índice não alcança.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_time_entry_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_conflito record;
  v_categoria aurora.status_category;
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

  -- Apontar hora em OS fechada reescreveria um custo já consolidado.
  SELECT status_category INTO v_categoria FROM aurora.work_orders WHERE id = NEW.work_order_id;
  IF v_categoria IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'não se aponta hora em ordem de serviço % ', v_categoria
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER time_entries_guard BEFORE INSERT OR UPDATE ON aurora.time_entries
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_time_entry_guard();

CREATE TRIGGER time_entries_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.time_entries
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('note');
CREATE TRIGGER signatures_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.signatures
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('signer_name');

-- -----------------------------------------------------------------------------
-- Fatos de conclusão de uma OS.
--
-- Uma consulta só devolve tudo que o bloco de conclusão precisa verificar. A
-- alternativa — cinco consultas da aplicação — daria cinco oportunidades de
-- alguém esquecer uma e concluir uma OS incompleta.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.work_order_completion_facts(p_work_order_id uuid)
RETURNS TABLE (
  checklist_total            integer,
  checklist_answered         integer,
  failed_items_without_photo integer,
  logged_minutes             integer,
  photos_before              integer,
  photos_after               integer,
  has_customer_signature     boolean,
  blocking_failures          integer
)
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  SELECT
    (SELECT count(*)::int FROM aurora.checklist_responses r
       JOIN aurora.checklist_items i ON i.template_id = r.template_id AND i.required
      WHERE r.work_order_id = p_work_order_id),
    (SELECT count(*)::int FROM aurora.checklist_responses r
       JOIN aurora.checklist_answers a ON a.response_id = r.id
       JOIN aurora.checklist_items i ON i.id = a.item_id AND i.required
      WHERE r.work_order_id = p_work_order_id),
    (SELECT count(*)::int FROM aurora.checklist_responses r
       JOIN aurora.checklist_answers a ON a.response_id = r.id
       JOIN aurora.checklist_items i ON i.id = a.item_id
      WHERE r.work_order_id = p_work_order_id
        AND a.verdict = 'fail'
        AND i.requires_photo_when IN ('always', 'on_fail')
        AND a.photo_count = 0),
    (SELECT coalesce(sum(EXTRACT(EPOCH FROM (te.ended_at - te.started_at)) / 60), 0)::int
       FROM aurora.time_entries te
      WHERE te.work_order_id = p_work_order_id AND te.ended_at IS NOT NULL),
    (SELECT count(*)::int FROM aurora.attachments
      WHERE work_order_id = p_work_order_id AND purpose = 'before'),
    (SELECT count(*)::int FROM aurora.attachments
      WHERE work_order_id = p_work_order_id AND purpose = 'after'),
    (SELECT EXISTS (SELECT 1 FROM aurora.signatures
                     WHERE work_order_id = p_work_order_id AND signer_role = 'customer')),
    (SELECT count(*)::int FROM aurora.checklist_responses r
       JOIN aurora.checklist_answers a ON a.response_id = r.id
       JOIN aurora.checklist_items i ON i.id = a.item_id
      WHERE r.work_order_id = p_work_order_id
        AND a.verdict = 'fail'
        AND i.fail_action = 'block_completion')
$fn$;

GRANT EXECUTE ON FUNCTION aurora.work_order_completion_facts(uuid) TO aurora_app, aurora_readonly;

-- -----------------------------------------------------------------------------
-- RLS e permissões
-- -----------------------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['time_entries', 'attachments', 'signatures']
  LOOP
    EXECUTE format('ALTER TABLE aurora.%I OWNER TO aurora_owner', t);
    EXECUTE format('ALTER TABLE aurora.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE aurora.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON aurora.%I FOR ALL
         USING (organization_id = aurora.current_organization_id())
         WITH CHECK (organization_id = aurora.current_organization_id())',
      t || '_tenant_isolation', t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.%I TO aurora_app', t);
    EXECUTE format('GRANT SELECT ON aurora.%I TO aurora_readonly', t);
  END LOOP;
END
$do$;

-- Assinatura não se edita nem se apaga: é a prova, não um rascunho dela.
REVOKE UPDATE, DELETE ON aurora.signatures FROM aurora_app;
