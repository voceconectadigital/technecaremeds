/**
 * Aurora — "Gerar relatório" do Painel: modelos BASIC, ADVANCED e EXPERT
 * (reunião 16/10/2026, Fase 9; Fase 1 de indicadores, 17/10/2026), e o relatório
 * PATRIMONIAL (REL-11, 29/10/2026).
 *
 * O catálogo de indicadores (`@aurora/domain`) é a fonte única da definição;
 * cada seção é a função de indicador que o Painel já usa, com o MESMO filtro
 * escopado pelo vínculo — então o número do relatório é o número do Painel.
 *
 * Indicador PENDING_DEFINITION não entra em relatório: fica só no catálogo e na
 * lista `pending`. PROVISIONAL sai marcado. A meta de cada seção vem de
 * `indicator_targets` ou diz SEM META CONFIGURADA.
 *
 * TRÊS SAÍDAS, UM NÚMERO (REL-10, 29/10/2026)
 *
 * JSON (a tela), `?format=pdf` e `?format=xlsx` saem da MESMA chamada a `buildReport`, com a
 * mesma permissão e o mesmo escopo. O PDF Advanced segue o modelo do cliente, o Basic o mesmo
 * padrão visual (painel de cartões + gráficos), e o Expert é a casca do IMR
 * (`relatorio-oficial.ts`). A planilha está em `relatorio-planilha.ts`.
 */
