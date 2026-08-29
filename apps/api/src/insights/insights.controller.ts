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
  productivity,
  laborHours,
  firstResponseTime,
  rebuildFacts,
  type MetricFilters,
  type Database,
} from '@aurora/db';
import { isUuid, ValidationError, METRIC_DEFINITIONS } from '@aurora/domain';
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
    return withTenant(this.db, ctx, (s) => workOrdersOpened(s, period(q), filters(q)));
  }

  @Get('work-orders/completed')
  @RequirePermissions('insight.read')
  async completed(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => workOrdersCompleted(s, period(q), filters(q)));
  }

  @Get('backlog')
  @RequirePermissions('insight.read')
  async backlog(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    const asOf = q.to ? instant(q.to, 'to') : new Date();
    return withTenant(this.db, ctx, (s) => backlog(s, asOf, filters(q)));
  }

  @Get('mttr')
  @RequirePermissions('insight.read')
  async mttr(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => mttr(s, period(q), filters(q)));
  }

  @Get('mtbf')
  @RequirePermissions('insight.read')
  async mtbf(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => mtbf(s, period(q), filters(q)));
  }

  @Get('sla')
  @RequirePermissions('insight.read')
  async sla(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => slaCompliance(s, period(q), filters(q)));
  }

  @Get('time-by-status')
  @RequirePermissions('insight.read')
  async byStatus(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => timeByStatus(s, period(q)));
  }

  @Get('time-by-wait-reason')
  @RequirePermissions('insight.read')
  async byWaitReason(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => timeByWaitReason(s, period(q)));
  }

  @Get('preventive-vs-corrective')
  @RequirePermissions('insight.read')
  async mix(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => preventiveVsCorrective(s, period(q), filters(q)));
  }

  @Get('plan-compliance')
  @RequirePermissions('insight.read')
  async plans(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => planCompliance(s, period(q)));
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
    return withTenant(this.db, ctx, (s) => productivity(s, period(q), filters(q)));
  }

  @Get('labor-hours')
  @RequirePermissions('insight.read')
  async hours(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => laborHours(s, period(q), filters(q)));
  }

  @Get('first-response')
  @RequirePermissions('insight.read')
  async firstResponse(@Req() req: AuroraRequest, @Query() q: RawQuery): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => firstResponseTime(s, period(q), filters(q)));
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
