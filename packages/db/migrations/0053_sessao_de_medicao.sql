-- =============================================================================
-- Aurora — 0053 sessão de medição e dado bruto
-- Auditoria de gap V2 §19–§20, P0.2 e P2.4 · PLAT §5 "Sessão de medição",
-- §6.2 passo 5 "preservar dado bruto" · CART §8 "Medição" · critérios 4 e 5
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A SESSÃO É EXTENSÃO 1:1 DA RESPOSTA DE CHECKLIST
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `checklist_responses` já é 60 % de uma sessão de medição: OS, protocolo com
-- versão congelada, início e fim. E já tem o que custou mais caro: anexar
-- offline com identificador vindo do aparelho, sob idempotência provada.
-- Criar `measurement_sessions` do zero, ao lado, jogaria isso fora.
--
-- A sessão acrescenta a PROVENIÊNCIA: instrumento, certificado vigente na data,
-- técnico, origem (manual hoje; arquivo, gateway, SDK amanhã — o mesmo modelo,
-- critério 4), condições ambientais declaradas e dado bruto.
--
-- `work_order_id` e `asset_id` são copiados da resposta/OS e conferidos pelo
-- gatilho: são redundantes de propósito, para a linha do tempo do ativo e o
-- relatório não dependerem de três junções para saber de quem é a medição.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A RESPOSTA GANHA O QUE A MEDIÇÃO PRECISA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `value_readings` (as leituras do ponto, na ordem), `unit` (copiada do item
-- no instante da resposta — a do item pode mudar na próxima versão), `source`,
-- `instrument_id` (quando o ponto usou outro instrumento que o da sessão) e
-- `device_measured_at` (o relógio do aparelho, guardado ao lado do do
-- servidor, nunca no lugar dele). O histórico da 0047 passa a arquivar esses
-- campos também.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DADO BRUTO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `attachments` aceita como dono a sessão (`raw_data`) e o certificado externo
-- (`certificate`). O envio retomável, a escrita posicional e a conferência de
-- SHA-256 são os mesmos — nenhuma linha do protocolo de envio muda. O anexo
-- passa a ter guarda de imutabilidade dos campos de identidade e auditoria.
-- =============================================================================

