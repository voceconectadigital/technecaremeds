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
import { withTenant, buildReport, type ReportSection, type Database } from '@aurora/db';
import {
  AGUARDANDO_MODELO,
  REPORT_INDICATORS,
  REPORT_LAYOUT_STATUS,
  REPORT_TIER_LABEL,
  REPORT_TIERS,
} from '@aurora/domain';
import { reportsGenerate } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import { gerarPdf, type LinhaPdf } from '../documents/pdf';
import type { AuroraRequest } from '../common/context.middleware';

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
