/**
 * Aurora — estoque (SPEC v0.2 §15 · EPIC-015).
 *
 * TODA QUANTIDADE E TODO CUSTO VIAJAM COMO TEXTO.
 *
 * As colunas são `numeric`, e `numeric` existe justamente porque ponto
 * flutuante erra em dinheiro e em quantidade fracionada. Converter para
 * `number` na fronteira desfaria a decisão do banco em silêncio: 0.1 + 0.2 em
 * peça fracionada é uma diferença de inventário que ninguém consegue explicar,
 * e o erro aparece meses depois, no fechamento.
 *
 * A tela FORMATA o texto. Ninguém precisa somar no cliente — quem soma é o
 * banco, que sabe somar `numeric`.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

/** Quantidade decimal em texto: `"12"`, `"0.5"`, `"-3"`. */
const Decimal = z.string();

export const StockBalance = z.object({
  item_id: Uuid,
  warehouse_id: Uuid,
  sku: z.string(),
  item_name: z.string(),
  warehouse_name: z.string(),
  on_hand: Decimal,
  /**
   * Reservado para ordens de serviço.
   *
   * Está fisicamente na prateleira e não está disponível — a distinção existe
   * porque contá-lo como disponível é como duas OS reservam a última peça.
   */
  reserved: Decimal,
  /** `on_hand - reserved`, calculado no banco. A tela não subtrai. */
  available: Decimal,
  min_qty: Decimal,
  /** Opcionais: capturas da demo anteriores a 16/10/2026 não os têm. */
  max_qty: Decimal.nullable().optional(),
  warehouse_owner: z.enum(['organization', 'customer']).optional(),
  warehouse_customer_id: Uuid.nullable().optional(),
  /** Nulo para quem não tem `inventory.read_costs` — sai da consulta, não da tela. */
  average_cost: Decimal.nullable(),
  /** "un", "cx", "m" — a unidade em que a quantidade é contada. */
  unit: z.string(),
  /** Categoria de almoxarifado. Filtra, agrupa, e escolhe a ilustração. */
  category: z.string().nullable(),
  /**
   * Endereço da imagem do item, já pronto para o `src`.
   *
   * É o SERVIDOR que monta, a partir da chave relativa gravada no banco — a
   * mesma decisão dos anexos (§28): a tela não sabe, e não deve saber, onde os
   * bytes moram. Nulo quando o item ainda não tem foto, e aí a interface
   * desenha as iniciais em vez de um retângulo vazio.
   */
  image_url: z.string().nullable(),
});
export type StockBalance = z.infer<typeof StockBalance>;

export const inventoryBalances = defineOperation({
  operationId: 'inventory.balances',
  method: 'GET',
  path: '/inventory/balances',
  summary: 'Saldos por item e almoxarifado',
  description:
    '`below_minimum=true` devolve só o que está abaixo do mínimo — a pergunta que quem compra faz ' +
    'de manhã, e que na referência exigia rodar um relatório.',
  permissions: ['inventory.read'],
  query: z.object({
    warehouse: Uuid.optional(),
    below_minimum: z.enum(['true', 'false']).optional(),
  }),
  response: z.object({ items: z.array(StockBalance) }),
});

export const StockMovement = z.object({
  /**
   * A ordem do razão.
   *
   * É `sequence`, e não `occurred_at`, que responde "o que aconteceu depois do
   * quê": dois movimentos podem cair no mesmo instante, e o saldo depende da
   * ordem em que foram aplicados.
   */
  sequence: z.union([z.number(), z.string()]),
  kind: z.enum([
    'receipt',
    'issue',
    'adjustment',
    'transfer_out',
    'transfer_in',
    'consumption',
    'return',
    'scrap',
  ]),
  qty: Decimal,
  unit_cost: Decimal.nullable(),
  /** A que documento o movimento se refere: `work_order`, por exemplo. */
  ref_type: z.string().nullable(),
  ref_id: Uuid.nullable(),
  reason: z.string().nullable(),
  /**
   * Preenchido quando ESTE movimento estorna outro.
   *
   * O estorno grava um movimento contrário e não apaga nada: apagar deixaria o
   * razão com um buraco, o saldo bateria, e ninguém conseguiria explicar por
   * que a peça apareceu e sumiu.
   */
  reverses_id: Uuid.nullable(),
  occurred_at: Timestamp,
});
export type StockMovement = z.infer<typeof StockMovement>;

