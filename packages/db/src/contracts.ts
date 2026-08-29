/**
 * Aurora — contratos na camada de dados (SPEC v0.2 §17 · EPIC-017).
 */
import {
  newId,
  coverageSpecificity,
  rangesOverlap,
  renewalAlert,
  franchiseState,
  overageAmount,
  penaltyForBreaches,
  periodBounds,
  summarizeMeasurement,
  contractStatusOn,
  ValidationError,
  NotFoundError,
  ConflictError,
  type ContractKind,
  type ContractStatus,
  type BillingModel,
  type CoverageKind,
  type MeasurementSummary,
  type IsoDate,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';

/* -------------------------------------------------------------------------- */
/* cadastro                                                                    */
/* -------------------------------------------------------------------------- */

export interface ContractInput {
  customerId: string;
  kind: ContractKind;
  title?: string;
  startsOn: IsoDate;
  endsOn?: IsoDate | null;
  autoRenew?: boolean;
  renewalNoticeDays?: number;
  adjustmentIndex?: string | null;
  slaPolicyId?: string | null;
  billingModel?: BillingModel;
  monthlyValue?: number | null;
  includedCalls?: number | null;
  includedHours?: number | null;
  overageCallRate?: number | null;
  overageHourRate?: number | null;
  penaltyPercentPerBreach?: number | null;
  penaltyCapPercent?: number | null;
  slaTargetPercent?: number | null;
  planTargetPercent?: number | null;
  notes?: string | null;
}

export async function createContract(session: TenantSession, input: ContractInput): Promise<string> {
  const id = newId();
  const [seq] = await session.query<{ next_number: string }>(
    `SELECT aurora.next_number($1, 'CT', $2) AS next_number`,
    [session.context.organizationId, new Date().getUTCFullYear()]
  );

  await session.query(
    `INSERT INTO aurora.contracts
       (id, organization_id, number, customer_id, kind, title, starts_on, ends_on,
        auto_renew, renewal_notice_days, adjustment_index, sla_policy_id, billing_model,
        monthly_value, included_calls, included_hours, overage_call_rate, overage_hour_rate,
        penalty_percent_per_breach, penalty_cap_percent, sla_target_percent, plan_target_percent,
        notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
    [
      id,
      session.context.organizationId,
      `CT-${new Date().getUTCFullYear()}-${String(seq!.next_number).padStart(5, '0')}`,
      input.customerId,
      input.kind,
      input.title ?? null,
      input.startsOn,
      input.endsOn ?? null,
      input.autoRenew ?? false,
      input.renewalNoticeDays ?? 30,
      input.adjustmentIndex ?? null,
      input.slaPolicyId ?? null,
      input.billingModel ?? 'fixed_monthly',
      input.monthlyValue ?? null,
      input.includedCalls ?? null,
      input.includedHours ?? null,
      input.overageCallRate ?? null,
      input.overageHourRate ?? null,
      input.penaltyPercentPerBreach ?? null,
      input.penaltyCapPercent ?? null,
      input.slaTargetPercent ?? null,
      input.planTargetPercent ?? null,
      input.notes ?? null,
      session.context.actorId,
    ]
  );
  return id;
}

export interface CoverageInput {
  contractId: string;
  kind: CoverageKind;
  assetId?: string | null;
  locationId?: string | null;
  assetCategoryId?: string | null;
}

/**
 * Adiciona uma cobertura e valida a exclusividade (§17).
 *
 * A regra é "um ativo em um contrato por vez numa dada data". Ela é verificada
 * aqui contra os ativos que a expressão alcança HOJE, e a mensagem lista os
 * ativos em conflito com o número do outro contrato — sem isso, o operador
 * recebe "conflito" e precisa descobrir sozinho onde, o que na prática faz ele
 * desistir e cadastrar o contrato com escopo errado.
 *
 * O que esta verificação NÃO faz, e não tem como fazer: impedir o conflito que
 * nasce depois, quando um ativo novo casa com duas expressões. Para esse caso a
 * resolução é determinística por especificidade — está em `contract_for_asset`,
 * e o motivo está escrito lá.
 */
export async function addCoverage(session: TenantSession, input: CoverageInput): Promise<string> {
  const [contrato] = await session.query<{
    id: string;
    number: string;
    starts_on: string;
    ends_on: string | null;
  }>(`SELECT id, number, starts_on, ends_on FROM aurora.contracts WHERE id = $1`, [input.contractId]);
  if (!contrato) throw new NotFoundError('contrato não encontrado');

  let depth = 0;
  if (input.kind === 'location_subtree') {
    if (!input.locationId) throw new ValidationError('cobertura por subárvore exige o local raiz');
    const [local] = await session.query<{ depth: number }>(
      `SELECT depth FROM aurora.locations WHERE id = $1`,
      [input.locationId]
    );
    if (!local) throw new NotFoundError('local não encontrado');
    depth = Number(local.depth);
  }

  const id = newId();
  const specificity = coverageSpecificity({
    kind: input.kind,
    hasCategoryFilter: input.assetCategoryId != null,
    depth,
  });

  await session.query(
    `INSERT INTO aurora.contract_coverages
       (id, organization_id, contract_id, kind, asset_id, location_id, asset_category_id,
        specificity, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      session.context.organizationId,
      input.contractId,
      input.kind,
      input.assetId ?? null,
      input.locationId ?? null,
      input.assetCategoryId ?? null,
      specificity,
      session.context.actorId,
    ]
  );

  const conflitos = await overlappingAssets(session, input.contractId);
  if (conflitos.length > 0) {
    const amostra = conflitos
      .slice(0, 5)
      .map((c) => `${c.asset_name} (já em ${c.other_number})`)
      .join('; ');
    const resto = conflitos.length > 5 ? ` e mais ${conflitos.length - 5}` : '';
    throw new ConflictError(
      `esta cobertura colocaria ${conflitos.length} ativo(s) em dois contratos ao mesmo tempo: ${amostra}${resto}`
    );
  }

  return id;
}

interface OverlapRow {
  asset_id: string;
  asset_name: string;
  other_contract_id: string;
  other_number: string;
}

/**
 * Ativos que o contrato passaria a cobrir e que já estão em outro contrato
 * vigente no mesmo intervalo.
 *
 * A sobreposição de datas é decidida em TypeScript (`rangesOverlap`) e não em
 * SQL de propósito: a regra dos extremos inclusivos — quem termina em 31/12 e
 * quem começa em 31/12 disputam aquele dia — está escrita num lugar só, com
 * teste próprio, em vez de repetida em cada consulta que precisar dela.
 */
async function overlappingAssets(session: TenantSession, contractId: string): Promise<OverlapRow[]> {
  const [alvo] = await session.query<{ starts_on: string; ends_on: string | null }>(
    `SELECT starts_on::text, ends_on::text FROM aurora.contracts WHERE id = $1`,
    [contractId]
  );
  if (!alvo) throw new NotFoundError('contrato não encontrado');

  const candidatos = await session.query<{
    asset_id: string;
    asset_name: string;
    other_contract_id: string;
    other_number: string;
    other_starts_on: string;
    other_ends_on: string | null;
  }>(
    `SELECT DISTINCT r.asset_id,
            a.name  AS asset_name,
            outro.id AS other_contract_id,
            outro.number AS other_number,
            outro.starts_on::text AS other_starts_on,
            outro.ends_on::text   AS other_ends_on
       FROM aurora.resolve_contract_assets($1) r
       JOIN aurora.assets a ON a.id = r.asset_id
       JOIN aurora.contracts outro ON outro.id <> $1 AND outro.status IN ('draft', 'active')
      WHERE EXISTS (
        SELECT 1 FROM aurora.resolve_contract_assets(outro.id) o WHERE o.asset_id = r.asset_id
      )`,
    [contractId]
  );

  return candidatos
    .filter((c) =>
      rangesOverlap(
        { startsOn: alvo.starts_on, endsOn: alvo.ends_on },
        { startsOn: c.other_starts_on, endsOn: c.other_ends_on }
      )
    )
    .map(({ asset_id, asset_name, other_contract_id, other_number }) => ({
      asset_id,
      asset_name,
      other_contract_id,
      other_number,
    }));
}

export async function addService(
  session: TenantSession,
  input: { contractId: string; workOrderTypeId: string; billedSeparately?: boolean }
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.contract_services
       (id, organization_id, contract_id, work_order_type_id, billed_separately, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      session.context.organizationId,
      input.contractId,
      input.workOrderTypeId,
      input.billedSeparately ?? false,
      session.context.actorId,
    ]
  );
  return id;
}

