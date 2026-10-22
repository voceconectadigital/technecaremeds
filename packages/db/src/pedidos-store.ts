/**
 * Aurora — pedidos da Store: comprar, acompanhar a entrega, receber a nota fiscal (conversa com o
 * cliente, 21/10/2026).
 *
 * "Ao comprar, ele já pode acompanhar por aqui sua data de entrega, anexos como nota fiscal etc.;
 * uma plataforma simples de venda para o que precisarem pontualmente ou urgentemente de peças e
 * acessórios." Este módulo é o PEDIDO e o seu acompanhamento — não há pagamento nem checkout.
 *
 * O CICLO:  requested → confirmed → shipped → delivered   (ou cancelled, enquanto não saiu)
 *   · o CLIENTE faz o pedido e pode cancelá-lo enquanto estiver "requested";
 *   · a PRESTADORA confirma (com a previsão de entrega), despacha, entrega e anexa a nota fiscal.
 * Cada passo grava um evento na linha do tempo do pedido.
 *
 * O PREÇO É O DE LISTA NO MOMENTO DO PEDIDO e fica gravado nos itens: mudar a lista depois não
 * reescreve o que o cliente comprou. Item "sob consulta" (sem preço) entra no pedido, fora do total.
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, newId } from '@aurora/domain';
import type { TenantSession } from './client';

export const STORE_ORDER_STATUSES = ['requested', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const;
export type StoreOrderStatus = (typeof STORE_ORDER_STATUSES)[number];

/** O que cada situação aceita a seguir. "cancelled" só antes de sair. */
export const STORE_ORDER_TRANSITIONS: Readonly<Record<StoreOrderStatus, readonly StoreOrderStatus[]>> =
  Object.freeze({
    requested: ['confirmed', 'cancelled'],
    confirmed: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
  });

export interface StoreOrderRow {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string;
  requested_by_name: string | null;
  status: StoreOrderStatus;
  note: string | null;
  total_cents: string;
  has_unpriced: boolean;
  expected_delivery: string | null;
  delivered_at: Date | null;
  cancel_reason: string | null;
  invoice_number: string | null;
  invoice_file_name: string | null;
  created_at: Date;
  item_count: number;
}

export interface StoreOrderItemRow {
  id: string;
  item_id: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  unit_price_cents: string | null;
}

export interface StoreOrderEventRow {
  id: string;
  status: string;
  note: string | null;
  actor_name: string | null;
  occurred_at: Date;
}

export interface StoreOrderDetail extends StoreOrderRow {
  items: StoreOrderItemRow[];
  events: StoreOrderEventRow[];
}

/** O recorte de quem pergunta: pedidos dos clientes que o vínculo alcança. */
const ESCOPO = `o.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))`;