export const inventoryLedger = defineOperation({
  operationId: 'inventory.ledger',
  method: 'GET',
  path: '/inventory/ledger',
  summary: 'Extrato de um item num almoxarifado',
  permissions: ['inventory.read'],
  query: z.object({
    item: Uuid,
    warehouse: Uuid,
    limit: z.coerce.number().int().positive().max(500).optional(),
  }),
  response: z.object({ items: z.array(StockMovement) }),
});

export const inventoryAdjust = defineOperation({
  operationId: 'inventory.adjust',
  method: 'POST',
  path: '/inventory/adjustments',
  summary: 'Ajusta o saldo, com motivo obrigatório',
  description:
    'É a única operação que muda o saldo sem um fato físico do outro lado. Sem motivo, o ' +
    'inventário que não fecha vira um ajuste anônimo — e a diferença entre furto, quebra e erro ' +
    'de lançamento, que é a informação que interessa, desaparece junto.',
  permissions: ['inventory.adjust'],
  body: z.object({
    item_id: Uuid,
    warehouse_id: Uuid,
    /** Pode ser negativo: é metade do propósito do ajuste. */
    qty: z.number(),
    reason: z.string().min(5),
  }),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['validation_failed'],
});

export const inventoryTransfer = defineOperation({
  operationId: 'inventory.transfer',
  method: 'POST',
  path: '/inventory/transfers',
  summary: 'Transfere entre almoxarifados',
  description:
    'Duas pernas, uma transação: sai de um e entra no outro juntos. Duas chamadas separadas ' +
    'deixariam a peça em lugar nenhum se a segunda falhasse, e o estoque só descobriria no ' +
    'inventário seguinte.',
  permissions: ['inventory.move'],
  body: z.object({
    item_id: Uuid,
    from_warehouse_id: Uuid,
    to_warehouse_id: Uuid,
    qty: z.number().positive(),
    reason: z.string().nullable().optional(),
  }),
  response: z.object({ out_id: Uuid, in_id: Uuid }),
  status: 201,
  errors: ['validation_failed'],
});

export const inventoryReverse = defineOperation({
  operationId: 'inventory.reverse',
  method: 'POST',
  path: '/inventory/movements/:id/reversal',
  summary: 'Estorna um movimento sem apagá-lo',
  permissions: ['inventory.adjust'],
  params: z.object({ id: Uuid }),
  body: z.object({ reason: z.string().min(5) }),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['validation_failed', 'not_found'],
});

export const inventorySetMinimum = defineOperation({
  operationId: 'inventory.minimum',
  method: 'POST',
  path: '/inventory/minimums',
  summary: 'Define o mínimo de um item num almoxarifado',
  description:
    'O mínimo é por (item, almoxarifado) e não por item: a mesma peça pode ser crítica na base ' +
    'que atende a UTI e dispensável no depósito central. Um mínimo global avisaria onde não ' +
    'importa e ficaria calado onde importa.',
  permissions: ['inventory.update'],
  body: z.object({
    item_id: Uuid,
    warehouse_id: Uuid,
    min_qty: z.number().nonnegative(),
  }),
  response: z.object({ ok: z.literal(true) }),
  status: 201,
  errors: ['validation_failed'],
});

export const WorkOrderReservation = z.object({
  id: Uuid,
  sku: z.string(),
  item_name: z.string(),
  warehouse_name: z.string(),
  qty: Decimal,
  consumed_qty: Decimal,
  /** O que foi reservado e ainda não teve consumo confirmado. */
  pending: Decimal,
  released_at: Timestamp.nullable(),
});
export type WorkOrderReservation = z.infer<typeof WorkOrderReservation>;

export const inventoryWorkOrderParts = defineOperation({
  operationId: 'inventory.workOrderParts',
  method: 'GET',
  path: '/inventory/work-orders/:id/parts',
  summary: 'Peças reservadas e consumidas numa ordem de serviço',
  permissions: ['inventory.read'],
  params: z.object({ id: Uuid }),
  response: z.object({ items: z.array(WorkOrderReservation) }),
});

