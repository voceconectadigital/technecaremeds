/**
 * Aurora — PF-34: peça lançada em campo ANTES da aprovação do orçamento.
 *
 * Decisão: na aprovação, cada linha de peça reserva só
 * `max(0, orçado − consumo de campo ainda livre)` daquele item na mesma OS, e
 * o abatimento fica gravado na linha (`field_consumed_qty`, migration 0074).
 * O valor cobrado não muda.
 *
 *   · campo 2 → orçamento de 2 aprovado → faturado: o físico cai exatamente 2;
 *   · campo 1 → orçamento de 3: reserva 2 → faturado: cai 3 no total;
 *   · o mesmo consumo não abate um segundo orçamento da OS;
 *   · revisar o aprovado: a versão nova abate de novo (a velha sai da conta);
 *   · cancelar antes de aprovar não mexe em nada; devolução volta a ser livre;
 *   · `fn_quote_items_frozen` continua recusando tudo o que recusava antes;
 *   · a 0074 liga ao orçamento as reservas de aprovação que a 0071 deixou sem
 *     elo (OS com 2+ aprovados) — o faturamento passa a baixá-las.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant, type TenantSession } from '../client';
import { createCustomer } from '../directory';
import { provisionOrganizationBaseline } from '../provisioning';
import { createWorkOrder } from '../work-orders';
import {
  createWarehouse,
  createItem,
  recordMovement,
  balances,
  consumeForWorkOrder,
  returnToStock,
} from '../inventory';
import { createQuote, addQuoteItem, transitionQuote, reviseQuote, loadQuote, quoteItems } from '../quotes';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from '../migrator';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'pf-estoque2',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let hospital: string, contato: string, corretiva: string, central: string;
let itens = 0;

const dia = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
const tx = <T>(f: (s: TenantSession) => Promise<T>) => withTenant(t.db, ctx, f);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'pf-estoque2', name: 'Prestadora', email: 'a@pf-estoque2.test', userName: 'A' }
  );
  await tx(async (s) => {
    await provisionOrganizationBaseline(s);
    hospital = await createCustomer(s, { name: 'Hospital A' });
    contato = newId();
    await s.query(
      `INSERT INTO aurora.customer_contacts (id, organization_id, customer_id, name, email)
       VALUES ($1, $2, $3, 'Compras', 'compras@hosp.test')`,
      [contato, ORG, hospital]
    );
    const [c] = await s.query<{ id: string }>(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
    );
    corretiva = c!.id;
    central = await createWarehouse(s, { name: 'Central' });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

/** Item novo com 20 no central: cada cenário conta só o próprio movimento. */
async function novoItem(): Promise<string> {
  return tx(async (s) => {
    const id = await createItem(s, { sku: `PF34-${++itens}`, name: 'Filtro' });
    await recordMovement(s, { itemId: id, warehouseId: central, kind: 'receipt', qty: 20, unitCost: 50 });
    return id;
  });
}

async function novaOs(): Promise<string> {
  return tx(async (s) => {
    const w = await createWorkOrder(s, { customerId: hospital, workOrderTypeId: corretiva, title: 'Troca' });
    return w.id;
  });
}

/** Orçamento ENVIADO com as quantidades dadas (uma linha por quantidade), R$ 100 cada. */
async function orcamentoEnviado(os: string, itemId: string, ...qtds: number[]): Promise<string> {
  return tx(async (s) => {
    const q = await createQuote(s, {
      customerId: hospital,
      workOrderId: os,
      approverContactId: contato,
      validUntil: dia(30),
    });
    for (const qtd of qtds) {
      await addQuoteItem(s, { quoteId: q, kind: 'part', itemId, quantity: qtd, unitPriceCents: 10_000 });
    }
    await transitionQuote(s, q, 'sent');
    return q;
  });
}

async function saldo(itemId: string) {
  const linhas = await tx((s) => balances(s, { warehouseId: central }));
  const l = linhas.find((b) => b.item_id === itemId)!;
  return { onHand: Number(l.on_hand), reserved: Number(l.reserved) };
}

async function abatimentos(quoteId: string): Promise<number[]> {
  const linhas = (await tx((s) => quoteItems(s, quoteId))) as Array<{ field_consumed_qty: string }>;
  return linhas.map((l) => Number(l.field_consumed_qty));
}

async function reservadoPeloOrcamento(quoteId: string): Promise<number> {
  const [r] = await tx((s) =>
    s.query<{ q: string }>(
      `SELECT COALESCE(sum(qty), 0)::text AS q FROM aurora.stock_reservations WHERE quote_id = $1`,
      [quoteId]
    )
  );
  return Number(r!.q);
}

