/**
 * Aurora — montagem dos relatórios BASIC / ADVANCED / EXPERT (reunião
 * 16/10/2026, Fases 9 e 10; Fase 1 de indicadores, 17/10/2026).
 *
 * Vive no pacote de dados, e não no controlador, porque tem DOIS chamadores:
 * o "Gerar relatório" do Painel e o relatório AGENDADO das automações. Os dois
 * precisam do mesmo número — e do mesmo recorte de escopo do vínculo de quem
 * vai ler.
 *
 * QUEM DEFINE O QUÊ
 *
 *   · o CATÁLOGO (`@aurora/domain`, `report-tiers`) diz quais indicadores
 *     existem, em quais modelos, em que situação e com que sentido de meta;
 *   · as METAS vêm de `indicator_targets` (contrato → cliente → organização);
 *   · o número vem da função de indicador que o Painel já usa.
 *
 * REGRAS DE ENTRADA NO RELATÓRIO
 *
 *   · sem seleção explícita, só indicadores ACTIVE;
 *   · PROVISIONAL só com pedido explícito, e sai marcado;
 *   · PENDING_DEFINITION nunca entra: pedir um é 422 e o catálogo diz o motivo.
 *     A resposta lista o que ficou de fora do modelo em `pending`, sem número.
 *
 * NADA DE INDICADOR NOVO SEM DEFINIÇÃO: cada seção é uma função existente.
 */
import {
  NotFoundError,
  REPORT_TIER_LABEL,
  ValidationError,
  dayOf,
  defaultIndicatorsForTier,
  evaluateTarget,
  indicatorsForTier,
  isReportable,
  legacyStatusOf,
  resolveTarget,
  NO_TARGET_LABEL,
  type IndicatorState,
  type IndicatorTarget,
  type IndicatorUnit,
  type LegacyIndicatorStatus,
  type ReportIndicator,
  type ReportTier,
  type TargetDirection,
  type TargetEvaluation,
  type TargetScope,
} from '@aurora/domain';
import type { TenantSession } from './client';
import {
  workOrdersOpened,
  workOrdersCompleted,
  openedVsClosed,
  serviceRating,
  backlog,
  mttr,
  mtbf,
  slaCompliance,
  preventiveVsCorrective,
} from './metrics';
import {
  membershipScope,
  assertCustomerInScope,
  scopedFilters,
  granularityFor,
  workOrderSeries,
  openWorkOrdersSnapshot,
  parkSnapshot,
} from './painel';
import { planBoard } from './plan-board';
import { loadVisibleTargets } from './indicator-targets';

export interface ReportInput {
  tier: ReportTier;
  indicators?: string[];
  from: string;
  to: string;
  customer_id?: string;
  /** Escolhe a META do contrato; o recorte dos números segue cliente/setor. */
  contract_id?: string;
  sector_id?: string;
  plan_kind?: string;
  asset_category_id?: string;
}

export interface ReportSectionTarget {
  id: string;
  value: number;
  unit: string;
  direction: Exclude<TargetDirection, 'INFORMATIONAL'>;
  scope: TargetScope;
  valid_from: string;
  valid_to: string | null;
}

export interface ReportSection {
  key: string;
  label: string;
  /** Situação no catálogo. Em relatório só aparecem ACTIVE e PROVISIONAL. */
  state: IndicatorState;
  /** Derivada de `state`; mantida para relatórios gravados e telas antigas. */
  status: LegacyIndicatorStatus;
  note: string | null;
  /** Valor principal, já na unidade dita em `unit`; nulo quando não há. */
  value: number | null;
  unit: IndicatorUnit;
  /** Amostras/cobertura, quando a métrica as tem. */
  samples: number | null;
  /** Detalhe estruturado (série, quebra por situação, numerador/denominador…). */
  detail: unknown;
  definition: string | null;
  direction: TargetDirection;
  /** A meta que vale para este indicador neste contexto, ou nulo. */
  target: ReportSectionTarget | null;
  target_evaluation: TargetEvaluation;
  /** `SEM META CONFIGURADA` quando o indicador tem sentido de meta e nenhuma vale. */
  target_label: string | null;
}

