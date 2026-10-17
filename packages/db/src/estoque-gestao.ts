/**
 * Aurora — gestão do estoque interno e Store (reunião 16/10/2026, Fase 8).
 *
 * ESTOQUE INTERNO é privado de quem é dono: o almoxarifado é da organização
 * (`customer_id` nulo — a prestadora) ou de um CLIENTE (o estoque do hospital
 * gerido aqui). Quem tem escopo restrito a certos clientes não vê o almoxarifado
 * de outro cliente. Toda SAÍDA continua pela OS (razão com `ref_type =
 * work_order`) ou por ajuste com motivo: nenhuma baixa silenciosa.
 *
 * CURVA ABC — regra CONVENCIONAL (Pareto), documentada e ajustável: itens em
 * ordem decrescente de VALOR CONSUMIDO no período; classe A até 80 % do valor
 * acumulado, B até 95 %, C o resto. O valor de cada saída é o custo gravado no
 * movimento; na falta dele, o custo médio atual do item no almoxarifado (dito
 * na resposta). Se o cliente quiser outra regra comercial, os limites vêm na
 * consulta (`a`, `b`).
 *
 * STORE é catálogo comercial: item publicado, descrição e preço de lista —
 * NUNCA saldo. Pedir proposta vira oportunidade; não há carrinho nem pagamento.
 */
import { NotFoundError, ValidationError, centsFromDecimal } from '@aurora/domain';
import type { TenantSession } from './client';
import { createItem, createWarehouse, recordMovement } from './inventory';
import { createOpportunity } from './opportunities';

/** Condição de visibilidade de almoxarifado para um vínculo (alias `w`). */
function almoxVisivel(n: number): string {
  return `(w.customer_id IS NULL OR $${n}::uuid IS NULL
           OR w.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($${n})))`;
}

/* -------------------------------------------------------------------------- */
/* itens e almoxarifados                                                       */
/* -------------------------------------------------------------------------- */

export interface ItemRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string | null;
  list_price_cents: string | null;
  store_published: boolean;
  store_summary: string | null;
}

export async function listInventoryItems(session: TenantSession): Promise<ItemRow[]> {
  return session.query<ItemRow>(
    `SELECT id, sku, name, unit, category, list_price_cents::text AS list_price_cents,
            store_published, store_summary
       FROM aurora.inventory_items
      WHERE archived_at IS NULL
      ORDER BY name`
  );
}

export async function createInventoryItem(
  session: TenantSession,
  input: { sku: string; name: string; unit?: string; category?: string | null; listPrice?: string | null }
): Promise<string> {
  const id = await createItem(session, {
    sku: input.sku.trim(),
    name: input.name.trim(),
    unit: input.unit?.trim() || 'un',
    category: input.category?.trim() || null,
  });
  if (input.listPrice) {
    await session.query(`UPDATE aurora.inventory_items SET list_price_cents = $2 WHERE id = $1`, [
      id,
      centavos(input.listPrice, 'list_price'),
    ]);
  }
  return id;
}

export async function updateInventoryItem(
  session: TenantSession,
  id: string,
  patch: {
    name?: string;
    category?: string | null;
    listPrice?: string | null;
    storePublished?: boolean;
    storeSummary?: string | null;
  }
): Promise<void> {
  const campos: [string, unknown][] = [];
  if (patch.name !== undefined) campos.push(['name', patch.name.trim()]);
  if (patch.category !== undefined) campos.push(['category', patch.category?.trim() || null]);
  if (patch.listPrice !== undefined) {
    campos.push([
      'list_price_cents',
      patch.listPrice === null ? null : centavos(patch.listPrice, 'list_price'),
    ]);
  }
  if (patch.storePublished !== undefined) campos.push(['store_published', patch.storePublished]);
  if (patch.storeSummary !== undefined) campos.push(['store_summary', patch.storeSummary?.trim() || null]);
  if (campos.length === 0) return;
  const sets = campos.map(([c], i) => `${c} = $${i + 2}`).join(', ');
  const linhas = await session.query(
    `UPDATE aurora.inventory_items SET ${sets} WHERE id = $1 AND archived_at IS NULL RETURNING id`,
    [id, ...campos.map(([, v]) => v)]
  );
  if (linhas.length === 0) throw new NotFoundError('item', id);
}

