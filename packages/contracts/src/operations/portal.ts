/**
 * Aurora — o portal do cliente (SPEC v0.2 §19 · EPIC-020).
 *
 * ESTES CONTRATOS SÃO UMA LISTA DO QUE PODE SAIR.
 *
 * Nas outras operações o contrato descreve o que a rota devolve. Aqui ele faz
 * mais: cada campo ausente é uma decisão. `internal_notes` não está aqui, custo
 * não está aqui, nome de técnico não está aqui — e a ausência é o ponto.
 *
 * Um contrato de portal com `.loose()` ou com `z.record(z.unknown())` seria
 * pior do que contrato nenhum: daria a impressão de que alguém revisou a
 * superfície, quando na verdade ela ficou aberta.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

/* -------------------------------------------------------------------------- */

export const PortalRequest = z.object({
  id: Uuid,
  number: z.string(),
  summary: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  /** A frase que o cliente lê. A chave interna também vem, para ordenação. */
  status_label: z.string(),
  priority: z.string(),
  asset_id: Uuid.nullable(),
  asset_name: z.string().nullable(),
  location_name: z.string().nullable(),
  created_at: Timestamp,
  /** Quantas ordens de serviço nasceram deste chamado. */
  work_order_count: z.number().int(),
  /**
   * A nota que o próprio cliente deu (1–5). Opcional no contrato porque
   * respostas anteriores à avaliação pelo portal não a têm.
   */
  rating: z.number().int().nullable().optional(),
});
export type PortalRequest = z.infer<typeof PortalRequest>;

export const PortalWorkOrder = z.object({
  id: Uuid,
  number: z.string().nullable(),
  title: z.string(),
  status_label: z.string(),
  /** A frase do cliente para o motivo da espera, quando há espera. */
  wait_label: z.string().nullable(),
  /**
   * Se a bola está com o CLIENTE.
   *
   * É o campo que transforma "aguardando" numa frase acionável — e o que evita
   * a ligação de "e aí, como está?" cuja resposta é "esperando você".
   */
  waiting_on_customer: z.boolean(),
  scheduled_start: Timestamp.nullable(),
  scheduled_end: Timestamp.nullable(),
  completed_at: Timestamp.nullable(),
  asset_name: z.string().nullable(),
  location_name: z.string().nullable(),
  /** Nulo enquanto não validada: rascunho de resolução não é resposta. */
  resolution: z.string().nullable(),
});
export type PortalWorkOrder = z.infer<typeof PortalWorkOrder>;

export const PortalPendingAction = z.object({
  kind: z.enum(['quote', 'work_order']),
  id: Uuid,
  label: z.string(),
  total_cents: z.string().nullable(),
});

export const PortalVisit = z.object({
  id: Uuid,
  number: z.string().nullable(),
  title: z.string(),
  scheduled_start: Timestamp,
  scheduled_end: Timestamp.nullable(),
  asset_name: z.string().nullable(),
  location_name: z.string().nullable(),
  status_label: z.string(),
});
export type PortalVisit = z.infer<typeof PortalVisit>;

export const portalHome = defineOperation({
  operationId: 'portal.home',
  method: 'GET',
  path: '/portal/home',
  summary: 'O que precisa de mim, e o que está em andamento',
  description:
    'Uma rota e quatro consultas. A tela pedir quatro rotas faria a primeira dobra do portal ' +
    'depender de quatro idas de rede numa conexão de hospital, que é a pior que existe.',
  public: false,
  response: z.object({
    /**
     * O que precisa de decisão AGORA, separado do que está em andamento.
     *
     * São duas perguntas diferentes, e juntá-las numa lista só é o que faz a
     * pendência de aprovação ficar entre dez chamados e ninguém aprovar nada.
     */
    pending_actions: z.array(PortalPendingAction),
    open_requests: z.array(PortalRequest),
    next_visits: z.array(PortalVisit),
  }),
});