export async function setSlaOverride(
  session: TenantSession,
  input: { contractId: string; criticalityLevelId: string; slaPolicyId: string }
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.contract_sla_overrides
       (id, organization_id, contract_id, criticality_level_id, sla_policy_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (contract_id, criticality_level_id)
     DO UPDATE SET sla_policy_id = EXCLUDED.sla_policy_id
     RETURNING id`,
    [
      id,
      session.context.organizationId,
      input.contractId,
      input.criticalityLevelId,
      input.slaPolicyId,
      session.context.actorId,
    ]
  );
  return id;
}

/* -------------------------------------------------------------------------- */
/* ciclo de vida                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Ativa o contrato.
 *
 * Contrato sem cobertura não cobre nada, e ativá-lo assim produz o pior estado
 * possível: a interface mostra "vigente", o cliente acredita que está coberto, e
 * a cascata de SLA não encontra nada. Recusar aqui é a única forma de o erro
 * aparecer enquanto ainda é barato.
 */
export async function activateContract(session: TenantSession, id: string): Promise<void> {
  const [contrato] = await session.query<{ number: string; status: ContractStatus }>(
    `SELECT number, status FROM aurora.contracts WHERE id = $1`,
    [id]
  );
  if (!contrato) throw new NotFoundError('contrato não encontrado');
  if (contrato.status !== 'draft') {
    throw new ConflictError(`contrato ${contrato.number} não está em rascunho`);
  }

  const [cobertura] = await session.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM aurora.contract_coverages WHERE contract_id = $1`,
    [id]
  );
  if (Number(cobertura!.total) === 0) {
    throw new ValidationError(
      'contrato sem cobertura não cobre ativo nenhum: defina o escopo antes de ativar'
    );
  }

  await session.query(`UPDATE aurora.contracts SET status = 'active', updated_by = $2 WHERE id = $1`, [
    id,
    session.context.actorId,
  ]);
  await emitEvent(session, {
    type: 'contract.activated',
    aggregateId: id,
    payload: { number: contrato.number },
  });
}

