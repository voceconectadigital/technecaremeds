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
  actions_run: z.number().int().nullable(),
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