export const portalRequests = defineOperation({
  operationId: 'portal.requests',
  method: 'GET',
  path: '/portal/requests',
  summary: 'Meus chamados',
  public: false,
  query: z.object({ open: z.enum(['true', 'false']).optional() }),
  response: z.object({ items: z.array(PortalRequest) }),
});

export const portalRequestDetail = defineOperation({
  operationId: 'portal.request',
  method: 'GET',
  path: '/portal/requests/:id',
  summary: 'Um chamado, com as ordens que nasceram dele',
  description:
    'Fora do escopo e inexistente devolvem a MESMA coisa: distinguir os dois contaria ao cliente ' +
    'que o chamado do concorrente existe — e, iterando os números, quantos ele abriu.',
  public: false,
  params: z.object({ id: Uuid }),
  response: z.object({
    request: PortalRequest,
    work_orders: z.array(PortalWorkOrder),
  }),
  errors: ['forbidden'],
});

export const portalOpenRequest = defineOperation({
  operationId: 'portal.abrir',
  method: 'POST',
  path: '/portal/requests',
  summary: 'Abrir chamado — a única escrita do portal',
  description:
    'O cliente vem do VÍNCULO, e não do corpo: aceitá-lo do corpo deixaria alguém abrir chamado ' +
    'em nome de outro. E a origem é `portal` sempre — deixá-la vir do corpo faria o indicador de ' +
    'autoatendimento medir ficção.',
  public: false,
  body: z.object({
    summary: z.string().min(3),
    description: z.string().optional(),
    asset_id: Uuid.optional(),
    location_id: Uuid.optional(),
  }),
  response: z.object({ id: Uuid, number: z.string() }),
  status: 201,
  errors: ['validation_failed', 'forbidden'],
});

export const portalWorkOrders = defineOperation({
  operationId: 'portal.workOrders',
  method: 'GET',
  path: '/portal/work-orders',
  summary: 'Os atendimentos do meu escopo',
  public: false,
  response: z.object({ items: z.array(PortalWorkOrder) }),
});

export const PortalComment = z.object({
  id: Uuid,
  body: z.string(),
  author_name: z.string().nullable(),
  created_at: Timestamp,
});
export type PortalComment = z.infer<typeof PortalComment>;

export const portalComments = defineOperation({
  operationId: 'portal.comments',
  method: 'GET',
  path: '/portal/work-orders/:id/comments',
  summary: 'A conversa que o cliente vê',
  description:
    'O tipo não tem o campo `visibility` — a nota interna não é escondida, ela não é lida, e não ' +
    'há como um consumidor vazar o que não recebeu.',
  public: false,
  params: z.object({ id: Uuid }),
  response: z.object({ items: z.array(PortalComment) }),
});

export const PortalAsset = z.object({
  id: Uuid,
  name: z.string(),
  tag: z.string().nullable(),
  serial_number: z.string().nullable(),
  status: z.string(),
  location_name: z.string().nullable(),
  category_name: z.string(),
  warranty_until: z.string().nullable(),
  /** A próxima visita programada para este equipamento. */
  next_service_at: Timestamp.nullable(),
});
export type PortalAsset = z.infer<typeof PortalAsset>;

export const portalAssets = defineOperation({
  operationId: 'portal.assets',
  method: 'GET',
  path: '/portal/assets',
  summary: 'Meus equipamentos',
  description: 'Nenhum valor financeiro: compra, residual e reposição não saem do servidor.',
  public: false,
  response: z.object({ items: z.array(PortalAsset) }),
});

export const PortalDocument = z.object({
  id: Uuid,
  number: z.string().nullable(),
  title: z.string().nullable(),
  type_name: z.string(),
  verdict: z.string().nullable(),
  asset_id: Uuid.nullable(),
  asset_name: z.string().nullable(),
  issued_at: Timestamp.nullable(),
  valid_until: z.string().nullable(),
});
export type PortalDocument = z.infer<typeof PortalDocument>;

