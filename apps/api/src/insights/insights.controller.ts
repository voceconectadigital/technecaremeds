/**
 * Aurora — indicadores pela HTTP (SPEC v0.2 §25 · EPIC-021).
 *
 * Uma rota por indicador, e não uma rota genérica com `?metric=`. A diferença
 * importa por duas razões: cada indicador tem os seus filtros próprios (o SLA
 * recorta por alvo, a produtividade por pessoa), e a permissão financeira
 * precisa cair sobre alguns e não sobre outros — coisa impossível numa rota só.
 *
 * Toda resposta traz a definição do indicador junto com o número. É o §25 em
 * forma de contrato de API: um cliente da API não consegue exibir o número sem
 * ter recebido como ele foi calculado.
 */
import { Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  workOrdersOpened,
  workOrdersCompleted,
  backlog,
  mttr,
  mtbf,
  slaCompliance,
  timeByStatus,
  timeByWaitReason,
  preventiveVsCorrective,
  planCompliance,
  workOrderRating,
  productivity,
  laborHours,
  firstResponseTime,
  rebuildFacts,
  membershipScope,
  assertCustomerInScope,
  scopedFilters,
  granularityFor,
  workOrderSeries,
  openWorkOrdersSnapshot,
  parkSnapshot,
  planBoard,
  panelTargets,
  type MetricFilters,
  type MembershipScope,
  type TenantSession,
  type Database,
} from '@aurora/db';
import { METRIC_DEFINITIONS, NotFoundError, ValidationError, isUuid } from '@aurora/domain';
import { insightControlPanel } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

/** Um ano é o maior recorte que um painel oferece; acima disso é exportação. */
const MAX_PERIOD_DAYS = 400;

function instant(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} deve ser uma data ISO`, { field });
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${field} não é uma data válida`, { field });
  }
  return d;
}

function uuidOrNull(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new ValidationError(`${field} deve ser um identificador válido`, { field });
  }
  return value;
}

interface RawQuery {
  from?: string;
  to?: string;
  customerId?: string;
  locationPath?: string;
  assetCategoryId?: string;
  teamId?: string;
  membershipId?: string;
}

function period(q: RawQuery): { from: Date; to: Date } {
  const from = instant(q.from, 'from');
  const to = instant(q.to, 'to');
  if (to.getTime() <= from.getTime()) {
    throw new ValidationError('"to" precisa ser depois de "from"', { field: 'to' });
  }
  if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * 86_400_000) {
    throw new ValidationError(`o período de um indicador é de no máximo ${MAX_PERIOD_DAYS} dias`, {
      field: 'to',
    });
  }
  return { from, to };
}

function filters(q: RawQuery): MetricFilters {
  return {
    customerId: uuidOrNull(q.customerId, 'customerId'),
    // O caminho é texto materializado, não uuid: o filtro é por prefixo de
    // subárvore, e é assim que "tudo abaixo da UTI" cabe num parâmetro só.
    locationPath: typeof q.locationPath === 'string' && q.locationPath ? q.locationPath : null,
    assetCategoryId: uuidOrNull(q.assetCategoryId, 'assetCategoryId'),
    teamId: uuidOrNull(q.teamId, 'teamId'),
    membershipId: uuidOrNull(q.membershipId, 'membershipId'),
  };
}

/**
 * Os filtros da requisição ESTREITADOS pelo escopo do vínculo.
 *
 * Antes desta rodada, as rotas de indicador agregavam a organização inteira
 * para qualquer vínculo com `insight.read` — um usuário restrito a um hospital
 * via o MTTR de todos. Agora a borda é a de `membership_scopes`, e um
 * `customerId` fora dela responde 404.
 */
async function escopado(s: TenantSession, req: AuroraRequest, q: RawQuery): Promise<MetricFilters> {
  const escopo: MembershipScope = await membershipScope(s, req.auroraContext!.membershipId);
  const f = filters(q);
  await assertCustomerInScope(s, escopo, f.customerId);
  return scopedFilters(escopo, f);
}