export interface WarehouseRow {
  id: string;
  name: string;
  kind: string;
  customer_id: string | null;
  customer_name: string | null;
  owner: 'organization' | 'customer';
}

export async function listWarehouses(
  session: TenantSession,
  membershipId: string | null
): Promise<WarehouseRow[]> {
  return session.query<WarehouseRow>(
    `SELECT w.id, w.name, w.kind::text AS kind, w.customer_id, c.name AS customer_name,
            CASE WHEN w.customer_id IS NULL THEN 'organization' ELSE 'customer' END AS owner
       FROM aurora.warehouses w
       LEFT JOIN aurora.customers c ON c.id = w.customer_id
      WHERE w.archived_at IS NULL AND ${almoxVisivel(1)}
      ORDER BY (w.customer_id IS NULL) DESC, c.name NULLS FIRST, w.name`,
    [membershipId]
  );
}

export async function createOwnedWarehouse(
  session: TenantSession,
  input: { name: string; kind?: 'central' | 'satellite' | 'consignment'; customerId?: string | null }
): Promise<string> {
  if (input.customerId) {
    const [c] = await session.query(`SELECT 1 FROM aurora.customers WHERE id = $1 AND deleted_at IS NULL`, [
      input.customerId,
    ]);
    if (!c) throw new NotFoundError('cliente', input.customerId);
  }
  const id = await createWarehouse(session, { name: input.name.trim(), kind: input.kind ?? 'central' });
  if (input.customerId) {
    await session.query(`UPDATE aurora.warehouses SET customer_id = $2 WHERE id = $1`, [
      id,
      input.customerId,
    ]);
  }
  return id;
}

/** O almoxarifado existe E é visível para quem pede — senão, 404. */
export async function assertWarehouseVisible(
  session: TenantSession,
  warehouseId: string,
  membershipId: string | null
): Promise<void> {
  const [w] = await session.query(
    `SELECT 1 FROM aurora.warehouses w WHERE w.id = $1 AND w.archived_at IS NULL AND ${almoxVisivel(2)}`,
    [warehouseId, membershipId]
  );
  if (!w) throw new NotFoundError('almoxarifado', warehouseId);
}

/* -------------------------------------------------------------------------- */
/* entrada, limites, valor                                                     */
/* -------------------------------------------------------------------------- */

function centavos(valor: string, campo: string): number {
  try {
    return centsFromDecimal(valor);
  } catch {
    throw new ValidationError(`${campo}: valor como "1234.56"`, { field: campo });
  }
}

/**
 * ENTRADA de estoque (compra, doação, devolução de fornecedor): movimento
 * `receipt` no razão, com custo unitário (texto decimal, sem float) e a
 * referência (nota fiscal…) como motivo auditável.
 */
export async function receiveStock(
  session: TenantSession,
  input: { itemId: string; warehouseId: string; qty: number; unitCost: string; reference: string }
): Promise<string> {
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    throw new ValidationError('a quantidade da entrada deve ser positiva', { field: 'qty' });
  }
  const custo = centavos(input.unitCost, 'unit_cost') / 100;
  if (input.reference.trim().length < 3) {
    throw new ValidationError('informe a referência da entrada (nota fiscal, pedido…)', {
      field: 'reference',
    });
  }
  return recordMovement(session, {
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    kind: 'receipt',
    qty: input.qty,
    unitCost: custo,
    reason: input.reference.trim(),
  });
}

export async function setStockLimits(
  session: TenantSession,
  itemId: string,
  warehouseId: string,
  min: number,
  max: number | null
): Promise<void> {
  if (min < 0 || (max !== null && max < min)) {
    throw new ValidationError('o máximo precisa ser maior ou igual ao mínimo', { field: 'max_qty' });
  }
  await session.query(
    `INSERT INTO aurora.stock_balances (organization_id, item_id, warehouse_id, min_qty, max_qty)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (item_id, warehouse_id) DO UPDATE SET min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty`,
    [session.context.organizationId, itemId, warehouseId, min, max]
  );
}

export interface ValuationRow {
  warehouse_id: string;
  warehouse_name: string;
  owner: 'organization' | 'customer';
  customer_name: string | null;
  items: number;
  value_cents: string;
  below_min: number;
  above_max: number;
}

