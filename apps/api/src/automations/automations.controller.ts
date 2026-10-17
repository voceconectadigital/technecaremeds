/**
 * Aurora — automações pela HTTP (SPEC v0.2 §24 · EPIC-024).
 *
 * A rota de ativação NÃO aceita um atalho. Simular é obrigatório, e a API
 * recusa ativar sem simulação — não porque seja elegante, mas porque a regra
 * que inunda a caixa de entrada de toda a equipe é sempre a que alguém ligou
 * com pressa.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  createRule,
  simulateRule,
  activateRule,
  pauseRule,
  ruleRuns,
  listRules,
  runScheduledRuleNow,
  listAutomationTasks,
  advanceAutomationTask,
  getReportOutput,
  type Database,
} from '@aurora/db';
import {
  ValidationError,
  ACTIONS,
  OPERATORS,
  TRIGGER_KINDS,
  AUTOMATION_TEMPLATES,
  DEFAULT_AUTOMATION_TIMEZONE,
  REPORT_PERIODS,
  nextRuns,
  type ActionKind,
  type TriggerKind,
  type ConditionNode,
} from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

@Controller('automations')
export class AutomationsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * O vocabulário do motor.
   *
   * Ações, operadores e espécies de gatilho, para a tela de montagem oferecer
   * exatamente o que existe. Uma interface que oferece mais do que o motor faz
   * produz a regra que falha calada.
   */
  @Get('vocabulary')
  @RequirePermissions('automation.read')
  vocabulary(): Record<string, unknown> {
    return {
      actions: [...ACTIONS],
      operators: OPERATORS,
      triggers: TRIGGER_KINDS,
      templates: AUTOMATION_TEMPLATES,
      default_timezone: DEFAULT_AUTOMATION_TIMEZONE,
      // Relatório agendado: sem `periodo`, os últimos `periodDays` dias; `mes_anterior`
      // é o mês civil anterior no fuso da organização (PF-52).
      report_periods: REPORT_PERIODS,
      // Sem provedor de e-mail configurado: a entrega fica na fila (BLOQUEADO — INFRA).
      email_transport: 'not_configured',
    };
  }

  @Get()
  @RequirePermissions('automation.read')
  async list(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const itens = (await withTenant(this.db, ctx, (s) => listRules(s))) as Array<Record<string, unknown>>;
    const agora = new Date();
    return {
      items: itens.map((r) => ({
        ...r,
        next_run:
          r.state === 'active' && typeof r.trigger_cron === 'string'
            ? (nextRuns(r.trigger_cron, r.trigger_timezone as string | null, agora, 1)[0] ?? null)
            : null,
      })),
    };
  }

  @Post()
  @RequirePermissions('automation.create')
  async create(
    @Req() req: AuroraRequest,
    @Body()
    body: {
      name?: unknown;
      description?: unknown;
      triggerKind?: unknown;
      triggerEvent?: unknown;
      triggerCron?: unknown;
      triggerTimezone?: unknown;
      conditions?: unknown;
      priority?: unknown;
      rateMax?: unknown;
      rateWindowMinutes?: unknown;
      actions?: unknown;
    }
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;

    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      throw new ValidationError('a regra precisa de nome', { field: 'name' });
    }
    if (!Array.isArray(body.actions)) {
      throw new ValidationError('actions deve ser uma lista', { field: 'actions' });
    }

    const id = await withTenant(this.db, ctx, (s) =>
      createRule(s, {
        name: body.name as string,
        description: typeof body.description === 'string' ? body.description : null,
        triggerKind:
          typeof body.triggerKind === 'string' && TRIGGER_KINDS.includes(body.triggerKind as TriggerKind)
            ? (body.triggerKind as TriggerKind)
            : 'event',
        triggerEvent: typeof body.triggerEvent === 'string' ? body.triggerEvent : null,
        triggerCron: typeof body.triggerCron === 'string' ? body.triggerCron : null,
        triggerTimezone: typeof body.triggerTimezone === 'string' ? body.triggerTimezone : null,
        conditions: (body.conditions ?? null) as ConditionNode | null,
        priority: body.priority === undefined ? 100 : Number(body.priority),
        rateMax: body.rateMax === undefined ? 100 : Number(body.rateMax),
        rateWindowMinutes: body.rateWindowMinutes === undefined ? 60 : Number(body.rateWindowMinutes),
        actions: (body.actions as Array<{ kind: ActionKind; params: Record<string, unknown> }>).map((a) => ({
          kind: a?.kind,
          params: a?.params ?? {},
        })),
      })
    );
    return { id };
  }

  /** Simula contra o histórico, sem executar ação nenhuma. */
  @Post(':id/simulate')
  @RequirePermissions('automation.update')
  async simulate(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { days?: unknown }
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    const dias = body.days === undefined ? 30 : Number(body.days);
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
      throw new ValidationError('days deve ser um número de 1 a 365', { field: 'days' });
    }
    return withTenant(this.db, ctx, (s) => simulateRule(s, uuidParam(id, 'id'), dias));
  }

  @Post(':id/activate')
  @RequirePermissions('automation.update')
  async activate(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ state: string }> {
    const ctx = req.auroraContext!;
    await withTenant(this.db, ctx, (s) => activateRule(s, uuidParam(id, 'id')));
    return { state: 'active' };
  }

  /** Executa agora a regra AGENDADA — a passada do minuto corrente, uma vez só. */
  @Post(':id/run-now')
  @RequirePermissions('automation.run_now')
  async runNow(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    const r = await withTenant(this.db, ctx, (s) => runScheduledRuleNow(s, uuidParam(id, 'id')));
    return { executed: r !== null, outcome: r?.outcome ?? null, actions: r?.actionsRun ?? [] };
  }

  @Post(':id/pause')
  @RequirePermissions('automation.update')
  async pause(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ state: string }> {
    const ctx = req.auroraContext!;
    await withTenant(this.db, ctx, (s) => pauseRule(s, uuidParam(id, 'id')));
    return { state: 'paused' };
  }

  /**
   * O log de execução.
   *
   * A rota existe porque o §24 é explícito: sem log, automação é caixa-preta —
   * e caixa-preta que age sozinha no dado de outra pessoa é o que faz o
   * operador desconfiar do próprio sistema.
   */
  @Get(':id/runs')
  @RequirePermissions('automation.read')
  async runs(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    return { items: await withTenant(this.db, ctx, (s) => ruleRuns(s, uuidParam(id, 'id'))) };
  }
}