describe('PF-34 — peça lançada antes da aprovação não sai duas vezes', () => {
  it('campo 2 → orçamento de 2 aprovado → faturado: o físico cai exatamente 2; valor intacto', async () => {
    const item = await novoItem();
    const os = await novaOs();
    await tx((s) => consumeForWorkOrder(s, os, item, central, 2));
    const q = await orcamentoEnviado(os, item, 2);

    await tx((s) => transitionQuote(s, q, 'approved'));
    expect(await abatimentos(q)).toEqual([2]);
    expect(await reservadoPeloOrcamento(q)).toBe(0);
    expect(await saldo(item)).toEqual({ onHand: 18, reserved: 0 });

    await tx((s) => transitionQuote(s, q, 'invoiced'));
    expect(await saldo(item)).toEqual({ onHand: 18, reserved: 0 });
    // O cliente paga pela peça usada: o total continua o orçado.
    expect(Number((await tx((s) => loadQuote(s, q))).total_cents)).toBe(20_000);
  });

  it('campo 1 → orçamento de 3: reserva 2 → faturado: cai 3 no total', async () => {
    const item = await novoItem();
    const os = await novaOs();
    await tx((s) => consumeForWorkOrder(s, os, item, central, 1));
    const q = await orcamentoEnviado(os, item, 3);

    await tx((s) => transitionQuote(s, q, 'approved'));
    expect(await abatimentos(q)).toEqual([1]);
    expect(await reservadoPeloOrcamento(q)).toBe(2);
    expect(await saldo(item)).toEqual({ onHand: 19, reserved: 2 });

    await tx((s) => transitionQuote(s, q, 'invoiced'));
    expect(await saldo(item)).toEqual({ onHand: 17, reserved: 0 });
    expect(Number((await tx((s) => loadQuote(s, q))).total_cents)).toBe(30_000);
  });

  it('o mesmo consumo não abate o segundo orçamento da mesma OS', async () => {
    const item = await novoItem();
    const os = await novaOs();
    await tx((s) => consumeForWorkOrder(s, os, item, central, 2));
    const a = await orcamentoEnviado(os, item, 2);
    await tx((s) => transitionQuote(s, a, 'approved'));
    expect(await abatimentos(a)).toEqual([2]);

    const b = await orcamentoEnviado(os, item, 2);
    await tx((s) => transitionQuote(s, b, 'approved'));
    expect(await abatimentos(b)).toEqual([0]);
    expect(await reservadoPeloOrcamento(b)).toBe(2);

    await tx(async (s) => {
      await transitionQuote(s, a, 'invoiced');
      await transitionQuote(s, b, 'invoiced');
    });
    expect(await saldo(item)).toEqual({ onHand: 16, reserved: 0 });
  });

  it('duas linhas do mesmo item dividem o consumo livre, na ordem das linhas', async () => {
    const item = await novoItem();
    const os = await novaOs();
    await tx((s) => consumeForWorkOrder(s, os, item, central, 2));
    const q = await orcamentoEnviado(os, item, 1, 3);
    await tx((s) => transitionQuote(s, q, 'approved'));
    expect(await abatimentos(q)).toEqual([1, 1]);
    expect(await reservadoPeloOrcamento(q)).toBe(2);
    await tx((s) => transitionQuote(s, q, 'invoiced'));
    expect(await saldo(item)).toEqual({ onHand: 16, reserved: 0 });
  });

  it('peça devolvida ao estoque deixa de abater', async () => {
    const item = await novoItem();
    const os = await novaOs();
    await tx((s) => consumeForWorkOrder(s, os, item, central, 2));
    await tx((s) => returnToStock(s, os, item, central, 1));
    const q = await orcamentoEnviado(os, item, 2);
    await tx((s) => transitionQuote(s, q, 'approved'));
    expect(await abatimentos(q)).toEqual([1]);
    expect(await reservadoPeloOrcamento(q)).toBe(1);
    await tx((s) => transitionQuote(s, q, 'invoiced'));
    expect(await saldo(item)).toEqual({ onHand: 18, reserved: 0 });
  });

  it('cancelar antes de aprovar não abate nada; o orçamento seguinte abate', async () => {
    const item = await novoItem();
    const os = await novaOs();
    await tx((s) => consumeForWorkOrder(s, os, item, central, 2));
    const cancelado = await orcamentoEnviado(os, item, 2);
    await tx((s) => transitionQuote(s, cancelado, 'cancelled'));
    expect(await abatimentos(cancelado)).toEqual([0]);

    const q = await orcamentoEnviado(os, item, 2);
    await tx((s) => transitionQuote(s, q, 'approved'));
    expect(await abatimentos(q)).toEqual([2]);
    expect(await saldo(item)).toEqual({ onHand: 18, reserved: 0 });
  });
});

