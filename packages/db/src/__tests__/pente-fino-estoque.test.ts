/**
 * Aurora — pente-fino de 17/10/2026: integridade entre orçamento e estoque.
 *
 *   · a peça do orçamento aprovado, usada em campo, sai do estoque UMA vez;
 *   · transição de orçamento serializada (trava + condição de situação);
 *   · aprovado não se revisa; cancelar orçamento solta só as reservas dele;
 *   · almoxarifado de cliente só abastece aquele cliente;
 *   · desconto/acréscimo/imposto só em rascunho (aplicação E banco);
 *   · extrato sem custo para quem não tem `inventory.read_costs`;
 *   · estorno único (índice parcial), reserva sem saldo recusada;
 *   · orçamento de um cliente sobre OS de outro é recusado.
 *
 * Concorrência de verdade não se reproduz no PGlite (uma conexão só): a
 * condição de situação do UPDATE é provada com uma leitura VELHA simulada.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS, ConflictError, ValidationError } from '@aurora/domain';
import { withTenant, type TenantSession } from '../client';
import { createCustomer } from '../directory';
import { provisionOrganizationBaseline } from '../provisioning';
import { createWorkOrder } from '../work-orders';
import {
  createWarehouse,
  createItem,
  recordMovement,
  balances,
  reserve,
  releaseReservations,
  consumeForWorkOrder,
  ledger,
  reverseMovement,
} from '../inventory';
import {
  createQuote,
  addQuoteItem,
  removeQuoteItem,
  setQuoteDiscount,
  transitionQuote,
  reviseQuote,
  loadQuote,
} from '../quotes';
import { fieldSyncBundle } from '../field-sync';
import { createTestDatabase, seedOrganization, seedMember, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'pf-estoque',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let hospitalA: string, hospitalB: string, contatoA: string, contatoB: string, corretiva: string;
let central: string, almoxB: string, filtro: string, valvula: string;
const MEM_RESTRITO = newId();

const dia = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
const tx = <T>(f: (s: TenantSession) => Promise<T>) => withTenant(t.db, ctx, f);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'pf-estoque', name: 'Prestadora', email: 'a@pf-estoque.test', userName: 'A' }
  );
  await tx(async (s) => {
    await provisionOrganizationBaseline(s);
    hospitalA = await createCustomer(s, { name: 'Hospital A' });
    hospitalB = await createCustomer(s, { name: 'Hospital B' });
    contatoA = newId();
    contatoB = newId();
    await s.query(
      `INSERT INTO aurora.customer_contacts (id, organization_id, customer_id, name, email)
       VALUES ($1, $2, $3, 'Compras A', 'a@hosp.test'), ($4, $2, $5, 'Compras B', 'b@hosp.test')`,
      [contatoA, ORG, hospitalA, contatoB, hospitalB]
    );
    const [c] = await s.query<{ id: string }>(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
    );
    corretiva = c!.id;

    central = await createWarehouse(s, { name: 'Central' });
    almoxB = await createWarehouse(s, { name: 'Almox. Hospital B' });
    await s.query(`UPDATE aurora.warehouses SET customer_id = $2 WHERE id = $1`, [almoxB, hospitalB]);
    filtro = await createItem(s, { sku: 'FLT-1', name: 'Filtro' });
    valvula = await createItem(s, { sku: 'VLV-1', name: 'Válvula' });

    await recordMovement(s, { itemId: filtro, warehouseId: central, kind: 'receipt', qty: 10, unitCost: 50 });
    // O almoxarifado do Hospital B tem MAIS saldo — a escolha "pelo maior
    // disponível" o pegaria se o dono não fosse respeitado.
    await recordMovement(s, { itemId: filtro, warehouseId: almoxB, kind: 'receipt', qty: 50, unitCost: 50 });
    await recordMovement(s, { itemId: valvula, warehouseId: almoxB, kind: 'receipt', qty: 5, unitCost: 80 });
  });
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: MEM_RESTRITO },
    { email: 'r@pf-estoque.test', userName: 'Restrito', customerIds: [hospitalA] }
  );
}, 120_000);

afterAll(async () => {
  await t?.close();
});

async function novaOs(customerId = hospitalA): Promise<string> {
  return tx(async (s) => {
    const w = await createWorkOrder(s, { customerId, workOrderTypeId: corretiva, title: 'Troca de peças' });
    return w.id;
  });
}

/** Orçamento enviado com `qtd` filtros, pronto para aprovar. */
async function orcamentoEnviado(os: string, qtd: number, itemId = filtro): Promise<string> {
  return tx(async (s) => {
    const q = await createQuote(s, {
      customerId: hospitalA,
      workOrderId: os,
      approverContactId: contatoA,
      validUntil: dia(30),
    });
    await addQuoteItem(s, { quoteId: q, kind: 'part', itemId, quantity: qtd, unitPriceCents: 10_000 });
    await transitionQuote(s, q, 'sent');
    return q;
  });
}