async function inserirEvento(
  session: TenantSession,
  orderId: string,
  status: string,
  note: string | null,
  membershipId: string | null
): Promise<void> {
  await session.query(
    `INSERT INTO aurora.store_order_events (id, organization_id, order_id, status, note, actor_membership_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId(), session.context.organizationId, orderId, status, note, membershipId]
  );
}

export async function createStoreOrder(
  session: TenantSession,
  input: {
    customerId: string;
    requestedByMembershipId: string;
    items: Array<{ itemId: string; quantity: number }>;
    note?: string | null;
  }
): Promise<{ id: string; number: string }> {
  if (input.items.length === 0)
    throw new ValidationError('o pedido precisa de ao menos um item', { field: 'items' });
  if (input.items.length > 100)
    throw new ValidationError('no máximo 100 itens por pedido', { field: 'items' });
  const nota = input.note?.trim() || null;
  if (nota && nota.length > 2000)
    throw new ValidationError('a observação vai até 2000 caracteres', { field: 'note' });

  // Um item repetido soma a quantidade: duas linhas do mesmo produto confundiriam a separação.
  const somados = new Map<string, number>();
  for (const i of input.items) {
    if (!Number.isFinite(i.quantity) || i.quantity <= 0 || i.quantity > 100_000) {
      throw new ValidationError('a quantidade precisa ser maior que zero', { field: 'quantity' });
    }
    somados.set(i.itemId, (somados.get(i.itemId) ?? 0) + i.quantity);
  }

  const itens = await session.query<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    list_price_cents: string | null;
  }>(
    `SELECT id, sku, name, unit, list_price_cents::text AS list_price_cents
       FROM aurora.inventory_items
      WHERE id = ANY($1::uuid[]) AND store_published AND archived_at IS NULL`,
    [[...somados.keys()]]
  );
  if (itens.length !== somados.size) {
    // Item fora da Store (ou arquivado) não se pede — e a resposta não diz qual, para não vazar o catálogo interno.
    throw new NotFoundError('item da Store', 'um ou mais itens');
  }

  let total = 0n;
  let semPreco = false;
  for (const it of itens) {
    if (it.list_price_cents === null) {
      semPreco = true;
      continue;
    }
    // Quantidade fracionada: o total sai arredondado ao centavo.
    total += BigInt(Math.round(Number(it.list_price_cents) * somados.get(it.id)!));
  }

  const ano = new Date().getUTCFullYear();
  const [seq] = await session.query<{ next_number: string }>(
    `SELECT aurora.next_number($1, 'PED', $2) AS next_number`,
    [session.context.organizationId, ano]
  );
  const numero = `PED-${ano}-${String(Number(seq!.next_number)).padStart(4, '0')}`;

  const id = newId();
  await session.query(
    `INSERT INTO aurora.store_orders
       (id, organization_id, number, customer_id, requested_by_membership_id, note, total_cents, has_unpriced, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      session.context.organizationId,
      numero,
      input.customerId,
      input.requestedByMembershipId,
      nota,
      total.toString(),
      semPreco,
      session.context.actorId,
    ]
  );
  for (const it of itens) {
    await session.query(
      `INSERT INTO aurora.store_order_items
         (id, organization_id, order_id, item_id, sku, name, unit, quantity, unit_price_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        newId(),
        session.context.organizationId,
        id,
        it.id,
        it.sku,
        it.name,
        it.unit,
        somados.get(it.id)!,
        it.list_price_cents,
      ]
    );
  }
  await inserirEvento(session, id, 'requested', 'Pedido feito.', input.requestedByMembershipId);
  return { id, number: numero };
}

const CAMPOS = `o.id, o.number, o.customer_id, c.name AS customer_name, u.name AS requested_by_name,
       o.status, o.note, o.total_cents::text AS total_cents, o.has_unpriced,
       o.expected_delivery::text AS expected_delivery, o.delivered_at, o.cancel_reason,
       o.invoice_number, o.invoice_file_name, o.created_at,
       (SELECT count(*)::int FROM aurora.store_order_items i WHERE i.order_id = o.id) AS item_count`;
const JUNTAS = `FROM aurora.store_orders o
       JOIN aurora.customers c ON c.id = o.customer_id
       LEFT JOIN aurora.memberships m ON m.id = o.requested_by_membership_id
       LEFT JOIN aurora.users u ON u.id = m.user_id`;

export async function listStoreOrders(
  session: TenantSession,
  scopeMembershipId: string,
  filters: { status?: StoreOrderStatus | null; customerId?: string | null } = {},
  limit = 200
): Promise<StoreOrderRow[]> {
  return session.query<StoreOrderRow>(
    `SELECT ${CAMPOS} ${JUNTAS}
      WHERE ${ESCOPO}
        AND ($2::text IS NULL OR o.status = $2)
        AND ($3::uuid IS NULL OR o.customer_id = $3)
      ORDER BY CASE o.status WHEN 'requested' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END,
               o.created_at DESC
      LIMIT $4`,
    [scopeMembershipId, filters.status ?? null, filters.customerId ?? null, limit]
  );
}

export async function getStoreOrder(
  session: TenantSession,
  scopeMembershipId: string,
  orderId: string
): Promise<StoreOrderDetail> {
  const [o] = await session.query<StoreOrderRow>(`SELECT ${CAMPOS} ${JUNTAS} WHERE o.id = $2 AND ${ESCOPO}`, [
    scopeMembershipId,
    orderId,
  ]);
  if (!o) throw new NotFoundError('Pedido', orderId);
  const items = await session.query<StoreOrderItemRow>(
    `SELECT id, item_id, sku, name, unit, quantity::text AS quantity, unit_price_cents::text AS unit_price_cents
       FROM aurora.store_order_items WHERE order_id = $1 ORDER BY name`,
    [orderId]
  );
  const events = await session.query<StoreOrderEventRow>(
    `SELECT e.id, e.status, e.note, u.name AS actor_name, e.occurred_at
       FROM aurora.store_order_events e
       LEFT JOIN aurora.memberships m ON m.id = e.actor_membership_id
       LEFT JOIN aurora.users u ON u.id = m.user_id
      WHERE e.order_id = $1 ORDER BY e.occurred_at, e.id`,
    [orderId]
  );
  return { ...o, items, events };
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Muda a situação. Quem GERENCIA (a prestadora) leva o pedido adiante; o CLIENTE só cancela o seu,
 * e só enquanto "requested". Postar a MESMA situação ("confirmed" ou "shipped") atualiza a previsão
 * de entrega sem mudar o passo.
 */
export async function changeStoreOrderStatus(
  session: TenantSession,
  orderId: string,
  input: { status: StoreOrderStatus; expectedDelivery?: string | null; note?: string | null },
  actor: { membershipId: string; canManage: boolean }
): Promise<{ status: StoreOrderStatus }> {
  if (!(STORE_ORDER_STATUSES as readonly string[]).includes(input.status)) {
    throw new ValidationError('situação desconhecida', { field: 'status' });
  }
  if (input.expectedDelivery && !DATA.test(input.expectedDelivery)) {
    throw new ValidationError('a previsão de entrega precisa ser AAAA-MM-DD', { field: 'expected_delivery' });
  }
  const nota = input.note?.trim() || null;

  const [o] = await session.query<{
    status: StoreOrderStatus;
    requested_by_membership_id: string;
    expected_delivery: string | null;
  }>(
    `SELECT o.status, o.requested_by_membership_id, o.expected_delivery::text AS expected_delivery
       FROM aurora.store_orders o WHERE o.id = $2 AND ${ESCOPO} FOR UPDATE OF o`,
    [actor.membershipId, orderId]
  );
  if (!o) throw new NotFoundError('Pedido', orderId);

  const atualizaPrevisao = input.status === o.status && (o.status === 'confirmed' || o.status === 'shipped');
  if (!atualizaPrevisao && !STORE_ORDER_TRANSITIONS[o.status].includes(input.status)) {
    throw new ConflictError(`um pedido "${o.status}" não pode ir para "${input.status}"`);
  }

  if (!actor.canManage) {
    // O cliente só cancela o PRÓPRIO pedido, enquanto ainda não foi confirmado.
    if (
      input.status !== 'cancelled' ||
      o.status !== 'requested' ||
      o.requested_by_membership_id !== actor.membershipId
    ) {
      throw new ForbiddenError('quote.update');
    }
  }
  if (input.status === 'cancelled' && (nota?.length ?? 0) < 5) {
    throw new ValidationError('diga o motivo do cancelamento (5+ caracteres)', { field: 'note' });
  }
  if (input.status === 'confirmed' && !input.expectedDelivery && !o.expected_delivery) {
    throw new ValidationError('confirmar o pedido exige a previsão de entrega', {
      field: 'expected_delivery',
    });
  }

  await session.query(
    `UPDATE aurora.store_orders
        SET status = $2,
            expected_delivery = COALESCE($3::date, expected_delivery),
            delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END,
            cancel_reason = CASE WHEN $2 = 'cancelled' THEN $4 ELSE cancel_reason END,
            updated_by = $5
      WHERE id = $1`,
    [orderId, input.status, input.expectedDelivery ?? null, nota, session.context.actorId]
  );
  await inserirEvento(
    session,
    orderId,
    input.status,
    atualizaPrevisao
      ? `Previsão de entrega: ${input.expectedDelivery ?? o.expected_delivery}.${nota ? ` ${nota}` : ''}`
      : nota,
    actor.membershipId
  );
  return { status: input.status };
}

export interface StoreInvoiceMeta {
  file_key: string;
  file_name: string;
  file_content_type: string | null;
  file_size: number;
}

/** A nota fiscal do pedido (só a prestadora anexa; o cliente do pedido baixa). */
export async function setStoreOrderInvoice(
  session: TenantSession,
  scopeMembershipId: string,
  orderId: string,
  invoiceNumber: string,
  meta: StoreInvoiceMeta & { sha256: string }
): Promise<{ previousKey: string | null }> {
  const numero = invoiceNumber.trim();
  if (numero.length < 1 || numero.length > 60) {
    throw new ValidationError('informe o número da nota fiscal (até 60 caracteres)', {
      field: 'invoice_number',
    });
  }
  const [o] = await session.query<{ status: StoreOrderStatus; invoice_file_key: string | null }>(
    `SELECT o.status, o.invoice_file_key FROM aurora.store_orders o WHERE o.id = $2 AND ${ESCOPO} FOR UPDATE OF o`,
    [scopeMembershipId, orderId]
  );
  if (!o) throw new NotFoundError('Pedido', orderId);
  if (o.status === 'requested' || o.status === 'cancelled') {
    throw new ConflictError('a nota fiscal entra depois que o pedido é confirmado');
  }
  await session.query(
    `UPDATE aurora.store_orders
        SET invoice_number = $2, invoice_file_key = $3, invoice_file_name = $4,
            invoice_file_content_type = $5, invoice_file_size = $6, invoice_file_sha256 = $7, updated_by = $8
      WHERE id = $1`,
    [
      orderId,
      numero,
      meta.file_key,
      meta.file_name,
      meta.file_content_type,
      meta.file_size,
      meta.sha256,
      session.context.actorId,
    ]
  );
  await inserirEvento(session, orderId, o.status, `Nota fiscal ${numero} anexada.`, scopeMembershipId);
  return { previousKey: o.invoice_file_key };
}

export async function getStoreOrderInvoice(
  session: TenantSession,
  scopeMembershipId: string,
  orderId: string
): Promise<StoreInvoiceMeta | null> {
  const [o] = await session.query<{
    invoice_file_key: string | null;
    invoice_file_name: string | null;
    invoice_file_content_type: string | null;
    invoice_file_size: number | null;
  }>(
    `SELECT o.invoice_file_key, o.invoice_file_name, o.invoice_file_content_type, o.invoice_file_size
       FROM aurora.store_orders o WHERE o.id = $2 AND ${ESCOPO}`,
    [scopeMembershipId, orderId]
  );
  if (!o) throw new NotFoundError('Pedido', orderId);
  if (!o.invoice_file_key || !o.invoice_file_name || o.invoice_file_size === null) return null;
  return {
    file_key: o.invoice_file_key,
    file_name: o.invoice_file_name,
    file_content_type: o.invoice_file_content_type,
    file_size: o.invoice_file_size,
  };
}
