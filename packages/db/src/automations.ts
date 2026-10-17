/**
 * Aurora — execução de automações (SPEC v0.2 §24 · EPIC-024).
 *
 * O motor faz quatro coisas em ordem, e a ordem é a das salvaguardas:
 * pode reagir? → passa nas condições? → cabe no limite? → executa e registra.
 *
 * NENHUMA AÇÃO CONTORNA PERMISSÃO
 *   A automação executa sob um ator de sistema cujo escopo é o declarado na
 *   regra — e cada ação declara a permissão que exige. Uma automação capaz de
 *   fazer o que o autor da regra não pode fazer seria uma escada de privilégio
 *   com interface amigável.
 */
import {
  newId,
  evaluateConditions,
  validateConditions,
  validateAction,
  actionDefinition,
  canReact,
  checkRateLimit,
  summarizeSimulation,
  validateActionsForTrigger,
  validateCron,
  isValidTimezone,
  countRuns,
  nextRuns,
  dueSlot,
  centsFromDecimal,
  DEFAULT_AUTOMATION_TIMEZONE,
  REPORT_TIER_LABEL,
  localDay,
  previousLocalMonth,
  type ReportTier,
  ValidationError,
  NotFoundError,
  ConflictError,
  type ConditionNode,
  type ActionKind,
  type TriggerKind,
  type SimulationResult,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { routeEvent, deliverAutomationNotice } from './notifications';
import { organizationTimezone } from './indicator-targets';
import { transitionWorkOrder, createWorkOrder } from './work-orders';
import { buildReport } from './relatorios';

/* -------------------------------------------------------------------------- */
/* cadastro                                                                    */
/* -------------------------------------------------------------------------- */

export interface RuleInput {
  name: string;
  description?: string | null;
  triggerKind?: TriggerKind;
  triggerEvent?: string | null;
  triggerCron?: string | null;
  triggerTimezone?: string | null;
  conditions?: ConditionNode | null;
  priority?: number;
  rateMax?: number;
  rateWindowMinutes?: number;
  actions: ReadonlyArray<{ kind: ActionKind; params: Record<string, unknown> }>;
}

/**
 * Cria a regra em RASCUNHO, com as ações validadas.
 *
 * Nasce inativa sempre. O §24 exige simulação antes de ativar, e uma regra que
 * nascesse ligada tornaria a exigência decorativa — bastaria criar e esquecer.
 */
export async function createRule(session: TenantSession, input: RuleInput): Promise<string> {
  const erros = [
    ...validateConditions(input.conditions ?? null),
    ...input.actions.flatMap((a, i) => validateAction(a, `actions[${i}]`)),
  ];
  if (input.actions.length === 0) erros.push('a regra precisa de ao menos uma ação');
  if (erros.length > 0) throw new ValidationError(erros.join('; '));

  const kind = input.triggerKind ?? 'event';
  if (kind === 'event' && !input.triggerEvent) {
    throw new ValidationError('gatilho de evento exige o tipo de evento', { field: 'triggerEvent' });
  }
  if (kind === 'schedule' && !input.triggerCron) {
    throw new ValidationError('gatilho agendado exige a expressão cron', { field: 'triggerCron' });
  }
  const errosDeGatilho = validateActionsForTrigger(kind, input.actions);
  if (kind === 'schedule') {
    errosDeGatilho.push(...validateCron(input.triggerCron!));
    if (input.triggerTimezone && !isValidTimezone(input.triggerTimezone)) {
      errosDeGatilho.push(`fuso desconhecido: ${input.triggerTimezone}`);
    }
  }
  if (errosDeGatilho.length > 0) throw new ValidationError(errosDeGatilho.join('; '));
  await conferirPessoasDasAcoes(session, input.actions);

  const id = newId();
  await session.query(
    `INSERT INTO aurora.automation_rules
       (id, organization_id, name, description, priority, trigger_kind, trigger_event,
        trigger_cron, trigger_timezone, conditions, rate_max, rate_window_minutes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::aurora.trigger_kind, $7, $8, $9, $10::jsonb, $11, $12, $13)`,
    [
      id,
      session.context.organizationId,
      input.name,
      input.description ?? null,
      input.priority ?? 100,
      kind,
      kind === 'event' ? input.triggerEvent : null,
      kind === 'schedule' ? input.triggerCron!.trim() : null,
      kind === 'schedule'
        ? (input.triggerTimezone ?? DEFAULT_AUTOMATION_TIMEZONE)
        : (input.triggerTimezone ?? null),
      input.conditions ? JSON.stringify(input.conditions) : null,
      input.rateMax ?? 100,
      input.rateWindowMinutes ?? 60,
      session.context.actorId,
    ]
  );

  for (const [i, a] of input.actions.entries()) {
    await session.query(
      `INSERT INTO aurora.automation_actions
         (id, organization_id, rule_id, position, kind, params)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [newId(), session.context.organizationId, id, i, a.kind, JSON.stringify(a.params)]
    );
  }

  return id;
}

/**
 * Destinatários e responsáveis das ações agendadas existem, estão ATIVOS e são
 * desta organização (a RLS garante a última parte). Destinatário de relatório
 * precisa ver indicadores — senão a regra entregaria a quem não pode ler.
 */
async function conferirPessoasDasAcoes(session: TenantSession, actions: RuleInput['actions']): Promise<void> {
  for (const [i, a] of actions.entries()) {
    const p = a.params as Record<string, unknown>;
    const ids =
      a.kind === 'send_report' || a.kind === 'reminder'
        ? (p.recipients as string[])
        : a.kind === 'create_task'
          ? [p.ownerMembershipId as string]
          : [];
    if (ids.length === 0) continue;
    const unicos = [...new Set(ids)];
    const ativos = await session.query<{ id: string }>(
      `SELECT id FROM aurora.memberships WHERE id = ANY($1::uuid[]) AND status = 'active'`,
      [unicos]
    );
    if (ativos.length !== unicos.length) {
      throw new ValidationError(`actions[${i}]: pessoa inexistente ou sem acesso ativo`, {
        field: a.kind === 'create_task' ? 'ownerMembershipId' : 'recipients',
      });
    }
    if (a.kind === 'send_report') {
      for (const id of unicos) {
        if (!(await temPermissao(session, id, 'insight.read'))) {
          throw new ValidationError(`actions[${i}]: um dos destinatários não pode ver indicadores`, {
            field: 'recipients',
          });
        }
      }
    }
  }
}

async function temPermissao(session: TenantSession, membershipId: string, chave: string): Promise<boolean> {
  const [r] = await session.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM aurora.effective_permissions($1) p WHERE p.permission_key = $2) AS ok`,
    [membershipId, chave]
  );
  return Boolean(r?.ok);
}

interface RuleRow {
  id: string;
  name: string;
  state: string;
  trigger_kind?: string;
  trigger_cron?: string | null;
  trigger_timezone?: string | null;
  trigger_event: string | null;
  conditions: ConditionNode | null;
  rate_max: number;
  rate_window_minutes: number;
  simulated_at: Date | null;
}

async function loadRule(session: TenantSession, id: string): Promise<RuleRow> {
  const [row] = await session.query<RuleRow>(
    `SELECT id, name, state::text AS state, trigger_kind::text AS trigger_kind, trigger_cron,
            trigger_timezone, trigger_event, conditions, rate_max, rate_window_minutes, simulated_at
       FROM aurora.automation_rules WHERE id = $1`,
    [id]
  );
  if (!row) throw new NotFoundError('regra não encontrada');
  return row;
}

/* -------------------------------------------------------------------------- */
/* simulação                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Roda a regra contra o histórico, SEM executar ação nenhuma.
 *
 * É a exigência do §24, e a razão dela é concreta: "esta regra teria disparado
 * 412 vezes nos últimos 30 dias" é a frase que impede a regra que inunda a
 * caixa de entrada de toda a equipe. Um contador pequeno num canto da tela
 * seria ignorado; a frase não é.
 */
export async function simulateRule(
  session: TenantSession,
  ruleId: string,
  days = 30,
  now: Date = new Date()
): Promise<SimulationResult & { next_runs?: string[] }> {
  const regra = await loadRule(session, ruleId);
  if (regra.trigger_kind === 'schedule' && regra.trigger_cron) {
    // A regra de relógio não tem histórico de evento para contar: a simulação
    // é a AGENDA — quantas vezes ela vai rodar e quando. Conta, não palpite.
    const dias = Math.min(days, 60);
    const total = countRuns(regra.trigger_cron, regra.trigger_timezone, now, dias);
    await session.query(
      `UPDATE aurora.automation_rules SET simulated_at = now(), simulated_matches = $2 WHERE id = $1`,
      [ruleId, total]
    );
    const r = summarizeSimulation(total, total, dias);
    return {
      ...r,
      summary: `esta regra vai rodar ${total} vez(es) nos próximos ${dias} dias${r.floodRisk ? ' — volume alto: confira a periodicidade' : ''}`,
      next_runs: nextRuns(regra.trigger_cron, regra.trigger_timezone, now, 5).map((d) => d.toISOString()),
    };
  }
  if (!regra.trigger_event) {
    throw new ConflictError('só regras de evento podem ser simuladas contra o histórico');
  }

  const eventos = await session.query<{ payload: Record<string, unknown>; aggregate_id: string }>(
    `SELECT payload, aggregate_id FROM aurora.domain_events
      WHERE type = $1 AND occurred_at > now() - ($2 || ' days')::interval`,
    [regra.trigger_event, days]
  );

  let casaram = 0;
  for (const e of eventos) {
    const fatos = { ...e.payload, payload: e.payload, aggregateId: e.aggregate_id };
    if (evaluateConditions(fatos, regra.conditions)) casaram++;
  }

  await session.query(
    `UPDATE aurora.automation_rules SET simulated_at = now(), simulated_matches = $2 WHERE id = $1`,
    [ruleId, casaram]
  );

  return summarizeSimulation(casaram, eventos.length, days);
}

/**
 * Ativa a regra.
 *
 * Recusa sem simulação. É a única forma de a exigência do §24 ser real: uma
 * validação que se pode pular não é validação, é sugestão — e a regra que
 * inunda a equipe é sempre a que alguém ativou com pressa.
 */
export async function activateRule(session: TenantSession, ruleId: string): Promise<void> {
  const regra = await loadRule(session, ruleId);
  if (regra.simulated_at === null) {
    throw new ConflictError(
      'simule a regra antes de ativar: é a única forma de saber quantas vezes ela dispararia'
    );
  }
  await session.query(
    `UPDATE aurora.automation_rules
        SET state = 'active', quarantined_at = NULL, quarantine_reason = NULL, updated_by = $2,
            activated_at = now()
      WHERE id = $1`,
    [ruleId, session.context.actorId]
  );
}

export async function pauseRule(session: TenantSession, ruleId: string): Promise<void> {
  await session.query(`UPDATE aurora.automation_rules SET state = 'paused', updated_by = $2 WHERE id = $1`, [
    ruleId,
    session.context.actorId,
  ]);
}

/* -------------------------------------------------------------------------- */
/* execução                                                                    */
/* -------------------------------------------------------------------------- */

export interface IncomingEvent {
  id?: string | null;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  causedByRuleId?: string | null;
  causationDepth?: number;
}

export interface RuleExecution {
  ruleId: string;
  ruleName: string;
  outcome: 'matched' | 'skipped_conditions' | 'skipped_recursion' | 'skipped_rate_limit' | 'failed';
  actionsRun: Array<{ kind: string; ok: boolean; detail?: string }>;
  error?: string;
}

/**
 * Roda todas as regras ativas que escutam este evento.
 *
 * A ordem é a prioridade declarada: quando duas regras agem sobre a mesma OS, o
 * resultado tem de ser previsível. Sem ordenação, a mesma sequência de eventos
 * produziria estados diferentes conforme o plano de consulta do banco.
 */
export async function runAutomations(session: TenantSession, event: IncomingEvent): Promise<RuleExecution[]> {
  const regras = await session.query<RuleRow>(
    `SELECT id, name, state::text AS state, trigger_event, conditions,
            rate_max, rate_window_minutes, simulated_at
       FROM aurora.automation_rules
      WHERE state = 'active' AND trigger_kind = 'event' AND trigger_event = $1
      ORDER BY priority, name`,
    [event.type]
  );

  const execucoes: RuleExecution[] = [];
  for (const regra of regras) {
    execucoes.push(await runOne(session, regra, event));
  }
  return execucoes;
}

async function runOne(session: TenantSession, regra: RuleRow, event: IncomingEvent): Promise<RuleExecution> {
  const inicio = Date.now();
  const fatos = { ...event.payload, payload: event.payload, aggregateId: event.aggregateId };

  const recursao = canReact(regra.id, event);
  if (!recursao.ok) {
    await logRun(session, regra, event, 'skipped_recursion', fatos, [], null, inicio);
    return {
      ruleId: regra.id,
      ruleName: regra.name,
      outcome: 'skipped_recursion',
      actionsRun: [],
    };
  }

  if (!evaluateConditions(fatos, regra.conditions)) {
    await logRun(session, regra, event, 'skipped_conditions', fatos, [], null, inicio);
    return {
      ruleId: regra.id,
      ruleName: regra.name,
      outcome: 'skipped_conditions',
      actionsRun: [],
    };
  }

  const [janela] = await session.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM aurora.rule_runs
      WHERE rule_id = $1 AND outcome = 'matched'
        AND ran_at > now() - ($2 || ' minutes')::interval`,
    [regra.id, regra.rate_window_minutes]
  );

  const limite = checkRateLimit(Number(janela!.total), {
    max: Number(regra.rate_max),
    windowMinutes: Number(regra.rate_window_minutes),
  });

  if (!limite.allowed) {
    // Quarentena, e não bloqueio silencioso: a regra aparece na tela com o
    // motivo, e alguém decide se corrige ou desliga.
    await session.query(
      `UPDATE aurora.automation_rules
          SET state = 'quarantined', quarantined_at = now(), quarantine_reason = $2
        WHERE id = $1`,
      [regra.id, limite.detail]
    );
    await logRun(session, regra, event, 'skipped_rate_limit', fatos, [], limite.detail, inicio);
    return {
      ruleId: regra.id,
      ruleName: regra.name,
      outcome: 'skipped_rate_limit',
      actionsRun: [],
    };
  }

  const acoes = await session.query<{ kind: string; params: Record<string, unknown> }>(
    `SELECT kind, params FROM aurora.automation_actions WHERE rule_id = $1 ORDER BY position`,
    [regra.id]
  );

  const feitas: RuleExecution['actionsRun'] = [];
  let erro: string | null = null;

  for (const acao of acoes) {
    try {
      const detalhe = await executeAction(session, regra.id, acao.kind, acao.params, event);
      feitas.push({ kind: acao.kind, ok: true, detail: detalhe });
    } catch (e) {
      // A ação que falha PARA a lista: as seguintes costumam depender do efeito
      // da anterior, e seguir em frente produziria meia automação — o pior dos
      // dois estados possíveis, porque parece que funcionou.
      erro = e instanceof Error ? e.message : String(e);
      feitas.push({ kind: acao.kind, ok: false, detail: erro });
      break;
    }
  }

  const resultado = erro === null ? 'matched' : 'failed';
  await logRun(session, regra, event, resultado, fatos, feitas, erro, inicio);

  return {
    ruleId: regra.id,
    ruleName: regra.name,
    outcome: resultado,
    actionsRun: feitas,
    ...(erro ? { error: erro } : {}),
  };
}

async function logRun(
  session: TenantSession,
  regra: RuleRow,
  event: IncomingEvent,
  outcome: string,
  facts: Record<string, unknown>,
  actions: unknown[],
  error: string | null,
  startedAt: number
): Promise<void> {
  await session.query(
    `INSERT INTO aurora.rule_runs
       (id, organization_id, rule_id, event_id, event_type, aggregate_id, outcome,
        facts, actions_run, error, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7::aurora.run_outcome, $8::jsonb, $9::jsonb, $10, $11)`,
    [
      newId(),
      session.context.organizationId,
      regra.id,
      event.id ?? null,
      event.type,
      event.aggregateId,
      outcome,
      JSON.stringify(facts),
      JSON.stringify(actions),
      error,
      Date.now() - startedAt,
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* ações                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Executa uma ação.
 *
 * A permissão declarada na definição é conferida contra o contexto ANTES de
 * agir. Uma automação capaz de fazer o que o ator não pode fazer seria uma
 * escada de privilégio com interface amigável — e o §24 é explícito: automação
 * nunca contorna permissão.
 */
async function executeAction(
  session: TenantSession,
  ruleId: string,
  kind: string,
  params: Record<string, unknown>,
  event: IncomingEvent
): Promise<string> {
  const def = actionDefinition(kind);
  if (!def) throw new ValidationError(`ação desconhecida: ${kind}`);

  if (!session.context.permissions.has(def.permission)) {
    throw new ValidationError(
      `a automação não tem a permissão ${def.permission} para executar "${def.label}"`
    );
  }

  const profundidade = (event.causationDepth ?? 0) + 1;

  switch (kind) {
    case 'notify': {
      const rotas = await routeEvent(session, {
        id: event.id ?? null,
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
      });
      return `${rotas.length} destinatário(s)`;
    }

    case 'assign': {
      const alvo = typeof params.membershipId === 'string' ? params.membershipId : null;
      if (!alvo) throw new ValidationError('assign exige membershipId');
      await session.query(`UPDATE aurora.work_orders SET assignee_membership_id = $2 WHERE id = $1`, [
        event.aggregateId,
        alvo,
      ]);
      return `atribuída a ${alvo}`;
    }

    case 'change_status': {
      const chave = typeof params.statusKey === 'string' ? params.statusKey : '';
      await transitionWorkOrder(session, event.aggregateId, chave, {
        waitReasonId: typeof params.waitReasonId === 'string' ? params.waitReasonId : null,
      });
      return `situação alterada para ${chave}`;
    }

    case 'add_comment': {
      const texto = typeof params.text === 'string' ? params.text : '';
      await session.query(
        `INSERT INTO aurora.work_order_comments
           (id, organization_id, work_order_id, body, visibility, author_membership_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          newId(),
          session.context.organizationId,
          event.aggregateId,
          texto,
          params.visibility === 'customer' ? 'customer' : 'internal',
          session.context.membershipId,
        ]
      );
      return 'comentário registrado';
    }

    case 'create_work_order': {
      const nova = await createWorkOrder(session, {
        customerId: String(params.customerId ?? event.payload.customer_id ?? ''),
        workOrderTypeId: String(params.workOrderTypeId),
        title: String(params.title),
        assetId: typeof params.assetId === 'string' ? params.assetId : null,
        source: 'automation',
      });
      // A OS nascida de automação carrega a marca da regra: sem isso, ninguém
      // consegue explicar de onde ela veio três semanas depois.
      await session.query(
        `INSERT INTO aurora.rule_runs
           (id, organization_id, rule_id, event_type, aggregate_id, outcome, actions_run)
         VALUES ($1, $2, $3, 'automation.created_work_order', $4, 'matched',
                 jsonb_build_array(jsonb_build_object('createdWorkOrder', $4::text, 'depth', $5::int)))`,
        [newId(), session.context.organizationId, ruleId, nova.id, profundidade]
      );
      return `OS ${nova.number ?? nova.id} criada`;
    }

    case 'send_report':
      return enviarRelatorio(session, ruleId, params, event);

    case 'reminder':
      return lembrar(session, ruleId, params, event);

    case 'create_task':
      return criarTarefa(session, ruleId, params, event);

    default:
      throw new ValidationError(`ação sem execução implementada: ${kind}`);
  }
}

