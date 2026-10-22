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

/**
 * A carga de uma pessoa num dia.
 *
 * `capacityMinutes` pode ser `null`, e aí `percent` também é — e isso NÃO é
 * zero. Um técnico sem jornada cadastrada não está com o dia livre: está com o
 * cadastro incompleto. Mostrar 0% seria dizer a coisa errada com confiança.
 */
export const LoadSummary = z.object({
  bookedMinutes: z.number().int(),
  capacityMinutes: z.number().int().nullable(),
  percent: z.number().nullable(),
  over: z.boolean(),
});

export const ResourceLoad = z.object({
  membershipId: Uuid,
  name: z.string().nullable(),
  load: LoadSummary,
  /**
   * Ausente entra como AUSENTE, e não como "sem trabalho".
   *
   * São a mesma linha vazia na tela e coisas opostas na cabeça de quem
   * programa: um dia livre convida a colocar trabalho; férias não.
   */
  absent: z.boolean(),
  entries: z.array(z.record(z.string(), z.unknown())),
});
export type ResourceLoad = z.infer<typeof ResourceLoad>;

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
  response: z.object({ items: z.array(ResourceLoad) }),
});

/**
 * Um item de um dos três baldes da agenda.
 *
 * Estava escrito `z.record(z.string(), z.unknown())` — "um objeto, sei lá com
 * o quê dentro". O custo apareceu duas vezes na mesma tela: a lista usava
 * `os.id`, campo que nunca existiu (a consulta devolve `work_order_id`), e
 * como toda chave do React virava `undefined`, dois itens no mesmo balde
 * colidiam; e o mesmo `undefined` ia como `workOrderId` na hora de gravar a
 * programação. Nenhuma das duas coisas o compilador podia ver, porque o
 * contrato não afirmava nada.
 *
 * A regra que fica: contrato de leitura descreve os campos. `unknown` só onde
 * a forma é genuinamente aberta.
 */
export const AgendaBucketItem = z.object({
  /** É a OS. Não existe `id` aqui — é este o campo. */
  work_order_id: Uuid,
  number: z.string().nullable(),
  title: z.string(),
  status_category: z.string(),
  priority: z.string(),
  scheduled_start: Timestamp.nullable(),
  scheduled_end: Timestamp.nullable(),
  started_at: Timestamp.nullable(),
  due_at: Timestamp.nullable(),
  assignee_membership_id: Uuid.nullable(),
  assignee_name: z.string().nullable(),
  customer_name: z.string().nullable(),
  location_name: z.string().nullable(),
  /**
   * Quantas vezes a janela já foi remarcada, e se a atual foi invalidada.
   *
   * Vem para a lista porque é sinal de problema: uma OS remarcada quatro vezes
   * não é um item comum do balde, é um caso que a coordenação precisa ver.
   */
  reschedule_count: z.number().int(),
  window_invalidated_at: Timestamp.nullable(),
  window_invalidated_reason: z.string().nullable(),
  /**
   * O balde do painel lateral.
   *
   * ESTES SÃO OS VALORES QUE O SERVIDOR DE FATO DEVOLVE, e o contrato dizia
   * outros: `['unscheduled', 'overdue', 'today']`. Nenhum dos dois inventados
   * existe — `SCHEDULE_BUCKETS` em `@aurora/domain` é `late | unscheduled |
   * to_reschedule`, e é ele que a consulta usa.
   *
   * O erro sobreviveu porque nenhuma tela lia o campo: a agenda filtrava por
   * posição na lista, e o painel nem existia. A primeira tela a usá-lo
   * encontrou três baldes vazios com os dados todos presentes na resposta.
   *
   * Não há "hoje" entre eles, e isso é do desenho: o balde responde "o que
   * precisa de DECISÃO", e uma OS marcada para daqui a duas horas não precisa
   * de nenhuma. A agenda do dia é outra lente — `schedule.calendar`.
   */
  bucket: z.enum(['late', 'unscheduled', 'to_reschedule']),
  /** Duração da janela marcada, quando existe janela. */
  minutes: z.number().int().nullable(),
});
export type AgendaBucketItem = z.infer<typeof AgendaBucketItem>;

export const scheduleBuckets = defineOperation({
  operationId: 'schedule.buckets',
  method: 'GET',
  path: '/schedule/buckets',
  summary: 'O que está sem data, atrasado ou marcado para hoje',
  description:
    'Os contadores vêm prontos do servidor: fazer a tela contar significaria carregar a lista ' +
    'inteira só para exibir três números.',
  permissions: ['work_order.read'],
  query: z.object({ customer: Uuid.optional() }),
  response: z.object({
    labels: z.record(z.string(), z.string()),
    counts: z.record(z.string(), z.number()),
    items: z.array(AgendaBucketItem),
  }),
});

export { Timestamp };
