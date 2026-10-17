/**
 * Aurora — automações (SPEC v0.2 §24 · EPIC-024).
 *
 * A REGRA SIMULA ANTES DE VALER.
 *
 * `simulated_at` e `simulated_matches` estão na LISTA, e não escondidos: uma
 * automação que ninguém simulou é uma automação cujo alcance ninguém conhece,
 * e ligá-la é descobrir na segunda-feira que ela abriu quatrocentas ordens de
 * serviço. A simulação roda contra os eventos que JÁ aconteceram — não é
 * previsão, é contagem do passado.
 *
 * A QUARENTENA É UMA PROPRIEDADE DO PRODUTO, e não um erro.
 *
 * `quarantine_reason` diz por que uma regra foi desligada sozinha. Uma
 * automação que falha em silêncio e continua ligada é pior do que automação
 * nenhuma: a equipe passa a contar com um efeito que não está acontecendo.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const AutomationRule = z.object({
  id: Uuid,
  name: z.string(),
  state: z.string(),
  priority: z.number().int(),
  /** `event` reage a algo que aconteceu; `cron` roda no relógio. */
  trigger_kind: z.string(),
  trigger_event: z.string().nullable(),
  /**
   * Quando a regra foi simulada pela última vez, e quantos casos ela pegaria.
   *
   * Vem na LISTA porque muda a decisão de ligar: uma regra nunca simulada tem
   * alcance desconhecido, e ligá-la é descobrir na segunda-feira que ela abriu
   * quatrocentas ordens.
   */
  simulated_at: Timestamp.nullable(),
  simulated_matches: z.number().int().nullable(),
  /**
   * Por que a regra foi desligada sozinha.
   *
   * Nulo é o normal. Preenchido é uma regra que falhou repetidamente e entrou
   * em quarentena — e dizer o motivo é o que permite corrigir em vez de
   * religar e esperar.
   */
  quarantine_reason: z.string().nullable(),
  action_count: z.union([z.number(), z.string()]),
  /** Regra agendada (Fase 10): expressão, fuso, primeira ação e próxima passada. */
  trigger_cron: z.string().nullable().optional(),
  trigger_timezone: z.string().nullable().optional(),
  activated_at: Timestamp.nullable().optional(),
  first_action: z.string().nullable().optional(),
  next_run: Timestamp.nullable().optional(),
});
export type AutomationRule = z.infer<typeof AutomationRule>;

export const automationsList = defineOperation({
  operationId: 'automations.list',
  method: 'GET',
  path: '/automations',
  summary: 'As regras de automação desta organização',
  permissions: ['automation.read'],
  response: z.object({ items: z.array(AutomationRule) }),
});

export const RuleRun = z.object({
  id: Uuid,
  event_type: z.string().nullable(),
  aggregate_id: Uuid.nullable(),
  /** `applied`, `skipped` ou `failed` — e a distinção entre os três importa. */
  outcome: z.string(),
  /** As ações executadas (lista), ou a contagem em respostas antigas. */
  actions_run: z.union([z.number().int(), z.array(z.unknown())]).nullable(),
  error: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  ran_at: Timestamp,
});
export type RuleRun = z.infer<typeof RuleRun>;

export const automationRuns = defineOperation({
  operationId: 'automations.runs',
  method: 'GET',
  path: '/automations/:id/runs',
  summary: 'As últimas execuções desta regra',
  description:
    '`skipped` é resultado legítimo — a regra rodou e a condição não bateu — e distingui-lo de ' +
    '`failed` é o que separa "não era o caso" de "quebrou".',
  permissions: ['automation.read'],
  params: z.object({ id: Uuid }),
  query: z.object({ limit: z.coerce.number().int().positive().max(200).optional() }),
  response: z.object({ items: z.array(RuleRun) }),
});

export const automationSimulate = defineOperation({
  operationId: 'automations.simulate',
  method: 'POST',
  path: '/automations/:id/simulate',
  summary: 'Conta quantos casos a regra pegaria, sem executar nada',
  description:
    'Roda contra os eventos que JÁ aconteceram: não é previsão, é contagem do passado. É a única ' +
    'forma de conhecer o alcance de uma regra antes de ligá-la.',
  permissions: ['automation.update'],
  params: z.object({ id: Uuid }),
  body: z.object({ days: z.number().int().min(1).max(365).optional() }),
  response: z.record(z.string(), z.unknown()),
  status: 201,
  errors: ['validation_failed'],
});

export const automationActivate = defineOperation({
  operationId: 'automations.activate',
  method: 'POST',
  path: '/automations/:id/activate',
  summary: 'Liga a regra',
  permissions: ['automation.update'],
  params: z.object({ id: Uuid }),
  response: z.record(z.string(), z.unknown()),
  status: 201,
  errors: ['validation_failed'],
});

export const automationPause = defineOperation({
  operationId: 'automations.pause',
  method: 'POST',
  path: '/automations/:id/pause',
  summary: 'Pausa a regra',
  permissions: ['automation.update'],
  params: z.object({ id: Uuid }),
  response: z.record(z.string(), z.unknown()),
  status: 201,
});