/* -------------------------------------------------------------------------- */
/* leitura                                                                     */
/* -------------------------------------------------------------------------- */

export async function ruleRuns(session: TenantSession, ruleId: string, limit = 50): Promise<unknown[]> {
  const n = Math.min(Math.max(limit, 1), 200);
  return session.query(
    `SELECT id, event_type, aggregate_id, outcome, actions_run, error, duration_ms, ran_at
       FROM aurora.rule_runs WHERE rule_id = $1 ORDER BY ran_at DESC LIMIT ${n}`,
    [ruleId]
  );
}

export async function listRules(session: TenantSession): Promise<unknown[]> {
  return session.query(
    `SELECT r.id, r.name, r.state, r.priority, r.trigger_kind, r.trigger_event,
            r.trigger_cron, r.trigger_timezone, r.activated_at,
            r.simulated_at, r.simulated_matches, r.quarantine_reason,
            (SELECT a.kind FROM aurora.automation_actions a WHERE a.rule_id = r.id ORDER BY a.position LIMIT 1) AS first_action,
            (SELECT count(*) FROM aurora.automation_actions a WHERE a.rule_id = r.id) AS action_count
       FROM aurora.automation_rules r
      ORDER BY r.priority, r.name`
  );
}

/* -------------------------------------------------------------------------- */
/* agendamento (reunião 16/10/2026, Fase 10)                                   */
/* -------------------------------------------------------------------------- */