/* -------------------------------------------------------------------------- */
/* Gestão do estoque interno e Store (reunião 16/10/2026, Fase 8)              */
/* -------------------------------------------------------------------------- */

/** Dinheiro como texto decimal ("12.50"): nunca float. */
const Valor = z
  .string()
  .trim()
  .regex(/^\d{1,12}([.,]\d{1,2})?$/, 'valor como "1234.56"');

export const InventoryItem = z.object({
  id: Uuid,
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  category: z.string().nullable(),
  list_price_cents: z.string().nullable(),
  store_published: z.boolean(),
  store_summary: z.string().nullable(),
});
export type InventoryItem = z.infer<typeof InventoryItem>;

export const inventoryItemsList = defineOperation({
  operationId: 'inventory.items',
  method: 'GET',
  path: '/inventory/items',
  summary: 'Itens do catálogo de estoque',
  permissions: ['inventory.read'],
  response: z.object({ items: z.array(InventoryItem) }),
});

export const inventoryItemsCreate = defineOperation({
  operationId: 'inventory.createItem',
  method: 'POST',
  path: '/inventory/items',
  summary: 'Cadastra um item de estoque',
  permissions: ['inventory.create'],
  body: z
    .object({
      sku: z.string().trim().min(1).max(60),
      name: z.string().trim().min(2).max(200),
      unit: z.string().trim().max(20).optional(),
      category: z.string().trim().max(80).nullable().optional(),
      list_price: Valor.nullable().optional(),
    })
    .strict(),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['conflict', 'validation_failed'],
});

export const inventoryItemsUpdate = defineOperation({
  operationId: 'inventory.updateItem',
  method: 'PATCH',
  path: '/inventory/items/:id',
  summary: 'Edita o item, inclusive a publicação na Store (preço de lista e resumo)',
  permissions: ['inventory.update'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      name: z.string().trim().min(2).max(200).optional(),
      category: z.string().trim().max(80).nullable().optional(),
      list_price: Valor.nullable().optional(),
      store_published: z.boolean().optional(),
      store_summary: z.string().trim().max(1000).nullable().optional(),
    })
    .strict(),
  response: z.object({ ok: z.literal(true) }),
  errors: ['not_found', 'validation_failed'],
});

export const Warehouse = z.object({
  id: Uuid,
  name: z.string(),
  kind: z.string(),
  customer_id: Uuid.nullable(),
  customer_name: z.string().nullable(),
  owner: z.enum(['organization', 'customer']),
});
export type Warehouse = z.infer<typeof Warehouse>;

export const inventoryWarehouses = defineOperation({
  operationId: 'inventory.warehouses',
  method: 'GET',
  path: '/inventory/warehouses',
  summary: 'Almoxarifados visíveis: os da organização e os dos clientes do escopo',
  permissions: ['inventory.read'],
  response: z.object({ items: z.array(Warehouse) }),
});

export const inventoryWarehousesCreate = defineOperation({
  operationId: 'inventory.createWarehouse',
  method: 'POST',
  path: '/inventory/warehouses',
  summary: 'Cria almoxarifado da organização ou de um CLIENTE (estoque privado do hospital)',
  permissions: ['inventory.create'],
  body: z
    .object({
      name: z.string().trim().min(2).max(120),
      kind: z.enum(['central', 'satellite', 'consignment']).optional(),
      customer_id: Uuid.nullable().optional(),
    })
    .strict(),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['not_found', 'validation_failed'],
});

export const inventoryReceipts = defineOperation({
  operationId: 'inventory.receive',
  method: 'POST',
  path: '/inventory/receipts',
  summary: 'ENTRADA de estoque (compra, doação…) com custo unitário e referência',
  permissions: ['inventory.move'],
  body: z
    .object({
      item_id: Uuid,
      warehouse_id: Uuid,
      qty: z.number().positive(),
      unit_cost: Valor,
      reference: z.string().trim().min(3).max(200),
    })
    .strict(),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['not_found', 'validation_failed'],
});

export const inventoryLimits = defineOperation({
  operationId: 'inventory.setLimits',
  method: 'PUT',
  path: '/inventory/limits',
  summary: 'Define mínimo e máximo de um item num almoxarifado',
  permissions: ['inventory.update'],
  body: z
    .object({
      item_id: Uuid,
      warehouse_id: Uuid,
      min_qty: z.number().min(0),
      max_qty: z.number().min(0).nullable(),
    })
    .strict(),
  response: z.object({ ok: z.literal(true) }),
  errors: ['not_found', 'validation_failed'],
});