export const automationVocabulary = defineOperation({
  operationId: 'automations.vocabulary',
  method: 'GET',
  path: '/automations/vocabulary',
  summary: 'Os gatilhos, condições e ações que existem',
  description:
    'O vocabulário é FECHADO. Uma automação que aceita expressão livre vira uma linguagem de ' +
    'programação que ninguém revisa, dentro de um sistema que ninguém testa.',
  permissions: ['automation.read'],
  response: z.record(z.string(), z.unknown()),
});

/* -------------------------------------------------------------------------- */
/* Nova automação e agendamento (reunião 16/10/2026, Fase 10)                  */
/* -------------------------------------------------------------------------- */

export const automationsCreate = defineOperation({
  operationId: 'automations.create',
  method: 'POST',
  path: '/automations',
  summary: 'Cria a regra — sempre em rascunho, até ser simulada e ligada',
  description:
    'Regra agendada (`triggerKind: schedule`) usa cron de cinco campos no fuso informado (padrão ' +
    'America/Sao_Paulo) e só aceita ações de relógio: relatório, lembrete, tarefa (tarefa, 5W2H, PDCA) e ' +
    'abrir OS. E-mail: fica na fila — não há transporte configurado (BLOQUEADO — INFRA).',
  permissions: ['automation.create'],
  body: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    triggerKind: z.enum(['event', 'schedule', 'condition_watch']).optional(),
    triggerEvent: z.string().nullable().optional(),
    triggerCron: z.string().max(120).nullable().optional(),
    triggerTimezone: z.string().max(64).nullable().optional(),
    conditions: z.record(z.string(), z.unknown()).nullable().optional(),
    priority: z.number().int().optional(),
    rateMax: z.number().int().positive().optional(),
    rateWindowMinutes: z.number().int().positive().optional(),
    actions: z.array(z.object({ kind: z.string(), params: z.record(z.string(), z.unknown()) })).min(1),
  }),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['validation_failed'],
});

export const automationRunNow = defineOperation({
  operationId: 'automations.runNow',
  method: 'POST',
  path: '/automations/:id/run-now',
  summary: 'Executa agora a regra agendada (a passada do minuto corrente)',
  description: 'Repetir no mesmo minuto não duplica: a passada é única por regra.',
  permissions: ['automation.run_now'],
  params: z.object({ id: Uuid }),
  response: z.object({
    executed: z.boolean(),
    outcome: z.string().nullable(),
    actions: z.array(z.object({ kind: z.string(), ok: z.boolean(), detail: z.string().optional() })),
  }),
  status: 201,
  errors: ['validation_failed', 'conflict'],
});

export const AutomationTask = z.object({
  id: Uuid,
  rule_id: Uuid.nullable(),
  rule_name: z.string().nullable(),
  method: z.enum(['task', '5w2h', 'pdca']),
  title: z.string(),
  why: z.string().nullable(),
  where_text: z.string().nullable(),
  how: z.string().nullable(),
  how_much_cents: z.number().int().nullable(),
  owner_membership_id: Uuid,
  owner_name: z.string().nullable(),
  due_date: z.string().nullable(),
  pdca_phase: z.enum(['plan', 'do', 'check', 'act']).nullable(),
  state: z.enum(['open', 'done', 'cancelled']),
  created_at: Timestamp,
  completed_at: Timestamp.nullable(),
});
export type AutomationTask = z.infer<typeof AutomationTask>;

export const automationTasksList = defineOperation({
  operationId: 'automationTasks.list',
  method: 'GET',
  path: '/automation-tasks',
  summary: 'Tarefas, 5W2H e PDCA gerados pelas automações',
  description: 'Cada pessoa vê as suas; quem lê automações (`automation.read`) vê todas, com `all=true`.',
  query: z.object({
    state: z.enum(['open', 'done', 'cancelled']).optional(),
    all: z.enum(['true', 'false']).optional(),
  }),
  response: z.object({ items: z.array(AutomationTask) }),
});

export const automationTaskAdvance = defineOperation({
  operationId: 'automationTasks.advance',
  method: 'POST',
  path: '/automation-tasks/:id/advance',
  summary: 'Avança a tarefa (PDCA: uma fase por vez) ou cancela',
  params: z.object({ id: Uuid }),
  body: z.object({ action: z.enum(['advance', 'cancel']) }),
  response: z.object({ state: z.string(), pdca_phase: z.string().nullable() }),
  status: 201,
  errors: ['validation_failed', 'not_found', 'conflict'],
});

export const automationReportOutput = defineOperation({
  operationId: 'automationReports.detail',
  method: 'GET',
  path: '/automation-report-outputs/:id',
  summary: 'Um relatório agendado entregue',
  description: 'Só ao destinatário: o conteúdo foi gerado no recorte de escopo dele.',
  params: z.object({ id: Uuid }),
  response: z.object({
    id: Uuid,
    rule_id: Uuid,
    rule_name: z.string(),
    schedule_slot: Timestamp,
    recipient_membership_id: Uuid,
    tier: z.enum(['basic', 'advanced', 'expert']),
    filters: z.record(z.string(), z.unknown()),
    sections: z.array(z.record(z.string(), z.unknown())),
    email_state: z.string(),
    created_at: Timestamp,
  }),
  errors: ['not_found'],
});
