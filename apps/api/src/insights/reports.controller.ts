/**
 * Aurora — "Gerar relatório" do Painel: modelos BASIC, ADVANCED e EXPERT
 * (reunião 16/10/2026, Fase 9; Fase 1 de indicadores, 17/10/2026).
 *
 * O catálogo de indicadores (`@aurora/domain`) é a fonte única da definição;
 * cada seção é a função de indicador que o Painel já usa, com o MESMO filtro
 * escopado pelo vínculo — então o número do relatório é o número do Painel.
 *
 * Indicador PENDING_DEFINITION não entra em relatório: fica só no catálogo e na
 * lista `pending`. PROVISIONAL sai marcado. A meta de cada seção vem de
 * `indicator_targets` ou diz SEM META CONFIGURADA. O PDF Advanced segue o modelo oficial
 * do Completo e o Expert é a casca do IMR (`relatorio-oficial.ts`); o Basic segue provisório, e diz
 * isso em toda página, até o modelo oficial chegar.
 */
import { Body, Controller, Get, Inject, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  withTenant,
  buildReport,
  buildReportSeries,
  organizationName,
  type ReportSection,
  type Database,
} from '@aurora/db';
import {
  AGUARDANDO_MODELO,
  DEFAULT_ORGANIZATION_TIMEZONE,
  NO_TARGET_LABEL,
  REPORT_INDICATORS,
  REPORT_LAYOUT_STATUS,
  REPORT_TIER_LABEL,
  REPORT_TIERS,
  legacyStatusOf,
} from '@aurora/domain';
import { reportsGenerate } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { PermissionsCheckedInHandler, RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import { gerarPdf, type LinhaPdf } from '../documents/pdf';
import type { AuroraRequest } from '../common/context.middleware';
import { CHAVES_IMR_COM_NUMERO, montarCompleto, montarImr } from './relatorio-oficial';

const SUFIXO: Record<string, string> = { percent: ' %', minutes: ' min', hours: ' h', score: ' de 5' };

function numero(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatar(sec: ReportSection): string {
  if (sec.value === null) return 'Sem dados suficientes no período';
  return `${numero(sec.value)}${SUFIXO[sec.unit] ?? ''}`;
}

function formatarMeta(sec: ReportSection): string | null {
  if (sec.direction === 'INFORMATIONAL') return null;
  if (!sec.target) return NO_TARGET_LABEL;
  const sinal = sec.target.direction === 'HIGHER_IS_BETTER' ? '≥' : '≤';
  const resultado =
    sec.target_evaluation === 'met'
      ? ' — cumprida'
      : sec.target_evaluation === 'not_met'
        ? ' — não cumprida'
        : '';
  return `Meta ${sinal} ${numero(sec.target.value)}${SUFIXO[sec.target.unit] ?? ''}${resultado}`;
}

@Controller('reports')
export class ReportsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('catalog')
  @RequirePermissions('insight.read')
  catalog(): unknown {
    return {
      tiers: REPORT_TIERS.map((t) => ({ key: t, label: REPORT_TIER_LABEL[t] })),
      indicators: REPORT_INDICATORS.map((i) => ({
        key: i.key,
        label: i.label,
        description: i.description,
        unit: i.unit,
        category: i.category,
        tiers: i.tiers,
        state: i.state,
        target_direction: i.targetDirection,
        source: i.source,
        ...(i.pendingKind ? { pending_kind: i.pendingKind } : {}),
        ...(i.note ? { note: i.note } : {}),
        status: legacyStatusOf(i.state),
      })),
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
  @PermissionsCheckedInHandler('rota de LEITURA: POST só porque os filtros vão no corpo; nada é gravado')
  async generate(
    @Req() req: AuroraRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @Query('format') format?: string
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    const b = parseWith(reportsGenerate.body, body);
    const pdf = format === 'pdf';
    const geradoEm = new Date();

    // Advanced em PDF: modelo oficial do Completo, com a série de 12 meses de cada indicador.
    if (pdf && b.tier === 'advanced') {
      const { r, serie, organizacao } = await withTenant(this.db, ctx, async (s) => {
        const r = await buildReport(s, ctx.membershipId, b);
        const serie = await buildReportSeries(
          s,
          ctx.membershipId,
          b,
          r.sections.filter((x) => x.unit !== 'none').map((x) => x.key)
        );
        return { r, serie, organizacao: await organizationName(s) };
      });
      const { linhas, rodape } = montarCompleto({
        organizacao,
        cliente: r.filters.customer ?? null,
        centroDeCusto: b.cost_center || null,
        cidade: b.city || null,
        contrato: r.filters.contract ?? null,
        setor: r.filters.sector ?? null,
        de: r.filters.from!,
        ate: r.filters.to!,
        fuso: r.filters.timezone ?? DEFAULT_ORGANIZATION_TIMEZONE,
        geradoEm,
        secoes: r.sections,
        serie,
        assinaturas: b.signatories?.map((x) => ({ nome: x.name, cargo: x.role })) ?? null,
      });
      return this.enviarPdf(
        res,
        'advanced',
        gerarPdf(linhas, { titulo: 'Relatório Completo', autor: organizacao, rodape })
      );
    }

    // Expert em PDF: a casca do IMR. Só entram os itens que têm número; o resto fica "aguardando".
    if (pdf && b.tier === 'expert') {
      const { r, organizacao } = await withTenant(this.db, ctx, async (s) => ({
        r: await buildReport(s, ctx.membershipId, { ...b, indicators: CHAVES_IMR_COM_NUMERO }),
        organizacao: await organizationName(s),
      }));
      const { linhas, rodape } = montarImr({
        organizacao,
        cliente: r.filters.customer ?? null,
        de: r.filters.from!,
        ate: r.filters.to!,
        fuso: r.filters.timezone ?? DEFAULT_ORGANIZATION_TIMEZONE,
        geradoEm,
        secoes: r.sections,
      });
      return this.enviarPdf(
        res,
        'expert',
        gerarPdf(linhas, {
          titulo: 'Instrumento de Medição de Resultados (IMR)',
          autor: organizacao,
          rodape,
          faixa: 'IMR — DESCONTO E GLOSA NÃO CALCULADOS (REGRA DO CLIENTE PENDENTE)',
        })
      );
    }

    const r = await withTenant(this.db, ctx, (s) => buildReport(s, ctx.membershipId, b));
    if (!pdf) {
      return {
        tier: b.tier,
        generated_at: geradoEm.toISOString(),
        layout_status: REPORT_LAYOUT_STATUS,
        ...r,
      };
    }
    // Basic: o PDF segue provisório até o cliente mandar o modelo oficial.
    // Datas e hora no fuso da ORGANIZAÇÃO (PF-51): o servidor roda em UTC, e o
    // fim do dia 31/10 em Brasília (02:59 UTC de 01/11) saía impresso como 01/11.
    const fuso = { timeZone: r.filters.timezone ?? DEFAULT_ORGANIZATION_TIMEZONE };
    const linhas: LinhaPdf[] = [
      { texto: `Relatório ${REPORT_TIER_LABEL[b.tier]}`, titulo: true },
      {
        texto:
          `Período: ${new Date(r.filters.from!).toLocaleDateString('pt-BR', fuso)} a ${new Date(r.filters.to!).toLocaleDateString('pt-BR', fuso)}` +
          (r.filters.customer ? ` · Cliente: ${r.filters.customer}` : '') +
          (r.filters.contract ? ` · Contrato: ${r.filters.contract}` : '') +
          (r.filters.sector ? ` · Setor: ${r.filters.sector}` : ''),
      },
      {
        texto: `Gerado em ${geradoEm.toLocaleString('pt-BR', fuso)}. Layout provisório — ${AGUARDANDO_MODELO}.`,
        tamanho: 8,
      },
    ];
    for (const sec of r.sections) {
      linhas.push({
        texto: sec.state === 'PROVISIONAL' ? `${sec.label} (PROVISÓRIO)` : sec.label,
        negrito: true,
        espacoAntes: 8,
      });
      linhas.push({ texto: formatar(sec), recuo: 12 });
      const meta = formatarMeta(sec);
      if (meta) linhas.push({ texto: meta, recuo: 12, tamanho: 8 });
      if (sec.samples !== null) linhas.push({ texto: `Base: ${sec.samples}`, recuo: 12, tamanho: 8 });
      if (sec.definition) linhas.push({ texto: `Definição: ${sec.definition}`, recuo: 12, tamanho: 8 });
      if (sec.state === 'PROVISIONAL' && sec.note) linhas.push({ texto: sec.note, recuo: 12, tamanho: 8 });
    }
    return this.enviarPdf(
      res,
      b.tier,
      gerarPdf(linhas, {
        titulo: `Relatório ${REPORT_TIER_LABEL[b.tier]}`,
        autor: 'Téchne Care',
        rodape: `Relatório ${REPORT_TIER_LABEL[b.tier]} — provisório`,
        faixa: AGUARDANDO_MODELO,
      })
    );
  }

  private enviarPdf(res: Response, tier: string, pdf: Buffer): StreamableFile {
    res.status(200);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="relatorio-${tier}.pdf"`);
    res.setHeader('cache-control', 'no-store');
    return new StreamableFile(pdf);
  }
}
