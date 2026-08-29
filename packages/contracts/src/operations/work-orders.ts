/**
 * Aurora — ordens de serviço (SPEC v0.2 §09, §10 · EPIC-008, EPIC-009).
 *
 * O ESTADO NÃO É UM ENUMERADO FIXO.
 *
 * Cada organização define os seus estados, e o que o código conhece é a
 * CATEGORIA (`open`, `in_progress`, `waiting`, `done`, `cancelled`) — é ela
 * que carrega o significado para relatório e automação. Por isso `status_key`
 * é texto livre aqui: fixá-lo num enumerado quebraria a primeira organização
 * que criasse "aguardando peça do fabricante".
 */
import { defineOperation } from '../registry';
import { z, Uuid, NonEmpty, Timestamp } from '../primitives';

export const STATUS_CATEGORIES = ['open', 'in_progress', 'waiting', 'done', 'cancelled'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const WORK_ORDER_PRIORITIES = ['none', 'low', 'normal', 'high', 'critical'] as const;

export const WorkOrderRow = z.object({
  id: Uuid,
  number: z.string().nullable(),
  title: z.string(),
  category: z.enum(STATUS_CATEGORIES),
  priority: z.enum(WORK_ORDER_PRIORITIES),
  customer_id: Uuid,
  asset_id: Uuid.nullable(),
  /**
   * Nome do local e do ativo CONGELADOS na criação.
   *
   * A lista mostra o nome que valia quando a OS nasceu. Um equipamento
   * transferido de setor não reescreve a história das OS antigas — quem ler
   * daqui a um ano precisa ver onde ele estava, não onde está.
   */
  location_name_snapshot: z.string().nullable(),
  asset_name_snapshot: z.string().nullable(),
  scheduled_start: Timestamp.nullable(),
  created_at: Timestamp,
  version: z.number().int(),
  status_key: z.string(),
  status_label: z.string(),
  status_color: z.string().nullable(),
  wait_reason_key: z.string().nullable(),
  wait_reason_label: z.string().nullable(),
});
export type WorkOrderRow = z.infer<typeof WorkOrderRow>;

/** Uma coluna do quadro: o estado, quantas OS nele e por que estão paradas. */
export const BoardColumn = z.object({
  id: Uuid,
  key: z.string(),
  label: z.string(),
  category: z.enum(STATUS_CATEGORIES),
  color: z.string().nullable(),
  position: z.number().int(),
  total: z.number().int(),
  /**
   * A quebra por motivo de espera.
   *
   * É a pergunta que o §09 destravou e que a referência não respondia: "está
   * parado" não é diagnóstico — "sete esperando peça, três esperando o
   * cliente" é. `pauses_sla` diz quais desses relógios estão pausados.
   */
  by_wait_reason: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      pauses_sla: z.boolean(),
      total: z.number().int(),
    })
  ),
});
export type BoardColumn = z.infer<typeof BoardColumn>;

/**
 * Uma transição possível AGORA, para ESTA pessoa, com o que ela exige.
 *
 * `requires` traz os campos que faltam — motivo de espera, resolução, código
 * de causa. A tela pede ANTES de enviar; sem isso o Kanban vira tentativa e
 * erro, que é exatamente o que a auditoria registrou como reclamação.
 */
export const WorkOrderTransition = z.object({
  to: z.string(),
  label: z.string(),
  category: z.enum(STATUS_CATEGORIES),
  permission: z.string(),
  allowed: z.boolean(),
  requires: z.array(z.string()),
  note: z.string().nullable().optional(),
});
export type WorkOrderTransition = z.infer<typeof WorkOrderTransition>;

export const WorkOrderDetail = z
  .object({
    id: Uuid,
    number: z.string().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    status_category: z.enum(STATUS_CATEGORIES),
    status_key: z.string(),
    status_label: z.string(),
    requires_wait_reason: z.boolean().nullable().optional(),
    wait_reason_key: z.string().nullable(),
    wait_reason_label: z.string().nullable(),
    pauses_sla: z.boolean().nullable(),
    priority: z.enum(WORK_ORDER_PRIORITIES),
    customer_id: Uuid,
    customer_name: z.string(),
    work_order_type_label: z.string(),
    asset_id: Uuid.nullable(),
    asset_name_snapshot: z.string().nullable(),
    location_name_snapshot: z.string().nullable(),
    assignee_membership_id: Uuid.nullable(),
    scheduled_start: Timestamp.nullable(),
    scheduled_end: Timestamp.nullable(),
    created_at: Timestamp,
    version: z.number().int(),
    history: z.array(z.record(z.string(), z.unknown())),
    /** O SLA vem na ficha porque é o que decide a ordem do dia de quem atende. */
    sla: z.array(z.record(z.string(), z.unknown())).nullable(),
    available_transitions: z.array(WorkOrderTransition),
  })
  .loose();
