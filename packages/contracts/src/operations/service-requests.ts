/**
 * Aurora — solicitações (SPEC v0.2 §08 · ADR-002 · EPIC-007).
 *
 * A solicitação é o pedido do cliente; a ordem de serviço é o trabalho da
 * equipe. São entidades distintas, e o ADR-002 comprou com isso uma superfície
 * de escrita estreita para o portal: o cliente escreve em UMA tabela, por DUAS
 * rotas — abrir e cancelar.
 */
import { defineOperation } from '../registry';
import { z, Uuid, NonEmpty, Timestamp } from '../primitives';

export const REQUEST_STATUSES = [
  'draft',
  'submitted',
  'triage',
  'info_needed',
  'accepted',
  'rejected',
  'merged',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_PRIORITIES = ['none', 'low', 'normal', 'high', 'critical'] as const;
export const SERVICE_REQUEST_SOURCES = ['portal', 'phone', 'email', 'walk_in', 'qr', 'system'] as const;

/** A linha da fila de triagem — o mínimo para decidir o que atender primeiro. */
export const ServiceRequestRow = z.object({
  id: Uuid,
  number: z.string(),
  status: z.enum(REQUEST_STATUSES),
  priority: z.enum(REQUEST_PRIORITIES),
  summary: z.string(),
  customer_id: Uuid,
  location_id: Uuid.nullable(),
  asset_id: Uuid.nullable(),
  created_at: Timestamp,
  version: z.number().int(),
});
export type ServiceRequestRow = z.infer<typeof ServiceRequestRow>;

/**
 * Uma transição possível A PARTIR DE AGORA, para ESTA pessoa.
 *
 * Vem do servidor já filtrada pelas permissões efetivas. A interface não
 * descobre o que pode fazer tentando e lendo o erro — era assim na referência,
 * e é a origem da maior parte das reclamações de "o sistema não deixa e não
 * diz por quê".
 */
export const AvailableTransition = z.object({
  to: z.enum(REQUEST_STATUSES),
  /** Campos que a transição exige no corpo. A tela pede ANTES de enviar. */
  requires: z.array(z.string()),
  note: z.string().nullable().optional(),
});

export const ServiceRequestDetail = z
  .object({
    id: Uuid,
    number: z.string(),
    status: z.enum(REQUEST_STATUSES),
    priority: z.enum(REQUEST_PRIORITIES),
    requested_priority: z.enum(REQUEST_PRIORITIES).nullable().optional(),
    summary: z.string(),
    description: z.string().nullable(),
    source: z.string(),
    customer_id: Uuid,
    customer_name: z.string(),
    location_id: Uuid.nullable(),
    location_name: z.string().nullable(),
    asset_id: Uuid.nullable(),
    asset_name: z.string().nullable(),
    reported_failure_label: z.string().nullable(),
    rejection_reason_label: z.string().nullable(),
    requester_name: z.string().nullable(),
    created_at: Timestamp,
    version: z.number().int(),
    history: z.array(
      z.object({
        from_status: z.string().nullable(),
        to_status: z.string(),
        changed_at: Timestamp,
        seconds_in_from: z.string().nullable(),
      })
    ),
    available_transitions: z.array(AvailableTransition),
  })
  // A ficha devolve `r.*`: colunas que a tela não usa hoje passam adiante em
  // vez de fazer a validação falhar por um campo a mais.
  .loose();
export type ServiceRequestDetail = z.infer<typeof ServiceRequestDetail>;

export const requestsQueue = defineOperation({
  operationId: 'serviceRequests.queue',
  method: 'GET',
  path: '/service-requests/queue',
  summary: 'Fila de triagem, na ordem de prioridade e idade',
  description:
    'Só o que aguarda decisão: enviada, em triagem ou aguardando informação. A ordem é a da ' +
    '§08 — prioridade primeiro, idade como desempate.',
  permissions: ['service_request.read'],
  query: z.object({ limit: z.coerce.number().int().positive().max(500).optional() }),
  response: z.object({ items: z.array(ServiceRequestRow) }),
});

export const requestDetail = defineOperation({
  operationId: 'serviceRequests.detail',
  method: 'GET',
  path: '/service-requests/:id',
  summary: 'Ficha da solicitação, com as transições que esta pessoa pode fazer',
  permissions: ['service_request.read'],
  params: z.object({ id: Uuid }),
  response: ServiceRequestDetail,
  errors: ['not_found'],
});

export const requestCreate = defineOperation({
  operationId: 'serviceRequests.create',
  method: 'POST',
  path: '/service-requests',
  summary: 'Abre uma solicitação',
  description:
    'Os avisos de duplicidade vêm na resposta da CRIAÇÃO, e não numa consulta anterior: entre ' +
    '"consultar" e "enviar" alguém pode ter aberto a mesma. Avisar depois, apontando a ' +
    'parecida, é honesto — e continua não bloqueando (§08).',
  permissions: ['service_request.create'],
  body: z.object({
    customer_id: Uuid,
    summary: NonEmpty.min(3),
    description: z.string().optional(),
    source: z.enum(SERVICE_REQUEST_SOURCES).optional(),
    location_id: Uuid.nullable().optional(),
    asset_id: Uuid.nullable().optional(),
    reported_failure_code_id: Uuid.nullable().optional(),
    requested_priority: z.enum(REQUEST_PRIORITIES).optional(),
    requester_name: z.string().nullable().optional(),
    requester_phone: z.string().nullable().optional(),
    requester_email: z.string().nullable().optional(),
    submit: z.boolean().optional(),
  }),
  response: z.object({
    id: Uuid,
    number: z.string(),
    duplicate_hints: z.array(z.unknown()),
  }),
  status: 201,
});

export const requestTransition = defineOperation({
  operationId: 'serviceRequests.transition',
  method: 'POST',
  path: '/service-requests/:id/transitions',
  summary: 'Move a solicitação de estado',
  description:
    'Uma rota para TODAS as transições. O grafo é a fonte de verdade: uma rota por transição ' +
    'criaria um segundo lugar onde elas estão listadas, e os dois divergiriam no dia em que o ' +
    'grafo mudasse. Cada aresta tem a sua própria permissão.',
  permissions: ['service_request.read'],
  params: z.object({ id: Uuid }),
  body: z.object({
    to: z.enum(REQUEST_STATUSES),
    rejection_reason_id: Uuid.nullable().optional(),
    merged_into_request_id: Uuid.nullable().optional(),
    cancellation_reason: z.string().nullable().optional(),
    priority: z.enum(REQUEST_PRIORITIES).optional(),
    version: z.number().int().optional(),
  }),
  response: z.object({ status: z.enum(REQUEST_STATUSES), version: z.number().int() }),
  status: 201,
  errors: ['not_found', 'conflict', 'forbidden'],
});
