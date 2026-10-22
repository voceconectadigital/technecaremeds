/**
 * Aurora — pedidos da Store: comprar, acompanhar a entrega e receber a nota fiscal (conversa com o
 * cliente, 21/10/2026). Não há pagamento: é pedido e acompanhamento.
 *
 *   · o CLIENTE faz o pedido (`store.request_quote`) e o cancela enquanto está "requested";
 *   · a PRESTADORA (`quote.update`) confirma com a previsão de entrega, despacha, entrega e anexa a NF;
 *   · quem vê a Store (`store.read`) lista e abre os pedidos dos clientes do seu escopo.
 * A nota fiscal sobe e desce por rotas de corpo cru (`PUT/GET /store-orders/:id/invoice`).
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const STORE_ORDER_STATUSES = ['requested', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const;
export const STORE_ORDER_STATUS_LABELS: Record<(typeof STORE_ORDER_STATUSES)[number], string> = {
  requested: 'Pedido feito',
  confirmed: 'Confirmado',
  shipped: 'A caminho',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};

export const StoreOrderRow = z.object({
  id: Uuid,
  number: z.string(),
  customer_id: Uuid,
  customer_name: z.string(),
  requested_by_name: z.string().nullable(),
  status: z.enum(STORE_ORDER_STATUSES),
  note: z.string().nullable(),
  /** Centavos, como texto. Itens "sob consulta" ficam fora do total (`has_unpriced`). */
  total_cents: z.string(),
  has_unpriced: z.boolean(),
  expected_delivery: z.string().nullable(),
  delivered_at: Timestamp.nullable(),
  cancel_reason: z.string().nullable(),
  invoice_number: z.string().nullable(),
  invoice_file_name: z.string().nullable(),
  created_at: Timestamp,
  item_count: z.number().int(),
});
export type StoreOrderRow = z.infer<typeof StoreOrderRow>;

export const StoreOrderItem = z.object({
  id: Uuid,
  item_id: Uuid,
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  quantity: z.string(),
  unit_price_cents: z.string().nullable(),
});

export const StoreOrderEvent = z.object({
  id: Uuid,
  status: z.string(),
  note: z.string().nullable(),
  actor_name: z.string().nullable(),
  occurred_at: Timestamp,
});

export const StoreOrderDetail = StoreOrderRow.extend({
  items: z.array(StoreOrderItem),
  events: z.array(StoreOrderEvent),
});
export type StoreOrderDetail = z.infer<typeof StoreOrderDetail>;

export const storeOrdersList = defineOperation({
  operationId: 'storeOrders.list',
  method: 'GET',
  path: '/store-orders',
  summary: 'Os pedidos da Store dos clientes do seu escopo',
  permissions: ['store.read'],
  query: z.object({ status: z.enum(STORE_ORDER_STATUSES).optional(), customer: Uuid.optional() }),
  response: z.object({ items: z.array(StoreOrderRow) }),
});

export const storeOrdersCreate = defineOperation({
  operationId: 'storeOrders.create',
  method: 'POST',
  path: '/store-orders',
  summary: 'Faz um pedido na Store (itens publicados, preço de lista do momento)',
  description:
    'O cliente vem do vínculo (ou de `customer_id`, se estiver no escopo). Item repetido soma a quantidade; ' +
    'item sem preço entra "sob consulta", fora do total. Não há pagamento.',
  permissions: ['store.request_quote'],
  body: z
    .object({
      customer_id: Uuid.optional(),
      items: z
        .array(z.object({ item_id: Uuid, quantity: z.number().positive().max(100_000) }).strict())
        .min(1)
        .max(100),
      note: z.string().trim().max(2000).optional(),
    })
    .strict(),
  response: z.object({ id: Uuid, number: z.string() }),
  status: 201,
  errors: ['validation_failed', 'not_found', 'forbidden'],
});

export const storeOrderDetail = defineOperation({
  operationId: 'storeOrders.detail',
  method: 'GET',
  path: '/store-orders/:id',
  summary: 'Um pedido, com itens e a linha do tempo',
  permissions: ['store.read'],
  params: z.object({ id: Uuid }),
  response: StoreOrderDetail,
  errors: ['not_found'],
});

export const storeOrderCancel = defineOperation({
  operationId: 'storeOrders.cancel',
  method: 'POST',
  path: '/store-orders/:id/cancel',
  summary: 'O cliente cancela o PRÓPRIO pedido, enquanto ainda não foi confirmado',
  permissions: ['store.request_quote'],
  params: z.object({ id: Uuid }),
  body: z.object({ reason: z.string().trim().min(5).max(500) }).strict(),
  response: z.object({ status: z.enum(STORE_ORDER_STATUSES) }),
  status: 200,
  errors: ['not_found', 'conflict', 'forbidden', 'validation_failed'],
});

export const storeOrderStatus = defineOperation({
  operationId: 'storeOrders.status',
  method: 'POST',
  path: '/store-orders/:id/status',
  summary: 'A prestadora leva o pedido adiante: confirma, despacha, entrega ou cancela',
  description:
    'Confirmar exige a previsão de entrega. Postar a MESMA situação ("confirmed" ou "shipped") só atualiza ' +
    'a previsão de entrega. Cada passo entra na linha do tempo.',
  permissions: ['quote.update'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      status: z.enum(STORE_ORDER_STATUSES),
      expected_delivery: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD')
        .optional(),
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
  response: z.object({ status: z.enum(STORE_ORDER_STATUSES) }),
  status: 200,
  errors: ['not_found', 'conflict', 'validation_failed'],
});