export const portalDocuments = defineOperation({
  operationId: 'portal.documents',
  method: 'GET',
  path: '/portal/documents',
  summary: 'Documentos liberados para mim',
  description:
    'Emitido e liberado são coisas diferentes: entre os dois há a conferência interna. Mostrar o ' +
    'emitido antecipa uma conversa que a equipe ainda não teve.',
  public: false,
  response: z.object({ items: z.array(PortalDocument) }),
});

export const PortalQuote = z.object({
  id: Uuid,
  number: z.string(),
  version: z.number().int(),
  status: z.string(),
  valid_until: z.string().nullable(),
  /** Centavos, como texto. O preço; não a composição dele. */
  total_cents: z.string(),
  awaiting_decision: z.boolean(),
});
export type PortalQuote = z.infer<typeof PortalQuote>;

export const portalQuotes = defineOperation({
  operationId: 'portal.quotes',
  method: 'GET',
  path: '/portal/quotes',
  summary: 'Orçamentos que chegaram até mim',
  public: false,
  response: z.object({ items: z.array(PortalQuote) }),
});

export const portalSchedule = defineOperation({
  operationId: 'portal.schedule',
  method: 'GET',
  path: '/portal/schedule',
  summary: 'Visitas programadas no meu escopo',
  description:
    'Não diz QUEM vai: quem entra na unidade é assunto do processo de autorização de acesso, e ' +
    'não de um campo de listagem.',
  public: false,
  response: z.object({ items: z.array(PortalVisit) }),
});

export const portalDocumentPdf = defineOperation({
  operationId: 'portal.documentPdf',
  method: 'GET',
  path: '/portal/documents/:id/pdf',
  summary: 'Um documento LIBERADO, em PDF',
  description:
    'Só o que a lista do portal mostra: liberado ao cliente, não cancelado, do cliente e dos ' +
    'locais do vínculo. Qualquer outro documento — inclusive emitido e não liberado — é 404.',
  public: false,
  params: z.object({ id: Uuid }),
  response: z.string().describe('Arquivo PDF'),
  produces: 'application/pdf',
  errors: ['not_found'],
});

export const portalQuoteDecision = defineOperation({
  operationId: 'portal.quoteDecision',
  method: 'POST',
  path: '/portal/quotes/:id/decision',
  summary: 'O cliente aprova ou recusa um orçamento que aguarda a decisão dele',
  description:
    'Mesma transição do lado interno (reserva de peça, retomada da OS, evento), com evidência de ' +
    'aceite: IP do soquete, navegador e nota. Recusar exige motivo do catálogo. Orçamento fora do ' +
    'escopo do vínculo, ou que não aguarda decisão, é 404/409.',
  public: false,
  permissions: ['quote.approve'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      decision: z.enum(['approve', 'reject']),
      note: z.string().trim().max(2000).optional(),
      rejection_reason_id: Uuid.optional(),
    })
    .strict(),
  response: z.object({ status: z.enum(['approved', 'rejected']) }),
  status: 200,
  errors: ['not_found', 'conflict'],
});

export const portalRejectionReasons = defineOperation({
  operationId: 'portal.rejectionReasons',
  method: 'GET',
  path: '/portal/quotes/rejection-reasons',
  summary: 'Os motivos de recusa que o cliente pode escolher',
  public: false,
  response: z.object({ items: z.array(z.object({ id: Uuid, label: z.string() })) }),
});

export const portalRateRequest = defineOperation({
  operationId: 'portal.rateRequest',
  method: 'POST',
  path: '/portal/requests/:id/rating',
  summary: 'O cliente avalia o atendimento (1 a 5), uma vez, depois de atendido',
  description:
    'A escala é a que o registro já tinha. Como ela vira NPS (promotores, neutros, detratores) é ' +
    'definição de indicador que o cliente não deu — nenhuma conta é feita aqui.',
  public: false,
  permissions: ['service_request.create'],
  params: z.object({ id: Uuid }),
  body: z
    .object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() })
    .strict(),
  response: z.object({ ok: z.literal(true) }),
  status: 200,
  errors: ['not_found', 'conflict'],
});