export async function terminateContract(session: TenantSession, id: string, reason: string): Promise<void> {
  if (reason.trim().length < 10) {
    throw new ValidationError('encerrar contrato exige justificativa de ao menos 10 caracteres');
  }
  const [contrato] = await session.query<{ number: string; notes: string | null }>(
    `SELECT number, notes FROM aurora.contracts WHERE id = $1`,
    [id]
  );
  if (!contrato) throw new NotFoundError('contrato não encontrado');

  await session.query(
    `UPDATE aurora.contracts
        SET status = 'terminated',
            notes = coalesce(notes || E'\n', '') || $2,
            updated_by = $3
      WHERE id = $1`,
    [id, `[encerramento] ${reason.trim()}`, session.context.actorId]
  );
  await emitEvent(session, {
    type: 'contract.terminated',
    aggregateId: id,
    payload: { number: contrato.number, reason: reason.trim() },
  });
}

/* -------------------------------------------------------------------------- */
/* cobertura em uso                                                            */
/* -------------------------------------------------------------------------- */

/** O contrato que responde por um ativo numa data — no máximo um (§17). */
export async function contractForAsset(
  session: TenantSession,
  assetId: string,
  on: IsoDate
): Promise<string | null> {
  const [row] = await session.query<{ id: string | null }>(
    `SELECT aurora.contract_for_asset($1, $2::date) AS id`,
    [assetId, on]
  );
  return row?.id ?? null;
}

