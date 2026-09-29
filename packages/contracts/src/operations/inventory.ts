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
  average_cost: Decimal,
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