async function saldo(warehouseId: string, itemId = filtro) {
  const linhas = await tx((s) => balances(s, { warehouseId }));
  const l = linhas.find((b) => b.item_id === itemId)!;
  return { onHand: Number(l.on_hand), reserved: Number(l.reserved) };
}

describe('P1 — a peça do orçamento usada em campo sai uma vez só', () => {
  it('aprovar 2 → campo registra 2 → faturar: o físico cai exatamente 2', async () => {
    const os = await novaOs();
    const q = await orcamentoEnviado(os, 2);
    const antes = await saldo(central);

    await tx((s) => transitionQuote(s, q, 'approved'));
    const aprovado = await saldo(central);
    expect(aprovado.reserved).toBe(antes.reserved + 2);

    const r = await tx((s) => consumeForWorkOrder(s, os, filtro, central, 2));
    expect(r.reservationId).toBeTruthy();
    const usado = await saldo(central);
    expect(usado.onHand).toBe(antes.onHand - 2);
    expect(usado.reserved).toBe(antes.reserved);

    await tx((s) => transitionQuote(s, q, 'invoiced'));
    const faturado = await saldo(central);
    expect(faturado.onHand).toBe(antes.onHand - 2);
    expect(faturado.reserved).toBe(antes.reserved);
  });

  it('campo usando MAIS que o orçado consome a reserva e só o excedente vira reserva nova', async () => {
    const os = await novaOs();
    const q = await orcamentoEnviado(os, 1);
    const antes = await saldo(central);
    await tx((s) => transitionQuote(s, q, 'approved'));
    await tx((s) => consumeForWorkOrder(s, os, filtro, central, 3));
    await tx((s) => transitionQuote(s, q, 'invoiced'));
    const depois = await saldo(central);
    expect(depois.onHand).toBe(antes.onHand - 3);
    expect(depois.reserved).toBe(antes.reserved);
  });
});

describe('P1 — transição serializada', () => {
  it('aprovar duas vezes: a segunda é conflito e não reserva de novo', async () => {
    const os = await novaOs();
    const q = await orcamentoEnviado(os, 1);
    const antes = await saldo(central);
    await tx((s) => transitionQuote(s, q, 'approved'));
    await expect(tx((s) => transitionQuote(s, q, 'approved'))).rejects.toBeInstanceOf(ConflictError);
    expect((await saldo(central)).reserved).toBe(antes.reserved + 1);
    await tx((s) => releaseReservations(s, os, q));
  });

  it('leitura velha (outro pedido mudou a situação no meio) vira conflito, sem efeito', async () => {
    const os = await novaOs();
    const q = await orcamentoEnviado(os, 1);
    const antes = await saldo(central);
    await expect(
      tx(async (s) => {
        // Simula a corrida: a leitura devolve "sent", mas antes do UPDATE outro
        // pedido já cancelou o orçamento.
        let interceptado = false;
        const velha: TenantSession = {
          context: s.context,
          query: async (sql, params) => {
            const r = await s.query(sql, params);
            if (!interceptado && /FROM aurora\.quotes WHERE id = \$1 FOR UPDATE/.test(sql)) {
              interceptado = true;
              await s.query(`UPDATE aurora.quotes SET status = 'cancelled' WHERE id = $1`, [q]);
            }
            return r;
          },
        };
        await transitionQuote(velha, q, 'approved');
      })
    ).rejects.toThrow(/mudou de situação/);
    expect((await saldo(central)).reserved).toBe(antes.reserved);
  });
});

