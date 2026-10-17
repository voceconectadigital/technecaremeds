/**
 * Aurora — estoque (SPEC v0.2 §15 · EPIC-015).
 *
 * O estoque existe aqui como desbloqueador do fluxo principal, não como módulo
 * acessório: falta de peça foi a maior causa de OS travada na referência.
 *
 * As operações estão desenhadas para que o caso difícil — duas OS disputando a
 * última peça — termine com uma delas sabendo que não tem, em vez de as duas
 * acharem que têm e as duas travarem.
 */
import { newId, ValidationError, NotFoundError, ConflictError } from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';

export type MovementKind =
  'receipt' | 'issue' | 'adjustment' | 'transfer_out' | 'transfer_in' | 'consumption' | 'return' | 'scrap';

export async function createWarehouse(
  session: TenantSession,
  input: {
    name: string;
    kind?: 'central' | 'satellite' | 'van' | 'consignment';
    locationId?: string | null;
    ownerMembershipId?: string | null;
    allowNegative?: boolean;
  }
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.warehouses
       (id, organization_id, name, kind, location_id, owner_membership_id, allow_negative, created_by)
     VALUES ($1, $2, $3, $4::aurora.warehouse_kind, $5, $6, $7, $8)`,
    [
      id,
      session.context.organizationId,
      input.name,
      input.kind ?? 'central',
      input.locationId ?? null,
      input.ownerMembershipId ?? null,
      input.allowNegative ?? false,
      session.context.actorId,
    ]
  );
  return id;
}

export async function createItem(
  session: TenantSession,
  input: {
    sku: string;
    name: string;
    unit?: string;
    tracking?: 'none' | 'lot' | 'serial';
    leadTimeDays?: number | null;
    manufacturerId?: string | null;
    /** Categoria de almoxarifado (migration 0046). Texto livre. */
    category?: string | null;
    /**
     * Caminho RELATIVO da imagem — `catalogo/filtro-hepa.svg`.
     *
     * Uma URL absoluta é recusada por restrição de tabela, e não por
     * validação aqui: a regra precisa valer também para importação em lote e
     * para correção manual no banco.
     */
    imageKey?: string | null;
  }
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.inventory_items
       (id, organization_id, sku, name, unit, tracking, lead_time_days, manufacturer_id,
        category, image_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::aurora.item_tracking, $7, $8, $9, $10, $11)`,
    [
      id,
      session.context.organizationId,
      input.sku,
      input.name,
      input.unit ?? 'un',
      input.tracking ?? 'none',
      input.leadTimeDays ?? null,
      input.manufacturerId ?? null,
      input.category ?? null,
      input.imageKey ?? null,
      session.context.actorId,
    ]
  );
  return id;
}

/** Estoque mínimo por item × almoxarifado (§15). */
export async function setMinimum(
  session: TenantSession,
  itemId: string,
  warehouseId: string,
  minQty: number
): Promise<void> {
  await session.query(
    `INSERT INTO aurora.stock_balances (organization_id, item_id, warehouse_id, min_qty)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (item_id, warehouse_id) DO UPDATE SET min_qty = EXCLUDED.min_qty`,
    [session.context.organizationId, itemId, warehouseId, minQty]
  );
}

/* -------------------------------------------------------------------------- */
/* movimentação                                                                */
/* -------------------------------------------------------------------------- */

export interface MovementInput {
  itemId: string;
  warehouseId: string;
  kind: MovementKind;
  qty: number;
  lotId?: string | null;
  unitCost?: number | null;
  refType?: string | null;
  refId?: string | null;
  reason?: string | null;
  reversesId?: string | null;
}

/**
 * Registra um movimento no razão.
 *
 * O sinal é derivado do tipo, e não recebido: entrada é positiva, saída é
 * negativa, e deixar quem chama escolher o sinal permitiria uma "baixa" que
 * aumenta o estoque. Só `adjustment` aceita os dois sentidos, porque é
 * exatamente o que ele é — e por isso exige justificativa.
 */
