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
 * `indicator_targets` ou diz SEM META CONFIGURADA. O PDF é provisório e diz
 * isso em toda página: o layout oficial vem dos PDFs que o cliente vai enviar.
 */
import { Body, Controller, Get, Inject, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { withTenant, buildReport, type ReportSection, type Database } from '@aurora/db';
import {
  AGUARDANDO_MODELO,
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
    const r = await withTenant(this.db, ctx, (s) => buildReport(s, ctx.membershipId, b));
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
          (r.filters.contract ? ` · Contrato: ${r.filters.contract}` : '') +
          (r.filters.sector ? ` · Setor: ${r.filters.sector}` : ''),
      },
      {
        texto: `Gerado em ${new Date(geradoEm).toLocaleString('pt-BR')}. Layout provisório — ${AGUARDANDO_MODELO}.`,
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
