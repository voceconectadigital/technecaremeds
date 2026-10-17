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

/**
 * As situações que o domínio e o banco de fato usam (`REQUEST_STATUSES` em
 * `@aurora/domain`, tipo `service_request_status`).
 *
 * Estava com `merged` no lugar de `duplicate` e sem `in_service`,
 * `fulfilled` e `closed`: a ficha devolvia a transição para `duplicate` e
 * o contrato a recusava. A captura da demonstração acusou; a lista agora é a
 * do domínio, e um teste compara as duas.
 */

/**
 * Tipos de solicitação — lista FECHADA definida pelo cliente (16/10/2026).
 * Espelha `packages/domain/src/request-types.ts`.
 */
export const SERVICE_REQUEST_TYPE_KEYS = [
  'corrective',
  'preventive',
  'technical_instruction',
  'training',
  'calibration',
  'electrical_safety',
  'qualification',
] as const;

export const REQUEST_STATUSES = [
  'draft',
  'submitted',
  'triage',
  'info_needed',
  'accepted',
  'in_service',
  'fulfilled',
  'closed',
  'rejected',
  'duplicate',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * A urgência, na ordem em que o domínio a declara: da maior para a menor.
 *
 * Estava `['none', 'low', 'normal', 'high', 'critical']` — e `normal`, `high` e
 * `critical` não existem. O tipo do PostgreSQL é `request_priority`, e o
 * domínio o espelha. Três dos cinco valores do contrato eram invenção, e como
 * a massa de teste nunca passou de `none`, nada reclamou.
 *
 * A ordem importa: é decrescente de gravidade, e a fila de triagem ordena por
 * ela. Alfabetar a lista trocaria a ordem de atendimento sem que uma linha de
 * lógica mudasse.
 */
export const REQUEST_PRIORITIES = ['emergency', 'very_urgent', 'urgent', 'low', 'none'] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];
/** As origens do domínio. `qr` e `system` não existiam no banco: abrir com elas dava 500. */
export const SERVICE_REQUEST_SOURCES = [
  'portal',
  'qr_code',
  'phone',
  'email',
  'walk_in',
  'api',
  'internal',
] as const;

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
    /** Opcionais: capturas anteriores à 0064 (demo) não os têm. */
    asset_tag: z.string().nullable().optional(),
    requested_type: z.enum(SERVICE_REQUEST_TYPE_KEYS).nullable().optional(),
    /** Dado histórico: o campo "sintoma" saiu da tela de abertura (16/10/2026). */
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
    requested_type: z.enum(SERVICE_REQUEST_TYPE_KEYS).nullable().optional(),
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
    /** Obrigatório para ir a `info_needed`: a pergunta feita a quem abriu. */
    info_request: z.string().trim().min(5).max(2000).optional(),
    /** Observação da recusa para o cliente (opcional). */
    rejection_note: z.string().trim().max(2000).optional(),
    priority: z.enum(REQUEST_PRIORITIES).optional(),
    version: z.number().int().optional(),
  }),
  response: z.object({ status: z.enum(REQUEST_STATUSES), version: z.number().int() }),
  status: 201,
  errors: ['not_found', 'conflict', 'forbidden'],
});
