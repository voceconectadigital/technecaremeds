-- =============================================================================
-- Aurora — 0092 Respostas do Anderson de 24/11/2026 (D-3, D-4, D-7) e o vídeo do
-- assistente de planos de 13/11/2026.
--
-- SÓ ADITIVA. Nenhuma coluna existente muda de tipo, nenhum dado existente é
-- reescrito, e a API anterior continua funcionando com o banco migrado (as
-- colunas novas são todas nulas ou têm padrão).
--
-- 1. PLANO — PRIMEIRA DATA POR EQUIPAMENTO (`plan_tasks.first_due_on`).
--    Educação continuada "só gera um calendário ... é obrigado pôr a data por
--    equipamento". Quando preenchida, é o VENCIMENTO do primeiro ciclo daquela
--    tarefa (os seguintes seguem a frequência a partir dela). Nula = regra de
--    sempre, pela âncora do plano.
--
-- 2. CONTRATO — SUSPENDER / BLOQUEAR ATENDIMENTO (D-4).
--    "Quando o contrato vence ou é apertado o botão suspender atendimento ou
--    bloquear atendimento, tudo para e fica somente consulta." A retenção mora
--    em colunas próprias, e não no `status`: o ciclo de vida do contrato
--    (rascunho → vigente → vencido/encerrado) continua o mesmo, e suspender não
--    apaga a vigência. `service_block()` é a regra única que a aplicação
--    consulta antes de abrir, executar ou concluir qualquer atendimento.
--
-- 3. CONTRATO — HISTÓRICO DE RENOVAÇÕES (D-7).
--    "Se possuir renovação automática, renova o ciclo se ninguém bloquear ou
--    suspender." Cada renovação (automática ou manual) é uma linha, com o fim
--    anterior e o novo. A unicidade por (contrato, fim anterior) é o que impede
--    a mesma vigência de ser renovada duas vezes por duas varreduras.
--
-- 4. OS — HORA DE INÍCIO E HORA DE TÉRMINO DO ATENDIMENTO (D-3).
--    "Estas são controladas pelo campo hora de início e hora de término da
--    ordem de serviço, campo obrigatório em toda OS." Informadas por quem
--    executa, e não deduzidas: `started_at` é a transição de situação, que não
--    é o horário em que o técnico começou o serviço. OS antiga fica nula — a
--    duração dela é "não informada", nunca zero.
-- =============================================================================

-- 1. ---------------------------------------------------------------------------
ALTER TABLE aurora.plan_tasks ADD COLUMN IF NOT EXISTS first_due_on date;

-- 2. ---------------------------------------------------------------------------
ALTER TABLE aurora.contracts
  ADD COLUMN IF NOT EXISTS service_hold        text,
  ADD COLUMN IF NOT EXISTS service_hold_reason text,
  ADD COLUMN IF NOT EXISTS service_hold_at     timestamptz,
  ADD COLUMN IF NOT EXISTS service_hold_by     uuid;
ALTER TABLE aurora.contracts
  ADD CONSTRAINT contracts_service_hold_valid
    CHECK (service_hold IS NULL OR service_hold IN ('suspended', 'blocked'));
ALTER TABLE aurora.contracts
  ADD CONSTRAINT contracts_service_hold_has_date
    CHECK ((service_hold IS NULL) = (service_hold_at IS NULL));