/** Valor em estoque por almoxarifado: saldo × custo médio, em centavos. */
export async function stockValuation(
  session: TenantSession,
  membershipId: string | null
): Promise<ValuationRow[]> {
  return session.query<ValuationRow>(
    `SELECT w.id AS warehouse_id, w.name AS warehouse_name,
            CASE WHEN w.customer_id IS NULL THEN 'organization' ELSE 'customer' END AS owner,
            c.name AS customer_name,
            count(b.item_id) FILTER (WHERE b.on_hand <> 0)::int AS items,
            COALESCE(round(sum(GREATEST(b.on_hand, 0) * b.average_cost) * 100), 0)::bigint::text AS value_cents,
            count(*) FILTER (WHERE b.on_hand < b.min_qty)::int AS below_min,
            count(*) FILTER (WHERE b.max_qty IS NOT NULL AND b.on_hand > b.max_qty)::int AS above_max
       FROM aurora.warehouses w
       LEFT JOIN aurora.customers c ON c.id = w.customer_id
       LEFT JOIN aurora.stock_balances b ON b.warehouse_id = w.id
      WHERE w.archived_at IS NULL AND ${almoxVisivel(1)}
      GROUP BY w.id, w.name, w.customer_id, c.name
      ORDER BY w.name`,
    [membershipId]
  );
}

/* -------------------------------------------------------------------------- */
/* curva ABC e relatório por período                                           */
/* -------------------------------------------------------------------------- */

export interface AbcRow {
  item_id: string;
  sku: string;
  name: string;
  consumed_qty: number;
  value_cents: number;
  share_pct: number;
  cumulative_pct: number;
  abc_class: 'A' | 'B' | 'C';
}

export async function abcCurve(
  session: TenantSession,
  f: { from: Date; to: Date; warehouseId?: string | null; aLimit?: number; bLimit?: number },
  membershipId: string | null
): Promise<{ items: AbcRow[]; total_value_cents: number; rule: string; a_limit: number; b_limit: number }> {
  const a = f.aLimit ?? 80;
  const b = f.bLimit ?? 95;
  if (!(a > 0 && a < b && b < 100)) {
    throw new ValidationError('limites inválidos: 0 < a < b < 100', { field: 'a' });
  }
  const linhas = await session.query<{
    item_id: string;
    sku: string;
    name: string;
    qty: string;
    valor: string;
  }>(
    `SELECT i.id AS item_id, i.sku, i.name,
            sum(-m.qty)::text AS qty,
            sum(-m.qty * COALESCE(m.unit_cost, bal.average_cost, 0))::text AS valor
       FROM aurora.stock_movements m
       JOIN aurora.inventory_items i ON i.id = m.item_id
       JOIN aurora.warehouses w ON w.id = m.warehouse_id
       LEFT JOIN aurora.stock_balances bal ON bal.item_id = m.item_id AND bal.warehouse_id = m.warehouse_id
      WHERE m.kind IN ('consumption', 'issue')
        AND m.occurred_at >= $1 AND m.occurred_at < $2
        AND ($3::uuid IS NULL OR m.warehouse_id = $3)
        AND ${almoxVisivel(4)}
      GROUP BY i.id, i.sku, i.name`,
    [f.from, f.to, f.warehouseId ?? null, membershipId]
  );
  const itens = linhas
    .map((l) => ({ ...l, qtd: Number(l.qty), centavos: Math.round(Number(l.valor) * 100) }))
    .sort((x, y) => y.centavos - x.centavos || x.name.localeCompare(y.name));
  const total = itens.reduce((s, x) => s + x.centavos, 0);
  let acumulado = 0;
  const items: AbcRow[] = itens.map((x) => {
    const antes = total > 0 ? (acumulado / total) * 100 : 0;
    acumulado += x.centavos;
    const cumulative = total > 0 ? (acumulado / total) * 100 : 0;
    // Classe pelo acumulado ANTES do item: o item que cruza 80 % ainda é A.
    const classe: 'A' | 'B' | 'C' = antes < a ? 'A' : antes < b ? 'B' : 'C';
    return {
      item_id: x.item_id,
      sku: x.sku,
      name: x.name,
      consumed_qty: x.qtd,
      value_cents: x.centavos,
      share_pct: total > 0 ? Number(((x.centavos / total) * 100).toFixed(2)) : 0,
      cumulative_pct: Number(cumulative.toFixed(2)),
      abc_class: classe,
    };
  });
  return {
    items,
    total_value_cents: total,
    rule:
      `Pareto por valor consumido no período (saídas para OS e entregas): A até ${a} % do valor acumulado, ` +
      `B até ${b} %, C o restante. Valor da saída = custo gravado no movimento; na falta, custo médio atual.`,
    a_limit: a,
    b_limit: b,
  };
}

