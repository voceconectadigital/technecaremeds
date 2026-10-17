/**
 * Aurora — "Gerar relatório" do Painel: fundação dos modelos BASIC, ADVANCED e
 * EXPERT (reunião 16/10/2026, Fase 9).
 *
 * NADA DE INDICADOR NOVO. Cada seção é a função de indicador que o Painel já
 * usa (`metrics.ts`, `painel.ts`, `plan-board.ts`), com o MESMO filtro escopado
 * pelo vínculo — então o número do relatório é o número do Painel.
 *
 * O que ainda não tem definição sai como seção SEM valor, com a situação e o
 * motivo (`AGUARDANDO MODELO PDF OFICIAL` ou "aguardando definição"). O PDF é
 * provisório e diz isso em toda página: o layout oficial vem dos PDFs que o
 * cliente vai enviar.
 */
import { Body, Controller, Get, Inject, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  withTenant,
  workOrdersOpened,
  workOrdersCompleted,
  backlog,
  mttr,
  mtbf,
  slaCompliance,
  preventiveVsCorrective,
  membershipScope,
  assertCustomerInScope,
  scopedFilters,
  granularityFor,
  workOrderSeries,
  openWorkOrdersSnapshot,
  parkSnapshot,
  planBoard,
  type TenantSession,
  type Database,
} from '@aurora/db';
import {
  AGUARDANDO_MODELO,
  NotFoundError,
  REPORT_INDICATORS,
  REPORT_LAYOUT_STATUS,
  REPORT_TIER_LABEL,
  REPORT_TIERS,
  ValidationError,
  indicatorsForTier,
  type ReportIndicator,
  type ReportTier,
} from '@aurora/domain';
import { reportsGenerate } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import { gerarPdf, type LinhaPdf } from '../documents/pdf';
import type { AuroraRequest } from '../common/context.middleware';