/** O transporte de e-mail não existe nesta instalação: a entrega fica na fila. */
export const EMAIL_SEM_TRANSPORTE = 'awaiting_email_transport';

export interface ScheduledSweep {
  rules: number;
  ran: number;
  failed: number;
  skipped: number;
}

/**
 * Roda as regras AGENDADAS cuja passada está devida.
 *
 * Idempotente por (regra, passada): a passada é REIVINDICADA com um INSERT que
 * respeita o índice único antes de qualquer efeito. Quem chega depois — a
 * varredura concorrente, a retentativa — não reivindica e não faz nada.
 */
export async function runScheduledAutomations(
  session: TenantSession,
  now: Date = new Date()
): Promise<ScheduledSweep> {
  const regras = await session.query<
    RuleRow & {
      trigger_cron: string;
      trigger_timezone: string | null;
      activated_at: Date | null;
      last_slot: Date | null;
    }
  >(
    `SELECT r.id, r.name, r.state::text AS state, r.trigger_event, r.conditions,
            r.rate_max, r.rate_window_minutes, r.simulated_at, r.trigger_cron, r.trigger_timezone,
            r.activated_at,
            (SELECT max(schedule_slot) FROM aurora.rule_runs x WHERE x.rule_id = r.id) AS last_slot
       FROM aurora.automation_rules r
      WHERE r.state = 'active' AND r.trigger_kind = 'schedule'
      ORDER BY r.priority, r.name`
  );
  const saida: ScheduledSweep = { rules: regras.length, ran: 0, failed: 0, skipped: 0 };
  for (const regra of regras) {
    const depois =
      [regra.activated_at, regra.last_slot]
        .filter((d): d is Date => d !== null)
        .map((d) => new Date(d))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const slot = dueSlot(regra.trigger_cron, regra.trigger_timezone, now, depois);
    if (!slot) continue;
    const r = await runScheduledRule(session, regra, slot);
    if (r === null) saida.skipped++;
    else if (r.outcome === 'matched') saida.ran++;
    else saida.failed++;
  }
  return saida;
}