export interface PendingIndicator {
  key: string;
  label: string;
  state: IndicatorState;
  note: string | null;
}

const PLAN_KIND_DO_INDICADOR: Record<string, string> = {
  compliance_preventive: 'preventive',
  compliance_calibration: 'calibration',
  compliance_electrical_safety: 'electrical_safety',
  compliance_qualification: 'qualification',
};

function periodo(from: string, to: string): { from: Date; to: Date } {
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
    throw new ValidationError('datas inválidas', { field: 'from' });
  }
  if (t <= f) throw new ValidationError('"to" precisa ser depois de "from"', { field: 'to' });
  if (t.getTime() - f.getTime() > 400 * 86_400_000) {
    throw new ValidationError('o período do relatório é de no máximo 400 dias', { field: 'to' });
  }
  return { from: f, to: t };
}

function definicao(r: {
  definition: { label: string; numerator: string; denominator: string | null };
}): string {
  return r.definition.denominator
    ? `${r.definition.numerator} ÷ ${r.definition.denominator}`
    : r.definition.numerator;
}

type Calculo = Pick<ReportSection, 'value' | 'samples' | 'detail' | 'definition'> & {
  unit?: IndicatorUnit;
};

/** O dia que vale para escolher a meta: o último dia do período, sem passar de hoje. */
export function targetReferenceDay(to: Date, now: Date = new Date()): string {
  return dayOf(new Date(Math.min(to.getTime(), now.getTime()) - 1));
}