export interface ReportSection {
  key: string;
  label: string;
  status: ReportIndicator['status'];
  note: string | null;
  /** Valor principal, já na unidade dita em `unit`; nulo quando não há. */
  value: number | null;
  unit: 'count' | 'minutes' | 'hours' | 'percent' | 'none';
  /** Amostras/cobertura, quando a métrica as tem. */
  samples: number | null;
  /** Detalhe estruturado (série, quebra por situação…). */
  detail: unknown;
  definition: string | null;
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

async function montar(
  s: TenantSession,
  membershipId: string | null,
  b: {
    tier: ReportTier;
    indicators?: string[];
    from: string;
    to: string;
    customer_id?: string;
    sector_id?: string;
    plan_kind?: string;
    asset_category_id?: string;
  }
): Promise<{ sections: ReportSection[]; filters: Record<string, string | null> }> {
  const p = periodo(b.from, b.to);
  const escopo = await membershipScope(s, membershipId);
  await assertCustomerInScope(s, escopo, b.customer_id ?? null);

  let locationPath: string | null = null;
  let sectorName: string | null = null;
  if (b.sector_id) {
    const [setor] = await s.query<{ path: string; name: string }>(
      `SELECT path, name FROM aurora.locations WHERE id = $1 AND deleted_at IS NULL`,
      [b.sector_id]
    );
    if (!setor) throw new NotFoundError('setor', b.sector_id);
    locationPath = setor.path;
    sectorName = setor.name;
  }
  const f = scopedFilters(escopo, {
    customerId: b.customer_id ?? null,
    locationPath,
    assetCategoryId: b.asset_category_id ?? null,
  });

  const doNivel = indicatorsForTier(b.tier);
  const pedidos = b.indicators && b.indicators.length > 0 ? new Set(b.indicators) : null;
  const escolhidos = doNivel.filter((i) => !pedidos || pedidos.has(i.key));
  if (pedidos) {
    const fora = [...pedidos].filter((k) => !doNivel.some((i) => i.key === k));
    if (fora.length > 0) {
      throw new ValidationError(
        `indicadores fora do modelo ${REPORT_TIER_LABEL[b.tier]}: ${fora.join(', ')}`,
        {
          field: 'indicators',
        }
      );
    }
  }

  let quadro: Awaited<ReturnType<typeof planBoard>> | null = null;
  const plano = async () =>
    (quadro ??= await planBoard(
      s,
      { from: p.from, to: p.to, customerId: b.customer_id ?? null, sectorId: b.sector_id ?? null },
      escopo
    ));

  const secoes: ReportSection[] = [];
  for (const ind of escolhidos) {
    const base = { key: ind.key, label: ind.label, status: ind.status, note: ind.note ?? null };
    if (ind.status !== 'available') {
      secoes.push({ ...base, value: null, unit: 'none', samples: null, detail: null, definition: null });
      continue;
    }
    switch (ind.key) {
      case 'park_availability_snapshot': {
        const park = await parkSnapshot(s, f);
        const disponiveis = (park.byStatus.active ?? 0) + (park.byStatus.standby ?? 0);
        secoes.push({
          ...base,
          value: park.total > 0 ? Number(((disponiveis / park.total) * 100).toFixed(1)) : null,
          unit: 'percent',
          samples: park.total,
          detail: park.byStatus,
          definition: 'equipamentos em operação ou reserva ÷ equipamentos cadastrados (situação de agora)',
        });
        break;
      }
      case 'mttr': {
        const r = await mttr(s, p, f);
        secoes.push({
          ...base,
          value: r.data.value,
          unit: 'minutes',
          samples: r.data.samples,
          detail: null,
          definition: definicao(r),
        });
        break;
      }
      case 'mtbf': {
        const r = await mtbf(s, p, f);
        secoes.push({
          ...base,
          value: r.data.value,
          unit: 'hours',
          samples: r.data.samples,
          detail: { assets: r.data.assetsWithInterval },
          definition: definicao(r),
        });
        break;
      }
      case 'work_orders_opened': {
        const r = await workOrdersOpened(s, p, f);
        secoes.push({
          ...base,
          value: r.data.count,
          unit: 'count',
          samples: null,
          detail: null,
          definition: definicao(r),
        });
        break;
      }
      case 'work_orders_completed': {
        const r = await workOrdersCompleted(s, p, f);
        secoes.push({
          ...base,
          value: r.data.count,
          unit: 'count',
          samples: null,
          detail: null,
          definition: definicao(r),
        });
        break;
      }
      case 'compliance_preventive':
      case 'compliance_calibration':
      case 'compliance_electrical_safety':
      case 'compliance_qualification': {
        const tipo = PLAN_KIND_DO_INDICADOR[ind.key]!;
        if (b.plan_kind && b.plan_kind !== tipo) continue;
        const q = await plano();
        const k = q.byKind.find((x) => x.key === tipo);
        const programados = k ? k.done + k.pending + k.late + k.skipped : 0;
        const denominador = programados - (k?.skipped ?? 0);
        secoes.push({
          ...base,
          value: k && denominador > 0 ? Number(((k.done / denominador) * 100).toFixed(1)) : null,
          unit: 'percent',
          samples: programados,
          detail: k ?? null,
          definition: 'itens de plano realizados no prazo ÷ (programados − dispensados), no período',
        });
        break;
      }
      case 'sla_compliance': {
        const r = await slaCompliance(s, p, f);
        secoes.push({
          ...base,
          value: r.data.rate,
          unit: 'percent',
          samples: r.data.met + r.data.breached,
          detail: r.data.byKind,
          definition: definicao(r),
        });
        break;
      }
      case 'work_order_evolution': {
        const serie = await workOrderSeries(s, p, granularityFor(p), f);
        secoes.push({
          ...base,
          value: null,
          unit: 'none',
          samples: null,
          detail: serie.map((x) => ({ start: x.start, opened: x.opened, completed: x.completed })),
          definition: 'abertas e concluídas por fatia do período',
        });
        break;
      }
      case 'backlog': {
        const r = await backlog(s, p.to.getTime() > Date.now() ? new Date() : p.to, f);
        secoes.push({
          ...base,
          value: r.data.count,
          unit: 'count',
          samples: null,
          detail: r.data.buckets,
          definition: definicao(r),
        });
        break;
      }
      case 'work_orders_by_status': {
        const agora = await openWorkOrdersSnapshot(s, f);
        const total = Object.values(agora.byStatus).reduce((t, v) => t + v, 0);
        secoes.push({
          ...base,
          value: total,
          unit: 'count',
          samples: null,
          detail: agora.byStatus,
          definition: 'OS abertas agora, por situação',
        });
        break;
      }
      case 'preventive_vs_corrective': {
        const r = await preventiveVsCorrective(s, p, f);
        secoes.push({
          ...base,
          value: null,
          unit: 'none',
          samples: null,
          detail: r.data,
          definition: definicao(r),
        });
        break;
      }
      default:
        secoes.push({ ...base, value: null, unit: 'none', samples: null, detail: null, definition: null });
    }
  }

  const [cliente] = b.customer_id
    ? await s.query<{ name: string }>(`SELECT name FROM aurora.customers WHERE id = $1`, [b.customer_id])
    : [];
  return {
    sections: secoes,
    filters: {
      from: p.from.toISOString(),
      to: p.to.toISOString(),
      customer: cliente?.name ?? null,
      sector: sectorName,
      plan_kind: b.plan_kind ?? null,
      asset_category_id: b.asset_category_id ?? null,
    },
  };
}

function formatar(sec: ReportSection): string {
  if (sec.status !== 'available') {
    return sec.status === 'awaiting_official_model' ? AGUARDANDO_MODELO : 'Aguardando definição do cliente';
  }
  if (sec.value === null) return 'Sem dados suficientes no período';
  const v = sec.value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return sec.unit === 'percent'
    ? `${v} %`
    : sec.unit === 'minutes'
      ? `${v} min`
      : sec.unit === 'hours'
        ? `${v} h`
        : v;
}

@Controller('reports')
export class ReportsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('catalog')
  @RequirePermissions('insight.read')
  catalog(): unknown {
    return {
      tiers: REPORT_TIERS.map((t) => ({ key: t, label: REPORT_TIER_LABEL[t] })),
      indicators: REPORT_INDICATORS,
      layout_status: REPORT_LAYOUT_STATUS,
      layout_note:
        'Refinamento dos relatórios Basic / Advanced / Expert será realizado em rodada dedicada após análise dos PDFs oficiais fornecidos pelo cliente.',
    };
  }