export const inventoryValuation = defineOperation({
  operationId: 'inventory.valuation',
  method: 'GET',
  path: '/inventory/valuation',
  summary: 'Valor em estoque por almoxarifado (saldo × custo médio), abaixo do mínimo e acima do máximo',
  permissions: ['inventory.read_costs'],
  response: z.object({
    items: z.array(
      z.object({
        warehouse_id: Uuid,
        warehouse_name: z.string(),
        owner: z.enum(['organization', 'customer']),
        customer_name: z.string().nullable(),
        items: z.number().int(),
        value_cents: z.string(),
        below_min: z.number().int(),
        above_max: z.number().int(),
      })
    ),
  }),
});

const Periodo = z.object({
  from: z.string(),
  to: z.string(),
  warehouse: Uuid.optional(),
});

export const inventoryAbc = defineOperation({
  operationId: 'inventory.abc',
  method: 'GET',
  path: '/inventory/abc',
  summary: 'Curva ABC por valor consumido no período (regra Pareto documentada e ajustável)',
  description:
    'A até `a`% (padrão 80) do valor acumulado, B até `b`% (padrão 95), C o resto. Valor da saída = ' +
    'custo gravado no movimento; na falta, custo médio atual. A regra vem por extenso na resposta.',
  permissions: ['inventory.read_costs'],
  query: Periodo.extend({
    a: z.coerce.number().min(1).max(98).optional(),
    b: z.coerce.number().min(2).max(99).optional(),
  }),
  response: z.object({
    items: z.array(
      z.object({
        item_id: Uuid,
        sku: z.string(),
        name: z.string(),
        consumed_qty: z.number(),
        value_cents: z.number(),
        share_pct: z.number(),
        cumulative_pct: z.number(),
        abc_class: z.enum(['A', 'B', 'C']),
      })
    ),
    total_value_cents: z.number(),
    rule: z.string(),
    a_limit: z.number(),
    b_limit: z.number(),
  }),
  errors: ['validation_failed'],
});

export const inventoryPeriodReport = defineOperation({
  operationId: 'inventory.periodReport',
  method: 'GET',
  path: '/inventory/period-report',
  summary: 'Entradas e saídas por item no período (mês, semestre, ano ou personalizado)',
  permissions: ['inventory.read'],
  query: Periodo,
  response: z.object({
    items: z.array(
      z.object({
        item_id: Uuid,
        sku: z.string(),
        name: z.string(),
        unit: z.string(),
        received: z.number(),
        consumed_by_work_orders: z.number(),
        other_out: z.number(),
        adjustments: z.number(),
        on_hand_now: z.number(),
      })
    ),
  }),
  errors: ['validation_failed'],
});

export const StoreItem = z.object({
  id: Uuid,
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  category: z.string().nullable(),
  summary: z.string().nullable(),
  list_price_cents: z.string().nullable(),
  image_url: z.string().nullable(),
});
export type StoreItem = z.infer<typeof StoreItem>;

export const storeItemsList = defineOperation({
  operationId: 'store.items',
  method: 'GET',
  path: '/store/items',
  summary: 'Store: catálogo comercial publicado — sem saldo de estoque',
  permissions: ['store.read'],
  response: z.object({ items: z.array(StoreItem) }),
});

export const storeRequestQuote = defineOperation({
  operationId: 'store.requestQuote',
  method: 'POST',
  path: '/store/requests',
  summary: 'Pede proposta de um item da Store (vira oportunidade para o comercial)',
  description: 'Sem carrinho, checkout ou pagamento. O cliente precisa estar no escopo de quem pede.',
  permissions: ['store.request_quote'],
  body: z
    .object({
      item_id: Uuid,
      quantity: z.number().positive(),
      notes: z.string().trim().max(1000).nullable().optional(),
      customer_id: Uuid.optional(),
    })
    .strict(),
  response: z.object({ opportunity_id: Uuid }),
  status: 201,
  errors: ['not_found', 'validation_failed', 'forbidden'],
});