export async function recordMovement(session: TenantSession, input: MovementInput): Promise<string> {
  if (input.qty <= 0) {
    throw new ValidationError('a quantidade do movimento deve ser positiva; o sentido vem do tipo', {
      field: 'qty',
    });
  }
  const saida = ['issue', 'transfer_out', 'consumption', 'scrap'].includes(input.kind);
  const quantidade = saida ? -Math.abs(input.qty) : Math.abs(input.qty);

  const id = newId();
  await session.query(
    `INSERT INTO aurora.stock_movements
       (id, organization_id, item_id, warehouse_id, lot_id, kind, qty, unit_cost,
        ref_type, ref_id, reason, reverses_id, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6::aurora.movement_kind, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      session.context.organizationId,
      input.itemId,
      input.warehouseId,
      input.lotId ?? null,
      input.kind,
      quantidade,
      input.unitCost ?? null,
      input.refType ?? null,
      input.refId ?? null,
      input.reason ?? null,
      input.reversesId ?? null,
      session.context.actorId,
    ]
  );

  await checkMinimum(session, input.itemId, input.warehouseId);
  return id;
}

/**
 * Ajuste com sentido explícito — o único movimento que aceita os dois.
 *
 * `delta` negativo baixa, positivo sobe. A justificativa é obrigatória porque o
 * ajuste é justamente o buraco por onde uma diferença de inventário poderia
 * desaparecer sem ninguém precisar explicá-la.
 */
export async function adjust(
  session: TenantSession,
  itemId: string,
  warehouseId: string,
  delta: number,
  reason: string
): Promise<string> {
  if (delta === 0) throw new ValidationError('ajuste de zero não é ajuste', { field: 'delta' });
  if (reason.trim().length < 5) {
    throw new ValidationError('ajuste exige justificativa', { field: 'reason' });
  }
  const id = newId();
  await session.query(
    `INSERT INTO aurora.stock_movements
       (id, organization_id, item_id, warehouse_id, kind, qty, reason, actor_id)
     VALUES ($1, $2, $3, $4, 'adjustment', $5, $6, $7)`,
    [id, session.context.organizationId, itemId, warehouseId, delta, reason.trim(), session.context.actorId]
  );
  await checkMinimum(session, itemId, warehouseId);
  return id;
}

/**
 * Estorna um movimento com o movimento inverso.
 *
 * "Nunca excluir movimento. Correção é sempre um movimento inverso com
 * referência ao original" (§15). O elo `reverses_id` é o que permite ao
 * relatório mostrar a correção como correção, e não como duas operações
 * independentes que por acaso se cancelam.
 */
export async function reverseMovement(
  session: TenantSession,
  movementId: string,
  reason: string
): Promise<string> {
  const [original] = await session.query<{
    item_id: string;
    warehouse_id: string;
    lot_id: string | null;
    qty: string;
    unit_cost: string | null;
  }>(`SELECT item_id, warehouse_id, lot_id, qty, unit_cost FROM aurora.stock_movements WHERE id = $1`, [
    movementId,
  ]);
  if (!original) throw new NotFoundError('Movimento de estoque', movementId);

  const [jaEstornado] = await session.query(`SELECT 1 FROM aurora.stock_movements WHERE reverses_id = $1`, [
    movementId,
  ]);
  if (jaEstornado) throw new ConflictError('este movimento já foi estornado');

  const id = newId();
  try {
    await session.query(
      `INSERT INTO aurora.stock_movements
         (id, organization_id, item_id, warehouse_id, lot_id, kind, qty, unit_cost,
          reason, reverses_id, actor_id)
       VALUES ($1, $2, $3, $4, $5, 'adjustment', $6, $7, $8, $9, $10)`,
      [
        id,
        session.context.organizationId,
        original.item_id,
        original.warehouse_id,
        original.lot_id,
        -Number(original.qty),
        original.unit_cost === null ? null : Number(original.unit_cost),
        `Estorno: ${reason.trim()}`,
        movementId,
        session.context.actorId,
      ]
    );
  } catch (e) {
    // A leitura acima não segura dois estornos simultâneos; o índice único
    // parcial `movements_reverses_once_uq` (migration 0071) segura.
    const pg = e as { code?: string; constraint?: string } | null;
    if (pg?.code === '23505' && pg.constraint === 'movements_reverses_once_uq') {
      throw new ConflictError('este movimento já foi estornado');
    }
    throw e;
  }
  return id;
}

/* -------------------------------------------------------------------------- */
/* reserva e consumo                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Reserva peça para uma OS.
 *
 * Reduz o DISPONÍVEL, não o físico: a peça continua na prateleira até alguém
 * pegá-la. É essa distinção que impede duas OS de contarem com a mesma peça e
 * travarem as duas — o problema que o estoque existe para resolver aqui.
 *
 * A restrição `balances_reserved_within_hand` é quem de fato garante isso: duas
 * reservas simultâneas do último item passariam as duas por uma leitura prévia,
 * e não passam pelo CHECK.
 */
export async function reserve(
  session: TenantSession,
  workOrderId: string,
  itemId: string,
  warehouseId: string,
  qty: number,
  /** Orçamento cuja aprovação gerou a reserva (migration 0071). Nulo: reserva do campo/escritório. */
  quoteId: string | null = null
): Promise<string> {
  if (qty <= 0) throw new ValidationError('a quantidade reservada deve ser positiva', { field: 'qty' });

  const id = newId();
  await session.query(
    `INSERT INTO aurora.stock_reservations
       (id, organization_id, work_order_id, item_id, warehouse_id, qty, created_by, quote_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      session.context.organizationId,
      workOrderId,
      itemId,
      warehouseId,
      qty,
      session.context.actorId,
      quoteId,
    ]
  );
  const saldo = await session.query(
    `UPDATE aurora.stock_balances SET reserved = reserved + $3
      WHERE item_id = $1 AND warehouse_id = $2
      RETURNING item_id`,
    [itemId, warehouseId, qty]
  );
  // Sem linha de saldo não há o que reservar. Antes, a reserva nascia "no ar":
  // não segurava nada, e o disponível dizia uma coisa e a reserva outra.
  if (saldo.length === 0) {
    throw new ValidationError('não há saldo deste item neste almoxarifado para reservar', {
      field: 'warehouse_id',
    });
  }
  return id;
}

