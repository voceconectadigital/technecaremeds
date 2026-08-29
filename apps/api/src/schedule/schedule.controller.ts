/**
 * Aurora — agenda pela HTTP (SPEC v0.2 §13 · EPIC-012).
 *
 * A rota que carrega o épico é `POST /schedule/check`: ela confere sem gravar,
 * para a tela mostrar os avisos ENQUANTO a pessoa arrasta o cartão. Descobrir o
 * conflito só depois de soltar é o que faz programar custar mais que ligar para
 * o técnico — e é por isso que a agenda da referência tem 2.950 serviços não
 * programados.
 *
 * É POST, e não GET, porque a proposta é um corpo com três campos e uma janela
 * de datas; espremer isso em query string daria URLs que o navegador registra
 * no histórico e que estouram em lote.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  checkSchedule,
  scheduleWorkOrder,
  unscheduleWorkOrder,
  createAvailabilityBlock,
  agenda,
  resourceBoard,
  buckets,
  type Database,
} from '@aurora/db';
import {
  isUuid,
  ValidationError,
  BLOCK_KINDS,
  BUCKET_LABELS,
  SCHEDULE_BUCKETS,
  type BlockKind,
} from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

const UUID_ROUTE = '[0-9a-fA-F-]{36}';

function uuidParam(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new ValidationError(`${field} deve ser um identificador válido`, { field });
  }
  return value;
}

/**
 * Converte um instante recebido do cliente.
 *
 * `new Date('qualquer coisa')` devolve `Invalid Date` sem reclamar, e uma data
 * inválida que entra no domínio vira `NaN` em toda comparação — a OS seria
 * gravada com uma janela que nenhuma consulta encontra depois.
 */
function instant(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} deve ser uma data e hora ISO`, { field });
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${field} não é uma data e hora válida`, { field });
  }
  return d;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} deve ser um de: ${allowed.join(', ')}`, { field });
  }
  return value as T;
}

interface ProposalBody {
  workOrderId?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  assigneeMembershipId?: unknown;
}

function proposal(body: ProposalBody) {
  return {
    workOrderId: uuidParam(body.workOrderId, 'workOrderId'),
    startsAt: instant(body.startsAt, 'startsAt'),
    endsAt: instant(body.endsAt, 'endsAt'),
    assigneeMembershipId: body.assigneeMembershipId
      ? uuidParam(body.assigneeMembershipId, 'assigneeMembershipId')
      : null,
  };
}

@Controller('schedule')
export class ScheduleController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Confere sem gravar — a rota do arrasto. */
  @Post('check')
  @RequirePermissions('work_order.schedule')
  async check(@Req() req: AuroraRequest, @Body() body: ProposalBody): Promise<{ conflicts: unknown[] }> {
    const ctx = req.auroraContext!;
    const conflicts = await withTenant(this.db, ctx, (s) => checkSchedule(s, proposal(body)));
    return { conflicts };
  }

  @Post()
  @RequirePermissions('work_order.schedule')
  async schedule(@Req() req: AuroraRequest, @Body() body: ProposalBody): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => scheduleWorkOrder(s, proposal(body)));
  }

  @Post(`work-orders/:id(${UUID_ROUTE})/unschedule`)
  @RequirePermissions('work_order.schedule')
  async unschedule(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ unscheduled: true }> {
    const ctx = req.auroraContext!;
    await withTenant(this.db, ctx, (s) => unscheduleWorkOrder(s, uuidParam(id, 'id')));
    return { unscheduled: true };
  }

  /** Lente CALENDÁRIO. */
  @Get()
  @RequirePermissions('work_order.read')
  async calendar(
    @Req() req: AuroraRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('membershipId') membershipId?: string,
    @Query('teamId') teamId?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const inicio = instant(from, 'from');
    const fim = instant(to, 'to');
    if (fim.getTime() <= inicio.getTime()) {
      throw new ValidationError('"to" precisa ser depois de "from"', { field: 'to' });
    }
    // Um intervalo aberto demais devolveria a agenda inteira da organização
    // numa resposta só. O limite é do tamanho de uma visão de mês com folga —
    // que é a maior lente que a tela oferece.
    if (fim.getTime() - inicio.getTime() > 62 * 86_400_000) {
      throw new ValidationError('o intervalo da agenda é de no máximo 62 dias', { field: 'to' });
    }

    const items = await withTenant(this.db, ctx, (s) =>
      agenda(s, {
        from: inicio,
        to: fim,
        membershipId: membershipId ? uuidParam(membershipId, 'membershipId') : null,
        teamId: teamId ? uuidParam(teamId, 'teamId') : null,
      })
    );
    return { items };
  }

  /** Lente RECURSOS. */
  @Get('resources')
  @RequirePermissions('work_order.read')
  async resources(
    @Req() req: AuroraRequest,
    @Query('day') day?: string,
    @Query('teamId') teamId?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) =>
      resourceBoard(s, instant(day, 'day'), teamId ? uuidParam(teamId, 'teamId') : null)
    );
    return { items };
  }

  /** Lente LISTA: os três baldes do painel lateral. */
  @Get('buckets')
  @RequirePermissions('work_order.read')
  async sidePanel(@Req() req: AuroraRequest): Promise<{
    labels: Record<string, string>;
    counts: Record<string, number>;
    items: unknown[];
  }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) => buckets(s));

    // Os contadores vêm prontos: o painel mostra o número em cada balde antes
    // de qualquer rolagem, e fazer a tela contar significaria carregar a lista
    // inteira só para exibir três números.
    const counts = Object.fromEntries(
      SCHEDULE_BUCKETS.map((b) => [b, items.filter((i) => i.bucket === b).length])
    );

    return { labels: BUCKET_LABELS, counts, items };
  }

  /**
   * Registrar ausência é operação de AGENDA, não de gestão de pessoas.
   *
   * `team.manage` — quem entra e quem sai da equipe — é do gestor. Férias e
   * afastamento são o insumo de que a programação depende, e quem programa é o
   * coordenador. Exigir aqui uma permissão que o coordenador não tem garantiria
   * agenda marcada por cima de férias, que é exatamente a falha que este épico
   * existe para impedir.
   */
  @Post('absences')
  @RequirePermissions('work_order.schedule')
  async absence(
    @Req() req: AuroraRequest,
    @Body()
    body: { membershipId?: unknown; kind?: unknown; startsAt?: unknown; endsAt?: unknown; note?: unknown }
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const id = await withTenant(this.db, ctx, (s) =>
      createAvailabilityBlock(s, {
        membershipId: uuidParam(body.membershipId, 'membershipId'),
        kind: oneOf<BlockKind>(body.kind, BLOCK_KINDS, 'kind'),
        startsAt: instant(body.startsAt, 'startsAt'),
        endsAt: instant(body.endsAt, 'endsAt'),
        note: typeof body.note === 'string' ? body.note : null,
      })
    );
    return { id };
  }
}