export async function buildReport(
  s: TenantSession,
  membershipId: string | null,
  b: ReportInput
): Promise<{
  sections: ReportSection[];
  pending: PendingIndicator[];
  filters: Record<string, string | null>;
}> {
  const p = periodo(b.from, b.to);
  const escopo = await membershipScope(s, membershipId);

  // O contrato escolhe a meta e carrega o cliente dele.
  let clienteId = b.customer_id ?? null;
  let contratoNumero: string | null = null;
  if (b.contract_id) {
    const [c] = await s.query<{ customer_id: string; number: string }>(
      `SELECT customer_id, number FROM aurora.contracts WHERE id = $1`,
      [b.contract_id]
    );
    if (!c) throw new NotFoundError('contrato', b.contract_id);
    if (clienteId && clienteId !== c.customer_id) {
      throw new ValidationError('o contrato não pertence ao cliente escolhido', { field: 'contract_id' });
    }
    clienteId = c.customer_id;
    contratoNumero = c.number;
  }
  await assertCustomerInScope(s, escopo, clienteId);

  let locationPath: string | null = null;
  let sectorName: string | null = null;
  if (b.sector_id) {
    const [setor] = await s.query<{ path: string; name: string; customer_id: string }>(
      `SELECT path, name, customer_id FROM aurora.locations WHERE id = $1 AND deleted_at IS NULL`,
      [b.sector_id]
    );
    if (!setor) throw new NotFoundError('setor', b.sector_id);
    // O setor precisa ser do cliente escolhido e do escopo de quem pede — sem
    // isso, os números ficavam no escopo, mas o NOME do setor de outro cliente
    // ia para o cabeçalho do relatório (pente-fino 17/10/2026).
    if (clienteId && setor.customer_id !== clienteId) {
      throw new ValidationError('o setor não pertence ao cliente escolhido', { field: 'sector_id' });
    }
    await assertCustomerInScope(s, escopo, setor.customer_id);
    locationPath = setor.path;
    sectorName = setor.name;
  }
  const f = scopedFilters(escopo, {
    customerId: clienteId,
    locationPath,
    assetCategoryId: b.asset_category_id ?? null,
  });

  const doModelo = indicatorsForTier(b.tier);
  const pedidos = b.indicators && b.indicators.length > 0 ? new Set(b.indicators) : null;
  let escolhidos: ReportIndicator[];
  if (pedidos) {
    const fora = [...pedidos].filter((k) => !doModelo.some((i) => i.key === k));
    if (fora.length > 0) {
      throw new ValidationError(
        `indicadores fora do modelo ${REPORT_TIER_LABEL[b.tier]}: ${fora.join(', ')}`,
        { field: 'indicators' }
      );
    }
    escolhidos = doModelo.filter((i) => pedidos.has(i.key));
    const pendentes = escolhidos.filter((i) => !isReportable(i)).map((i) => i.key);
    if (pendentes.length > 0) {
      throw new ValidationError(
        `indicadores aguardando definição não entram em relatório: ${pendentes.join(', ')}`,
        { field: 'indicators' }
      );
    }
  } else {
    escolhidos = defaultIndicatorsForTier(b.tier);
  }
  const pending: PendingIndicator[] = doModelo
    .filter((i) => !isReportable(i))
    .map((i) => ({ key: i.key, label: i.label, state: i.state, note: i.note ?? null }));

  const metas: IndicatorTarget[] = await loadVisibleTargets(
    s,
    escopo,
    escolhidos.filter((i) => i.targetDirection !== 'INFORMATIONAL').map((i) => i.key)
  );
  const diaDaMeta = targetReferenceDay(p.to);

  let quadro: Awaited<ReturnType<typeof planBoard>> | null = null;
  const plano = async () =>
    (quadro ??= await planBoard(
      s,
      { from: p.from, to: p.to, customerId: clienteId, sectorId: b.sector_id ?? null },
      escopo
    ));

  const calcular = async (ind: ReportIndicator): Promise<Calculo | null> => {
    switch (ind.key) {
      case 'park_availability_snapshot': {
        const park = await parkSnapshot(s, f);
        /*
         * A MESMA BASE DO PAINEL (`disponibilidadeAgora`, apps/web/src/features/
         * painel/dados.ts) — pente-fino 17/10/2026. O relatório dividia pelo total
         * cadastrado, inclusive baixados e descartados, e o Painel não: 90 em
         * operação, 10 em manutenção e 50 baixados davam 90 % numa tela e 60 % no
         * PDF. Baixado e descartado saem da base; emprestado fica nela. A
         * definição de disponibilidade no tempo segue em aberto (P-09).
         */
        const disponiveis = (park.byStatus.active ?? 0) + (park.byStatus.standby ?? 0);
        const base = disponiveis + (park.byStatus.under_maintenance ?? 0) + (park.byStatus.loaned ?? 0);
        return {
          value: base > 0 ? Number(((disponiveis / base) * 100).toFixed(1)) : null,
          samples: base,
          detail: park.byStatus,
          definition:
            'equipamentos em operação ou reserva ÷ equipamentos em uso (operação, reserva, manutenção, emprestados; sem baixados e descartados) — situação de agora',
        };
      }
      case 'mttr': {
        const r = await mttr(s, p, f);
        return { value: r.data.value, samples: r.data.samples, detail: null, definition: definicao(r) };
      }
      case 'mtbf': {
        const r = await mtbf(s, p, f);
        return {
          value: r.data.value,
          samples: r.data.samples,
          detail: { assets: r.data.assetsWithInterval },
          definition: definicao(r),
        };
      }
      case 'work_orders_opened': {
        const r = await workOrdersOpened(s, p, f);
        return { value: r.data.count, samples: null, detail: null, definition: definicao(r) };
      }
      case 'work_orders_completed': {
        const r = await workOrdersCompleted(s, p, f);
        return { value: r.data.count, samples: null, detail: null, definition: definicao(r) };
      }
      case 'opened_vs_closed': {
        const r = await openedVsClosed(s, p, f);
        return {
          value: r.data.percent,
          samples: r.data.denominator,
          detail: {
            numerator: r.data.numerator,
            denominator: r.data.denominator,
            opened: r.data.opened,
            closed: r.data.closed,
          },
          definition: definicao(r),
        };
      }
      case 'service_rating': {
        const r = await serviceRating(s, p, f);
        return {
          value: r.data.average,
          samples: r.data.count,
          detail: { count: r.data.count, distribution: r.data.distribution },
          definition: definicao(r),
        };
      }
      case 'compliance_preventive':
      case 'compliance_calibration':
      case 'compliance_electrical_safety':
      case 'compliance_qualification': {
        const tipo = PLAN_KIND_DO_INDICADOR[ind.key]!;
        if (b.plan_kind && b.plan_kind !== tipo) return null;
        const q = await plano();
        const k = q.byKind.find((x) => x.key === tipo);
        const programados = k ? k.done + k.pending + k.late + k.skipped : 0;
        const denominador = programados - (k?.skipped ?? 0);
        return {
          value: k && denominador > 0 ? Number(((k.done / denominador) * 100).toFixed(1)) : null,
          samples: programados,
          detail: k ?? null,
          // "No prazo" NÃO: o quadro conta o item feito com atraso como realizado,
          // e se o atraso conta é pergunta aberta (P-06/P-07). A definição impressa
          // descreve o que a conta faz — sem decidir a pergunta.
          definition: 'itens de plano realizados ÷ (programados − dispensados), no período',
        };
      }
      case 'sla_compliance': {
        const r = await slaCompliance(s, p, f);
        return {
          value: r.data.rate,
          samples: r.data.met + r.data.breached,
          detail: r.data.byKind,
          definition: definicao(r),
        };
      }
      case 'work_order_evolution': {
        const serie = await workOrderSeries(s, p, granularityFor(p), f);
        return {
          value: null,
          samples: null,
          detail: serie.map((x) => ({ start: x.start, opened: x.opened, completed: x.completed })),
          definition: 'abertas e concluídas por fatia do período',
        };
      }
      case 'backlog': {
        const r = await backlog(s, p.to.getTime() > Date.now() ? new Date() : p.to, f);
        return { value: r.data.count, samples: null, detail: r.data.buckets, definition: definicao(r) };
      }
      case 'work_orders_by_status': {
        const agora = await openWorkOrdersSnapshot(s, f);
        const total = Object.values(agora.byStatus).reduce((t, v) => t + v, 0);
        return {
          value: total,
          samples: null,
          detail: agora.byStatus,
          definition: 'OS abertas agora, por situação',
        };
      }
      case 'preventive_vs_corrective': {
        const r = await preventiveVsCorrective(s, p, f);
        return { value: null, samples: null, detail: r.data, definition: definicao(r) };
      }
      default:
        // Indicador reportável sem cálculo ligado: falha alta, e não seção em branco.
        throw new Error(`indicador "${ind.key}" está no catálogo como reportável, mas não tem cálculo`);
    }
  };

  const secoes: ReportSection[] = [];
  for (const ind of escolhidos) {
    const calc = await calcular(ind);
    if (!calc) continue;
    const valida =
      ind.targetDirection === 'INFORMATIONAL'
        ? null
        : resolveTarget(metas, {
            indicatorKey: ind.key,
            customerId: clienteId,
            contractId: b.contract_id ?? null,
            on: diaDaMeta,
          });
    const avaliacao = evaluateTarget(calc.value, valida?.target ?? null, ind.targetDirection);
    secoes.push({
      key: ind.key,
      label: ind.label,
      state: ind.state,
      status: legacyStatusOf(ind.state),
      note: ind.note ?? null,
      value: calc.value,
      unit: calc.unit ?? ind.unit,
      samples: calc.samples,
      detail: calc.detail,
      definition: calc.definition,
      direction: ind.targetDirection,
      target: valida
        ? {
            id: valida.target.id,
            value: valida.target.value,
            unit: valida.target.unit,
            direction: valida.target.direction,
            scope: valida.scope,
            valid_from: valida.target.validFrom,
            valid_to: valida.target.validTo,
          }
        : null,
      target_evaluation: avaliacao,
      target_label: avaliacao === 'no_target' ? NO_TARGET_LABEL : null,
    });
  }

  const [cliente] = clienteId
    ? await s.query<{ name: string }>(`SELECT name FROM aurora.customers WHERE id = $1`, [clienteId])
    : [];
  return {
    sections: secoes,
    pending,
    filters: {
      from: p.from.toISOString(),
      to: p.to.toISOString(),
      customer: cliente?.name ?? null,
      contract: contratoNumero,
      sector: sectorName,
      plan_kind: b.plan_kind ?? null,
      asset_category_id: b.asset_category_id ?? null,
      target_day: diaDaMeta,
    },
  };
}
