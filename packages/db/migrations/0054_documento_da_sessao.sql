-- =============================================================================
-- Aurora — 0054 o documento técnico nasce da sessão de medição
-- Auditoria de gap V2 §21 e P2.6 · PLAT §6.2 (ativo → OS → instrumento →
-- certificado → protocolo → medição → relatório → revisão → aprovação →
-- assinatura) · critério 6 do PLAT §14
--
-- O vínculo é a coluna; o conteúdo é CÓPIA.
--
-- `documents.measurement_session_id` diz de qual sessão o documento saiu. O
-- payload do rascunho recebe um INSTANTÂNEO da sessão (protocolo, instrumento,
-- certificado, pontos, leituras, dado bruto) montado por cópia, sem cálculo
-- nenhum — e a partir daí vale o motor de sempre: revisão congela o hash,
-- assinatura promete aquele hash, emissão queima o número, versão nova não
-- sobrescreve.
--
-- Ligar a sessão ao documento é também o que permite à EMISSÃO conferir a
-- regra de calendário já validada (US-DOC-002): o certificado do instrumento
-- cobria o dia da medição? A fronteira deixa de ser uma função isolada e passa
-- a impedir a emissão de verdade.
--
-- O vínculo é imutável depois de gravado: trocar a sessão de um documento é
-- trocar a evidência por trás de uma assinatura.
-- =============================================================================

ALTER TABLE aurora.documents
  ADD COLUMN IF NOT EXISTS measurement_session_id uuid;

ALTER TABLE aurora.documents DROP CONSTRAINT IF EXISTS documents_session_org_fk;
ALTER TABLE aurora.documents
  ADD CONSTRAINT documents_session_org_fk
    FOREIGN KEY (measurement_session_id, organization_id)
    REFERENCES aurora.measurement_sessions (id, organization_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS documents_session_idx ON aurora.documents (measurement_session_id)
  WHERE measurement_session_id IS NOT NULL;

CREATE FUNCTION aurora.fn_document_session_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.measurement_session_id IS DISTINCT FROM OLD.measurement_session_id THEN
    RAISE EXCEPTION 'a sessão de medição de um documento não muda; gere outro documento'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER documents_session_link_guard BEFORE UPDATE ON aurora.documents
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_document_session_link_guard();
