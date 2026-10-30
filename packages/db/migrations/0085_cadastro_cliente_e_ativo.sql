-- =============================================================================
-- Aurora — 0085 cadastro do cliente e do equipamento (pedidos do cliente, WhatsApp 19/10/2026)
--
--   ATV-07 "foto obrigatória do ativo no cadastro"
--   ATV-15 "SLA de cada equipamento com opção habilitar ou desabilitar"
--   CLI-05 "no cadastro do cliente o tipo de relatório incluso no contrato: basic, advanced, expert"
--   CLI-06 "informar a duração do contrato"
--
-- FOTO DO EQUIPAMENTO. Uma foto por equipamento, e os BYTES fora do banco (armazenamento de
-- objetos, como os certificados da 0082 e a NF da 0083). Aqui ficam só a chave — gerada pelo
-- servidor, nunca recebida —, o tipo, o tamanho e o SHA-256 conferidos na subida. As colunas andam
-- juntas: ou a foto existe inteira, ou não existe. A obrigatoriedade é da CRIAÇÃO pela API
-- (`POST /assets` recusa sem foto); o banco não a exige, porque o parque já cadastrado, a
-- importação em massa e a semeadura continuam válidos sem foto.
--
-- SLA POR EQUIPAMENTO. `sla_policy_id` já existe desde a 0027 (e vence contrato, cliente e
-- organização na cascata). Faltava o DESLIGAR: `sla_enabled = false` faz a cascata devolver nula,
-- e sem política nenhuma OS nem chamado desse equipamento abre relógio. Padrão `true`: nada muda
-- para quem já estava cadastrado.
--
-- CLIENTE. O modelo de relatório incluso no contrato (`report_tier`, nulo = não informado) e a
-- vigência do contrato (início e fim, juntos ou nenhum; fim DEPOIS do início). É dado de cadastro:
-- não é o módulo de contratos (0031) nem trava relatório — a trava vem depois, em outra rodada.
-- A situação (vigente, vence em 30 dias, vencido) é DERIVADA na leitura, nunca gravada: gravada,
-- envelheceria sozinha.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Equipamento: foto e SLA
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.assets
  ADD COLUMN IF NOT EXISTS photo_key          text,
  ADD COLUMN IF NOT EXISTS photo_content_type text,
  ADD COLUMN IF NOT EXISTS photo_size         integer,
  ADD COLUMN IF NOT EXISTS photo_sha256       text,
  ADD COLUMN IF NOT EXISTS photo_uploaded_at  timestamptz,
  ADD COLUMN IF NOT EXISTS sla_enabled        boolean NOT NULL DEFAULT true;

ALTER TABLE aurora.assets
  ADD CONSTRAINT assets_photo_all_or_none CHECK (
    (photo_key IS NULL) = (photo_content_type IS NULL)
    AND (photo_key IS NULL) = (photo_size IS NULL)
    AND (photo_key IS NULL) = (photo_sha256 IS NULL)
    AND (photo_key IS NULL) = (photo_uploaded_at IS NULL)
  );
-- Imagem que o navegador mostra e a impressão leva: PNG, JPEG ou WebP. HEIC fica de fora.
ALTER TABLE aurora.assets
  ADD CONSTRAINT assets_photo_content_type_valid
  CHECK (photo_content_type IS NULL OR photo_content_type IN ('image/png', 'image/jpeg', 'image/webp'));
-- O mesmo teto da API (8 MB): a foto viaja dentro do JSON do cadastro.
ALTER TABLE aurora.assets
  ADD CONSTRAINT assets_photo_size_valid
  CHECK (photo_size IS NULL OR (photo_size > 0 AND photo_size <= 8388608));
ALTER TABLE aurora.assets
  ADD CONSTRAINT assets_photo_sha256_valid
  CHECK (photo_sha256 IS NULL OR photo_sha256 ~ '^[0-9a-f]{64}$');

-- -----------------------------------------------------------------------------
-- Cascata de SLA (0027 → 0031) com o desligamento por equipamento.
--
-- Equipamento com SLA desabilitado: nula, e `startSlaClock` não abre relógio — nem de OS nem de
-- chamado. Habilitado: a mesma cascata de antes (ativo → contrato → cliente → organização).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aurora.resolve_sla_policy(p_asset_id uuid, p_customer_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  WITH contrato AS (
    SELECT aurora.contract_for_asset(p_asset_id, CURRENT_DATE) AS id
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM aurora.assets a WHERE a.id = p_asset_id AND NOT a.sla_enabled) THEN NULL
    ELSE COALESCE(
      (SELECT a.sla_policy_id FROM aurora.assets a WHERE a.id = p_asset_id),
      (SELECT o.sla_policy_id
         FROM aurora.contract_sla_overrides o, contrato, aurora.assets a
        WHERE o.contract_id = contrato.id
          AND a.id = p_asset_id
          AND o.criticality_level_id = a.criticality_id),
      (SELECT ct.sla_policy_id FROM aurora.contracts ct, contrato WHERE ct.id = contrato.id),
      (SELECT c.default_sla_policy_id FROM aurora.customers c WHERE c.id = p_customer_id),
      (SELECT o.default_sla_policy_id FROM aurora.organizations o
        WHERE o.id = aurora.current_organization_id())
    )
  END
$fn$;

GRANT EXECUTE ON FUNCTION aurora.resolve_sla_policy(uuid, uuid) TO aurora_app, aurora_readonly;

-- -----------------------------------------------------------------------------
-- Cliente: relatório incluso e vigência do contrato
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.customers
  ADD COLUMN IF NOT EXISTS report_tier        text,
  ADD COLUMN IF NOT EXISTS contract_starts_on date,
  ADD COLUMN IF NOT EXISTS contract_ends_on   date;

ALTER TABLE aurora.customers
  ADD CONSTRAINT customers_report_tier_valid
  CHECK (report_tier IS NULL OR report_tier IN ('basic', 'advanced', 'expert'));
ALTER TABLE aurora.customers
  ADD CONSTRAINT customers_contract_term_pair
  CHECK ((contract_starts_on IS NULL) = (contract_ends_on IS NULL));
ALTER TABLE aurora.customers
  ADD CONSTRAINT customers_contract_term_order
  CHECK (contract_ends_on IS NULL OR contract_ends_on > contract_starts_on);
