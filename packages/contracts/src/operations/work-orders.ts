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

/**
 * As categorias de situação, como o domínio as define.
 *
 * ESTAS DUAS LISTAS ESTAVAM ERRADAS, e erradas de um jeito que não doía.
 *
 * A daqui tinha cinco valores — `open`, `in_progress`, `waiting`, `done`,
 * `cancelled` — e o domínio tem nove: faltavam `draft`, `scheduled`, `review`
 * e `closed`. Como o cliente CONFERE a resposta contra o contrato em
 * desenvolvimento, uma OS agendada ou em revisão fazia a tela inteira falhar
 * — e não falhava só porque nenhuma massa de teste tinha chegado nesses
 * estados. Era uma bomba com pino, esperando a primeira OS agendada.
 *
 * A de prioridade era pior: `normal`, `high` e `critical` não existem em lugar
 * nenhum do sistema. O tipo do PostgreSQL é `request_priority`, com `urgent`,
 * `very_urgent` e `emergency`. O contrato descrevia um vocabulário que o banco
 * não sabe produzir — três dos cinco valores eram ficção.
 *
 * A duplicação em relação a `@aurora/domain` é deliberada (este pacote não
 * depende de nenhum outro, porque é ele que o navegador carrega), e o preço
 * dela é cobrado por um teste que falha se as listas divergirem.
 */
