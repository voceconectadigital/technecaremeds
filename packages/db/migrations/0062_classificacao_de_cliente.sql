-- =============================================================================
-- Aurora — 0062 classificação do cliente: EAS × empresa corporativa
-- (reunião 16/10/2026, Fase 2)
--
-- `kind`    — 'eas' (Estabelecimento Assistencial de Saúde) ou 'corporate'
--             (engenharia clínica, assistência técnica, prestadora…).
-- `subtype` — chave curta da lista de `packages/domain/src/customer-kinds.ts`
--             (hospital, clínica, consultório…). A coerência subtipo × tipo é
--             conferida pela aplicação; o banco só garante o formato, para que
--             um subtipo novo não exija migration.
--
-- `segment` (texto livre, 0008) continua: é o que importação e cadastro antigo
-- preencheram. O que já era um segmento conhecido vira subtipo aqui.
-- =============================================================================

ALTER TABLE aurora.customers
  ADD COLUMN IF NOT EXISTS kind    text NOT NULL DEFAULT 'eas',
  ADD COLUMN IF NOT EXISTS subtype text;

ALTER TABLE aurora.customers
  ADD CONSTRAINT customers_kind_valid CHECK (kind IN ('eas', 'corporate')),
  ADD CONSTRAINT customers_subtype_fmt CHECK (subtype IS NULL OR subtype ~ '^[a-z][a-z_]{1,39}$');

UPDATE aurora.customers
   SET subtype = CASE lower(segment)
                   WHEN 'hospital'           THEN 'hospital'
                   WHEN 'clinica'            THEN 'clinica'
                   WHEN 'clínica'            THEN 'clinica'
                   WHEN 'laboratorio'        THEN 'laboratorio'
                   WHEN 'laboratório'        THEN 'laboratorio'
                   WHEN 'diagnostico_imagem' THEN 'clinica_imagem'
                   WHEN 'home_care'          THEN 'home_care'
                 END
 WHERE subtype IS NULL AND segment IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_kind_idx ON aurora.customers (organization_id, kind) WHERE deleted_at IS NULL;