describe('PF-34 — revisão do orçamento aprovado', () => {
  it('a versão nova nasce sem abatimento e, aprovada, abate de novo (a velha sai da conta)', async () => {
    const item = await novoItem();
    const os = await novaOs();
    await tx((s) => consumeForWorkOrder(s, os, item, central, 2));
    const v1 = await orcamentoEnviado(os, item, 3);
    await tx((s) => transitionQuote(s, v1, 'approved'));
    expect(await abatimentos(v1)).toEqual([2]);
    expect(await saldo(item)).toEqual({ onHand: 18, reserved: 1 });

    const v2 = await tx((s) => reviseQuote(s, v1));
    // A versão aprovada fica registrada como era; a nova é rascunho, sem abatimento.
    expect(await abatimentos(v1)).toEqual([2]);
    expect(await abatimentos(v2)).toEqual([0]);
    expect(await saldo(item)).toEqual({ onHand: 18, reserved: 0 });

    await tx(async (s) => {
      await transitionQuote(s, v2, 'sent');
      await transitionQuote(s, v2, 'approved');
    });
    expect(await abatimentos(v2)).toEqual([2]);
    expect(await saldo(item)).toEqual({ onHand: 18, reserved: 1 });

    await tx((s) => transitionQuote(s, v2, 'invoiced'));
    expect(await saldo(item)).toEqual({ onHand: 17, reserved: 0 });
  });

  it('peça usada em campo DEPOIS da aprovação da v1 é abatida pela v2, não reservada de novo', async () => {
    const item = await novoItem();
    const os = await novaOs();
    const v1 = await orcamentoEnviado(os, item, 3);
    await tx((s) => transitionQuote(s, v1, 'approved'));
    // Consome contra a reserva da v1.
    await tx((s) => consumeForWorkOrder(s, os, item, central, 1));
    expect(await saldo(item)).toEqual({ onHand: 19, reserved: 2 });

    const v2 = await tx((s) => reviseQuote(s, v1));
    expect(await saldo(item)).toEqual({ onHand: 19, reserved: 0 });
    await tx(async (s) => {
      await transitionQuote(s, v2, 'sent');
      await transitionQuote(s, v2, 'approved');
    });
    expect(await abatimentos(v2)).toEqual([1]);
    expect(await reservadoPeloOrcamento(v2)).toBe(2);

    await tx((s) => transitionQuote(s, v2, 'invoiced'));
    expect(await saldo(item)).toEqual({ onHand: 17, reserved: 0 });
  });

  it('sem consumo de campo, nada muda: reserva a linha inteira (comportamento anterior)', async () => {
    const item = await novoItem();
    const os = await novaOs();
    const q = await orcamentoEnviado(os, item, 2);
    await tx((s) => transitionQuote(s, q, 'approved'));
    expect(await abatimentos(q)).toEqual([0]);
    expect(await reservadoPeloOrcamento(q)).toBe(2);
    await tx((s) => transitionQuote(s, q, 'invoiced'));
    expect(await saldo(item)).toEqual({ onHand: 18, reserved: 0 });
  });
});

describe('PF-34 — fn_quote_items_frozen (0074) mantém tudo o que recusava', () => {
  let rascunho: string, enviado: string, aprovado: string, item: string;

  beforeAll(async () => {
    item = await novoItem();
    const os = await novaOs();
    enviado = await orcamentoEnviado(os, item, 1);
    aprovado = await orcamentoEnviado(os, item, 1);
    await tx((s) => transitionQuote(s, aprovado, 'approved'));
    rascunho = await tx(async (s) => {
      const q = await createQuote(s, { customerId: hospital, workOrderId: os });
      await addQuoteItem(s, { quoteId: q, kind: 'part', itemId: item, quantity: 2, unitPriceCents: 100 });
      return q;
    });
  });

  const upd = (quoteId: string, set: string) =>
    tx((s) => s.query(`UPDATE aurora.quote_items SET ${set} WHERE quote_id = $1`, [quoteId]));

  it('aprovado: só o abatimento muda; qualquer outra coluna, junto ou sozinha, é recusada', async () => {
    await upd(aprovado, 'field_consumed_qty = 1');
    await upd(aprovado, 'field_consumed_qty = 0');
    await expect(upd(aprovado, `description = 'outra'`)).rejects.toThrow(/não se edita/);
    await expect(upd(aprovado, `field_consumed_qty = 1, unit_price_cents = 1`)).rejects.toThrow(
      /não se edita/
    );
    // UPDATE que não muda nada continua recusado fora do rascunho.
    await expect(upd(aprovado, 'field_consumed_qty = field_consumed_qty')).rejects.toThrow(/não se edita/);
  });

  it('aprovado: INSERT e DELETE de linha continuam recusados', async () => {
    await expect(
      tx((s) =>
        addQuoteItem(s, {
          quoteId: aprovado,
          kind: 'service',
          description: 'x',
          quantity: 1,
          unitPriceCents: 1,
        })
      )
    ).rejects.toThrow(/não se edita/);
    await expect(
      tx((s) => s.query(`DELETE FROM aurora.quote_items WHERE quote_id = $1`, [aprovado]))
    ).rejects.toThrow(/não se edita/);
  });

  it('enviado (não aprovado): nem o abatimento muda', async () => {
    await expect(upd(enviado, 'field_consumed_qty = 1')).rejects.toThrow(/não se edita/);
  });

  it('rascunho: continua editável; o abatimento não passa da quantidade', async () => {
    await upd(rascunho, `description = 'Filtro novo'`);
    await expect(upd(rascunho, 'field_consumed_qty = 3')).rejects.toThrow(/field_consumed_within/);
    await expect(upd(aprovado, 'field_consumed_qty = -1')).rejects.toThrow(/field_consumed_within/);
  });
});

