-- =============================================================================
-- Aurora — 0048 identificador externo nas entidades migráveis
-- Auditoria de gap V2 P0.3 · PLAT §12 (migração Arkmeds) · SPEC OQ-09
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE AGORA, E NÃO "QUANDO A INTEGRAÇÃO CHEGAR"
-- ─────────────────────────────────────────────────────────────────────────────
--
-- O PLAT §12 manda operar em paralelo durante o piloto, com o sistema antigo
-- como consulta. "Operar em paralelo" só funciona se der para dizer, de cada
-- registro daqui, QUAL registro de lá ele é. Sem a coluna, a resposta seria
-- "procure pelo nome" — e nome muda, repete e vem com erro de digitação.
--
-- Barato agora, caro depois: acrescentar a coluna com o banco vazio custa uma
-- migration; acrescentar depois de importar 27 mil ativos custa uma
-- reconciliação manual.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A UNICIDADE É POR ORGANIZAÇÃO E POR ORIGEM — NUNCA GLOBAL
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `(organization_id, external_source, external_id)`. Dois tenants que migram
-- do mesmo sistema legado têm, com toda probabilidade, um ativo "1042" cada
-- um — e uma unicidade global faria o segundo tenant receber um erro que
-- revela a existência do registro do primeiro. A origem entra na chave porque
-- o "1042" do Arkmeds e o "1042" do Omie são coisas diferentes.
--
-- As duas colunas andam juntas: identificador sem origem não se reconcilia
-- com nada, e origem sem identificador não identifica nada.
-- =============================================================================

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers', 'locations', 'assets', 'work_orders', 'inventory_items', 'memberships'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE aurora.%I
         ADD COLUMN IF NOT EXISTS external_source text,
         ADD COLUMN IF NOT EXISTS external_id     text', t);

    EXECUTE format('ALTER TABLE aurora.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_external_pair');
    -- Os `IS NOT NULL` explícitos NÃO são redundantes: sem eles, origem nula
    -- faria `NULL ~ padrão` dar NULL, e CHECK que avalia NULL PASSA — o par
    -- incompleto entraria em silêncio. Foi o teste que mostrou.
    EXECUTE format(
      'ALTER TABLE aurora.%I ADD CONSTRAINT %I CHECK (
         (external_source IS NULL AND external_id IS NULL)
         OR (external_source IS NOT NULL AND external_id IS NOT NULL
             AND external_source ~ ''^[a-z][a-z0-9_.-]{1,40}$''
             AND length(btrim(external_id)) BETWEEN 1 AND 200)
       )', t, t || '_external_pair');

    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON aurora.%I (organization_id, external_source, external_id)
         WHERE external_id IS NOT NULL', t || '_external_uq', t);
  END LOOP;
END
$do$;

COMMENT ON COLUMN aurora.assets.external_source IS
  'Sistema de origem (ex.: arkmeds). Par com external_id; único por organização e origem.';
COMMENT ON COLUMN aurora.assets.external_id IS
  'Identificador do registro no sistema de origem. Nunca usado como chave interna.';