/**
 * "Executar agora" (permissão `automation.run_now`): roda a regra agendada na
 * passada do minuto corrente. Repetir no mesmo minuto não duplica.
 */
export async function runScheduledRuleNow(
  session: TenantSession,
  ruleId: string,
  now: Date = new Date()
): Promise<RuleExecution | null> {
  const regra = await loadRule(session, ruleId);
  if (regra.trigger_kind !== 'schedule') {
    throw new ConflictError('só regras agendadas podem ser executadas agora');
  }
  if (regra.state === 'quarantined') {
    throw new ConflictError('a regra está em quarentena: revise antes de executar');
  }
  const slot = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  return runScheduledRule(session, regra, slot);
}

async function runScheduledRule(
  session: TenantSession,
  regra: RuleRow,
  slot: Date
): Promise<RuleExecution | null> {
  const inicio = Date.now();
  const evento: IncomingEvent = {
    type: 'automation.schedule',
    aggregateType: 'automation_rule',
    aggregateId: regra.id,
    payload: { slot: slot.toISOString(), ruleName: regra.name },
  };

  const [janela] = await session.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM aurora.rule_runs
      WHERE rule_id = $1 AND outcome = 'matched'
        AND ran_at > now() - ($2 || ' minutes')::interval`,
    [regra.id, regra.rate_window_minutes]
  );
  const limite = checkRateLimit(Number(janela!.total), {
    max: Number(regra.rate_max),
    windowMinutes: Number(regra.rate_window_minutes),
  });
  if (!limite.allowed) {
    await session.query(
      `UPDATE aurora.automation_rules
          SET state = 'quarantined', quarantined_at = now(), quarantine_reason = $2
        WHERE id = $1`,
      [regra.id, limite.detail]
    );
    return { ruleId: regra.id, ruleName: regra.name, outcome: 'skipped_rate_limit', actionsRun: [] };
  }

  const runId = newId();
  const reivindicada = await session.query<{ id: string }>(
    `INSERT INTO aurora.rule_runs
       (id, organization_id, rule_id, event_type, aggregate_id, outcome, facts, schedule_slot)
     VALUES ($1, $2, $3, 'automation.schedule', $3, 'matched', $4::jsonb, $5)
     ON CONFLICT (rule_id, schedule_slot) WHERE schedule_slot IS NOT NULL DO NOTHING
     RETURNING id`,
    [runId, session.context.organizationId, regra.id, JSON.stringify(evento.payload), slot]
  );
  if (reivindicada.length === 0) return null;

  const acoes = await session.query<{ kind: string; params: Record<string, unknown> }>(
    `SELECT kind, params FROM aurora.automation_actions WHERE rule_id = $1 ORDER BY position`,
    [regra.id]
  );
  const feitas: RuleExecution['actionsRun'] = [];
  let erro: string | null = null;
  for (const acao of acoes) {
    // SAVEPOINT por ação: a que falha desfaz SÓ o que ela fez, e o registro da
    // execução (com o erro) continua gravável na mesma transação.
    await session.query('SAVEPOINT acao_agendada');
    try {
      const detalhe = await executeAction(session, regra.id, acao.kind, acao.params, evento);
      await session.query('RELEASE SAVEPOINT acao_agendada');
      feitas.push({ kind: acao.kind, ok: true, detail: detalhe });
    } catch (e) {
      await session.query('ROLLBACK TO SAVEPOINT acao_agendada');
      erro = e instanceof Error ? e.message : String(e);
      feitas.push({ kind: acao.kind, ok: false, detail: erro });
      break;
    }
  }
  const resultado = erro === null ? 'matched' : 'failed';
  await session.query(
    `UPDATE aurora.rule_runs
        SET outcome = $2::aurora.run_outcome, actions_run = $3::jsonb, error = $4, duration_ms = $5
      WHERE id = $1`,
    [runId, resultado, JSON.stringify(feitas), erro, Date.now() - inicio]
  );
  return {
    ruleId: regra.id,
    ruleName: regra.name,
    outcome: resultado,
    actionsRun: feitas,
    ...(erro ? { error: erro } : {}),
  };
}

/**
 * Avisa na caixa de entrada e, se a pessoa pode receber e-mail, põe o e-mail na
 * FILA — sem transporte, não sai. As preferências de notificação valem aqui
 * como em qualquer aviso (`deliverAutomationNotice`, PF-56).
 */
async function avisar(
  session: TenantSession,
  membershipId: string,
  aviso: {
    typeKey: string;
    aggregateType: string;
    aggregateId: string;
    title: string;
    body: string | null;
    link: string | null;
    dedupe: string;
    email: boolean;
  }
): Promise<{ id: string; email: 'pending' | 'sent' | 'suppressed' | 'digested' | null }> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.notifications
       (id, organization_id, membership_id, type_key, aggregate_type, aggregate_id, title, body, link, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      session.context.organizationId,
      membershipId,
      aviso.typeKey,
      aviso.aggregateType,
      aviso.aggregateId,
      aviso.title,
      aviso.body,
      aviso.link,
      aviso.dedupe,
    ]
  );
  const entregas = await deliverAutomationNotice(session, id, membershipId, aviso.typeKey, {
    email: aviso.email,
    pendingReason: EMAIL_SEM_TRANSPORTE,
  });
  return { id, email: entregas.find((e) => e.channel === 'email')?.state ?? null };
}

async function destinatariosAtivos(session: TenantSession, ids: unknown): Promise<string[]> {
  const lista = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  if (lista.length === 0) return [];
  const r = await session.query<{ id: string }>(
    `SELECT id FROM aurora.memberships WHERE id = ANY($1::uuid[]) AND status = 'active' ORDER BY id`,
    [lista]
  );
  return r.map((x) => x.id);
}

/** Dia (AAAA-MM-DD) no fuso da organização — e não em UTC (PF-51/PF-72). */
const dataLocal = (d: Date, fuso: string): string => localDay(d, fuso);

/**
 * O período do relatório agendado.
 *
 * `periodo: 'mes_anterior'` é o MÊS CIVIL anterior à passada, no fuso da
 * organização: a passada de 01/11 08:00 gera outubro inteiro, de 01/10 a
 * 31/10 23:59:59.999, e a meta é a de 31/10 (pente-fino 17/10/2026, PF-52).
 * Sem `periodo`, é o de sempre — os últimos `periodDays` dias até a passada —
 * e as regras antigas não mudam.
 */
function periodoDoRelatorio(p: Record<string, unknown>, slot: Date, fuso: string): { from: Date; to: Date } {
  if (p.periodo === 'mes_anterior') {
    const mes = previousLocalMonth(slot, fuso);
    return { from: mes.from, to: mes.to };
  }
  const dias = p.periodDays === undefined || p.periodDays === null ? 30 : Number(p.periodDays);
  return { from: new Date(slot.getTime() - dias * 86_400_000), to: slot };
}

async function enviarRelatorio(
  session: TenantSession,
  ruleId: string,
  p: Record<string, unknown>,
  event: IncomingEvent
): Promise<string> {
  const slot = new Date(String(event.payload.slot));
  const fuso = await organizationTimezone(session);
  const periodo = periodoDoRelatorio(p, slot, fuso);
  const tier = String(p.tier) as ReportTier;
  const entrada = {
    tier,
    indicators: Array.isArray(p.indicators) ? (p.indicators as string[]) : undefined,
    from: periodo.from.toISOString(),
    to: periodo.to.toISOString(),
    ...(typeof p.customerId === 'string' ? { customer_id: p.customerId } : {}),
    ...(typeof p.sectorId === 'string' ? { sector_id: p.sectorId } : {}),
    ...(typeof p.planKind === 'string' ? { plan_kind: p.planKind } : {}),
    ...(typeof p.assetCategoryId === 'string' ? { asset_category_id: p.assetCategoryId } : {}),
  };
  let gerados = 0;
  let suprimidos = 0;
  const pulados: string[] = [];
  for (const membershipId of await destinatariosAtivos(session, p.recipients)) {
    if (!(await temPermissao(session, membershipId, 'insight.read'))) {
      pulados.push('sem permissão de indicadores');
      continue;
    }
    // Cada destinatário recebe o relatório no SEU recorte: quem só vê o
    // Hospital A não recebe número do Hospital B porque a regra é de outra pessoa.
    await session.query('SAVEPOINT relatorio_destinatario');
    let r: Awaited<ReturnType<typeof buildReport>>;
    try {
      r = await buildReport(session, membershipId, entrada, slot);
      await session.query('RELEASE SAVEPOINT relatorio_destinatario');
    } catch (e) {
      await session.query('ROLLBACK TO SAVEPOINT relatorio_destinatario');
      if (e instanceof NotFoundError) {
        pulados.push('filtro fora do escopo do destinatário');
        continue;
      }
      throw e;
    }
    const saidaId = newId();
    const nome = String(event.payload.ruleName ?? 'automação');
    const aviso = await avisar(session, membershipId, {
      typeKey: 'automation.scheduled_report',
      aggregateType: 'automation_report_output',
      aggregateId: saidaId,
      title: `Relatório ${REPORT_TIER_LABEL[tier]} — ${nome}`,
      body: `Período: ${dataLocal(periodo.from, fuso)} a ${dataLocal(new Date(periodo.to.getTime() - 1), fuso)}`,
      link: `/relatorios/agendados/${saidaId}`,
      dedupe: `automation.scheduled_report:${membershipId}:${ruleId}:${slot.toISOString()}`,
      email: true,
    });
    if (aviso.email === 'suppressed') suprimidos++;
    await session.query(
      `INSERT INTO aurora.automation_report_outputs
         (id, organization_id, rule_id, schedule_slot, recipient_membership_id, tier, filters, sections,
          notification_id, email_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
      [
        saidaId,
        session.context.organizationId,
        ruleId,
        slot,
        membershipId,
        tier,
        JSON.stringify(r.filters),
        JSON.stringify(r.sections),
        aviso.id,
        aviso.email === 'suppressed' ? 'suppressed' : 'queued_no_transport',
      ]
    );
    gerados++;
  }
  // Ninguém recebeu: é falha, não sucesso com zero (pente-fino 17/10/2026). Sem
  // isto, uma regra cujo setor foi apagado ficava "executada" todo mês, vazia.
  if (gerados === 0 && pulados.length > 0) {
    throw new ValidationError(
      `nenhum relatório gerado: ${pulados.length} destinatário(s) pulado(s) — ${[...new Set(pulados)].join(', ')}`
    );
  }
  return (
    `${gerados} relatório(s) na caixa de entrada; e-mail na fila (sem transporte configurado)` +
    (suprimidos > 0 ? `; ${suprimidos} e-mail(s) suprimido(s) pelas preferências de notificação` : '') +
    (pulados.length > 0
      ? `; ${pulados.length} destinatário(s) pulado(s): ${[...new Set(pulados)].join(', ')}`
      : '')
  );
}