describe('P1 — revisão e cancelamento não deixam reserva órfã', () => {
  it('revisar o aprovado solta a reserva dele; aprovar a nova versão reserva uma vez só', async () => {
    const os = await novaOs();
    const q = await orcamentoEnviado(os, 2);
    const antes = await saldo(central);
    await tx((s) => transitionQuote(s, q, 'approved'));
    expect((await saldo(central)).reserved).toBe(antes.reserved + 2);

    const v2 = await tx((s) => reviseQuote(s, q));
    expect((await tx((s) => loadQuote(s, q))).status).toBe('superseded');
    expect((await saldo(central)).reserved).toBe(antes.reserved);

    await tx(async (s) => {
      await transitionQuote(s, v2, 'sent');
      await transitionQuote(s, v2, 'approved');
    });
    expect((await saldo(central)).reserved).toBe(antes.reserved + 2);
    await tx((s) => releaseReservations(s, os, v2));
  });

  it('orçamento em execução não se revisa', async () => {
    const os = await novaOs();
    const q = await orcamentoEnviado(os, 1);
    await tx(async (s) => {
      await transitionQuote(s, q, 'approved');
      await transitionQuote(s, q, 'in_execution');
    });
    await expect(tx((s) => reviseQuote(s, q))).rejects.toThrow(/em execução não se revisa/);
    expect((await tx((s) => loadQuote(s, q))).status).toBe('in_execution');
    await tx((s) => releaseReservations(s, os, q));
  });

  it('a reserva da aprovação leva o orçamento; cancelar outro orçamento da OS não solta a do campo', async () => {
    const os = await novaOs();
    const aprovado = await orcamentoEnviado(os, 1);
    await tx((s) => transitionQuote(s, aprovado, 'approved'));
    const [r] = await tx((s) =>
      s.query<{ quote_id: string | null }>(
        `SELECT quote_id FROM aurora.stock_reservations WHERE work_order_id = $1`,
        [os]
      )
    );
    expect(r!.quote_id).toBe(aprovado);

    // Reserva de escritório (sem orçamento) e um segundo orçamento cancelado.
    await tx((s) => reserve(s, os, filtro, central, 1));
    const outro = await tx(async (s) => {
      const id = await createQuote(s, { customerId: hospitalA, workOrderId: os });
      await transitionQuote(s, id, 'cancelled');
      return id;
    });
    expect(outro).toBeTruthy();
    const [abertas] = await tx((s) =>
      s.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM aurora.stock_reservations
          WHERE work_order_id = $1 AND released_at IS NULL`,
        [os]
      )
    );
    expect(abertas!.n).toBe(2);

    // Liberar pelo orçamento solta só a dele.
    expect(await tx((s) => releaseReservations(s, os, aprovado))).toBe(1);
    expect(await tx((s) => releaseReservations(s, os))).toBe(1);
  });
});

describe('P1 — almoxarifado de cliente só abastece aquele cliente', () => {
  it('a aprovação reserva no da prestadora, nunca no de outro cliente (mesmo com mais saldo)', async () => {
    const os = await novaOs();
    const q = await orcamentoEnviado(os, 2);
    const b = await saldo(almoxB);
    await tx((s) => transitionQuote(s, q, 'approved'));
    expect((await saldo(almoxB)).reserved).toBe(b.reserved);
    const [r] = await tx((s) =>
      s.query<{ warehouse_id: string }>(
        `SELECT warehouse_id FROM aurora.stock_reservations WHERE quote_id = $1`,
        [q]
      )
    );
    expect(r!.warehouse_id).toBe(central);
    await tx((s) => releaseReservations(s, os, q));
  });

  it('peça que só existe no almoxarifado de outro cliente não é reservada', async () => {
    const os = await novaOs();
    const q = await orcamentoEnviado(os, 1, valvula);
    await tx((s) => transitionQuote(s, q, 'approved'));
    const reservas = await tx((s) =>
      s.query(`SELECT 1 FROM aurora.stock_reservations WHERE quote_id = $1`, [q])
    );
    expect(reservas).toHaveLength(0);
  });

  it('o campo não consome do almoxarifado de outro cliente', async () => {
    const os = await novaOs();
    await expect(tx((s) => consumeForWorkOrder(s, os, filtro, almoxB, 1))).rejects.toThrow(/outro cliente/);
    // Na OS do próprio Hospital B, pode.
    const osB = await novaOs(hospitalB);
    await tx((s) => consumeForWorkOrder(s, osB, filtro, almoxB, 1));
  });

  it('a sincronização de campo não manda saldo de almoxarifado fora do escopo', async () => {
    const restrito = buildContext({
      organizationId: ORG,
      actorId: newId(),
      membershipId: MEM_RESTRITO,
      requestId: 'pf-sync',
      permissions: PERMISSION_KEYS,
    });
    const pacote = await withTenant(t.db, restrito, (s) => fieldSyncBundle(s, MEM_RESTRITO));
    const almox = new Set((pacote.stock as Array<{ warehouse_id: string }>).map((x) => x.warehouse_id));
    expect(almox.has(central)).toBe(true);
    expect(almox.has(almoxB)).toBe(false);

    const tudo = await tx((s) => fieldSyncBundle(s, MEM));
    expect((tudo.stock as Array<{ warehouse_id: string }>).some((x) => x.warehouse_id === almoxB)).toBe(true);
  });
});

describe('P1 — totais congelados fora do rascunho', () => {
  it('desconto em orçamento enviado é conflito', async () => {
    const os = await novaOs();
    const q = await orcamentoEnviado(os, 1);
    await expect(tx((s) => setQuoteDiscount(s, q, { percent: 10 }))).rejects.toBeInstanceOf(ConflictError);
  });

  it('o banco também recusa (escrita direta)', async () => {
    const os = await novaOs();
    const q = await orcamentoEnviado(os, 1);
    await expect(
      tx((s) => s.query(`UPDATE aurora.quotes SET additions_cents = 500 WHERE id = $1`, [q]))
    ).rejects.toThrow(/não muda desconto/);
  });

  it('mandar só acréscimo não zera o desconto geral (P3)', async () => {
    const q = await tx(async (s) => {
      const id = await createQuote(s, { customerId: hospitalA });
      await addQuoteItem(s, {
        quoteId: id,
        kind: 'service',
        description: 'Mão de obra',
        quantity: 1,
        unitPriceCents: 10_000,
      });
      await setQuoteDiscount(s, id, { percent: 10 });
      await setQuoteDiscount(s, id, { additionsCents: 500 });
      return id;
    });
    const [row] = await tx((s) =>
      s.query<{ general_discount_percent: string | null; total_cents: string }>(
        `SELECT general_discount_percent::text, total_cents::text FROM aurora.quotes WHERE id = $1`,
        [q]
      )
    );
    expect(Number(row!.general_discount_percent)).toBe(10);
    expect(Number(row!.total_cents)).toBe(10_000 - 1_000 + 500);
  });
});

describe('P2 — cadastro do orçamento', () => {
  it('OS de outro cliente é recusada', async () => {
    const osB = await novaOs(hospitalB);
    await expect(
      tx((s) => createQuote(s, { customerId: hospitalA, workOrderId: osB }))
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('contato aprovador de outro cliente é recusado', async () => {
    await expect(
      tx((s) => createQuote(s, { customerId: hospitalA, approverContactId: contatoB }))
    ).rejects.toThrow(/contato aprovador é de outro cliente/);
  });

  it('remover linha exige que ela seja do orçamento informado', async () => {
    const { a, b, linha } = await tx(async (s) => {
      const a = await createQuote(s, { customerId: hospitalA });
      const b = await createQuote(s, { customerId: hospitalA });
      const linha = await addQuoteItem(s, {
        quoteId: a,
        kind: 'service',
        description: 'X',
        quantity: 1,
        unitPriceCents: 100,
      });
      return { a, b, linha };
    });
    await expect(tx((s) => removeQuoteItem(s, linha, b))).rejects.toThrow(/não encontrada/);
    await tx((s) => removeQuoteItem(s, linha, a));
  });

  it('linha com valor que estoura a coluna é 422, não 500', async () => {
    const q = await tx((s) => createQuote(s, { customerId: hospitalA }));
    await expect(
      tx((s) =>
        addQuoteItem(s, {
          quoteId: q,
          kind: 'service',
          description: 'Enorme',
          quantity: 999_999_999,
          unitPriceCents: 99_999_999_999_999,
        })
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('P2 — estoque', () => {
  it('reservar sem linha de saldo é recusado', async () => {
    const os = await novaOs();
    const novo = await tx((s) => createItem(s, { sku: 'SEM-SALDO', name: 'Sem saldo' }));
    await expect(tx((s) => reserve(s, os, novo, central, 1))).rejects.toThrow(/não há saldo/);
  });

  it('o extrato sai sem custo quando pedido sem custos', async () => {
    const com = await tx((s) => ledger(s, filtro, central, 10, true));
    const sem = await tx((s) => ledger(s, filtro, central, 10, false));
    expect(com.some((m) => m.unit_cost !== null)).toBe(true);
    expect(sem.every((m) => m.unit_cost === null)).toBe(true);
  });

  it('estorno é único — inclusive se a conferência prévia for driblada (índice 0071)', async () => {
    const mov = await tx((s) =>
      recordMovement(s, { itemId: filtro, warehouseId: central, kind: 'receipt', qty: 1, unitCost: 50 })
    );
    await tx((s) => reverseMovement(s, mov, 'lançado em dobro'));
    await expect(tx((s) => reverseMovement(s, mov, 'de novo'))).rejects.toThrow(/já foi estornado/);

    // Corrida simulada: a leitura "já estornado?" não vê o primeiro estorno.
    await expect(
      tx((s) =>
        reverseMovement(
          {
            context: s.context,
            query: async (sql, params) => (/WHERE reverses_id = \$1/.test(sql) ? [] : s.query(sql, params)),
          },
          mov,
          'corrida'
        )
      )
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