describe('0074 — reservas de aprovação que a 0071 deixou sem orçamento', () => {
  /** O trecho de dado da 0074, executado de novo sobre o dado "legado" montado aqui. */
  const correcao = (() => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0074_orcamento_e_peca_lancada.sql'), 'utf8');
    const i = sql.indexOf('-- Reservas de aprovação sem orçamento');
    expect(i).toBeGreaterThan(0);
    return sql.slice(i);
  })();

  const reservasDa = async (os: string) =>
    (await t.raw(
      `SELECT id, quote_id, qty::float AS qty, consumed_qty::float AS consumed, released_at
         FROM aurora.stock_reservations WHERE work_order_id = $1 ORDER BY created_at, id`,
      [os]
    )) as Array<{ id: string; quote_id: string | null; qty: number; consumed: number; released_at: unknown }>;

  it('OS com 2 aprovados: cada reserva volta ao seu orçamento, e o faturamento a baixa', async () => {
    const item = await novoItem();
    const os = await novaOs();
    const a = await orcamentoEnviado(os, item, 2);
    const b = await orcamentoEnviado(os, item, 3);
    await tx((s) => transitionQuote(s, a, 'approved'));
    await tx((s) => transitionQuote(s, b, 'approved'));
    // Um terceiro, aprovado e depois revisado já sem o elo: a revisão não o soltou.
    const c = await orcamentoEnviado(os, item, 4);
    await tx((s) => transitionQuote(s, c, 'approved'));
    // O estado que a 0071 deixou: OS com 2+ aprovados → reservas sem orçamento.
    await t.raw(`UPDATE aurora.stock_reservations SET quote_id = NULL WHERE work_order_id = $1`, [os]);
    await tx((s) => reviseQuote(s, c));
    expect(await saldo(item)).toEqual({ onHand: 20, reserved: 9 });

    // Faturar sem a correção não baixaria nada — é o defeito.
    await t.admin.transaction((x) => x.query(correcao));

    const r = await reservasDa(os);
    expect(r.map((x) => x.quote_id)).toEqual([a, b, c]);
    expect(r[2]!.released_at).not.toBeNull();
    expect(await saldo(item)).toEqual({ onHand: 20, reserved: 5 });

    await tx((s) => transitionQuote(s, a, 'invoiced'));
    expect(await saldo(item)).toEqual({ onHand: 18, reserved: 3 });
    await tx((s) => transitionQuote(s, b, 'invoiced'));
    expect(await saldo(item)).toEqual({ onHand: 15, reserved: 0 });
  });

  it('sem marca única (criada fora da aprovação) não é ligada nem solta', async () => {
    const item = await novoItem();
    const os = await novaOs();
    const a = await orcamentoEnviado(os, item, 1);
    await tx((s) => transitionQuote(s, a, 'approved'));
    await t.raw(
      `UPDATE aurora.stock_reservations SET quote_id = NULL, created_at = created_at - interval '1 minute'
        WHERE work_order_id = $1`,
      [os]
    );
    await t.admin.transaction((x) => x.query(correcao));
    const [r] = await reservasDa(os);
    expect(r!.quote_id).toBeNull();
    expect(r!.released_at).toBeNull();
    expect(await saldo(item)).toEqual({ onHand: 20, reserved: 1 });
  });
});