/**
 * Tarefas, 5W2H e PDCA gerados pelas automações (Fase 10). Cada pessoa vê e
 * avança as SUAS; quem administra automações vê todas.
 */
@Controller('automation-tasks')
export class AutomationTasksController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list(
    @Req() req: AuroraRequest,
    @Query('state') state?: string,
    @Query('all') all?: string
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    if (state && !['open', 'done', 'cancelled'].includes(state)) {
      throw new ValidationError('state é open, done ou cancelled', { field: 'state' });
    }
    const todas = all === 'true' && ctx.permissions.has('automation.read');
    const items = await withTenant(this.db, ctx, (s) =>
      listAutomationTasks(s, {
        ownerMembershipId: todas ? null : (ctx.membershipId ?? '00000000-0000-0000-0000-000000000000'),
        state: state ?? null,
      })
    );
    return { items };
  }

  @Post(':id/advance')
  async advance(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { action?: unknown }
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    const acao = body?.action;
    if (acao !== 'advance' && acao !== 'cancel') {
      throw new ValidationError('action é advance ou cancel', { field: 'action' });
    }
    return withTenant(this.db, ctx, (s) =>
      advanceAutomationTask(s, uuidParam(id, 'id'), acao, {
        membershipId: ctx.membershipId,
        canManage: ctx.permissions.has('automation.update'),
      })
    );
  }
}

/** O relatório agendado entregue: só ao destinatário (foi gerado no recorte dele). */
@Controller('automation-report-outputs')
export class AutomationReportsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get(':id')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) =>
      getReportOutput(s, uuidParam(id, 'id'), { membershipId: ctx.membershipId })
    );
  }
}