export async function coveredAssets(session: TenantSession, contractId: string): Promise<string[]> {
  const rows = await session.query<{ asset_id: string }>(
    `SELECT asset_id FROM aurora.resolve_contract_assets($1)`,
    [contractId]
  );
  return rows.map((r) => r.asset_id);
}

/**
 * A natureza de OS está coberta pelo contrato?
 *
 * Três respostas, não duas: coberta, coberta mas faturada à parte, e fora do
 * escopo. Colapsar as duas últimas em "não coberta" faria a medição perder de
 * vista o serviço que o contrato prevê e cobra — que é justamente o que entra na
 * fatura como excedente.
 */
export async function serviceCoverage(
  session: TenantSession,
  contractId: string,
  workOrderTypeId: string
): Promise<'included' | 'billed_separately' | 'out_of_scope'> {
  const [row] = await session.query<{ billed_separately: boolean }>(
    `SELECT billed_separately FROM aurora.contract_services
      WHERE contract_id = $1 AND work_order_type_id = $2`,
    [contractId, workOrderTypeId]
  );
  if (!row) return 'out_of_scope';
  return row.billed_separately ? 'billed_separately' : 'included';
}

/* -------------------------------------------------------------------------- */
/* medição                                                                     */
/* -------------------------------------------------------------------------- */

export interface PeriodMeasurement extends MeasurementSummary {
  contractId: string;
  period: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  overageCalls: number;
  overageHours: number;
  overageAmount: number;
  penaltyAmount: number | null;
  closedAt: Date | null;
}

/**
 * Mede um período a partir dos fatos.
 *
 * Todos os números vêm das mesmas linhas que operaram o mês — OS, apontamentos,
 * movimentos de estoque, relógios de SLA, itens de ciclo. Nenhum é digitado, e
 * é isso que permite ao cliente conferir qualquer total descendo até a OS que o
 * gerou. Um relatório cujo número não se rastreia até um fato é um relatório que
 * só serve enquanto ninguém pergunta.
 *
 * O recorte é por ATIVO coberto, não por cliente: um cliente pode ter dois
 * contratos, e somar tudo no primeiro faria a franquia do outro parecer intacta.
 */
