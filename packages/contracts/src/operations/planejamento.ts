/**
 * Aurora — Planos de Manutenção: criação orientada, painel, cronograma e
 * procedimentos (checklists versionados).
 *
 * O MOTOR É O DE SEMPRE. Plano/tarefa/ciclo da 0029 (+0055), checklist
 * versionado da 0024 (+0052, `procedure_kind`). Nenhuma rota aqui cria
 * segunda forma de plano, de checklist ou de calendário: a criação orientada
 * grava `maintenance_plans` + `plan_tasks`; o cronograma lê os itens de ciclo
 * e projeta os ciclos futuros pela frequência (marcados como previstos, nunca
 * gravados); a Agenda continua sendo a das OS.
 *
 * TIPO DE PLANO ≠ TIPO DE CONTRATO. O tipo aqui é a natureza do serviço
 * (preventiva, calibração, TSE, qualificação), derivada da natureza da OS e
 * do `procedure_kind` do checklist. Educação continuada não existe no
 * domínio e não é aceita.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';
import { PLAN_FREQUENCY_UNITS } from './plans';

export const PLAN_KINDS = ['preventive', 'calibration', 'electrical_safety', 'qualification'] as const;
export const PROCEDURE_KINDS = ['calibration', 'electrical_safety', 'qualification', 'acceptance'] as const;

/* -------------------------------------------------------------------------- */
/* criação orientada                                                           */
/* -------------------------------------------------------------------------- */

export const plansCreate = defineOperation({
  operationId: 'plans.create',
  method: 'POST',
  path: '/maintenance-plans',
  summary: 'Cria um plano: cliente → setor → equipamentos → tipo → procedimento → periodicidade',
  description:
    'Sem `asset_ids`, o alvo é o SETOR inteiro como expressão (o equipamento que chegar depois ' +
    'entra sozinho). Com `asset_ids`, uma tarefa por equipamento. O servidor confere que setor e ' +
    'equipamentos são do cliente informado e estão no escopo de quem cadastra; o procedimento ' +
    'precisa estar publicado e ser do mesmo tipo do plano.',
  permissions: ['maintenance_plan.create'],
  body: z
    .object({
      name: z.string().trim().min(3).max(200),
      description: z.string().trim().max(2000).optional(),
      customer_id: Uuid,
      sector_id: Uuid,
      asset_ids: z.array(Uuid).max(500).default([]),
      kind: z.enum(PLAN_KINDS),
      checklist_template_key: z.string().trim().min(2).max(64).nullable().optional(),
      frequency_unit: z.enum(PLAN_FREQUENCY_UNITS),
      frequency_interval: z.number().int().min(1).max(60),
      /** Data civil (AAAA-MM-DD) de onde o primeiro ciclo começa a contar. */
      anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      lead_time_days: z.number().int().min(0).max(365).default(7),
      tolerance_days: z.number().int().min(0).max(90).default(3),
      auto_generate: z.boolean().default(true),
      estimated_duration_min: z.number().int().min(1).max(10_000).nullable().optional(),
    })
    .strict(),
  response: z.object({ id: Uuid, task_count: z.number().int() }),
  errors: ['not_found', 'validation_failed'],
});

export const plansFormOptions = defineOperation({
  operationId: 'plans.formOptions',
  method: 'GET',
  path: '/maintenance-plans/form-options',
  summary: 'O que o formulário de plano oferece: tipos suportados e procedimentos publicados',
  description:
    'Um tipo só aparece como disponível quando a natureza de OS dele existe no catálogo desta ' +
    'organização. Os procedimentos são a versão publicada mais recente de cada checklist.',
  permissions: ['maintenance_plan.read'],
  response: z.object({
    kinds: z.array(
      z.object({
        key: z.enum(PLAN_KINDS),
        available: z.boolean(),
        work_order_type: z.string(),
        procedure_kind: z.enum(PROCEDURE_KINDS).nullable(),
      })
    ),
    templates: z.array(
      z.object({
        key: z.string(),
        title: z.string(),
        version: z.number().int(),
        procedure_kind: z.enum(PROCEDURE_KINDS).nullable(),
        item_count: z.number().int(),
      })
    ),
  }),
});