async function lembrar(
  session: TenantSession,
  ruleId: string,
  p: Record<string, unknown>,
  event: IncomingEvent
): Promise<string> {
  const slot = String(event.payload.slot);
  const pessoas = await destinatariosAtivos(session, p.recipients);
  for (const membershipId of pessoas) {
    await avisar(session, membershipId, {
      typeKey: 'automation.reminder',
      aggregateType: 'automation_rule',
      aggregateId: ruleId,
      title: String(p.title),
      body: typeof p.message === 'string' && p.message.trim() ? p.message : null,
      link: null,
      dedupe: `automation.reminder:${membershipId}:${ruleId}:${slot}`,
      email: true,
    });
  }
  return `${pessoas.length} lembrete(s); e-mail na fila (sem transporte configurado)`;
}

async function criarTarefa(
  session: TenantSession,
  ruleId: string,
  p: Record<string, unknown>,
  event: IncomingEvent
): Promise<string> {
  const slot = new Date(String(event.payload.slot));
  const fuso = await organizationTimezone(session);
  const [dono] = await destinatariosAtivos(session, [p.ownerMembershipId]);
  if (!dono) throw new ValidationError('o responsável da tarefa não tem mais acesso ativo');
  const metodo = String(p.method);
  const prazo = p.dueInDays === undefined ? 7 : Number(p.dueInDays);
  const texto = (k: string): string | null =>
    typeof p[k] === 'string' && (p[k] as string).trim() ? (p[k] as string).trim() : null;
  const id = newId();
  await session.query(
    `INSERT INTO aurora.automation_tasks
       (id, organization_id, rule_id, schedule_slot, method, title, why, where_text, how, how_much_cents,
        owner_membership_id, due_date, pdca_phase)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13)`,
    [
      id,
      session.context.organizationId,
      ruleId,
      slot,
      metodo,
      String(p.title).trim(),
      texto('why'),
      texto('where'),
      texto('how'),
      p.howMuch === undefined || p.howMuch === null || p.howMuch === ''
        ? null
        : centsFromDecimal(String(p.howMuch)),
      dono,
      dataLocal(new Date(slot.getTime() + prazo * 86_400_000), fuso),
      metodo === 'pdca' ? 'plan' : null,
    ]
  );
  await avisar(session, dono, {
    typeKey: 'automation.task',
    aggregateType: 'automation_task',
    aggregateId: id,
    title: `Nova tarefa: ${String(p.title).trim()}`,
    body: metodo === '5w2h' ? 'Plano de ação 5W2H' : metodo === 'pdca' ? 'Ciclo PDCA — fase Planejar' : null,
    link: '/tarefas',
    dedupe: `automation.task:${dono}:${ruleId}:${slot.toISOString()}`,
    email: false,
  });
  return `tarefa ${metodo} criada`;
}

