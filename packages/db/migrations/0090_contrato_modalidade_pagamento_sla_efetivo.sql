-- =============================================================================
-- Aurora — 0090 contrato no cadastro do cliente: modalidade, pagamento e SLA efetivo
-- (áudios do Anderson, 10/11/2026 — CTR-02, CTR-03, CTR-04..08)
--
-- TRÊS CONCEITOS INDEPENDENTES no contrato, e não um:
--   · MODALIDADE DE ATENDIMENTO (`service_frequency`): anual, semestral, trimestral, mensal,
--     quinzenal ou semanal — a periodicidade das visitas;
--   · EQUIPE FIXA (`fixed_team_packages`): os identificadores 1…10, combináveis (ex.: {1,10}).
--     A composição de cada pacote NÃO está definida; o número não diz quantas pessoas há;
--   · BASE DE PRECIFICAÇÃO (`billing_model`, que já existia): ganha `per_hour` (hora técnica);
--   · CONDIÇÃO DE PAGAMENTO (`payment_terms`): mensal ou à vista.
-- Todas NULAS por padrão: contrato antigo fica exatamente como estava ("não informado").
-- Nenhum cálculo financeiro lê estes campos — são cadastro.
--
-- SLA EFETIVO COM ORIGEM. A regra já existia em `resolve_sla_policy` (0085): equipamento
-- desabilitado → nada; política do próprio equipamento (a EXCEÇÃO) → criticidade no contrato →
-- SLA GERAL do contrato → padrão do cliente → padrão da organização. Faltava dizer DE ONDE veio.
-- `resolve_sla_policy_source` repete a mesma cascata devolvendo também a origem; os testes provam
-- que as duas devolvem a mesma política em todos os degraus. A cascata usada pelos relógios de SLA
-- NÃO muda nesta migration.
-- =============================================================================

-- O PostgreSQL aceita ADD VALUE dentro da transação desde que o valor novo não seja usado nela.
ALTER TYPE aurora.billing_model ADD VALUE IF NOT EXISTS 'per_hour';

ALTER TABLE aurora.contracts
  ADD COLUMN IF NOT EXISTS service_frequency   text,
  ADD COLUMN IF NOT EXISTS fixed_team_packages smallint[],
  ADD COLUMN IF NOT EXISTS payment_terms       text,
  -- `billing_model` sempre foi NOT NULL com padrão `fixed_monthly`: o contrato antigo "tem" uma
  -- base de precificação que ninguém escolheu. Este marcador diz se ela foi INFORMADA. Nenhuma linha
  -- existente é alterada: a API lê "informada" = marcador OU valor diferente do padrão (per_call e
  -- per_asset nunca foram padrão, então foram escolhidos). Só o fixed_monthly antigo sai "não informada".
  ADD COLUMN IF NOT EXISTS billing_model_informed boolean NOT NULL DEFAULT false;

-- Sem repetição: {1,1} ou {1,10,1} são recusados também em gravação direta no banco.
CREATE OR REPLACE FUNCTION aurora.smallint_array_has_no_duplicates(p smallint[])
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT count(*) = count(DISTINCT x) FROM unnest(p) AS x
$fn$;

ALTER TABLE aurora.contracts
  ADD CONSTRAINT contracts_service_frequency_valid
  CHECK (service_frequency IS NULL OR service_frequency IN
         ('annual', 'semiannual', 'quarterly', 'monthly', 'biweekly', 'weekly'));

ALTER TABLE aurora.contracts
  ADD CONSTRAINT contracts_payment_terms_valid
  CHECK (payment_terms IS NULL OR payment_terms IN ('monthly', 'upfront'));

-- Vazio é gravado como NULO pela aplicação; aqui só os identificadores 1…10, SEM REPETIÇÃO.
-- `<@` sozinho aceitaria {1,1}; a função acima fecha essa porta no próprio banco.
ALTER TABLE aurora.contracts
  ADD CONSTRAINT contracts_fixed_teams_valid
  CHECK (fixed_team_packages IS NULL OR (
    cardinality(fixed_team_packages) BETWEEN 1 AND 10
    AND array_position(fixed_team_packages, NULL) IS NULL
    AND fixed_team_packages <@ ARRAY[1,2,3,4,5,6,7,8,9,10]::smallint[]
    AND aurora.smallint_array_has_no_duplicates(fixed_team_packages)
  ));

-- -----------------------------------------------------------------------------
-- A mesma cascata de `resolve_sla_policy` (0085), com a origem de cada degrau.
-- Sem nenhuma linha = sem política (nenhum relógio de SLA abre).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aurora.resolve_sla_policy_source(p_asset_id uuid, p_customer_id uuid)
RETURNS TABLE (policy_id uuid, source text, contract_id uuid)
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  WITH contrato AS (
    SELECT aurora.contract_for_asset(p_asset_id, CURRENT_DATE) AS id
  ),
  ativo AS (
    SELECT a.sla_enabled, a.sla_policy_id, a.criticality_id FROM aurora.assets a WHERE a.id = p_asset_id
  ),
  degraus AS (
    SELECT 1 AS ordem, NULL::uuid AS policy_id, 'disabled'::text AS source, NULL::uuid AS contract_id
      FROM ativo WHERE NOT ativo.sla_enabled
    UNION ALL
    SELECT 2, ativo.sla_policy_id, 'asset', NULL FROM ativo WHERE ativo.sla_policy_id IS NOT NULL
    UNION ALL
    SELECT 3, o.sla_policy_id, 'contract_criticality', contrato.id
      FROM aurora.contract_sla_overrides o, contrato, ativo
     WHERE o.contract_id = contrato.id AND o.criticality_level_id = ativo.criticality_id
    UNION ALL
    SELECT 4, ct.sla_policy_id, 'contract', ct.id
      FROM aurora.contracts ct, contrato
     WHERE ct.id = contrato.id AND ct.sla_policy_id IS NOT NULL
    UNION ALL
    SELECT 5, c.default_sla_policy_id, 'customer', NULL
      FROM aurora.customers c WHERE c.id = p_customer_id AND c.default_sla_policy_id IS NOT NULL
    UNION ALL
    SELECT 6, o.default_sla_policy_id, 'organization', NULL
      FROM aurora.organizations o
     WHERE o.id = aurora.current_organization_id() AND o.default_sla_policy_id IS NOT NULL
  )
  SELECT policy_id, source, contract_id FROM degraus ORDER BY ordem LIMIT 1
$fn$;

GRANT EXECUTE ON FUNCTION aurora.resolve_sla_policy_source(uuid, uuid) TO aurora_app, aurora_readonly;