/* -------------------------------------------------------------------------- */
/* painel e cronograma                                                         */
/* -------------------------------------------------------------------------- */

const Estados = z.object({
  done: z.number().int(),
  pending: z.number().int(),
  late: z.number().int(),
  skipped: z.number().int(),
});

const FiltroDoPlano = z.object({
  from: z.string(),
  to: z.string(),
  customer: Uuid.optional(),
  sector: Uuid.optional(),
});

export const plansBoard = defineOperation({
  operationId: 'plans.board',
  method: 'GET',
  path: '/maintenance-plans/board',
  summary: 'Programados, realizados, pendentes, vencidos e dispensados — por tipo, cliente, setor e mês',
  description:
    'Lê os itens de ciclo EXISTENTES com vencimento no período, com a tolerância de cada tarefa ' +
    '(mesma regra da conformidade). O que ainda não foi gerado não entra: é previsão, e aparece ' +
    'só no cronograma. Taxa = realizados ÷ (programados − dispensados).',
  permissions: ['maintenance_plan.read'],
  query: FiltroDoPlano,
  response: z.object({
    totals: Estados.extend({ scheduled: z.number().int() }),
    rate: z.number().nullable(),
    byKind: z.array(Estados.extend({ key: z.string() })),
    byCustomer: z.array(Estados.extend({ key: z.string(), label: z.string() })),
    bySector: z.array(Estados.extend({ key: z.string(), label: z.string() })),
    byMonth: z.array(Estados.extend({ key: z.string() })),
    plans: z.object({ active: z.number().int(), tasks: z.number().int() }),
  }),
  errors: ['not_found', 'validation_failed'],
});

export const ScheduleEntry = z.object({
  id: Uuid.nullable(),
  /** Verdadeiro: ciclo futuro calculado pela frequência — não existe no banco. */
  projected: z.boolean(),
  due_at: Timestamp,
  state: z.enum(['done', 'pending', 'late', 'skipped', 'planned']),
  plan_id: Uuid,
  plan_name: z.string(),
  task_name: z.string(),
  kind: z.string(),
  customer_id: Uuid,
  customer_name: z.string(),
  sector_name: z.string().nullable(),
  asset_id: Uuid,
  asset_name: z.string(),
  work_order_id: Uuid.nullable(),
  work_order_number: z.string().nullable(),
});
export type ScheduleEntry = z.infer<typeof ScheduleEntry>;

export const plansSchedule = defineOperation({
  operationId: 'plans.schedule',
  method: 'GET',
  path: '/maintenance-plans/schedule',
  summary: 'Cronograma: atividades reais do período e as previstas pela frequência',
  permissions: ['maintenance_plan.read'],
  query: FiltroDoPlano,
  response: z.object({ items: z.array(ScheduleEntry), truncated: z.boolean() }),
  errors: ['not_found', 'validation_failed'],
});

/* -------------------------------------------------------------------------- */
/* procedimentos (checklists versionados)                                      */
/* -------------------------------------------------------------------------- */

export const TemplateRow = z.object({
  id: Uuid,
  key: z.string(),
  version: z.number().int(),
  title: z.string(),
  description: z.string(),
  status: z.enum(['draft', 'published', 'archived']),
  procedure_kind: z.enum(PROCEDURE_KINDS).nullable(),
  item_count: z.number().int(),
  published_version: z.number().int().nullable(),
  updated_at: Timestamp,
});
export type TemplateRow = z.infer<typeof TemplateRow>;

export const checklistTemplatesList = defineOperation({
  operationId: 'checklistTemplates.list',
  method: 'GET',
  path: '/checklist-templates',
  summary: 'Checklists e procedimentos: a versão mais recente de cada um',
  permissions: ['procedure.read'],
  query: z.object({ kind: z.enum([...PROCEDURE_KINDS, 'none']).optional() }),
  response: z.object({ items: z.array(TemplateRow) }),
});

/**
 * Os tipos de item que a tela oferece — TODOS já existentes no motor.
 * Medição: nominal e tolerâncias são DADO; o veredito continua `na`.
 */