/* -------------------------------------------------------------------------- */
/* tarefas e relatórios entregues                                              */
/* -------------------------------------------------------------------------- */

export interface AutomationTask {
  id: string;
  rule_id: string | null;
  rule_name: string | null;
  method: string;
  title: string;
  why: string | null;
  where_text: string | null;
  how: string | null;
  how_much_cents: number | null;
  owner_membership_id: string;
  owner_name: string | null;
  due_date: string | null;
  pdca_phase: string | null;
  state: string;
  created_at: Date;
  completed_at: Date | null;
}

/** As tarefas: as minhas, ou todas para quem administra automações. */
export async function listAutomationTasks(
  session: TenantSession,
  filtro: { ownerMembershipId: string | null; state?: string | null }
): Promise<AutomationTask[]> {
  const params: unknown[] = [];
  const onde: string[] = [];
  if (filtro.ownerMembershipId) {
    params.push(filtro.ownerMembershipId);
    onde.push(`t.owner_membership_id = $${params.length}`);
  }
  if (filtro.state) {
    params.push(filtro.state);
    onde.push(`t.state = $${params.length}`);
  }
  const linhas = await session.query<AutomationTask>(
    `SELECT t.id, t.rule_id, r.name AS rule_name, t.method, t.title, t.why, t.where_text, t.how,
            t.how_much_cents, t.owner_membership_id, u.name AS owner_name,
            to_char(t.due_date, 'YYYY-MM-DD') AS due_date, t.pdca_phase, t.state, t.created_at, t.completed_at
       FROM aurora.automation_tasks t
       LEFT JOIN aurora.automation_rules r ON r.id = t.rule_id
       LEFT JOIN aurora.memberships m ON m.id = t.owner_membership_id
       LEFT JOIN aurora.users u ON u.id = m.user_id
      ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''}
      ORDER BY (t.state = 'open') DESC, t.due_date NULLS LAST, t.created_at DESC
      LIMIT 200`,
    params
  );
  return linhas.map((l) => ({
    ...l,
    how_much_cents: l.how_much_cents === null ? null : Number(l.how_much_cents),
  }));
}