export async function measurePeriod(
  session: TenantSession,
  contractId: string,
  period: string
): Promise<PeriodMeasurement> {
  const { startsOn, endsOn } = periodBounds(period);

  const [contrato] = await session.query<{
    included_calls: number | null;
    included_hours: string | null;
    overage_call_rate: string | null;
    overage_hour_rate: string | null;
    monthly_value: string | null;
    penalty_percent_per_breach: string | null;
    penalty_cap_percent: string | null;
  }>(
    `SELECT included_calls, included_hours, overage_call_rate, overage_hour_rate,
            monthly_value, penalty_percent_per_breach, penalty_cap_percent
       FROM aurora.contracts WHERE id = $1`,
    [contractId]
  );
  if (!contrato) throw new NotFoundError('contrato não encontrado');

  const [fatos] = await session.query<{
    work_orders: string;
    labor_minutes: string;
    parts_cost: string;
    sla_total: string;
    sla_met: string;
    plan_expected: string;
    plan_done: string;
  }>(
    `WITH escopo AS (
       SELECT asset_id FROM aurora.resolve_contract_assets($1)
     ),
     os AS (
       SELECT w.id
         FROM aurora.work_orders w
         JOIN escopo e ON e.asset_id = w.asset_id
        WHERE w.created_at >= $2::date
          AND w.created_at <  ($3::date + 1)
     )
     SELECT
       (SELECT count(*) FROM os)::text AS work_orders,
       (SELECT coalesce(sum(
                 EXTRACT(EPOCH FROM (t.ended_at - t.started_at)) / 60), 0)::bigint
          FROM aurora.time_entries t JOIN os ON os.id = t.work_order_id
         WHERE t.ended_at IS NOT NULL)::text AS labor_minutes,
       (SELECT coalesce(sum(m.qty * coalesce(m.unit_cost, 0)), 0)
          FROM aurora.stock_movements m JOIN os ON os.id = m.ref_id
         WHERE m.ref_type = 'work_order' AND m.kind = 'consumption')::text AS parts_cost,
       (SELECT count(*) FROM aurora.sla_clocks c JOIN os ON os.id = c.document_id
         WHERE c.document_type = 'work_order'
           AND c.state IN ('met', 'breached'))::text AS sla_total,
       (SELECT count(*) FROM aurora.sla_clocks c JOIN os ON os.id = c.document_id
         WHERE c.document_type = 'work_order' AND c.state = 'met')::text AS sla_met,
       (SELECT count(*) FROM aurora.plan_cycle_items i JOIN escopo e ON e.asset_id = i.asset_id
         WHERE i.due_at >= $2::date AND i.due_at < ($3::date + 1)
           AND i.status <> 'skipped')::text AS plan_expected,
       (SELECT count(*) FROM aurora.plan_cycle_items i JOIN escopo e ON e.asset_id = i.asset_id
         WHERE i.due_at >= $2::date AND i.due_at < ($3::date + 1)
           AND i.status = 'done')::text AS plan_done`,
    [contractId, startsOn, endsOn]
  );

  const resumo = summarizeMeasurement({
    workOrders: Number(fatos!.work_orders),
    laborMinutes: Number(fatos!.labor_minutes),
    partsCost: Number(fatos!.parts_cost),
    slaTotal: Number(fatos!.sla_total),
    slaMet: Number(fatos!.sla_met),
    planExpected: Number(fatos!.plan_expected),
    planDone: Number(fatos!.plan_done),
  });

  const chamados = franchiseState(contrato.included_calls, resumo.workOrders);
  const horas = franchiseState(
    contrato.included_hours === null ? null : Number(contrato.included_hours),
    resumo.laborHours
  );

  const excedenteChamados = chamados ? Math.max(resumo.workOrders - chamados.included, 0) : 0;
  const excedenteHoras = horas ? Number((resumo.laborHours - horas.included).toFixed(2)) : 0;

  const valorExcedente =
    overageAmount(
      contrato.included_calls,
      resumo.workOrders,
      contrato.overage_call_rate === null ? null : Number(contrato.overage_call_rate)
    ) +
    overageAmount(
      contrato.included_hours === null ? null : Number(contrato.included_hours),
      resumo.laborHours,
      contrato.overage_hour_rate === null ? null : Number(contrato.overage_hour_rate)
    );

  const glosa = penaltyForBreaches(
    {
      percentPerBreach:
        contrato.penalty_percent_per_breach === null ? null : Number(contrato.penalty_percent_per_breach),
      capPercent: contrato.penalty_cap_percent === null ? null : Number(contrato.penalty_cap_percent),
    },
    resumo.slaBreaches,
    contrato.monthly_value === null ? 0 : Number(contrato.monthly_value)
  );

  return {
    ...resumo,
    contractId,
    period,
    startsOn,
    endsOn,
    overageCalls: excedenteChamados,
    overageHours: Math.max(excedenteHoras, 0),
    overageAmount: Number(valorExcedente.toFixed(2)),
    penaltyAmount: glosa === null ? null : glosa.amount,
    closedAt: null,
  };
}

/**
 * Grava a medição do período — recalculando enquanto está aberto.
 *
 * O `ON CONFLICT` reescreve o período aberto de propósito: até fechar, a medição
 * é uma leitura dos fatos de hoje, e os fatos de um mês em curso mudam. Depois
 * de fechado, o gatilho `contract_periods_guard` recusa qualquer escrita.
 */