import { Body, Controller, Get, Inject, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  withTenant,
  buildAssetReport,
  buildReport,
  buildReportSeries,
  organizationName,
  organizationTimezone,
  type Database,
  assertNivelDeRelatorioContratado,
  clienteDoRecorte,
  membershipScope,
} from '@aurora/db';
import {
  DEFAULT_ORGANIZATION_TIMEZONE,
  ForbiddenError,
  REPORT_INDICATORS,
  REPORT_LAYOUT_STATUS,
  REPORT_TIER_LABEL,
  REPORT_TIERS,
  SERVICE_REQUEST_TYPES,
  ValidationError,
  formulaInfo,
  legacyStatusOf,
} from '@aurora/domain';
import { reportsAssets, reportsGenerate } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { PermissionsCheckedInHandler, RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import { gerarPdf } from '../documents/pdf';
import { XLSX_CONTENT_TYPE, gerarXlsx } from '../documents/xlsx';
import type { AuroraRequest } from '../common/context.middleware';
import { CHAVES_IMR_COM_NUMERO, montarBasic, montarCompleto, montarImr } from './relatorio-oficial';
import { abasDoRelatorio } from './relatorio-planilha';
import { abasDoPatrimonial, montarPatrimonial } from './relatorio-patrimonial';

type Formato = 'json' | 'pdf' | 'xlsx';

function formatoDe(v: string | undefined): Formato {
  if (v === undefined || v === '' || v === 'json') return 'json';
  if (v === 'pdf' || v === 'xlsx') return v;
  throw new ValidationError('formato inválido: use pdf ou xlsx (ou nenhum, para JSON)', { field: 'format' });
}

/** Na tela, o patrimonial mostra as primeiras linhas; PDF e Excel trazem o recorte inteiro. */
const MAX_ITENS_NA_TELA = 500;

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
        ...(() => {
          const fi = formulaInfo(i);
          return { formula_version: fi.version, formula_defined_on: fi.definedOn, formula_source: fi.source };
        })(),
      })),
      layout_status: REPORT_LAYOUT_STATUS,
      layout_note:
        'Advanced segue o modelo do cliente (gráfico de 12 meses e assinaturas); Basic usa o mesmo padrão ' +
        'visual; Expert é a casca do IMR. Exportação em PDF e em Excel (.xlsx).',
    };
  }

  /**
   * Opções dos filtros do gerador (REL-03): setores no escopo do vínculo (a mesma consulta do
   * Painel), os sete tipos de manutenção e as famílias/tipos de equipamento.
   */
  @Get('options')
  @RequirePermissions('insight.read')
  async options(@Req() req: AuroraRequest): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => {
      const escopo = await membershipScope(s, ctx.membershipId);
      const setores = await s.query<{ id: string; name: string; customer_id: string }>(
        `SELECT l.id, l.name, l.customer_id
           FROM aurora.locations l
           JOIN aurora.location_types t ON t.id = l.location_type_id AND t.key = 'setor'
          WHERE l.deleted_at IS NULL
            AND ($1::uuid[] IS NULL OR l.customer_id = ANY($1::uuid[]))
            AND ($2::text[] IS NULL OR EXISTS (SELECT 1 FROM unnest($2::text[]) sp(p) WHERE l.path LIKE sp.p || '%'))
          ORDER BY l.name`,
        [escopo.customerIds, escopo.locationPaths]
      );
      const categorias = await s.query<{
        id: string;
        name: string;
        parent_id: string | null;
        family_key: string | null;
      }>(
        `SELECT id, name, parent_id, family_key FROM aurora.asset_categories
          WHERE archived_at IS NULL ORDER BY family_key IS NULL, name`
      );
      return {
        sectors: setores,
        work_order_types: SERVICE_REQUEST_TYPES.map((t) => ({ key: t.key, label: t.label })),
        asset_categories: categorias,
      };
    });
  }

  /**
   * Gera o relatório. `?format=pdf` devolve o PDF; `?format=xlsx`, a planilha; sem isso, JSON.
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
    const formato = formatoDe(format);
    const geradoEm = new Date();

    // O nível contratado pelo cliente é TETO (REL-13, 0085): vale para JSON, PDF e Excel. O cliente
    // é o escolhido, ou o do contrato, ou o do setor — escolher só o setor não pula a trava.
    await withTenant(this.db, ctx, async (s) =>
      assertNivelDeRelatorioContratado(s, ctx.membershipId, await clienteDoRecorte(s, b), b.tier)
    );

    // Expert em PDF: a casca do IMR. Só entram os itens que têm número; o resto fica "aguardando".
    if (formato === 'pdf' && b.tier === 'expert') {
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
      return this.enviar(
        res,
        'application/pdf',
        'relatorio-expert.pdf',
        gerarPdf(linhas, {
          titulo: 'Relatório Expert — Instrumento de Medição de Resultados (IMR)',
          autor: organizacao,
          rodape,
          faixa: 'IMR — DESCONTO E GLOSA NÃO CALCULADOS (REGRA DO CLIENTE PENDENTE)',
        })
      );
    }

    if (formato === 'json') {
      const r = await withTenant(this.db, ctx, (s) => buildReport(s, ctx.membershipId, b));
      return {
        tier: b.tier,
        generated_at: geradoEm.toISOString(),
        layout_status: REPORT_LAYOUT_STATUS,
        ...r,
      };
    }

    // PDF Basic/Advanced e Excel de qualquer nível: o relatório e, fora do Expert, a série de 12
    // meses de cada indicador com número (é o gráfico do PDF e a aba "Série mensal" da planilha).
    const { r, serie, organizacao } = await withTenant(this.db, ctx, async (s) => {
      const r = await buildReport(s, ctx.membershipId, b);
      const serie =
        b.tier === 'expert'
          ? null
          : await buildReportSeries(
              s,
              ctx.membershipId,
              b,
              r.sections.filter((x) => x.unit !== 'none').map((x) => x.key)
            );
      return { r, serie, organizacao: await organizationName(s) };
    });
    const fuso = r.filters.timezone ?? DEFAULT_ORGANIZATION_TIMEZONE;

    if (formato === 'xlsx') {
      return this.enviar(
        res,
        XLSX_CONTENT_TYPE,
        `relatorio-${b.tier}.xlsx`,
        gerarXlsx(
          abasDoRelatorio({
            tier: b.tier,
            organizacao,
            filtros: r.filters,
            secoes: r.sections,
            pendentes: r.pending,
            serie,
            geradoEm,
            fuso,
          })
        )
      );
    }

    const dados = {
      organizacao,
      cliente: r.filters.customer ?? null,
      centroDeCusto: b.cost_center || null,
      cidade: b.city || null,
      contrato: r.filters.contract ?? null,
      setor: r.filters.sector ?? null,
      de: r.filters.from!,
      ate: r.filters.to!,
      fuso,
      geradoEm,
      secoes: r.sections,
      serie,
      assinaturas: b.signatories?.map((x) => ({ nome: x.name, cargo: x.role })) ?? null,
    };
    const { linhas, rodape } =
      b.tier === 'advanced' ? montarCompleto(dados) : montarBasic({ ...dados, pendentes: r.pending });
    return this.enviar(
      res,
      'application/pdf',
      `relatorio-${b.tier}.pdf`,
      gerarPdf(linhas, { titulo: `Relatório ${REPORT_TIER_LABEL[b.tier]}`, autor: organizacao, rodape })
    );
  }

  /**
   * Relatório PATRIMONIAL (REL-11): ativos, em manutenção e obsoletos, com depreciação. JSON,
   * `?format=pdf` ou `?format=xlsx`. O valor do bem só aparece com `asset.read_financials` —
   * a mesma regra da ficha do ativo, aplicada na consulta.
   */
  @Post('assets')
  @RequirePermissions('insight.read', 'asset.read')
  @PermissionsCheckedInHandler(
    'rota de LEITURA: POST só porque os filtros vão no corpo; nada é gravado. Valores financeiros só com asset.read_financials'
  )
  async assets(
    @Req() req: AuroraRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @Query('format') format?: string
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    if (!ctx.membershipId) throw new ForbiddenError('esta rota exige um vínculo com a organização');
    const membershipId = ctx.membershipId;
    const b = parseWith(reportsAssets.body, body ?? {});
    const formato = formatoDe(format);
    const geradoEm = new Date();
    const financials = ctx.permissions.has('asset.read_financials');

    const { relatorio, organizacao, fuso } = await withTenant(this.db, ctx, async (s) => ({
      relatorio: await buildAssetReport(s, membershipId, b, { financials, now: geradoEm }),
      organizacao: await organizationName(s),
      fuso: await organizationTimezone(s),
    }));

    if (formato === 'json') {
      return {
        generated_at: geradoEm.toISOString(),
        ...relatorio,
        items_truncated: relatorio.items.length > MAX_ITENS_NA_TELA,
        items: relatorio.items.slice(0, MAX_ITENS_NA_TELA),
      };
    }
    const dados = { organizacao, relatorio, geradoEm, fuso };
    if (formato === 'xlsx') {
      return this.enviar(
        res,
        XLSX_CONTENT_TYPE,
        'relatorio-patrimonial.xlsx',
        gerarXlsx(abasDoPatrimonial(dados))
      );
    }
    const { linhas, rodape } = montarPatrimonial(dados);
    return this.enviar(
      res,
      'application/pdf',
      'relatorio-patrimonial.pdf',
      gerarPdf(linhas, { titulo: 'Relatório Patrimonial', autor: organizacao, rodape })
    );
  }

  private enviar(res: Response, tipo: string, arquivo: string, conteudo: Buffer): StreamableFile {
    res.status(200);
    res.setHeader('content-type', tipo);
    res.setHeader('content-disposition', `attachment; filename="${arquivo}"`);
    res.setHeader('cache-control', 'no-store');
    return new StreamableFile(conteudo);
  }
}