const PROXIMA_FASE: Record<string, string> = { plan: 'do', do: 'check', check: 'act' };

/**
 * Avança a tarefa. PDCA anda uma fase por vez (Planejar → Executar → Checar →
 * Agir) e só conclui depois de Agir; as outras concluem direto. Só o
 * responsável, ou quem administra automações.
 */
export async function advanceAutomationTask(
  session: TenantSession,
  taskId: string,
  acao: 'advance' | 'cancel',
  quem: { membershipId: string | null; canManage: boolean }
): Promise<{ state: string; pdca_phase: string | null }> {
  const [t] = await session.query<{
    owner_membership_id: string;
    method: string;
    pdca_phase: string | null;
    state: string;
  }>(
    `SELECT owner_membership_id, method, pdca_phase, state FROM aurora.automation_tasks WHERE id = $1 FOR UPDATE`,
    [taskId]
  );
  if (!t) throw new NotFoundError('tarefa', taskId);
  if (!quem.canManage && t.owner_membership_id !== quem.membershipId)
    throw new NotFoundError('tarefa', taskId);
  if (t.state !== 'open') throw new ConflictError('a tarefa já foi encerrada');
  if (acao === 'cancel') {
    await session.query(`UPDATE aurora.automation_tasks SET state = 'cancelled' WHERE id = $1`, [taskId]);
    return { state: 'cancelled', pdca_phase: t.pdca_phase };
  }
  if (t.method === 'pdca' && t.pdca_phase && PROXIMA_FASE[t.pdca_phase]) {
    const fase = PROXIMA_FASE[t.pdca_phase]!;
    await session.query(`UPDATE aurora.automation_tasks SET pdca_phase = $2 WHERE id = $1`, [taskId, fase]);
    return { state: 'open', pdca_phase: fase };
  }
  await session.query(
    `UPDATE aurora.automation_tasks SET state = 'done', completed_at = now(), completed_by = $2 WHERE id = $1`,
    [taskId, quem.membershipId]
  );
  return { state: 'done', pdca_phase: t.pdca_phase };
}

/**
 * Um relatório entregue — SÓ ao destinatário. O conteúdo foi gerado no recorte
 * de escopo dele; mostrar a um gestor de escopo menor vazaria o que esse
 * gestor não vê no Painel. Quem administra acompanha pelo log da regra.
 */
export async function getReportOutput(
  session: TenantSession,
  id: string,
  quem: { membershipId: string | null }
): Promise<Record<string, unknown>> {
  const [o] = await session.query<Record<string, unknown> & { recipient_membership_id: string }>(
    `SELECT o.id, o.rule_id, r.name AS rule_name, o.schedule_slot, o.recipient_membership_id, o.tier,
            o.filters, o.sections, o.email_state, o.created_at
       FROM aurora.automation_report_outputs o
       JOIN aurora.automation_rules r ON r.id = o.rule_id
      WHERE o.id = $1`,
    [id]
  );
  if (!o || o.recipient_membership_id !== quem.membershipId) {
    throw new NotFoundError('relatório', id);
  }
  return o;
}
