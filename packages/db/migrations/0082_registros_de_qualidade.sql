-- =============================================================================
-- Aurora — 0082 registros de qualidade (certificados)
-- Conversa com o cliente, 21/10/2026: "já deixa o tópico de Qualidade, com o lugar para os
-- certificados de calibração, teste de segurança elétrica, qualificação e treinamento".
--
-- UM REGISTRO, UM CERTIFICADO. Cada linha é um certificado (ou comprovante) de um dos quatro
-- tipos, com quem emitiu, quando, até quando vale e — opcionalmente — o arquivo. O arquivo mora
-- fora do banco (armazenamento de objetos, como os anexos); aqui ficam só a chave e os metadados.
--
-- A VIGÊNCIA É CALCULADA NA CONSULTA, e não gravada: um certificado "vigente" gravado ontem
-- venceu hoje, e uma coluna que ninguém atualiza passaria a mentir em silêncio.
-- =============================================================================

CREATE TABLE aurora.quality_records (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  kind               text NOT NULL,
  title              text NOT NULL,
  customer_id        uuid,
  asset_id           uuid,
  /** Treinamento: quem foi treinado (texto livre — nem todo treinado tem acesso ao sistema). */
  person_name        text,
  certificate_number text,
  issuer             text,
  issued_at          date NOT NULL,
  valid_until        date,
  note               text,
  -- O arquivo (opcional): chave no armazenamento de objetos + metadados.
  file_key           text,
  file_name          text,
  file_content_type  text,
  file_size          integer,
  file_sha256        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid,
  deleted_at         timestamptz,

  CONSTRAINT quality_records_kind_valid CHECK (kind IN ('calibration', 'electrical_safety', 'qualification', 'training')),
  CONSTRAINT quality_records_title_present CHECK (length(btrim(title)) >= 2),
  CONSTRAINT quality_records_note_len CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT quality_records_valid_range CHECK (valid_until IS NULL OR valid_until >= issued_at),
  CONSTRAINT quality_records_file_together CHECK (
    (file_key IS NULL) = (file_name IS NULL)
    AND (file_key IS NULL) = (file_size IS NULL)
    AND (file_key IS NULL) = (file_sha256 IS NULL)
  ),
  CONSTRAINT quality_records_file_sha_format CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quality_records_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT quality_records_customer_org_fk
    FOREIGN KEY (customer_id, organization_id) REFERENCES aurora.customers (id, organization_id),
  CONSTRAINT quality_records_asset_org_fk
    FOREIGN KEY (asset_id, organization_id) REFERENCES aurora.assets (id, organization_id)
);
CREATE INDEX quality_records_org_kind_idx  ON aurora.quality_records (organization_id, kind, valid_until)
  WHERE deleted_at IS NULL;
CREATE INDEX quality_records_asset_idx     ON aurora.quality_records (asset_id) WHERE deleted_at IS NULL;
CREATE INDEX quality_records_customer_idx  ON aurora.quality_records (customer_id) WHERE deleted_at IS NULL;

CREATE TRIGGER quality_records_touch BEFORE UPDATE ON aurora.quality_records
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER quality_records_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.quality_records
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('title');

ALTER TABLE aurora.quality_records OWNER TO aurora_owner;
ALTER TABLE aurora.quality_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.quality_records FORCE  ROW LEVEL SECURITY;
CREATE POLICY quality_records_tenant_isolation ON aurora.quality_records FOR ALL
  USING (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());
-- Sem DELETE: o registro sai de cena por `deleted_at`, e a trilha de auditoria guarda o resto.
GRANT SELECT, INSERT, UPDATE ON aurora.quality_records TO aurora_app;
GRANT SELECT ON aurora.quality_records TO aurora_readonly;