export async function saveMeasurement(
  session: TenantSession,
  contractId: string,
  period: string
): Promise<PeriodMeasurement> {
  const m = await measurePeriod(session, contractId, period);

  await session.query(
    `INSERT INTO aurora.contract_periods
       (id, organization_id, contract_id, period, starts_on, ends_on,
        work_order_count, labor_minutes, parts_cost, sla_total, sla_met,
        plan_expected, plan_done, overage_calls, overage_hours, overage_amount, penalty_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (contract_id, period) DO UPDATE SET
       work_order_count = EXCLUDED.work_order_count,
       labor_minutes    = EXCLUDED.labor_minutes,
       parts_cost       = EXCLUDED.parts_cost,
       sla_total        = EXCLUDED.sla_total,
       sla_met          = EXCLUDED.sla_met,
       plan_expected    = EXCLUDED.plan_expected,
       plan_done        = EXCLUDED.plan_done,
       overage_calls    = EXCLUDED.overage_calls,
       overage_hours    = EXCLUDED.overage_hours,
       overage_amount   = EXCLUDED.overage_amount,
       penalty_amount   = EXCLUDED.penalty_amount`,
    [
      newId(),
      session.context.organizationId,
      contractId,
      period,
      m.startsOn,
      m.endsOn,
      m.workOrders,
      m.laborMinutes,
      m.partsCost,
      m.slaTotal,
      m.slaMet,
      m.planExpected,
      m.planDone,
      m.overageCalls,
      m.overageHours,
      m.overageAmount,
      m.penaltyAmount,
    ]
  );

  return m;
}

/**
 * Fecha o período: os números de hoje viram os números do mês, para sempre.
 *
 * Fechar antes do último dia terminar produziria uma fatura de um mês que ainda
 * está acontecendo — e como o período fechado não se recalcula, o trabalho dos
 * dias restantes ficaria fora de qualquer medição.
 */
export async function closePeriod(
  session: TenantSession,
  contractId: string,
  period: string,
  today: IsoDate
): Promise<PeriodMeasurement> {
  const { endsOn } = periodBounds(period);
  if (today <= endsOn) {
    throw new ValidationError(
      `a competência ${period} termina em ${endsOn} e só pode ser fechada depois disso`
    );
  }

  const m = await saveMeasurement(session, contractId, period);
  await session.query(
    `UPDATE aurora.contract_periods
        SET closed_at = now(), closed_by = $3
      WHERE contract_id = $1 AND period = $2`,
    [contractId, period, session.context.actorId]
  );

  await emitEvent(session, {
    type: 'contract.period_closed',
    aggregateId: contractId,
    payload: {
      period,
      workOrders: m.workOrders,
      slaRate: m.slaRate,
      overageAmount: m.overageAmount,
      penaltyAmount: m.penaltyAmount,
    },
  });

  return { ...m, closedAt: new Date() };
}

/* -------------------------------------------------------------------------- */
/* alertas                                                                     */
/* -------------------------------------------------------------------------- */

export interface ContractAlert {
  contractId: string;
  number: string;
  kind: 'renewal' | 'franchise' | 'sla_below_target' | 'plan_below_target';
  detail: string;
}

/**
 * Varre os contratos vigentes e emite os alertas de §17.
 *
 * Idempotente por marco: o alerta de renovação só é emitido quando o marco
 * cruzado é mais próximo do que o último registrado. Sem isso, uma varredura
 * diária mandaria o mesmo aviso 90 vezes, e o efeito prático de um aviso que
 * chega todo dia é ninguém mais olhar para ele.
 */