export const STATUS_CATEGORIES = [
  'draft',
  'open',
  'scheduled',
  'in_progress',
  'waiting',
  'review',
  'done',
  'closed',
  'cancelled',
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/**
 * A urgência, no vocabulário que o banco realmente grava.
 *
 * É a mesma escala da solicitação, e de propósito: a OS nasce do que o cliente
 * pediu, e traduzir "muito urgente" para "alta" na fronteira faria a triagem
 * discutir com o solicitante sobre uma palavra que o sistema trocou sozinho.
 */
export const WORK_ORDER_PRIORITIES = ['none', 'low', 'urgent', 'very_urgent', 'emergency'] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

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

/**
 * Uma mudança de estado no histórico.
 *
 * `seconds_in_from` é quanto tempo a OS passou no estado ANTERIOR, e é a
 * informação que transforma um histórico em diagnóstico: "parada 6 dias
 * aguardando peça" responde a pergunta que "mudou para Aguardando" não
 * responde.
 */
export const WorkOrderHistoryEntry = z.object({
  changed_at: Timestamp,
  seconds_in_from: z.number().int().nullable(),
  from_category: z.string().nullable(),
  to_category: z.string(),
  from_label: z.string().nullable(),
  to_label: z.string(),
  wait_reason_label: z.string().nullable(),
});
export type WorkOrderHistoryEntry = z.infer<typeof WorkOrderHistoryEntry>;

/** Um relógio de SLA, com o percentual já consumido em tempo ÚTIL. */
export const SlaClock = z.object({
  id: Uuid,
  kind: z.string(),
  state: z.string(),
  due_at: Timestamp,
  target_minutes: z.number().int(),
  paused_minutes: z.number().int(),
  /**
   * Minutos ÚTEIS decorridos — não relógio de parede.
   *
   * A diferença é o produto inteiro: um chamado aberto sexta às 17h com prazo
   * de 4 horas vence terça de manhã, e não sábado de madrugada.
   */
  elapsed_business_minutes: z.number().int().nullable(),
  breached_at: Timestamp.nullable(),
  consumed_pct: z.number(),
});
export type SlaClock = z.infer<typeof SlaClock>;

/**
 * A ficha completa da ordem de serviço.
 *
 * ERA `.loose()`, e a rota devolvia `w.*`. As duas coisas juntas significavam
 * que a resposta real tinha 20 campos a mais do que o contrato descrevia — e a
 * tela não podia usar nenhum deles sem adivinhar o nome. A resolução, a causa,
 * o responsável e o solicitante estavam TODOS ali, trafegando, invisíveis para
 * o compilador e por isso ausentes da interface.
 *
 * O objeto agora é estrito. Campo novo na tabela não chega mais ao navegador
 * por acidente: alguém precisa escrevê-lo aqui, e ao escrever decide se ele
 * deve mesmo sair do servidor.
 */
export const WorkOrderDetail = z.object({
  /* --- identificação ---------------------------------------------------- */
  id: Uuid,
  number: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  source: z.string().nullable(),
  version: z.number().int(),

  /* --- situação --------------------------------------------------------- */
  status_id: Uuid,
  status_key: z.string(),
  status_label: z.string(),
  status_category: z.enum(STATUS_CATEGORIES),
  requires_wait_reason: z.boolean().nullable().optional(),
  wait_reason_id: Uuid.nullable(),
  wait_reason_key: z.string().nullable(),
  wait_reason_label: z.string().nullable(),
  /** Se este motivo de parada pausa o relógio do prazo. */
  pauses_sla: z.boolean().nullable(),
  /** O detalhe da parada: "aguardando cliente" sem o quê? */
  wait_note: z.string().nullable(),
  priority: z.enum(WORK_ORDER_PRIORITIES),
  criticality_id: Uuid.nullable(),
  criticality_label: z.string().nullable(),

  /* --- a quem e onde ---------------------------------------------------- */
  customer_id: Uuid,
  customer_name: z.string(),
  location_id: Uuid.nullable(),
  location_name_snapshot: z.string().nullable(),
  /**
   * O caminho completo do local, como era na abertura.
   *
   * É instantâneo, e não junção: o setor pode ser renomeado ou movido depois,
   * e a ficha de um atendimento de março não deve mudar porque a árvore de
   * locais foi reorganizada em agosto.
   */
  location_path_snapshot: z.string().nullable(),
  asset_id: Uuid.nullable(),
  asset_name_snapshot: z.string().nullable(),
  asset_serial_snapshot: z.string().nullable(),

  /* --- quem faz --------------------------------------------------------- */
  assignee_membership_id: Uuid.nullable(),
  assignee_name: z.string().nullable(),
  team_id: Uuid.nullable(),
  team_name: z.string().nullable(),
  created_by_name: z.string().nullable(),

  /* --- de onde veio ----------------------------------------------------- */
  service_request_id: Uuid.nullable(),
  service_request_number: z.string().nullable(),
  parent_work_order_id: Uuid.nullable(),
  contract_id: Uuid.nullable(),
  work_order_type_id: Uuid,
  work_order_type_label: z.string(),

  /* --- diagnóstico e solução -------------------------------------------- */
  reported_failure_code_id: Uuid.nullable(),
  reported_failure_label: z.string().nullable(),
  cause_failure_code_id: Uuid.nullable(),
  cause_failure_label: z.string().nullable(),
  action_code_id: Uuid.nullable(),
  action_label: z.string().nullable(),
  resolution: z.string().nullable(),

  /* --- agenda e marcos -------------------------------------------------- */
  scheduled_start: Timestamp.nullable(),
  scheduled_end: Timestamp.nullable(),
  /**
   * Quantas vezes a janela foi remarcada.
   *
   * Aparece na ficha porque remarcar quatro vezes não é detalhe de agenda: é o
   * sintoma de um atendimento que ninguém está conseguindo fazer.
   */
  reschedule_count: z.number().int(),
  window_invalidated_at: Timestamp.nullable(),
  window_invalidated_reason: z.string().nullable(),
  started_at: Timestamp.nullable(),
  completed_at: Timestamp.nullable(),
  validated_at: Timestamp.nullable(),
  closed_at: Timestamp.nullable(),
  created_at: Timestamp,
  updated_at: Timestamp,

  /* --- desfechos que precisam de explicação ------------------------------ */
  cancellation_reason: z.string().nullable(),
  rework_reason: z.string().nullable(),
  reopen_reason: z.string().nullable(),

  /* --- Preencher Ordem de Serviço (16/10/2026); opcionais por causa da demo */
  service_description: z.string().nullable().optional(),
  service_observations: z.string().nullable().optional(),
  /** Situação de uso após o serviço — não é veredito metrológico. */
  operational_result: z.enum(['released', 'stopped']).nullable().optional(),
  final_opinion: z.string().nullable().optional(),
  service_report_updated_at: z.string().nullable().optional(),
  /** O orçamento vivo ligado a esta OS, se houver. */
  quote_summary: z
    .object({
      id: Uuid,
      number: z.string(),
      version: z.number().int(),
      status: z.string(),
      total_cents: z.string(),
    })
    .nullable()
    .optional(),

  /* --- agregados -------------------------------------------------------- */
  history: z.array(WorkOrderHistoryEntry),
  /** O SLA vem na ficha porque é o que decide a ordem do dia de quem atende. */
  sla: z.array(SlaClock).nullable(),
  available_transitions: z.array(WorkOrderTransition),
});
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

export const WaitReason = z.object({
  id: Uuid,
  key: z.string(),
  label: z.string(),
  /**
   * Se este motivo PAUSA o relógio do SLA.
   *
   * Muda o significado da escolha, e por isso vem junto: parar por peça do
   * fabricante não conta contra o SLA; parar por falta de técnico conta. Quem
   * escolhe precisa ver isso ANTES de escolher.
   */
  pauses_sla: z.boolean(),
  responsible: z.string().nullable(),
  /** Alguns motivos exigem explicação: "aguardando cliente" sem o quê? */
  requires_note: z.boolean(),
  position: z.number().int(),
});
export type WaitReason = z.infer<typeof WaitReason>;

export const workOrderWaitReasons = defineOperation({
  operationId: 'workOrders.waitReasons',
  method: 'GET',
  path: '/work-orders/wait-reasons',
  summary: 'Motivos de espera desta organização',
  description:
    'Rota própria, e não parte de /catalogs: motivo de espera carrega `pauses_sla` e ' +
    '`requires_note`, que o catálogo genérico não tem — e são justamente as duas coisas que a ' +
    'tela precisa saber para pedir a informação certa.',
  permissions: ['work_order.read'],
  response: z.object({ items: z.array(WaitReason) }),
});

export const workOrderStatuses = defineOperation({
  operationId: 'workOrders.statuses',
  method: 'GET',
  path: '/work-orders/statuses',
  summary: 'Os estados desta organização, na ordem do quadro',
  permissions: ['work_order.read'],
  response: z.object({ items: z.array(z.record(z.string(), z.unknown())) }),
});
