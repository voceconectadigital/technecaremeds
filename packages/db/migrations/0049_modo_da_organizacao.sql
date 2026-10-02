-- =============================================================================
-- Aurora — 0049 modo de uso e recursos habilitados por organização
-- Auditoria de gap V2 P0.4 · PLAT §2 (cinco públicos) e §4 (recursos habilitados)
--
-- Uma plataforma, configuração diferente — e não cinco sistemas. O modo e a
-- lista de recursos são DADO da organização; o catálogo de recursos vive em
-- código (`packages/domain/src/organization-features.ts`), como as permissões.
--
-- `enabled_features` NULO quer dizer "nunca configurado = tudo habilitado".
-- Guardar a lista inteira desde o início faria todo módulo novo nascer
-- desligado para quem já existia. O CHECK do banco só garante a forma (sem
-- elemento nulo nem vazio); quem confere o vocabulário e a repetição é o
-- domínio (`normalizeFeatures`), porque o vocabulário cresce com o código e
-- não deve exigir migration a cada módulo.
--
-- O padrão de modo é `service_provider`: é o que todas as organizações que já
-- existem são hoje (a Be Care é a primeira prestadora). Quais recursos cada
-- modo usa por padrão é decisão do cliente que ainda não foi tomada — por isso
-- ninguém perde módulo por causa desta migration.
-- =============================================================================

CREATE TYPE aurora.organization_usage_mode AS ENUM (
  'service_provider', 'hospital', 'manufacturer', 'consultancy', 'laboratory'
);

ALTER TABLE aurora.organizations
  ADD COLUMN IF NOT EXISTS usage_mode aurora.organization_usage_mode NOT NULL DEFAULT 'service_provider',
  ADD COLUMN IF NOT EXISTS enabled_features text[];

ALTER TABLE aurora.organizations DROP CONSTRAINT IF EXISTS organizations_features_shape;
ALTER TABLE aurora.organizations
  ADD CONSTRAINT organizations_features_shape CHECK (
    enabled_features IS NULL
    OR (array_position(enabled_features, NULL) IS NULL AND array_position(enabled_features, '') IS NULL)
  );