  /**
   * Gera o relatório. `?format=pdf` devolve o PDF PROVISÓRIO; sem isso, JSON.
   * A geração é LEITURA — nada é gravado.
   */
  @Post('generate')
  @RequirePermissions('insight.read')
  async generate(
    @Req() req: AuroraRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @Query('format') format?: string
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    const b = parseWith(reportsGenerate.body, body);
    const r = await withTenant(this.db, ctx, (s) => montar(s, ctx.membershipId, b));
    const geradoEm = new Date().toISOString();
    if (format !== 'pdf') {
      return { tier: b.tier, generated_at: geradoEm, layout_status: REPORT_LAYOUT_STATUS, ...r };
    }
    const linhas: LinhaPdf[] = [
      { texto: `Relatório ${REPORT_TIER_LABEL[b.tier]}`, titulo: true },
      {
        texto:
          `Período: ${new Date(r.filters.from!).toLocaleDateString('pt-BR')} a ${new Date(r.filters.to!).toLocaleDateString('pt-BR')}` +
          (r.filters.customer ? ` · Cliente: ${r.filters.customer}` : '') +
          (r.filters.sector ? ` · Setor: ${r.filters.sector}` : ''),
      },
      {
        texto: `Gerado em ${new Date(geradoEm).toLocaleString('pt-BR')}. Layout provisório — ${AGUARDANDO_MODELO}.`,
        tamanho: 8,
      },
    ];
    for (const sec of r.sections) {
      linhas.push({ texto: sec.label, negrito: true, espacoAntes: 8 });
      linhas.push({ texto: formatar(sec), recuo: 12 });
      if (sec.samples !== null) linhas.push({ texto: `Base: ${sec.samples}`, recuo: 12, tamanho: 8 });
      if (sec.definition) linhas.push({ texto: `Definição: ${sec.definition}`, recuo: 12, tamanho: 8 });
      if (sec.note) linhas.push({ texto: sec.note, recuo: 12, tamanho: 8 });
    }
    const pdf = gerarPdf(linhas, {
      titulo: `Relatório ${REPORT_TIER_LABEL[b.tier]}`,
      autor: 'Téchne Care',
      rodape: `Relatório ${REPORT_TIER_LABEL[b.tier]} — provisório`,
      faixa: AGUARDANDO_MODELO,
    });
    res.status(200);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="relatorio-${b.tier}.pdf"`);
    res.setHeader('cache-control', 'no-store');
    return new StreamableFile(pdf);
  }
}