export interface PeriodRow {
  item_id: string;
  sku: string;
  name: string;
  unit: string;
  received: number;
  consumed_by_work_orders: number;
  other_out: number;
  adjustments: number;
  on_hand_now: number;
}

/** Entradas e saídas do período, por item — saldo de agora, sem reconstruir o passado. */
export async function stockPeriodReport(
  session: TenantSession,
  f: { from: Date; to: Date; warehouseId?: string | null },
  membershipId: string | null
): Promise<PeriodRow[]> {
  return session.query<PeriodRow>(
    `SELECT i.id AS item_id, i.sku, i.name, i.unit,
            COALESCE(sum(m.qty) FILTER (WHERE m.kind IN ('receipt', 'transfer_in', 'return')), 0)::float8 AS received,
            COALESCE(-sum(m.qty) FILTER (WHERE m.kind = 'consumption' AND m.ref_type = 'work_order'), 0)::float8
              AS consumed_by_work_orders,
            COALESCE(-sum(m.qty) FILTER (WHERE m.kind IN ('issue', 'transfer_out', 'scrap')
                                         OR (m.kind = 'consumption' AND m.ref_type IS DISTINCT FROM 'work_order')), 0)::float8
              AS other_out,
            COALESCE(sum(m.qty) FILTER (WHERE m.kind = 'adjustment'), 0)::float8 AS adjustments,
            COALESCE((SELECT sum(b.on_hand) FROM aurora.stock_balances b
                       JOIN aurora.warehouses wb ON wb.id = b.warehouse_id
                      WHERE b.item_id = i.id AND ($3::uuid IS NULL OR b.warehouse_id = $3)
                        AND (wb.customer_id IS NULL OR $4::uuid IS NULL
                             OR wb.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($4)))), 0)::float8
              AS on_hand_now
       FROM aurora.inventory_items i
       JOIN aurora.stock_movements m ON m.item_id = i.id
       JOIN aurora.warehouses w ON w.id = m.warehouse_id
      WHERE m.occurred_at >= $1 AND m.occurred_at < $2
        AND ($3::uuid IS NULL OR m.warehouse_id = $3)
        AND ${almoxVisivel(4)}
      GROUP BY i.id, i.sku, i.name, i.unit
      ORDER BY i.name`,
    [f.from, f.to, f.warehouseId ?? null, membershipId]
  );
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

export interface StoreItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string | null;
  summary: string | null;
  list_price_cents: string | null;
  image_key: string | null;
}

/** O que a Store mostra: só item publicado, e NUNCA saldo de almoxarifado. */
export async function storeItems(session: TenantSession): Promise<StoreItem[]> {
  return session.query<StoreItem>(
    `SELECT id, sku, name, unit, category, store_summary AS summary,
            list_price_cents::text AS list_price_cents, image_key
       FROM aurora.inventory_items
      WHERE store_published AND archived_at IS NULL
      ORDER BY category NULLS LAST, name`
  );
}

/** Pedir proposta: vira OPORTUNIDADE (origem `customer_request`) para o comercial. */
export async function requestStoreQuote(
  session: TenantSession,
  input: { itemId: string; quantity: number; notes?: string | null; customerId: string }
): Promise<string> {
  const [item] = await session.query<{ name: string; sku: string }>(
    `SELECT name, sku FROM aurora.inventory_items WHERE id = $1 AND store_published AND archived_at IS NULL`,
    [input.itemId]
  );
  if (!item) throw new NotFoundError('item da Store', input.itemId);
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new ValidationError('quantidade precisa ser maior que zero', { field: 'quantity' });
  }
  return createOpportunity(session, {
    customerId: input.customerId,
    origin: 'customer_request',
    title: `Store: ${item.name}`.slice(0, 200),
    need:
      `Pedido de proposta pela Store — ${input.quantity} × ${item.name} (${item.sku}).` +
      (input.notes?.trim() ? ` Observação: ${input.notes.trim()}` : ''),
  });
}