export const CHECKLIST_ITEM_KINDS = [
  'text',
  'number',
  'boolean',
  'option',
  'multi_option',
  'photo',
  'date',
  'measurement',
] as const;

export const TemplateItem = z
  .object({
    kind: z.enum(CHECKLIST_ITEM_KINDS),
    label: z.string().trim().min(1).max(300),
    required: z.boolean().default(true),
    options: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    failing_options: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    unit: z.string().trim().min(1).max(20).nullable().optional(),
    nominal_value: z.number().nullable().optional(),
    tolerance_minus: z.number().min(0).nullable().optional(),
    tolerance_plus: z.number().min(0).nullable().optional(),
    tolerance_mode: z.enum(['absolute', 'percent']).nullable().optional(),
    readings_required: z.number().int().min(1).max(50).nullable().optional(),
  })
  .strict();
export type TemplateItem = z.infer<typeof TemplateItem>;

const CorpoDoModelo = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  items: z.array(TemplateItem).min(1).max(200),
  /** Publica na mesma operação. Publicada, a versão fica imutável. */
  publish: z.boolean().default(false),
});

export const checklistTemplatesCreate = defineOperation({
  operationId: 'checklistTemplates.create',
  method: 'POST',
  path: '/checklist-templates',
  summary: 'Cria um checklist/procedimento (versão 1), com os itens',
  permissions: ['procedure.create'],
  body: CorpoDoModelo.extend({ procedure_kind: z.enum(PROCEDURE_KINDS).nullable().default(null) }).strict(),
  response: z.object({ id: Uuid, key: z.string() }),
  errors: ['validation_failed', 'conflict'],
});

export const checklistTemplatesDetail = defineOperation({
  operationId: 'checklistTemplates.detail',
  method: 'GET',
  path: '/checklist-templates/:id',
  summary: 'Um checklist, com os itens e as versões',
  permissions: ['procedure.read'],
  params: z.object({ id: Uuid }),
  response: z.object({
    template: TemplateRow.extend({ supersedes_id: Uuid.nullable(), published_at: Timestamp.nullable() }),
    items: z.array(
      z.object({
        id: Uuid,
        kind: z.string(),
        label: z.string(),
        required: z.boolean(),
        position: z.number().int(),
        options: z.array(z.string()),
        failing_options: z.array(z.string()),
        min_value: z.number().nullable(),
        max_value: z.number().nullable(),
        unit: z.string().nullable(),
        expected_boolean: z.boolean().nullable(),
        nominal_value: z.number().nullable(),
        tolerance_minus: z.number().nullable(),
        tolerance_plus: z.number().nullable(),
        tolerance_mode: z.string().nullable(),
        readings_required: z.number().int().nullable(),
      })
    ),
    versions: z.array(z.object({ id: Uuid, version: z.number().int(), status: z.string() })),
  }),
  errors: ['not_found'],
});

export const checklistTemplatesRevise = defineOperation({
  operationId: 'checklistTemplates.revise',
  method: 'POST',
  path: '/checklist-templates/:id/revisions',
  summary: 'Nova revisão (versão seguinte) de um checklist, com os itens',
  description:
    'A versão anterior continua valendo para as OS que já a usaram: a resposta congela a ' +
    'versão. O tipo de procedimento não muda entre versões.',
  permissions: ['procedure.update'],
  params: z.object({ id: Uuid }),
  body: CorpoDoModelo.strict(),
  response: z.object({ id: Uuid, key: z.string(), version: z.number().int() }),
  errors: ['not_found', 'validation_failed', 'conflict'],
});

export const checklistTemplatesPublish = defineOperation({
  operationId: 'checklistTemplates.publish',
  method: 'POST',
  path: '/checklist-templates/:id/publish',
  summary: 'Publica a versão em rascunho (a partir daí, imutável)',
  permissions: ['procedure.publish'],
  params: z.object({ id: Uuid }),
  response: z.object({ ok: z.literal(true) }),
  errors: ['not_found', 'conflict', 'validation_failed'],
});
