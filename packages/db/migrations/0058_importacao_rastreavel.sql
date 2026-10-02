-- =============================================================================
-- Aurora — 0058 importação rastreável: lote, linha, arquivo original, relatório
-- Auditoria de gap V2 §28 e P1.8 · PLAT §12 (migração em seis passos) ·
-- critério 8 do PLAT §14 ("migração com validação, rastreabilidade e arquivo
-- histórico")
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O QUE MUDA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `importAssets` já importava linha a linha com erro por linha — e o resultado
-- voltava na resposta HTTP e SUMIA. Não havia como responder, uma semana
-- depois, "de qual arquivo veio este ativo?", "quais linhas falharam no lote
-- oficial?" ou "a amostra passou antes da carga?".
--
-- Agora:
--   · `import_batches` — o lote: origem (`external_source`), amostra ou
--     oficial, quem, quando, o ARQUIVO ORIGINAL (anexo `import_source`, com
--     SHA-256) e o relatório persistido;
--   · `import_rows` — cada linha CRUA como chegou, o identificador externo, o
--     desfecho (validada, importada, falhou), o erro com campo, e o registro
--     criado.
--
-- AMOSTRA não grava nada no destino: a linha é processada dentro de um
-- savepoint que volta atrás, e só o desfecho fica. OFICIAL grava.
--
-- O QUE NÃO ESTÁ AQUI: o leitor do formato do Arkmeds. Sem o arquivo real de
-- exportação, qualquer parser seria adivinhação (BLOQUEADO — CLIENTE). As
-- linhas entram já convertidas no formato de importação de ativos que existe.
-- =============================================================================

CREATE TYPE aurora.import_kind AS ENUM ('assets');
CREATE TYPE aurora.import_mode AS ENUM ('sample', 'official');
CREATE TYPE aurora.import_status AS ENUM ('draft', 'completed');
CREATE TYPE aurora.import_row_status AS ENUM ('pending', 'validated', 'imported', 'failed');

CREATE TABLE aurora.import_batches (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  kind               aurora.import_kind NOT NULL,
  mode               aurora.import_mode NOT NULL,
  /** Sistema de origem (ex.: arkmeds) — a mesma regra de forma da 0048. */
  external_source    text NOT NULL,
  /** Cliente de destino dos ativos importados. */
  customer_id        uuid NOT NULL,
  description        text NOT NULL DEFAULT '',
  status             aurora.import_status NOT NULL DEFAULT 'draft',
  row_count          integer NOT NULL DEFAULT 0,
  succeeded_count    integer NOT NULL DEFAULT 0,
  failed_count       integer NOT NULL DEFAULT 0,
  /** O relatório, persistido: contagens, fabricantes/modelos criados, duração. */
  report             jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  CONSTRAINT ib_source_format CHECK (external_source ~ '^[a-z][a-z0-9_.-]{1,40}$'),
  CONSTRAINT ib_report_is_object CHECK (jsonb_typeof(report) = 'object'),
  CONSTRAINT ib_counts_coherent CHECK (
    row_count >= 0 AND succeeded_count >= 0 AND failed_count >= 0
    AND succeeded_count + failed_count <= row_count
  ),
  CONSTRAINT ib_completed_stamped CHECK (status <> 'completed' OR finished_at IS NOT NULL),
  CONSTRAINT ib_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT ib_customer_org_fk FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX ib_org_created_idx ON aurora.import_batches (organization_id, created_at DESC);

CREATE TABLE aurora.import_rows (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  batch_id           uuid NOT NULL,
  line               integer NOT NULL,
  /** A linha como chegou — nunca reescrita. */
  raw                jsonb NOT NULL,
  external_id        text,
  status             aurora.import_row_status NOT NULL DEFAULT 'pending',
  target_entity      text NOT NULL,
  created_entity_id  uuid,
  error_field        text,
  error_message      text,
  processed_at       timestamptz,
  CONSTRAINT ir_line_positive CHECK (line >= 1),
  CONSTRAINT ir_raw_is_object CHECK (jsonb_typeof(raw) = 'object'),
  CONSTRAINT ir_failed_has_error CHECK (status <> 'failed' OR error_message IS NOT NULL),
  CONSTRAINT ir_imported_has_entity CHECK (status <> 'imported' OR created_entity_id IS NOT NULL),
  CONSTRAINT ir_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT ir_batch_org_fk FOREIGN KEY (batch_id, organization_id)
    REFERENCES aurora.import_batches (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ir_batch_line_uq ON aurora.import_rows (batch_id, line);
CREATE INDEX ir_batch_status_idx ON aurora.import_rows (batch_id, status);
CREATE INDEX ir_created_entity_idx ON aurora.import_rows (created_entity_id) WHERE created_entity_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- A linha crua não se reescreve, e lote concluído não muda.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_import_row_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.raw IS DISTINCT FROM OLD.raw OR NEW.line IS DISTINCT FROM OLD.line
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
    RAISE EXCEPTION 'a linha original de uma importação não se reescreve' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'linha já processada não muda' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER import_rows_guard BEFORE UPDATE ON aurora.import_rows
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_import_row_guard();

CREATE FUNCTION aurora.fn_import_batch_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'lote concluído não muda; abra outro lote' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.external_source IS DISTINCT FROM OLD.external_source
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'tipo, modo, origem e cliente de um lote não mudam' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER import_batches_guard BEFORE UPDATE ON aurora.import_batches
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_import_batch_guard();

CREATE TRIGGER import_batches_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.import_batches
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('external_source');

-- -----------------------------------------------------------------------------
-- O arquivo original é anexo do lote.
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.attachments
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

ALTER TABLE aurora.attachments DROP CONSTRAINT IF EXISTS att_import_batch_org_fk;
ALTER TABLE aurora.attachments
  ADD CONSTRAINT att_import_batch_org_fk
    FOREIGN KEY (import_batch_id, organization_id)
    REFERENCES aurora.import_batches (id, organization_id) ON DELETE RESTRICT;

ALTER TABLE aurora.attachments DROP CONSTRAINT IF EXISTS att_has_owner;
ALTER TABLE aurora.attachments
  ADD CONSTRAINT att_has_owner CHECK (
    num_nonnulls(work_order_id, checklist_answer_id, measurement_session_id,
                 instrument_certificate_id, import_batch_id) >= 1
  );

ALTER TABLE aurora.attachments DROP CONSTRAINT IF EXISTS att_purpose_matches_owner;
ALTER TABLE aurora.attachments
  ADD CONSTRAINT att_purpose_matches_owner CHECK (
    (purpose <> 'raw_data' OR measurement_session_id IS NOT NULL)
    AND (purpose <> 'certificate' OR instrument_certificate_id IS NOT NULL)
    AND (purpose <> 'import_source' OR import_batch_id IS NOT NULL)
    AND (measurement_session_id IS NULL OR purpose = 'raw_data')
    AND (instrument_certificate_id IS NULL OR purpose = 'certificate')
    AND (import_batch_id IS NULL OR purpose = 'import_source')
  );

ALTER TABLE aurora.attachments DROP CONSTRAINT IF EXISTS att_evidence_has_sha;
ALTER TABLE aurora.attachments
  ADD CONSTRAINT att_evidence_has_sha CHECK (
    purpose NOT IN ('raw_data', 'certificate', 'import_source') OR sha256 IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS att_import_batch_idx ON aurora.attachments (import_batch_id);

/** A guarda de identidade do anexo (0053) passa a cobrir o dono novo. */
CREATE OR REPLACE FUNCTION aurora.fn_attachment_identity_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
     OR NEW.checklist_answer_id IS DISTINCT FROM OLD.checklist_answer_id
     OR NEW.measurement_session_id IS DISTINCT FROM OLD.measurement_session_id
     OR NEW.instrument_certificate_id IS DISTINCT FROM OLD.instrument_certificate_id
     OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.content_type IS DISTINCT FROM OLD.content_type
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
    RAISE EXCEPTION 'a identidade de um anexo registrado não muda'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

-- -----------------------------------------------------------------------------
-- RLS e privilégios
-- -----------------------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_batches', 'import_rows']
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
    -- Lote e linha não se apagam: são o arquivo histórico da migração.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON aurora.%I TO aurora_app', t);
    EXECUTE format('GRANT SELECT ON aurora.%I TO aurora_readonly', t);
  END LOOP;
END
$do$;