-- -----------------------------------------------------------------------------
-- O atendimento deste cliente (e, quando informado, deste equipamento) está
-- retido por contrato?
--
-- Devolve NO MÁXIMO UMA linha — o contrato que retém e o motivo
-- (`suspended`, `blocked` ou `expired`) — ou nenhuma, quando o atendimento é
-- livre. A regra:
--
--   · só contam contratos que já começaram e que não são rascunho nem
--     encerrados (`terminated` é fim negociado: o cliente passa a ser "sem
--     contrato", e cliente sem contrato é atendido normalmente);
--   · com equipamento, só os contratos que COBREM o equipamento (a mesma
--     expressão de `contract_for_asset`); sem equipamento, todos os do cliente;
--   · havendo UM contrato válido (vigente na data e sem retenção), o
--     atendimento é livre — um contrato velho vencido não bloqueia o novo;
--   · senão, o que retém é o mais específico e, no empate, o mais recente.
--
-- A data vem da aplicação, no fuso da organização: `CURRENT_DATE` do servidor
-- é UTC, e às 21 h de Brasília do último dia já seria "amanhã".
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.service_block(p_customer_id uuid, p_asset_id uuid, p_on date)
RETURNS TABLE (
  contract_id     uuid,
  contract_number text,
  reason          text,
  held_at         timestamptz,
  hold_reason     text,
  ends_on         date
)
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  WITH candidatos AS (
    SELECT ct.id, ct.number, ct.starts_on, ct.ends_on, ct.service_hold_at, ct.service_hold_reason,
           COALESCE(max(cv.specificity), 0) AS especificidade,
           CASE
             WHEN ct.service_hold IS NOT NULL THEN ct.service_hold
             WHEN ct.status = 'suspended' THEN 'suspended'
             WHEN ct.status = 'expired' OR (ct.ends_on IS NOT NULL AND ct.ends_on < p_on) THEN 'expired'
             ELSE NULL
           END AS motivo
      FROM aurora.contracts ct
      LEFT JOIN aurora.contract_coverages cv ON cv.contract_id = ct.id
      LEFT JOIN aurora.assets a ON a.id = p_asset_id
     WHERE ct.customer_id = p_customer_id
       AND ct.archived_at IS NULL
       AND ct.status IN ('active', 'suspended', 'expired')
       AND ct.starts_on <= p_on
       AND (
         p_asset_id IS NULL
         OR (a.customer_id = ct.customer_id AND (
               cv.kind = 'customer'
               OR (cv.kind = 'asset'          AND a.id = cv.asset_id)
               OR (cv.kind = 'asset_category' AND a.asset_category_id = cv.asset_category_id)
               OR (cv.kind = 'location_subtree' AND EXISTS (
                     SELECT 1 FROM aurora.locations l
                      WHERE l.id = cv.location_id AND a.location_path LIKE l.path || '%')
                   AND (cv.asset_category_id IS NULL OR a.asset_category_id = cv.asset_category_id))
             ))
       )
     GROUP BY ct.id
  )
  SELECT c.id, c.number, c.motivo, c.service_hold_at, c.service_hold_reason, c.ends_on
    FROM candidatos c
   WHERE c.motivo IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM candidatos v WHERE v.motivo IS NULL)
   ORDER BY c.especificidade DESC, c.starts_on DESC, c.id
   LIMIT 1
$fn$;

GRANT EXECUTE ON FUNCTION aurora.service_block(uuid, uuid, date) TO aurora_app, aurora_readonly;

-- 3. ---------------------------------------------------------------------------
CREATE TABLE aurora.contract_renewals (
  id               uuid PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  contract_id      uuid NOT NULL,
  seq              integer NOT NULL CHECK (seq >= 1),
  previous_ends_on date NOT NULL,
  new_ends_on      date NOT NULL,
  mode             text NOT NULL CHECK (mode IN ('automatic', 'manual')),
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  CONSTRAINT contract_renewals_forward CHECK (new_ends_on > previous_ends_on),
  CONSTRAINT contract_renewals_once UNIQUE (contract_id, previous_ends_on),
  CONSTRAINT contract_renewals_seq_uq UNIQUE (contract_id, seq),
  CONSTRAINT contract_renewals_contract_org_fk
    FOREIGN KEY (contract_id, organization_id) REFERENCES aurora.contracts (id, organization_id)
    ON DELETE CASCADE
);
CREATE INDEX contract_renewals_org_idx ON aurora.contract_renewals (organization_id, created_at DESC);

ALTER TABLE aurora.contract_renewals OWNER TO aurora_owner;
ALTER TABLE aurora.contract_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.contract_renewals FORCE  ROW LEVEL SECURITY;
CREATE POLICY contract_renewals_tenant_isolation ON aurora.contract_renewals FOR ALL
  USING (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());
GRANT SELECT ON aurora.contract_renewals TO aurora_readonly;
-- Histórico: só se acrescenta.
GRANT SELECT, INSERT ON aurora.contract_renewals TO aurora_app;

-- 4. ---------------------------------------------------------------------------
ALTER TABLE aurora.work_orders
  ADD COLUMN IF NOT EXISTS service_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS service_ended_at   timestamptz;
ALTER TABLE aurora.work_orders
  ADD CONSTRAINT work_orders_service_hours_order
    CHECK (service_started_at IS NULL OR service_ended_at IS NULL
           OR service_ended_at > service_started_at);