/**
 * Libera as reservas de uma OS.
 *
 * Chamada quando a OS é cancelada (§15). Sem isto, cancelar uma OS deixaria
 * peça reservada para sempre — e o disponível iria minguando sem que o físico
 * mudasse, até alguém descobrir que "tem no estoque mas não pode usar".
 */
export async function releaseReservations(
  session: TenantSession,
  workOrderId: string,
  /** Só as reservas deste orçamento: cancelar um orçamento não solta a peça do campo nem a de outro. */
  quoteId: string | null = null
): Promise<number> {
  const abertas = await session.query<{
    id: string;
    item_id: string;
    warehouse_id: string;
    qty: string;
    consumed_qty: string;
  }>(
    `SELECT id, item_id, warehouse_id, qty, consumed_qty
       FROM aurora.stock_reservations
      WHERE work_order_id = $1 AND released_at IS NULL
        AND ($2::uuid IS NULL OR quote_id = $2)
      FOR UPDATE`,
    [workOrderId, quoteId]
  );

  for (const r of abertas) {
    const pendente = Number(r.qty) - Number(r.consumed_qty);
    if (pendente > 0) {
      await session.query(
        `UPDATE aurora.stock_balances SET reserved = reserved - $3
          WHERE item_id = $1 AND warehouse_id = $2`,
        [r.item_id, r.warehouse_id, pendente]
      );
    }
    await session.query(`UPDATE aurora.stock_reservations SET released_at = now() WHERE id = $1`, [r.id]);
  }
  return abertas.length;
}

/**
 * Consome peça reservada: sai do físico e da reserva ao mesmo tempo.
 *
 * O custo do movimento é o custo médio vigente no almoxarifado, congelado aqui
 * (§15). Buscá-lo na hora de ler o custo da OS faria o valor de uma OS fechada
 * mudar sozinho na próxima compra.
 */