@Controller('insights')
export class InsightsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * O catálogo das definições, sem consultar nada.
   *
   * Existe para a interface montar os textos de ajuda sem precisar buscar um
   * número antes. O §25 exige que cada métrica exiba sua definição; esta rota é
   * o que permite fazer isso na tela de configuração do painel, onde ainda não
   * há período escolhido.
   */
  @Get('definitions')
  @RequirePermissions('insight.read')
  definitions(): { items: unknown[] } {
    return { items: Object.values(METRIC_DEFINITIONS) };
  }

  @Get('work-orders/opened')
  @RequirePermissions('insight.read')
  async opened(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => workOrdersOpened(s, period(q), await escopado(s, req, q)));
  }

  @Get('work-orders/completed')
  @RequirePermissions('insight.read')
  async completed(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) =>
      workOrdersCompleted(s, period(q), await escopado(s, req, q))
    );
  }

  @Get('backlog')
  @RequirePermissions('insight.read')
  async backlog(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    const asOf = q.to ? instant(q.to, 'to') : new Date();
    return withTenant(this.db, ctx, async (s) => backlog(s, asOf, await escopado(s, req, q)));
  }

  @Get('mttr')
  @RequirePermissions('insight.read')
  async mttr(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => mttr(s, period(q), await escopado(s, req, q)));
  }

  @Get('mtbf')
  @RequirePermissions('insight.read')
  async mtbf(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => mtbf(s, period(q), await escopado(s, req, q)));
  }

  @Get('sla')
  @RequirePermissions('insight.read')
  async sla(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => slaCompliance(s, period(q), await escopado(s, req, q)));
  }

  @Get('time-by-status')
  @RequirePermissions('insight.read')
  async byStatus(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => timeByStatus(s, period(q), await escopado(s, req, q)));
  }

  @Get('time-by-wait-reason')
  @RequirePermissions('insight.read')
  async byWaitReason(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => timeByWaitReason(s, period(q), await escopado(s, req, q)));
  }

  @Get('preventive-vs-corrective')
  @RequirePermissions('insight.read')
  async mix(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) =>
      preventiveVsCorrective(s, period(q), await escopado(s, req, q))
    );
  }

  @Get('plan-compliance')
  @RequirePermissions('insight.read')
  async plans(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => planCompliance(s, period(q), await escopado(s, req, q)));
  }

  /**
   * Produtividade por pessoa.
   *
   * Exige `insight.read_people_metrics`? Não: exige `insight.read` como as
   * demais, porque a lista de OS concluídas por técnico já é visível na própria
   * fila. Esconder o agregado de quem enxerga as linhas seria teatro de
   * privacidade — o que a permissão financeira protege é dinheiro, e dinheiro
   * não entra aqui.
   */
  @Get('productivity')
  @RequirePermissions('insight.read')
  async productivity(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => productivity(s, period(q), await escopado(s, req, q)));
  }

  @Get('labor-hours')
  @RequirePermissions('insight.read')
  async hours(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => laborHours(s, period(q), await escopado(s, req, q)));
  }

  @Get('first-response')
  @RequirePermissions('insight.read')
  async firstResponse(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => firstResponseTime(s, period(q), await escopado(s, req, q)));
  }

  /**
   * O Painel de Controle numa resposta só (também alimenta o Modo Exibição).
   *
   * Cada número é a função de sempre, com o mesmo filtro escopado; a série é a
   * mesma definição por fatia. Uma consulta por bloco, numa transação só — a
   * televisão que se atualiza a cada minuto faz UMA ida ao servidor.
   */
  @Get('control-panel')
  @RequirePermissions('insight.read')
  async controlPanel(@Req() req: AuroraRequest, @Query() query: unknown): Promise<unknown> {
    const ctx = req.auroraContext!;
    const q = parseWith(insightControlPanel.query, query);
    const p = period(q);
    return withTenant(this.db, ctx, async (s) => {
      const escopo = await membershipScope(s, ctx.membershipId);
      await assertCustomerInScope(s, escopo, q.customerId);

      const clientes = await s.query<{ id: string; name: string }>(
        `SELECT id, name FROM aurora.customers
          WHERE deleted_at IS NULL AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
          ORDER BY name`,
        [escopo.customerIds]
      );
      const setores = await s.query<{ id: string; name: string; customer_id: string; path: string }>(
        `SELECT l.id, l.name, l.customer_id, l.path
           FROM aurora.locations l
           JOIN aurora.location_types t ON t.id = l.location_type_id AND t.key = 'setor'
          WHERE l.deleted_at IS NULL
            AND ($1::uuid[] IS NULL OR l.customer_id = ANY($1::uuid[]))
            AND ($2::text[] IS NULL OR EXISTS (SELECT 1 FROM unnest($2::text[]) sp(p) WHERE l.path LIKE sp.p || '%'))
            AND ($3::uuid IS NULL OR l.customer_id = $3)
          ORDER BY l.name`,
        [escopo.customerIds, escopo.locationPaths, q.customerId ?? null]
      );

      let locationPath: string | null = null;
      if (q.sectorId) {
        const setor = setores.find((x) => x.id === q.sectorId);
        if (!setor) throw new NotFoundError('setor', q.sectorId);
        locationPath = setor.path;
      }
      const f = scopedFilters(escopo, { customerId: q.customerId ?? null, locationPath });

      const [opened, completed, bl, mt, mb, sl, mx, pc, pr] = [
        await workOrdersOpened(s, p, f),
        await workOrdersCompleted(s, p, f),
        await backlog(s, p.to.getTime() > Date.now() ? new Date() : p.to, f),
        await mttr(s, p, f),
        await mtbf(s, p, f),
        await slaCompliance(s, p, f),
        await preventiveVsCorrective(s, p, f),
        await planCompliance(s, p, f),
        await productivity(s, p, f),
      ];
      // Avaliação das OS (REL-14): a MESMA função do relatório, no mesmo recorte.
      const avaliacao = await workOrderRating(s, p, f);
      const granularity = granularityFor(p);
      return {
        generated_at: new Date().toISOString(),
        granularity,
        customers: clientes,
        sectors: setores.map(({ id, name, customer_id }) => ({ id, name, customer_id })),
        kpis: {
          opened,
          completed,
          backlog: bl,
          mttr: mt,
          mtbf: mb,
          sla: sl,
          mix: mx,
          plan_compliance: pc,
          productivity: pr,
          work_order_rating: avaliacao,
        },
        series: await workOrderSeries(s, p, granularity, f),
        preventives: await (async () => {
          const b = await planBoard(
            s,
            { from: p.from, to: p.to, customerId: q.customerId ?? null, sectorId: q.sectorId ?? null },
            escopo
          );
          return { totals: b.totals, rate: b.rate, byMonth: b.byMonth };
        })(),
        open_now: await openWorkOrdersSnapshot(s, f),
        park: await parkSnapshot(s, f),
        // As metas configuradas que valem neste recorte: a cor do Painel é a da
        // meta, e não um limiar fixo (pente-fino 17/10/2026, PF-55).
        targets: await panelTargets(s, escopo, { customerId: q.customerId ?? null, to: p.to }),
      };
    });
  }

  /**
   * Reconstrói a projeção da organização.
   *
   * Toda projeção precisa de um caminho de volta, e este é o dele. É POST e
   * pede permissão de administração porque varre e reescreve a tabela inteira.
   */
  @Post('facts/rebuild')
  @RequirePermissions('organization.manage_catalogs')
  async rebuild(@Req() req: AuroraRequest): Promise<{ rebuilt: number }> {
    const ctx = req.auroraContext!;
    const rebuilt = await withTenant(this.db, ctx, (s) => rebuildFacts(s));
    return { rebuilt };
  }
}