CREATE TABLE aurora.measurement_sessions (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  response_id               uuid NOT NULL,
  work_order_id             uuid NOT NULL,
  asset_id                  uuid,
  instrument_id             uuid,
  instrument_certificate_id uuid,
  technician_membership_id  uuid,
  source                    aurora.measurement_source NOT NULL DEFAULT 'manual',
  /** Data civil da medição: é nela que a validade do certificado é avaliada. */
  measured_on               date NOT NULL,
  started_at                timestamptz NOT NULL DEFAULT now(),
  finished_at               timestamptz,
  /** Condições ambientais COMO DECLARADAS (temperatura, umidade…). Sem cálculo. */
  ambient                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes                     text NOT NULL DEFAULT '',
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  CONSTRAINT ms_ambient_is_object CHECK (jsonb_typeof(ambient) = 'object'),
  CONSTRAINT ms_finish_after_start CHECK (finished_at IS NULL OR finished_at >= started_at),
  -- certificado sem instrumento não prova nada sobre a medição
  CONSTRAINT ms_certificate_needs_instrument CHECK (
    instrument_certificate_id IS NULL OR instrument_id IS NOT NULL
  ),
  CONSTRAINT ms_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT ms_response_uq UNIQUE (response_id),
  CONSTRAINT ms_response_org_fk
    FOREIGN KEY (response_id, organization_id)
    REFERENCES aurora.checklist_responses (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT ms_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT ms_asset_org_fk
    FOREIGN KEY (asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT ms_instrument_org_fk
    FOREIGN KEY (instrument_id, organization_id)
    REFERENCES aurora.instruments (asset_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT ms_certificate_org_fk
    FOREIGN KEY (instrument_certificate_id, organization_id)
    REFERENCES aurora.instrument_certificates (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT ms_technician_org_fk
    FOREIGN KEY (technician_membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX ms_wo_idx    ON aurora.measurement_sessions (work_order_id);
CREATE INDEX ms_asset_idx ON aurora.measurement_sessions (asset_id, measured_on DESC);
CREATE INDEX ms_instrument_idx ON aurora.measurement_sessions (instrument_id, measured_on DESC);
CREATE INDEX ms_org_idx   ON aurora.measurement_sessions (organization_id);

-- -----------------------------------------------------------------------------
-- Coerência da sessão — conferida pelo banco, para nenhum caminho futuro
-- escapar:
--   · a OS e o ativo são os da resposta (não os que o chamador disser);
--   · o certificado é DO instrumento da sessão;
--   · identidade, instrumento e certificado não mudam depois de gravados.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_measurement_session_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE
  v_wo    uuid;
  v_asset uuid;
  v_cert_instrument uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.response_id IS DISTINCT FROM OLD.response_id
       OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
       OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
       OR NEW.instrument_id IS DISTINCT FROM OLD.instrument_id
       OR NEW.instrument_certificate_id IS DISTINCT FROM OLD.instrument_certificate_id
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.measured_on IS DISTINCT FROM OLD.measured_on THEN
      RAISE EXCEPTION 'a proveniência de uma sessão de medição é imutável'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT r.work_order_id, w.asset_id INTO v_wo, v_asset
    FROM aurora.checklist_responses r
    JOIN aurora.work_orders w ON w.id = r.work_order_id
   WHERE r.id = NEW.response_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resposta de checklist inexistente ou fora do seu acesso'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.work_order_id := v_wo;
  NEW.asset_id := v_asset;

  IF NEW.instrument_certificate_id IS NOT NULL THEN
    SELECT instrument_id INTO v_cert_instrument
      FROM aurora.instrument_certificates WHERE id = NEW.instrument_certificate_id;
    IF v_cert_instrument IS DISTINCT FROM NEW.instrument_id THEN
      RAISE EXCEPTION 'o certificado informado não é do instrumento desta sessão'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER measurement_sessions_guard BEFORE INSERT OR UPDATE ON aurora.measurement_sessions
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_measurement_session_guard();

CREATE TRIGGER measurement_sessions_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.measurement_sessions
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('measured_on');

-- -----------------------------------------------------------------------------
-- Respostas: proveniência por ponto
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.checklist_answers
  ADD COLUMN IF NOT EXISTS value_readings     numeric[],
  ADD COLUMN IF NOT EXISTS unit               text,
  ADD COLUMN IF NOT EXISTS source             aurora.measurement_source,
  ADD COLUMN IF NOT EXISTS instrument_id      uuid,
  ADD COLUMN IF NOT EXISTS device_measured_at timestamptz;

ALTER TABLE aurora.checklist_answers DROP CONSTRAINT IF EXISTS ca_instrument_org_fk;
ALTER TABLE aurora.checklist_answers
  ADD CONSTRAINT ca_instrument_org_fk
    FOREIGN KEY (instrument_id, organization_id)
    REFERENCES aurora.instruments (asset_id, organization_id) ON DELETE RESTRICT;

ALTER TABLE aurora.checklist_answers DROP CONSTRAINT IF EXISTS ca_readings_present;
ALTER TABLE aurora.checklist_answers
  ADD CONSTRAINT ca_readings_present CHECK (
    value_readings IS NULL
    OR (cardinality(value_readings) BETWEEN 1 AND 50 AND array_position(value_readings, NULL) IS NULL)
  );

ALTER TABLE aurora.checklist_answer_revisions
  ADD COLUMN IF NOT EXISTS value_readings     numeric[],
  ADD COLUMN IF NOT EXISTS unit               text,
  ADD COLUMN IF NOT EXISTS source             aurora.measurement_source,
  ADD COLUMN IF NOT EXISTS instrument_id      uuid,
  ADD COLUMN IF NOT EXISTS device_measured_at timestamptz;

/** O gatilho da 0047, agora arquivando também a proveniência da medição. */
CREATE OR REPLACE FUNCTION aurora.fn_checklist_answer_revision() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.response_id IS DISTINCT FROM OLD.response_id
     OR NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    RAISE EXCEPTION 'a identidade de uma resposta de checklist é imutável'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.value_text    IS NOT DISTINCT FROM OLD.value_text
     AND NEW.value_number  IS NOT DISTINCT FROM OLD.value_number
     AND NEW.value_boolean IS NOT DISTINCT FROM OLD.value_boolean
     AND NEW.value_options IS NOT DISTINCT FROM OLD.value_options
     AND NEW.value_date    IS NOT DISTINCT FROM OLD.value_date
     AND NEW.value_readings IS NOT DISTINCT FROM OLD.value_readings
     AND NEW.unit          IS NOT DISTINCT FROM OLD.unit
     AND NEW.source        IS NOT DISTINCT FROM OLD.source
     AND NEW.instrument_id IS NOT DISTINCT FROM OLD.instrument_id
     AND NEW.verdict       IS NOT DISTINCT FROM OLD.verdict
     AND NEW.photo_count   IS NOT DISTINCT FROM OLD.photo_count
     AND NEW.note          IS NOT DISTINCT FROM OLD.note THEN
    RETURN OLD;
  END IF;

  INSERT INTO aurora.checklist_answer_revisions
    (id, organization_id, answer_id, response_id, item_id, revision,
     value_text, value_number, value_boolean, value_options, value_date,
     value_readings, unit, source, instrument_id, device_measured_at,
     verdict, photo_count, note, correction_reason, measured_by, measured_at,
     superseded_at, superseded_by)
  VALUES
    (gen_random_uuid(), OLD.organization_id, OLD.id, OLD.response_id, OLD.item_id, OLD.revision,
     OLD.value_text, OLD.value_number, OLD.value_boolean, OLD.value_options, OLD.value_date,
     OLD.value_readings, OLD.unit, OLD.source, OLD.instrument_id, OLD.device_measured_at,
     OLD.verdict, OLD.photo_count, OLD.note, OLD.correction_reason, OLD.measured_by, OLD.measured_at,
     now(), aurora.current_actor_id());

  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END
$fn$;
ALTER FUNCTION aurora.fn_checklist_answer_revision() OWNER TO aurora_owner;

-- -----------------------------------------------------------------------------
-- Anexos: dono sessão e certificado; identidade imutável; auditoria
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.attachments
  ADD COLUMN IF NOT EXISTS measurement_session_id    uuid,
  ADD COLUMN IF NOT EXISTS instrument_certificate_id uuid;

ALTER TABLE aurora.attachments DROP CONSTRAINT IF EXISTS att_session_org_fk;
ALTER TABLE aurora.attachments
  ADD CONSTRAINT att_session_org_fk
    FOREIGN KEY (measurement_session_id, organization_id)
    REFERENCES aurora.measurement_sessions (id, organization_id) ON DELETE RESTRICT;
ALTER TABLE aurora.attachments DROP CONSTRAINT IF EXISTS att_certificate_org_fk;
ALTER TABLE aurora.attachments
  ADD CONSTRAINT att_certificate_org_fk
    FOREIGN KEY (instrument_certificate_id, organization_id)
    REFERENCES aurora.instrument_certificates (id, organization_id) ON DELETE RESTRICT;

-- Anexo solto continua não existindo; o dono agora pode ser um de quatro.
ALTER TABLE aurora.attachments DROP CONSTRAINT IF EXISTS att_has_owner;
ALTER TABLE aurora.attachments
  ADD CONSTRAINT att_has_owner CHECK (
    num_nonnulls(work_order_id, checklist_answer_id, measurement_session_id, instrument_certificate_id) >= 1
  );

-- A finalidade combina com o dono: dado bruto é da sessão, certificado é do
-- certificado. Um "dado bruto" pendurado na OS perderia a ligação com o ponto
-- medido — que é a razão de ele ser guardado.
ALTER TABLE aurora.attachments DROP CONSTRAINT IF EXISTS att_purpose_matches_owner;
ALTER TABLE aurora.attachments
  ADD CONSTRAINT att_purpose_matches_owner CHECK (
    (purpose <> 'raw_data' OR measurement_session_id IS NOT NULL)
    AND (purpose <> 'certificate' OR instrument_certificate_id IS NOT NULL)
    AND (measurement_session_id IS NULL OR purpose = 'raw_data')
    AND (instrument_certificate_id IS NULL OR purpose = 'certificate')
  );

-- Dado bruto e certificado sem resumo não provam integridade nenhuma.
ALTER TABLE aurora.attachments DROP CONSTRAINT IF EXISTS att_evidence_has_sha;
ALTER TABLE aurora.attachments
  ADD CONSTRAINT att_evidence_has_sha CHECK (
    purpose NOT IN ('raw_data', 'certificate') OR sha256 IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS att_session_idx     ON aurora.attachments (measurement_session_id);
CREATE INDEX IF NOT EXISTS att_certificate_idx ON aurora.attachments (instrument_certificate_id);

/**
 * O que identifica um anexo não muda depois de registrado.
 *
 * A contagem de bytes recebidos e o carimbo de conclusão mudam — é o envio
 * retomável (0044). Dono, finalidade, chave, tipo, tamanho e resumo, não: um
 * anexo cujo resumo pode ser trocado depois do envio não prova nada.
 */
CREATE FUNCTION aurora.fn_attachment_identity_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
     OR NEW.checklist_answer_id IS DISTINCT FROM OLD.checklist_answer_id
     OR NEW.measurement_session_id IS DISTINCT FROM OLD.measurement_session_id
     OR NEW.instrument_certificate_id IS DISTINCT FROM OLD.instrument_certificate_id
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

CREATE TRIGGER attachments_identity_guard BEFORE UPDATE ON aurora.attachments
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_attachment_identity_guard();

-- Criação e remoção entram na trilha. A atualização NÃO: cada fatia do envio
-- retomável é um UPDATE de `received_bytes`, e auditar fatia por fatia
-- encheria a trilha de ruído sem dizer nada que o estado final não diga.
CREATE TRIGGER attachments_audit AFTER INSERT OR DELETE ON aurora.attachments
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('file_name');

-- -----------------------------------------------------------------------------
-- RLS e privilégios
-- -----------------------------------------------------------------------------
DO $do$
BEGIN
  ALTER TABLE aurora.measurement_sessions OWNER TO aurora_owner;
  ALTER TABLE aurora.measurement_sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE aurora.measurement_sessions FORCE  ROW LEVEL SECURITY;
  CREATE POLICY measurement_sessions_tenant_isolation ON aurora.measurement_sessions FOR ALL
    USING (organization_id = aurora.current_organization_id())
    WITH CHECK (organization_id = aurora.current_organization_id());
  -- Sessão não se apaga: é evidência. Encerrar é `finished_at`.
  GRANT SELECT, INSERT, UPDATE ON aurora.measurement_sessions TO aurora_app;
  GRANT SELECT ON aurora.measurement_sessions TO aurora_readonly;
END
$do$;