export async function consume(session: TenantSession, reservationId: string, qty: number): Promise<string> {
  const [reserva] = await session.query<{
    work_order_id: string;
    item_id: string;
    warehouse_id: string;
    qty: string;
    consumed_qty: string;
    released_at: string | null;
  }>(
    `SELECT work_order_id, item_id, warehouse_id, qty, consumed_qty, released_at
       FROM aurora.stock_reservations WHERE id = $1`,
    [reservationId]
  );
  if (!reserva) throw new NotFoundError('Reserva', reservationId);
  if (reserva.released_at) throw new ConflictError('esta reserva já foi liberada');

  const disponivelNaReserva = Number(reserva.qty) - Number(reserva.consumed_qty);
  if (qty > disponivelNaReserva) {
    throw new ValidationError(`a reserva tem ${disponivelNaReserva} disponível e o consumo pede ${qty}`, {
      reserved: disponivelNaReserva,
      requested: qty,
    });
  }

  const [saldo] = await session.query<{ average_cost: string }>(
    `SELECT average_cost FROM aurora.stock_balances WHERE item_id = $1 AND warehouse_id = $2`,
    [reserva.item_id, reserva.warehouse_id]
  );

  // A ORDEM IMPORTA: a reserva sai primeiro, o físico depois.
  //
  // Baixar o físico antes deixaria, por um instante, `reserved` maior que
  // `on_hand` — e a restrição `balances_reserved_within_hand` recusaria a
  // operação inteira. A ordem inversa nunca produz estado inválido: reserva
  // menor que o físico é sempre legítima.
  //
  // Se o movimento falhar em seguida (saldo insuficiente), a transação volta
  // atrás por inteiro e a reserva permanece como estava.
  await session.query(`UPDATE aurora.stock_reservations SET consumed_qty = consumed_qty + $2 WHERE id = $1`, [
    reservationId,
    qty,
  ]);
  await session.query(
    `UPDATE aurora.stock_balances SET reserved = reserved - $3
      WHERE item_id = $1 AND warehouse_id = $2`,
    [reserva.item_id, reserva.warehouse_id, qty]
  );

  return recordMovement(session, {
    itemId: reserva.item_id,
    warehouseId: reserva.warehouse_id,
    kind: 'consumption',
    qty,
    unitCost: saldo ? Number(saldo.average_cost) : null,
    refType: 'work_order',
    refId: reserva.work_order_id,
  });
}

/**
 * O TÉCNICO PEGOU A PEÇA: consome primeiro o que já estava reservado para a OS
 * naquele item e almoxarifado (a reserva da aprovação do orçamento, por
 * exemplo) e só reserva-e-consome o que passar disso.
 *
 * Antes, o campo sempre criava uma reserva NOVA e a consumia; no faturamento, o
 * orçamento consumia a reserva dele também — e a mesma peça saía do estoque
 * duas vezes.
 *
 * Almoxarifado de cliente só abastece OS daquele cliente: a peça do Hospital B
 * não é consumida numa OS do Hospital A.
 */
export async function consumeForWorkOrder(
  session: TenantSession,
  workOrderId: string,
  itemId: string,
  warehouseId: string,
  qty: number
): Promise<{ movementId: string; reservationId: string }> {
  if (!(qty > 0)) throw new ValidationError('a quantidade consumida deve ser positiva', { field: 'qty' });

  const [os] = await session.query<{ customer_id: string }>(
    `SELECT customer_id FROM aurora.work_orders WHERE id = $1`,
    [workOrderId]
  );
  if (!os) throw new NotFoundError('ordem de serviço', workOrderId);
  await assertWarehouseServesCustomer(session, warehouseId, os.customer_id);

  const abertas = await session.query<{ id: string; pendente: string }>(
    `SELECT id, (qty - consumed_qty)::text AS pendente
       FROM aurora.stock_reservations
      WHERE work_order_id = $1 AND item_id = $2 AND warehouse_id = $3
        AND released_at IS NULL AND consumed_qty < qty
      ORDER BY created_at, id
      FOR UPDATE`,
    [workOrderId, itemId, warehouseId]
  );

  let restante = qty;
  let primeiro: { movementId: string; reservationId: string } | null = null;
  for (const r of abertas) {
    if (restante <= 0) break;
    const parte = Math.min(restante, Number(r.pendente));
    const movementId = await consume(session, r.id, parte);
    primeiro ??= { movementId, reservationId: r.id };
    // A coluna é numeric(16,4): arredondar na mesma escala evita sobra de float
    // (0,3 − 0,1 − 0,2 ≠ 0) virando uma reserva de 0,0000000001.
    restante = Number((restante - parte).toFixed(4));
  }
  if (restante > 0) {
    const reservationId = await reserve(session, workOrderId, itemId, warehouseId, restante);
    const movementId = await consume(session, reservationId, restante);
    primeiro ??= { movementId, reservationId };
  }
  return primeiro!;
}

/**
 * Almoxarifado de cliente (0066) só abastece aquele cliente; o da prestadora
 * (sem cliente) abastece qualquer um.
 */
