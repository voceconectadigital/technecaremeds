/**
 * Aurora — agenda (SPEC v0.2 §13 · EPIC-012).
 *
 * A REGRA: CONFERIR ANTES DE SALVAR.
 *
 * Descobrir o conflito DEPOIS de salvar é o que faz programar custar mais do
 * que ligar para o técnico — e é o problema que o §13 existe para resolver. Por
 * isso `/schedule/check` existe separado de `/schedule`: a tela pergunta
 * enquanto a pessoa arrasta e mostra o conflito ANTES de ela soltar.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const CONFLICT_KINDS = [
  'absence',
  'overlap',
  'outside_working_hours',
  'travel_time',
  'over_capacity',
] as const;

/**
 * Um conflito.
 *
 * `severity` separa o que IMPEDE do que AVISA, e a diferença é a decisão
 * inteira: férias do técnico bloqueiam; sobrecarga do dia avisa e deixa o
 * coordenador decidir, porque só ele sabe que aquele chamado é do hospital que
 * está sem nenhum ventilador reserva.
 *
 * `detail` é frase pronta, e não código: quem decide precisa ler "Rafael está
 * de férias de 12 a 20/03", não `ABSENCE_CONFLICT`.
 */
export const ScheduleConflict = z.object({
  kind: z.enum(CONFLICT_KINDS),
  severity: z.enum(['block', 'warn']),
  detail: z.string(),
  referenceId: z.string().optional(),
});
export type ScheduleConflict = z.infer<typeof ScheduleConflict>;

const Proposta = z.object({
  workOrderId: Uuid,
  startsAt: z.string(),
  endsAt: z.string(),
  assigneeMembershipId: Uuid.nullable().optional(),
});

export const scheduleCheck = defineOperation({
  operationId: 'schedule.check',
  method: 'POST',
  path: '/schedule/check',
  summary: 'Confere a proposta SEM gravar',
  description:
    'A rota do arrasto. Devolve os conflitos que a proposta criaria, separados entre os que ' +
    'impedem e os que apenas avisam. Não altera nada.',
  permissions: ['work_order.schedule'],
  body: Proposta,
  response: z.object({ conflicts: z.array(ScheduleConflict) }),
  status: 201,
});

export const scheduleSet = defineOperation({
  operationId: 'schedule.set',
  method: 'POST',
  path: '/schedule',
  summary: 'Programa a ordem de serviço',
  description:
    'Recusa se houver conflito BLOQUEANTE — a conferência do servidor é a que vale, e a da ' +
    'tela é conveniência. Conflito de aviso passa: quem decide é o coordenador.',
  permissions: ['work_order.schedule'],
  body: Proposta,
  response: z.record(z.string(), z.unknown()),
  status: 201,
  errors: ['conflict', 'not_found'],
});

export const scheduleUnset = defineOperation({
  operationId: 'schedule.unset',
  method: 'POST',
  path: '/schedule/work-orders/:id/unschedule',
  summary: 'Tira a ordem de serviço da agenda',
  permissions: ['work_order.schedule'],
  params: z.object({ id: Uuid }),
  response: z.object({ unscheduled: z.literal(true) }),
  status: 201,
  errors: ['not_found'],
});

export const scheduleCalendar = defineOperation({
  operationId: 'schedule.calendar',
  method: 'GET',
  path: '/schedule',
  summary: 'A agenda no período, por pessoa ou equipe',
  permissions: ['work_order.read'],
  query: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    membershipId: Uuid.optional(),
    teamId: Uuid.optional(),
  }),
  response: z.object({ items: z.array(z.record(z.string(), z.unknown())) }),
});

export const scheduleResources = defineOperation({
  operationId: 'schedule.resources',
  method: 'GET',
  path: '/schedule/resources',
  summary: 'Pessoas agendáveis, com a carga de cada uma',
  description:
    'A carga vem junto porque atribuir sem ver a carga é como se produz o técnico com onze ' +
    'chamados no dia e o colega com dois.',
  permissions: ['work_order.read'],
  query: z.object({ day: z.string().optional(), teamId: Uuid.optional() }),
  response: z.object({ items: z.array(z.record(z.string(), z.unknown())) }),
});

/** Os três baldes do painel lateral: sem data, atrasadas, para hoje (§13). */
export const scheduleBuckets = defineOperation({
  operationId: 'schedule.buckets',
  method: 'GET',
  path: '/schedule/buckets',
  summary: 'O que está sem data, atrasado ou marcado para hoje',
  description:
    'Os contadores vêm prontos do servidor: fazer a tela contar significaria carregar a lista ' +
    'inteira só para exibir três números.',
  permissions: ['work_order.read'],
  response: z.object({
    labels: z.record(z.string(), z.string()),
    counts: z.record(z.string(), z.number()),
    items: z.array(z.record(z.string(), z.unknown())),
  }),
});

export { Timestamp };