export async function sweepContractAlerts(
  session: TenantSession,
  today: IsoDate,
  period: string
): Promise<ContractAlert[]> {
  const contratos = await session.query<{
    id: string;
    number: string;
    status: ContractStatus;
    starts_on: string;
    ends_on: string | null;
    auto_renew: boolean;
    renewal_notice_days: number;
    included_calls: number | null;
    included_hours: string | null;
    sla_target_percent: string | null;
    plan_target_percent: string | null;
    last_renewal_threshold: number | null;
  }>(
    `SELECT id, number, status, starts_on::text, ends_on::text, auto_renew, renewal_notice_days,
            included_calls, included_hours, sla_target_percent, plan_target_percent,
            -- O último marco avisado PARA ESTA VIGÊNCIA. O recorte pela data
            -- de término é o que faz a renovação recomeçar a contagem: sem ele,
            -- um contrato que avisou aos 30 dias e depois foi renovado por mais
            -- um ano carregaria esse 30 para sempre, e nenhum aviso da vigência
            -- nova passaria pela comparação — o contrato ficaria silencioso
            -- justamente porque foi bem administrado da primeira vez.
            (SELECT (e.payload->>'threshold')::int
               FROM aurora.domain_events e
              WHERE e.aggregate_id = c.id AND e.type = 'contract.expiring'
                AND e.payload->>'endsOn' IS NOT DISTINCT FROM c.ends_on::text
              ORDER BY e.occurred_at DESC LIMIT 1) AS last_renewal_threshold
       FROM aurora.contracts c
      WHERE status = 'active' AND archived_at IS NULL`
  );

  const alertas: ContractAlert[] = [];

  for (const c of contratos) {
    const vigencia = { startsOn: c.starts_on, endsOn: c.ends_on };

    // Expirar não é decisão de ninguém: é a data ter passado. Deixar isso para
    // a varredura significaria contrato vencido continuar cobrindo ativo toda
    // vez que a varredura falhasse — então o estado derivado manda, e o banco
    // apenas registra o que já é verdade.
    if (contractStatusOn(c.status, vigencia, today) === 'expired') {
      await session.query(`UPDATE aurora.contracts SET status = 'expired' WHERE id = $1`, [c.id]);
      await emitEvent(session, {
        type: 'contract.expired',
        aggregateId: c.id,
        payload: { number: c.number, endsOn: c.ends_on },
      });
      continue;
    }

    const renovacao = renewalAlert(
      {
        ...vigencia,
        autoRenew: c.auto_renew,
        renewalNoticeDays: Number(c.renewal_notice_days),
      },
      today
    );
    if (renovacao && (c.last_renewal_threshold === null || renovacao.threshold < c.last_renewal_threshold)) {
      const aviso = renovacao.noticeWindowClosed
        ? ' — o prazo de aviso prévio já passou: a renovação automática está confirmada'
        : '';
      alertas.push({
        contractId: c.id,
        number: c.number,
        kind: 'renewal',
        detail: `vence em ${renovacao.daysToEnd} dia(s)${aviso}`,
      });
      await emitEvent(session, {
        type: 'contract.expiring',
        aggregateId: c.id,
        payload: {
          number: c.number,
          endsOn: c.ends_on,
          threshold: renovacao.threshold,
          daysToEnd: renovacao.daysToEnd,
          noticeWindowClosed: renovacao.noticeWindowClosed,
        },
      });
    }

    const medicao = await measurePeriod(session, c.id, period);

    const chamados = franchiseState(c.included_calls, medicao.workOrders);
    const horas = franchiseState(
      c.included_hours === null ? null : Number(c.included_hours),
      medicao.laborHours
    );
    for (const [rotulo, f] of [
      ['chamados', chamados],
      ['horas', horas],
    ] as const) {
      if (f?.warning) {
        alertas.push({
          contractId: c.id,
          number: c.number,
          kind: 'franchise',
          detail: `franquia de ${rotulo} em ${Math.round(f.ratio * 100)} % (${f.used} de ${f.included})`,
        });
      }
    }

    if (c.sla_target_percent !== null && medicao.slaRate !== null) {
      const meta = Number(c.sla_target_percent);
      if (medicao.slaRate < meta) {
        alertas.push({
          contractId: c.id,
          number: c.number,
          kind: 'sla_below_target',
          detail: `SLA do período em ${medicao.slaRate} %, abaixo da meta de ${meta} %`,
        });
      }
    }

    if (c.plan_target_percent !== null && medicao.planCompliance !== null) {
      const meta = Number(c.plan_target_percent);
      if (medicao.planCompliance < meta) {
        alertas.push({
          contractId: c.id,
          number: c.number,
          kind: 'plan_below_target',
          detail: `conformidade de plano em ${medicao.planCompliance} %, abaixo da meta de ${meta} %`,
        });
      }
    }
  }

  return alertas;
}