export async function assertWarehouseServesCustomer(
  session: TenantSession,
  warehouseId: string,
  customerId: string
): Promise<void> {
  const [w] = await session.query<{ customer_id: string | null }>(
    `SELECT customer_id FROM aurora.warehouses WHERE id = $1 AND archived_at IS NULL`,
    [warehouseId]
  );
  if (!w) throw new NotFoundError('almoxarifado', warehouseId);
  if (w.customer_id !== null && w.customer_id !== customerId) {
    throw new ValidationError('este almoxarifado é de outro cliente e não abastece esta OS', {
      field: 'warehouse_id',
    });
  }
}

/**
 * Devolve peça consumida ao estoque.
 *
 * "Peça não usada volta ao lote de origem quando rastreado; senão, entra como
 * ajuste positivo com referência à OS" (§15). O elo com a OS é o que permite
 * ao custo dela ser recalculado corretamente.
 */
export async function returnToStock(
  session: TenantSession,
  workOrderId: string,
  itemId: string,
  warehouseId: string,
  qty: number,
  lotId?: string | null
): Promise<string> {
  const [saldo] = await session.query<{ average_cost: string }>(
    `SELECT average_cost FROM aurora.stock_balances WHERE item_id = $1 AND warehouse_id = $2`,
    [itemId, warehouseId]
  );
  return recordMovement(session, {
    itemId,
    warehouseId,
    kind: 'return',
    qty,
    lotId: lotId ?? null,
    unitCost: saldo ? Number(saldo.average_cost) : null,
    refType: 'work_order',
    refId: workOrderId,
  });
}

/** Transferência entre almoxarifados: duas pernas, uma operação. */
export async function transfer(
  session: TenantSession,
  itemId: string,
  fromWarehouseId: string,
  toWarehouseId: string,
  qty: number,
  reason?: string
): Promise<{ out: string; in: string }> {
  if (fromWarehouseId === toWarehouseId) {
    throw new ValidationError('origem e destino da transferência são o mesmo almoxarifado', {
      field: 'to_warehouse_id',
    });
  }
  const [saldo] = await session.query<{ average_cost: string }>(
    `SELECT average_cost FROM aurora.stock_balances WHERE item_id = $1 AND warehouse_id = $2`,
    [itemId, fromWarehouseId]
  );
  const custo = saldo ? Number(saldo.average_cost) : null;

  const saida = await recordMovement(session, {
    itemId,
    warehouseId: fromWarehouseId,
    kind: 'transfer_out',
    qty,
    unitCost: custo,
    reason: reason ?? null,
  });
  const entrada = await recordMovement(session, {
    itemId,
    warehouseId: toWarehouseId,
    kind: 'transfer_in',
    qty,
    unitCost: custo,
    reason: reason ?? null,
  });
  return { out: saida, in: entrada };
}

/* -------------------------------------------------------------------------- */
/* consultas                                                                   */
/* -------------------------------------------------------------------------- */

export interface BalanceRow {
  item_id: string;
  warehouse_id: string;
  sku: string;
  item_name: string;
  warehouse_name: string;
  on_hand: string;
  reserved: string;
  available: string;
  min_qty: string;
  max_qty: string | null;
  /** Nulo sem `inventory.read_costs`. */
  average_cost: string | null;
  warehouse_customer_id: string | null;
  warehouse_owner: 'organization' | 'customer';
  unit: string;
  category: string | null;
  /**
   * Caminho RELATIVO da imagem, como está gravado.
   *
   * A camada de dados devolve o que está no banco e não supõe onde os bytes
   * são servidos — quem transforma a chave em endereço é a borda HTTP.
   */
  image_key: string | null;
}

