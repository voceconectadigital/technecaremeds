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
  ValidationError,
  NotFoundError,
  ConflictError,
  type ConditionNode,
  type ActionKind,
  type TriggerKind,
  type SimulationResult,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { routeEvent } from './notifications';
import { transitionWorkOrder, createWorkOrder } from './work-orders';

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
      kind === 'schedule' ? input.triggerCron : null,
      input.triggerTimezone ?? null,
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

interface RuleRow {
  id: string;
  name: string;
  state: string;
  trigger_event: string | null;
  conditions: ConditionNode | null;
  rate_max: number;
  rate_window_minutes: number;
  simulated_at: Date | null;
}

async function loadRule(session: TenantSession, id: string): Promise<RuleRow> {
  const [row] = await session.query<RuleRow>(
    `SELECT id, name, state::text AS state, trigger_event, conditions,
            rate_max, rate_window_minutes, simulated_at
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
  days = 30
): Promise<SimulationResult> {
  const regra = await loadRule(session, ruleId);
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
        SET state = 'active', quarantined_at = NULL, quarantine_reason = NULL, updated_by = $2
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
            r.simulated_at, r.simulated_matches, r.quarantine_reason,
            (SELECT count(*) FROM aurora.automation_actions a WHERE a.rule_id = r.id) AS action_count
       FROM aurora.automation_rules r
      ORDER BY r.priority, r.name`
  );
}