export type WorkOrderDetail = z.infer<typeof WorkOrderDetail>;

export const workOrdersList = defineOperation({
  operationId: 'workOrders.list',
  method: 'GET',
  path: '/work-orders',
  summary: 'Ordens de serviço, das mais recentes para as mais antigas',
  permissions: ['work_order.read'],
  query: z.object({
    customer: Uuid.optional(),
    category: z.enum(STATUS_CATEGORIES).optional(),
    assignee: Uuid.optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  }),
  response: z.object({ items: z.array(WorkOrderRow) }),
});

export const workOrdersBoard = defineOperation({
  operationId: 'workOrders.board',
  method: 'GET',
  path: '/work-orders/board',
  summary: 'Quadro por estado, com a quebra por motivo de espera',
  permissions: ['work_order.read'],
  query: z.object({ customer: Uuid.optional() }),
  response: z.object({ columns: z.array(BoardColumn) }),
});

export const workOrderDetail = defineOperation({
  operationId: 'workOrders.detail',
  method: 'GET',
  path: '/work-orders/:id',
  summary: 'Ficha da OS, com histórico, SLA e transições disponíveis',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  response: WorkOrderDetail,
  errors: ['not_found'],
});

export const workOrderTransition = defineOperation({
  operationId: 'workOrders.transition',
  method: 'POST',
  path: '/work-orders/:id/transitions',
  summary: 'Move a OS de estado',
  description:
    'O ARRASTAR DO QUADRO PASSA POR AQUI. A tela não muda a coluna e avisa depois: ela pede a ' +
    'transição, espera a resposta e só então move o cartão. Recusado, o cartão volta com a ' +
    'explicação. `version` habilita o bloqueio otimista — dois coordenadores na mesma OS ao ' +
    'mesmo tempo é o caso normal, não a exceção.',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  body: z.object({
    to: NonEmpty,
    wait_reason_id: Uuid.nullable().optional(),
    wait_note: z.string().nullable().optional(),
    resolution: z.string().nullable().optional(),
    cancellation_reason: z.string().nullable().optional(),
    rework_reason: z.string().nullable().optional(),
    reopen_reason: z.string().nullable().optional(),
    cause_failure_code_id: Uuid.nullable().optional(),
    action_code_id: Uuid.nullable().optional(),
    assignee_membership_id: Uuid.nullable().optional(),
    scheduled_start: z.string().nullable().optional(),
    scheduled_end: z.string().nullable().optional(),
    version: z.number().int().optional(),
  }),
  response: z.object({
    status: z.string(),
    category: z.enum(STATUS_CATEGORIES),
    version: z.number().int(),
  }),
  status: 201,
  errors: ['not_found', 'conflict', 'forbidden'],
});

export const workOrdersFromRequest = defineOperation({
  operationId: 'workOrders.fromRequest',
  method: 'POST',
  path: '/work-orders/from-request/:requestId',
  summary: 'Aceita a solicitação e gera as ordens de serviço',
  description:
    'Uma solicitação pode virar VÁRIAS ordens — o pedido "os três ventiladores da UTI estão ' +
    'com alarme" é um pedido só e três trabalhos. Aceitar e gerar acontecem na mesma ' +
    'transação: solicitação aceita sem OS é trabalho que ninguém vai fazer.',
  permissions: ['work_order.create'],
  params: z.object({ requestId: Uuid }),
  body: z.object({
    targets: z
      .array(
        z.object({
          work_order_type_id: Uuid,
          asset_id: Uuid.nullable().optional(),
          location_id: Uuid.nullable().optional(),
          title: z.string().optional(),
          assignee_membership_id: Uuid.nullable().optional(),
        })
      )
      .min(1)
      .max(50),
  }),
  response: z.object({ work_orders: z.array(z.record(z.string(), z.unknown())) }),
  status: 201,
  errors: ['not_found', 'conflict'],
});

export const workOrderStatuses = defineOperation({
  operationId: 'workOrders.statuses',
  method: 'GET',
  path: '/work-orders/statuses',
  summary: 'Os estados desta organização, na ordem do quadro',
  permissions: ['work_order.read'],
  response: z.object({ items: z.array(z.record(z.string(), z.unknown())) }),
});
