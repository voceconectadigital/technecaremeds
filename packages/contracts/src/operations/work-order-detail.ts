/**
 * Aurora — o que a ficha da ordem de serviço lê (SPEC v0.2 §09, §12 · EPIC-009).
 *
 * Cada aba da ficha tem a sua rota, e cada rota o seu contrato descrito campo a
 * campo. A alternativa — um contrato de resposta com `z.unknown()` dentro —
 * custou caro duas vezes nesta mesma sessão: a agenda lia `os.id` num item que
 * só tem `work_order_id`, e a tela de solicitação pedia um catálogo
 * inexistente. Nenhum dos dois erros o compilador podia ver.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

/* -------------------------------------------------------------------------- */
/* Comentários e notas internas                                               */
/* -------------------------------------------------------------------------- */

export const CommentVisibility = z.enum(['internal', 'customer']);
export type CommentVisibility = z.infer<typeof CommentVisibility>;

export const WorkOrderComment = z.object({
  id: Uuid,
  body: z.string(),
  /**
   * `internal` NUNCA chega ao portal do cliente.
   *
   * A separação é de coluna desde a migration 0021, e o filtro acontece na
   * consulta — não na tela. Quem não pode ler nota interna não recebe nenhuma,
   * nem a contagem delas.
   */
  visibility: CommentVisibility,
  author_membership_id: Uuid.nullable(),
  author_name: z.string().nullable(),
  created_at: Timestamp,
  edited_at: Timestamp.nullable(),
});
export type WorkOrderComment = z.infer<typeof WorkOrderComment>;

export const workOrderComments = defineOperation({
  operationId: 'workOrders.comments',
  method: 'GET',
  path: '/work-orders/:id/comments',
  summary: 'Comentários e notas internas de uma ordem de serviço',
  description:
    'A permissão da rota é `work_order.read`: quem só vê o que o cliente vê continua abrindo a ' +
    'aba, com menos conteúdo. Negar a rota inteira ensinaria que "a aba está quebrada" quando ' +
    'ela apenas está vazia.',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  response: z.object({
    /**
     * Se esta pessoa pode escrever no canal interno.
     *
     * Vem do servidor para a tela não precisar deduzir da lista de permissões
     * — e para não oferecer um seletor "interna/cliente" que só falha depois
     * de a pessoa ter digitado o texto.
     */
    can_write_internal: z.boolean(),
    items: z.array(WorkOrderComment),
  }),
});

export const workOrderComment = defineOperation({
  operationId: 'workOrders.comment',
  method: 'POST',
  path: '/work-orders/:id/comments',
  summary: 'Escreve um comentário ou nota interna',
  description:
    'A visibilidade é obrigatória, sem padrão: quem quisesse falar com o cliente e esquecesse o ' +
    'campo escreveria uma nota que o cliente nunca lê, e esperaria resposta de uma mensagem que ' +
    'não foi entregue.',
  permissions: ['work_order.comment'],
  params: z.object({ id: Uuid }),
  body: z.object({
    body: z.string().min(1).max(20_000),
    visibility: CommentVisibility,
  }),
  response: z.object({ id: Uuid }),
  errors: ['validation_failed', 'forbidden'],
});

/* -------------------------------------------------------------------------- */
/* Horas apontadas                                                            */
/* -------------------------------------------------------------------------- */

export const TimeEntry = z.object({
  id: Uuid,
  membership_id: Uuid.nullable(),
  person_name: z.string().nullable(),
  started_at: Timestamp,
  /** Nulo enquanto o cronômetro está correndo. */
  ended_at: Timestamp.nullable(),
  /**
   * Nulo enquanto a entrada está aberta, e calculado no banco.
   *
   * Deixar a tela fazer `agora - início` faria o número crescer a cada
   * renderização — inclusive depois de a OS fechar, se alguém tiver esquecido
   * o cronômetro ligado.
   */
  minutes: z.number().int().nullable(),
  source: z.string(),
  note: z.string().nullable(),
  approved_at: Timestamp.nullable(),
  /** Só para quem tem `work_order.read_costs`; nulo para os demais. */
  cost: z.string().nullable(),
  currency: z.string().nullable(),
});
export type TimeEntry = z.infer<typeof TimeEntry>;

export const workOrderTimeEntries = defineOperation({
  operationId: 'workOrders.timeEntries',
  method: 'GET',
  path: '/work-orders/:id/time-entries',
  summary: 'Horas apontadas na ordem de serviço',
  description:
    'O custo sai da consulta para quem não tem `work_order.read_costs` — o técnico aponta a hora ' +
    'e não precisa saber por quanto ela é cobrada.',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  response: z.object({
    /** Somado no servidor: somar no cliente quebra em silêncio quando a lista paginar. */
    total_minutes: z.number().int(),
    /**
     * Quantas entradas ficaram abertas.
     *
     * É o defeito operacional mais comum do apontamento — o técnico inicia o
     * cronômetro e esquece. A ficha diz quantas há, em vez de apresentar o
     * total como se estivesse completo.
     */
    open_entries: z.number().int(),
    items: z.array(TimeEntry),
  }),
});

/* -------------------------------------------------------------------------- */
/* Anexos                                                                     */
/* -------------------------------------------------------------------------- */

export const Attachment = z.object({
  id: Uuid,
  purpose: z.string(),
  file_name: z.string(),
  content_type: z.string(),
  /** Texto porque a coluna é `bigint`: acima de 2^53 o JavaScript perde precisão calado. */
  byte_size: z.string(),
  sha256: z.string(),
  taken_at: Timestamp.nullable(),
  uploaded_at: Timestamp,
  uploaded_by_name: z.string().nullable(),
  checklist_answer_id: Uuid.nullable(),
});
export type Attachment = z.infer<typeof Attachment>;

export const workOrderAttachments = defineOperation({
  operationId: 'workOrders.attachments',
  method: 'GET',
  path: '/work-orders/:id/attachments',
  summary: 'Anexos e fotos da ordem de serviço',
  description:
    'Não devolve a chave de armazenamento: entregá-la ao navegador transformaria um ' +
    'identificador interno em coisa que alguém tenta adivinhar. A tela pede pelo id do anexo.',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  response: z.object({ items: z.array(Attachment) }),
});

/* -------------------------------------------------------------------------- */
/* Peças                                                                      */
/* -------------------------------------------------------------------------- */

export const WorkOrderPart = z.object({
  id: Uuid,
  item_id: Uuid,
  item_name: z.string().nullable(),
  item_sku: z.string().nullable(),
  unit: z.string().nullable(),
  /** `consumption` saiu do estoque para a OS; `return` voltou. */
  kind: z.enum(['consumption', 'return']),
  qty: z.string(),
  warehouse_name: z.string().nullable(),
  occurred_at: Timestamp,
  /** Só para quem tem `work_order.read_costs`. */
  unit_cost: z.string().nullable(),
});
export type WorkOrderPart = z.infer<typeof WorkOrderPart>;

export const workOrderParts = defineOperation({
  operationId: 'workOrders.parts',
  method: 'GET',
  path: '/work-orders/:id/parts',
  summary: 'Peças movimentadas na ordem de serviço',
  description:
    'Vêm dos movimentos de estoque, e devolução é linha própria — consolidar em "líquido zero" ' +
    'apagaria o fato de a peça ter sido levada, que é o que explica a segunda visita.',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  response: z.object({ items: z.array(WorkOrderPart) }),
});