export async function balances(
  session: TenantSession,
  opts: {
    warehouseId?: string | null;
    belowMinimum?: boolean;
    /** Vínculo cujo escopo esconde almoxarifado de cliente alheio (16/10/2026). */
    membershipId?: string | null;
    /** Sem `inventory.read_costs`, o custo sai da CONSULTA (vem nulo). */
    withCosts?: boolean;
  } = {}
): Promise<BalanceRow[]> {
  return session.query<BalanceRow>(
    `SELECT b.item_id, b.warehouse_id, i.sku, i.name AS item_name, w.name AS warehouse_name,
            b.on_hand, b.reserved, (b.on_hand - b.reserved) AS available, b.min_qty, b.max_qty,
            CASE WHEN $4::boolean THEN b.average_cost END AS average_cost,
            i.unit, i.category, i.image_key,
            w.customer_id AS warehouse_customer_id,
            CASE WHEN w.customer_id IS NULL THEN 'organization' ELSE 'customer' END AS warehouse_owner
       FROM aurora.stock_balances b
       JOIN aurora.inventory_items i ON i.id = b.item_id
       JOIN aurora.warehouses w      ON w.id = b.warehouse_id
      WHERE ($1::uuid IS NULL OR b.warehouse_id = $1)
        AND (NOT $2::boolean OR (b.min_qty > 0 AND b.on_hand < b.min_qty))
        AND (w.customer_id IS NULL OR $3::uuid IS NULL
             OR w.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($3)))
      ORDER BY i.name, w.name`,
    [opts.warehouseId ?? null, opts.belowMinimum ?? false, opts.membershipId ?? null, opts.withCosts ?? true]
  );
}

/**
 * Emite `stock.below_minimum` quando o saldo cruza o mínimo.
 *
 * Evento, e não uma "automação" fixa como na referência: quem decide o que
 * fazer com o aviso é a automação da organização — abrir requisição de compra,
 * notificar o comprador, ou nada.
 */
async function checkMinimum(session: TenantSession, itemId: string, warehouseId: string): Promise<void> {
  const [saldo] = await session.query<{ on_hand: string; min_qty: string; sku: string }>(
    `SELECT b.on_hand, b.min_qty, i.sku
       FROM aurora.stock_balances b
       JOIN aurora.inventory_items i ON i.id = b.item_id
      WHERE b.item_id = $1 AND b.warehouse_id = $2`,
    [itemId, warehouseId]
  );
  if (!saldo) return;
  if (Number(saldo.min_qty) > 0 && Number(saldo.on_hand) < Number(saldo.min_qty)) {
    await emitEvent(session, {
      type: 'stock.below_minimum',
      aggregateId: itemId,
      payload: {
        sku: saldo.sku,
        warehouse_id: warehouseId,
        on_hand: Number(saldo.on_hand),
        min_qty: Number(saldo.min_qty),
      },
    });
  }
}

/** Extrato de um item num almoxarifado, na ordem do razão. */
export async function ledger(
  session: TenantSession,
  itemId: string,
  warehouseId: string,
  limit = 100,
  /** Sem `inventory.read_costs`, o custo sai da CONSULTA (vem nulo), como em `balances`. */
  withCosts = true
): Promise<Array<Record<string, unknown>>> {
  return session.query(
    `SELECT sequence, kind::text AS kind, qty,
            CASE WHEN $4::boolean THEN unit_cost END AS unit_cost,
            ref_type, ref_id, reason, reverses_id, occurred_at
       FROM aurora.stock_movements
      WHERE item_id = $1 AND warehouse_id = $2
      ORDER BY sequence DESC
      LIMIT $3`,
    [itemId, warehouseId, limit, withCosts]
  );
}

/** Peças de uma OS, com o que foi reservado e o que foi consumido. */
export async function workOrderParts(
  session: TenantSession,
  workOrderId: string
): Promise<Array<Record<string, unknown>>> {
  return session.query(
    `SELECT r.id, i.sku, i.name AS item_name, w.name AS warehouse_name,
            r.qty, r.consumed_qty, (r.qty - r.consumed_qty) AS pending, r.released_at
       FROM aurora.stock_reservations r
       JOIN aurora.inventory_items i ON i.id = r.item_id
       JOIN aurora.warehouses w      ON w.id = r.warehouse_id
      WHERE r.work_order_id = $1
      ORDER BY i.name`,
    [workOrderId]
  );
}

/** Quantas peças ainda esperam confirmação de consumo — usado no bloco de conclusão. */
export async function pendingPartsCount(session: TenantSession, workOrderId: string): Promise<number> {
  const [row] = await session.query<{ c: number }>(
    `SELECT count(*)::int c FROM aurora.stock_reservations
      WHERE work_order_id = $1 AND released_at IS NULL AND consumed_qty < qty`,
    [workOrderId]
  );
  return Number(row?.c ?? 0);
}
