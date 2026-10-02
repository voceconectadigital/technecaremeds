-- =============================================================================
-- Aurora — 0051 instrumento (extensão de ativo) e certificado externo
-- Auditoria de gap V2 §16–§17, P2.1–P2.2 · PLAT §5 "Instrumento" e "Certificado",
-- §8 "catálogo de instrumentos" · CART §8
--
-- ─────────────────────────────────────────────────────────────────────────────
-- INSTRUMENTO É UM PAPEL DE ATIVO, NÃO UMA SEGUNDA HIERARQUIA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Um analisador de segurança elétrica TEM fabricante, modelo, número de série,
-- local, status e ciclo de vida — tudo o que `assets` já modela, com curadoria
-- de fabricante/modelo (`verified`, `merge`) que serve de "status do modelo"
-- do PLAT §8. Duplicar isso numa tabela `instruments` com as próprias colunas
-- de fabricante e série produziria duas verdades para o mesmo objeto físico.
--
-- Então `instruments` é extensão 1:1 de `assets` (a chave É o `asset_id`), e
-- guarda SÓ o que é específico de instrumento de medição: interface,
-- protocolo, firmware, adaptador, última validação, limitações conhecidas.
-- Nenhum driver, nenhuma comunicação física — só cadastro (PLAT §6.1, N0).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O CERTIFICADO EXTERNO NÃO É UM DOCUMENTO NOSSO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- O certificado que o LABORATÓRIO emite para o instrumento é registro de um
-- documento de terceiro. Ele não passa pelo grafo `draft → issued`, não queima
-- número da nossa série e não é assinado por nós. Tratá-lo como `documents`
-- seria afirmar que a Téchne Care o emitiu. Por isso tabela própria, leve:
-- número, laboratório, emissão, validade, escopo declarado, arquivo e a cadeia
-- de rastreabilidade.
--
-- O ESCOPO É TEXTO DECLARADO. Faixas, incerteza declarada e resolução que o
-- laboratório informa são decisão de especialista (VAL-E §36.2) — guardá-las
-- como colunas numéricas agora seria inventar a estrutura de um dado
-- metrológico que ninguém validou.
--
-- O certificado registrado é IMUTÁVEL: corrigir um erro de digitação é
-- REVOGAR (com motivo) e registrar de novo. Uma sessão de medição pode já
-- apontar para ele, e reescrevê-lo mudaria retroativamente a evidência.
-- =============================================================================

CREATE TABLE aurora.instruments (
  asset_id            uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  status              aurora.instrument_status NOT NULL DEFAULT 'active',
  ownership           aurora.instrument_ownership NOT NULL DEFAULT 'own',
  /** Como ele se conecta — USB, serial, Ethernet, BLE, nenhuma. Cadastro, não driver. */
  interface           text,
  /** Protocolo declarado pelo fabricante. */
  protocol            text,
  firmware_version    text,
  adapter             text,
  /** Última validação funcional interna (não é a calibração do laboratório). */
  last_validated_on   date,
  known_limitations   text NOT NULL DEFAULT '',
  notes               text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  CONSTRAINT instruments_id_org_uq UNIQUE (asset_id, organization_id),
  CONSTRAINT instruments_asset_org_fk
    FOREIGN KEY (asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX instruments_org_status_idx ON aurora.instruments (organization_id, status);

CREATE TABLE aurora.instrument_certificates (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  instrument_id           uuid NOT NULL,
  certificate_number      text NOT NULL,
  laboratory              text NOT NULL,
  /** Data civil: certificado vence num dia, não num instante (metrologia.ts). */
  issued_on               date NOT NULL,
  valid_until             date NOT NULL,
  /** O escopo como o laboratório declarou. Texto, de propósito — ver cabeçalho. */
  scope                   text NOT NULL DEFAULT '',
  /** A declaração de rastreabilidade (ex.: RBC/Inmetro). */
  traceability_statement  text NOT NULL DEFAULT '',
  /** O certificado do padrão que calibrou ESTE — o elo seguinte da cadeia. */
  traceable_to_id         uuid,
  revoked_at              timestamptz,
  revoked_reason          text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  CONSTRAINT icert_number_present CHECK (length(btrim(certificate_number)) > 0),
  CONSTRAINT icert_lab_present CHECK (length(btrim(laboratory)) > 0),
  CONSTRAINT icert_validity_order CHECK (valid_until >= issued_on),
  CONSTRAINT icert_revocation_has_reason CHECK (
    (revoked_at IS NULL AND revoked_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL AND length(btrim(revoked_reason)) >= 10)
  ),
  CONSTRAINT icert_not_self_traceable CHECK (traceable_to_id IS DISTINCT FROM id),
  CONSTRAINT icert_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT icert_instrument_org_fk
    FOREIGN KEY (instrument_id, organization_id)
    REFERENCES aurora.instruments (asset_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT icert_traceable_org_fk
    FOREIGN KEY (traceable_to_id, organization_id)
    REFERENCES aurora.instrument_certificates (id, organization_id) ON DELETE RESTRICT
);
-- O mesmo número de certificado não entra duas vezes para o mesmo instrumento.
CREATE UNIQUE INDEX icert_instrument_number_uq
  ON aurora.instrument_certificates (organization_id, instrument_id, certificate_number);
CREATE INDEX icert_instrument_validity_idx
  ON aurora.instrument_certificates (instrument_id, valid_until DESC) WHERE revoked_at IS NULL;
CREATE INDEX icert_org_idx ON aurora.instrument_certificates (organization_id);

-- -----------------------------------------------------------------------------
-- Certificado registrado é imutável; revogar é a única mudança, e só uma vez.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_instrument_certificate_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'certificado % já revogado: não muda mais', OLD.certificate_number
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.instrument_id      IS DISTINCT FROM OLD.instrument_id
     OR NEW.certificate_number IS DISTINCT FROM OLD.certificate_number
     OR NEW.laboratory         IS DISTINCT FROM OLD.laboratory
     OR NEW.issued_on          IS DISTINCT FROM OLD.issued_on
     OR NEW.valid_until        IS DISTINCT FROM OLD.valid_until
     OR NEW.scope              IS DISTINCT FROM OLD.scope
     OR NEW.traceability_statement IS DISTINCT FROM OLD.traceability_statement
     OR NEW.traceable_to_id    IS DISTINCT FROM OLD.traceable_to_id
     OR NEW.organization_id    IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'certificado registrado não se edita: revogue com motivo e registre de novo'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER instrument_certificates_guard BEFORE UPDATE ON aurora.instrument_certificates
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_instrument_certificate_guard();

CREATE TRIGGER instruments_touch BEFORE UPDATE ON aurora.instruments
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();

CREATE TRIGGER instruments_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.instruments
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('status', 'asset_id');
CREATE TRIGGER instrument_certificates_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.instrument_certificates
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('certificate_number');

-- -----------------------------------------------------------------------------
-- RLS e privilégios
-- -----------------------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['instruments', 'instrument_certificates']
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
    EXECUTE format('GRANT SELECT ON aurora.%I TO aurora_readonly', t);
  END LOOP;

  GRANT SELECT, INSERT, UPDATE ON aurora.instruments TO aurora_app;
  -- Certificado não se apaga: revoga-se. Sem DELETE para a aplicação.
  GRANT SELECT, INSERT, UPDATE ON aurora.instrument_certificates TO aurora_app;
END
$do$;
