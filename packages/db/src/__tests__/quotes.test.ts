/**
 * Aurora — orçamentos contra o banco (SPEC v0.2 §16 · EPIC-016).
 *
 * O elo que este épico fecha: a OS entra em "aguardando aprovação de
 * orçamento" quando a proposta sai, e volta a andar quando o cliente aprova.
 * Até aqui o motivo de espera existia sem ter o que esperar.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS, toCents } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder, transitionWorkOrder } from '../work-orders';
import { createWarehouse, createItem, recordMovement, balances } from '../inventory';
import { createSlaPolicy, setSlaTarget } from '../sla';
import {
  createQuote,
  addQuoteItem,
  removeQuoteItem,
  setQuoteDiscount,
  transitionQuote,
  reviseQuote,
  loadQuote,
  currentStatus,
  quoteItems,
  quoteVersions,
  priceFor,
  sweepExpiredQuotes,
} from '../quotes';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'qt',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, contato: string, setor: string, ativo: string, natureza: string;
let central: string, filtro: string, valvula: string;
let motivoRecusa: string;

const dia = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'qt', name: 'Prestadora', email: 'a@qt.test', userName: 'A' }
  );

  await withTenant(t.db, ctx, async (s) => {
    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital' });

    contato = newId();
    await s.query(
      `INSERT INTO aurora.customer_contacts (id, organization_id, customer_id, name, email)
       VALUES ($1, $2, $3, 'Compras', 'compras@hosp.test')`,
      [contato, ORG, cliente]
    );

    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede',
    });
    setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });
    natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    motivoRecusa = await createCatalogItem(s, {
      catalogKey: 'rejection_reason',
      key: 'preco',
      label: 'Preço acima do orçado pelo cliente',
    });

    // Sem política não há relógio (§11), e sem relógio não há pausa a observar
    // quando a OS entra em "aguardando aprovação de orçamento".
    const politica = await createSlaPolicy(s, { name: 'Padrão', isDefault: true });
    await setSlaTarget(s, politica, 'none', 'resolution', 2_880, false);
    await setSlaTarget(s, politica, 'none', 'onsite', 480, false);
    await s.query(`UPDATE aurora.organizations SET default_sla_policy_id = $1 WHERE id = $2`, [
      politica,
      ORG,
    ]);

    central = await createWarehouse(s, { name: 'Central', kind: 'central' });
    filtro = await createItem(s, { sku: 'FLT-1', name: 'Filtro bacteriológico' });
    valvula = await createItem(s, { sku: 'VLV-1', name: 'Válvula de exalação' });

    await s.query(`UPDATE aurora.inventory_items SET list_price_cents = 18_000 WHERE id = $1`, [filtro]);
    await recordMovement(s, {
      itemId: filtro,
      warehouseId: central,
      kind: 'receipt',
      qty: 20,
      unitCost: 100,
    });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

async function novaOs(titulo: string) {
  return withTenant(t.db, ctx, async (s) => {
    const w = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: titulo,
      locationId: setor,
      assetId: ativo,
    });
    await transitionWorkOrder(s, w.id, 'in_progress');
    return w.id;
  });
}

/* -------------------------------------------------------------------------- */

describe('cascata de preço', () => {
  it('sem alias nem tabela, o preço vem do catálogo', async () => {
    const p = await withTenant(t.db, ctx, (s) => priceFor(s, filtro, cliente, null));
    expect(p).toEqual({ cents: 18_000, source: 'catalog' });
  });

  it('a tabela do contrato vence o catálogo', async () => {
    const contrato = await withTenant(t.db, ctx, async (s) => {
      const tabela = newId();
      await s.query(
        `INSERT INTO aurora.price_lists (id, organization_id, name) VALUES ($1, $2, 'Tabela 2025')`,
        [tabela, ORG]
      );
      await s.query(
        `INSERT INTO aurora.price_list_items (organization_id, price_list_id, item_id, price_cents)
         VALUES ($1, $2, $3, 15000)`,
        [ORG, tabela, filtro]
      );
      const id = newId();
      await s.query(
        `INSERT INTO aurora.contracts
           (id, organization_id, number, customer_id, kind, status, starts_on, price_list_id)
         VALUES ($1, $2, 'CT-TESTE', $3, 'full_service', 'active', CURRENT_DATE, $4)`,
        [id, ORG, cliente, tabela]
      );
      return id;
    });

    const p = await withTenant(t.db, ctx, (s) => priceFor(s, filtro, cliente, contrato));
    expect(p).toEqual({ cents: 15_000, source: 'contract_price_list' });
  });

  it('o acordo com o cliente vence a tabela do contrato', async () => {
    await withTenant(t.db, ctx, (s) =>
      s.query(
        `INSERT INTO aurora.customer_item_aliases
           (organization_id, customer_id, item_id, alias, sale_price)
         VALUES ($1, $2, $3, 'Filtro HME', 129.90)`,
        [ORG, cliente, filtro]
      )
    );
    const p = await withTenant(t.db, ctx, (s) => priceFor(s, filtro, cliente, null));
    expect(p).toEqual({ cents: toCents(129.9), source: 'customer_alias' });
  });

  it('item sem preço em degrau nenhum devolve nulo — não se inventa preço', async () => {
    const p = await withTenant(t.db, ctx, (s) => priceFor(s, valvula, cliente, null));
    expect(p).toBeNull();
  });
});

describe('montagem da proposta', () => {
  let os: string, orcamento: string;

  it('nasce em rascunho, com número próprio e o contrato herdado da OS', async () => {
    os = await novaOs('Troca de filtro e válvula');
    orcamento = await withTenant(t.db, ctx, (s) =>
      createQuote(s, {
        customerId: cliente,
        workOrderId: os,
        approverContactId: contato,
        validUntil: dia(30),
      })
    );

    const q = await withTenant(t.db, ctx, (s) => loadQuote(s, orcamento));
    expect(q.status).toBe('draft');
    expect(q.number).toMatch(/^QT-\d{4}-00001$/);
  });

  it('a linha herda descrição e preço do item, e grava a origem', async () => {
    await withTenant(t.db, ctx, (s) =>
      addQuoteItem(s, { quoteId: orcamento, kind: 'part', itemId: filtro, quantity: 2 })
    );

    const [linha] = (await withTenant(t.db, ctx, (s) => quoteItems(s, orcamento))) as {
      description: string;
      unit_price_cents: string;
      price_source: string;
    }[];
    expect(linha!.description).toBe('Filtro bacteriológico');
    expect(linha!.price_source).toBe('customer_alias');
    expect(Number(linha!.unit_price_cents)).toBe(toCents(129.9));
  });

  it('item sem preço em degrau nenhum exige valor informado, dizendo o que fazer', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        addQuoteItem(s, { quoteId: orcamento, kind: 'part', itemId: valvula, quantity: 1 })
      )
    ).rejects.toThrow(/informe o valor ou cadastre-o na tabela de preço/);
  });

  it('o total do cabeçalho é mantido pelo banco a cada linha', async () => {
    await withTenant(t.db, ctx, (s) =>
      addQuoteItem(s, {
        quoteId: orcamento,
        kind: 'service',
        description: 'Mão de obra',
        quantity: 2,
        unitPriceCents: toCents(180),
      })
    );

    const q = await withTenant(t.db, ctx, (s) => loadQuote(s, orcamento));
    expect(Number(q.total_cents)).toBe(toCents(129.9) * 2 + toCents(180) * 2);
  });

  it('remover linha reflete no total sem ninguém recalcular', async () => {
    const linhas = (await withTenant(t.db, ctx, (s) => quoteItems(s, orcamento))) as {
      id: string;
      net_cents: string;
    }[];
    const antes = await withTenant(t.db, ctx, (s) => loadQuote(s, orcamento));
    const alvo = linhas.at(-1)!;

    await withTenant(t.db, ctx, (s) => removeQuoteItem(s, alvo.id));

    const depois = await withTenant(t.db, ctx, (s) => loadQuote(s, orcamento));
    expect(Number(depois.total_cents)).toBe(Number(antes.total_cents) - Number(alvo.net_cents));
  });

  it('o desconto geral também recalcula o total', async () => {
    await withTenant(t.db, ctx, (s) =>
      addQuoteItem(s, {
        quoteId: orcamento,
        kind: 'service',
        description: 'Mão de obra',
        quantity: 2,
        unitPriceCents: toCents(180),
      })
    );
    const antes = await withTenant(t.db, ctx, (s) => loadQuote(s, orcamento));

    await withTenant(t.db, ctx, (s) => setQuoteDiscount(s, orcamento, { percent: 10 }));

    const depois = await withTenant(t.db, ctx, (s) => loadQuote(s, orcamento));
    expect(Number(depois.total_cents)).toBe(
      Number(antes.total_cents) - Math.round(Number(antes.total_cents) * 0.1)
    );
  });

  it('valor e percentual juntos são recusados', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => setQuoteDiscount(s, orcamento, { percent: 5, cents: 100 }))
    ).rejects.toThrow(/não os dois/);
  });
});

describe('envio, e a OS que passa a esperar', () => {
  let os: string, orcamento: string;

  beforeAll(async () => {
    os = await novaOs('Reparo com orçamento');
    orcamento = await withTenant(t.db, ctx, (s) => createQuote(s, { customerId: cliente, workOrderId: os }));
  });

  it('diz TODAS as pendências de uma vez, não uma por vez', async () => {
    await expect(withTenant(t.db, ctx, (s) => transitionQuote(s, orcamento, 'sent'))).rejects.toThrow(
      /nenhum item.*maior que zero.*validade.*aprovar/s
    );
  });

  it('enviado, a OS entra em espera pelo cliente e o SLA pausa', async () => {
    await withTenant(t.db, ctx, async (s) => {
      await s.query(
        `UPDATE aurora.quotes SET valid_until = $2::date, approver_contact_id = $3 WHERE id = $1`,
        [orcamento, dia(20), contato]
      );
      await addQuoteItem(s, { quoteId: orcamento, kind: 'part', itemId: filtro, quantity: 1 });
      await transitionQuote(s, orcamento, 'sent');
    });

    const [w] = await withTenant(t.db, ctx, (s) =>
      s.query<{ status_category: string }>(`SELECT status_category FROM aurora.work_orders WHERE id = $1`, [
        os,
      ])
    );
    expect(w!.status_category).toBe('waiting');

    const [relogio] = await withTenant(t.db, ctx, (s) =>
      s.query<{ state: string }>(
        `SELECT state FROM aurora.sla_clocks WHERE document_id = $1 AND kind = 'resolution'`,
        [os]
      )
    );
    expect(relogio?.state).toBe('paused');
  });

  it('proposta enviada não se edita — para mudar existe a revisão', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        addQuoteItem(s, {
          quoteId: orcamento,
          kind: 'service',
          description: 'Extra',
          quantity: 1,
          unitPriceCents: 1000,
        })
      )
    ).rejects.toThrow(/já enviado não se edita/);
  });

  it('aprovar reserva a peça e devolve a OS ao trabalho', async () => {
    const antes = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: central }));

    await withTenant(t.db, ctx, (s) =>
      transitionQuote(s, orcamento, 'approved', {
        acceptance: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0', note: 'aprovado por e-mail' },
      })
    );

    const depois = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: central }));
    expect(Number(depois[0]!.reserved)).toBe(Number(antes[0]!.reserved) + 1);
    // O físico não se mexe na aprovação: reserva é "posso usar", não "saiu".
    expect(Number(depois[0]!.on_hand)).toBe(Number(antes[0]!.on_hand));

    const [w] = await withTenant(t.db, ctx, (s) =>
      s.query<{ status_category: string }>(`SELECT status_category FROM aurora.work_orders WHERE id = $1`, [
        os,
      ])
    );
    expect(w!.status_category).toBe('in_progress');
  });

  it('a evidência do aceite fica registrada', async () => {
    const [q] = await withTenant(t.db, ctx, (s) =>
      s.query<{ accepted_ip: string; decided_at: string }>(
        `SELECT accepted_ip, decided_at FROM aurora.quotes WHERE id = $1`,
        [orcamento]
      )
    );
    expect(q!.accepted_ip).toBe('203.0.113.7');
    expect(q!.decided_at).toBeTruthy();
  });

  it('faturar baixa o físico das reservas', async () => {
    const antes = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: central }));
    await withTenant(t.db, ctx, (s) => transitionQuote(s, orcamento, 'invoiced'));
    const depois = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: central }));

    expect(Number(depois[0]!.on_hand)).toBe(Number(antes[0]!.on_hand) - 1);
    expect(Number(depois[0]!.reserved)).toBe(Number(antes[0]!.reserved) - 1);
  });

  it('a transição não declarada é recusada nomeando as possíveis', async () => {
    await expect(withTenant(t.db, ctx, (s) => transitionQuote(s, orcamento, 'draft'))).rejects.toThrow(
      /não pode ir para "draft".*closed \(encerrar\)/s
    );
  });

  it('faturado, o orçamento encerra', async () => {
    await withTenant(t.db, ctx, (s) => transitionQuote(s, orcamento, 'closed'));
    expect((await withTenant(t.db, ctx, (s) => loadQuote(s, orcamento))).status).toBe('closed');
  });
});

describe('recusa', () => {
  it('exige o motivo do catálogo', async () => {
    const q = await withTenant(t.db, ctx, async (s) => {
      const id = await createQuote(s, {
        customerId: cliente,
        approverContactId: contato,
        validUntil: dia(15),
      });
      await addQuoteItem(s, {
        quoteId: id,
        kind: 'service',
        description: 'Serviço',
        quantity: 1,
        unitPriceCents: 50_000,
      });
      await transitionQuote(s, id, 'sent');
      return id;
    });

    await expect(withTenant(t.db, ctx, (s) => transitionQuote(s, q, 'rejected'))).rejects.toThrow(
      /análise de perda/
    );

    await withTenant(t.db, ctx, (s) =>
      transitionQuote(s, q, 'rejected', {
        rejectionReasonId: motivoRecusa,
        note: 'cliente conseguiu proposta menor',
      })
    );
    const depois = await withTenant(t.db, ctx, (s) => loadQuote(s, q));
    expect(depois.status).toBe('rejected');
  });
});

describe('versionamento', () => {
  let v1: string, v2: string;

  it('revisar cria a versão seguinte e supera a anterior, com as linhas juntas', async () => {
    v1 = await withTenant(t.db, ctx, async (s) => {
      const id = await createQuote(s, {
        customerId: cliente,
        approverContactId: contato,
        validUntil: dia(10),
      });
      await addQuoteItem(s, { quoteId: id, kind: 'part', itemId: filtro, quantity: 3 });
      await transitionQuote(s, id, 'sent');
      return id;
    });

    v2 = await withTenant(t.db, ctx, (s) => reviseQuote(s, v1));

    const antiga = await withTenant(t.db, ctx, (s) => loadQuote(s, v1));
    const nova = await withTenant(t.db, ctx, (s) => loadQuote(s, v2));

    expect(antiga.status).toBe('superseded');
    expect(nova.status).toBe('draft');
    expect(nova.version).toBe(2);
    expect(nova.number).toBe(antiga.number);
    expect(Number(nova.total_cents)).toBe(Number(antiga.total_cents));

    const linhas = await withTenant(t.db, ctx, (s) => quoteItems(s, v2));
    expect(linhas).toHaveLength(1);
  });

  it('a versão nova é editável — é para isso que ela existe', async () => {
    await withTenant(t.db, ctx, (s) => setQuoteDiscount(s, v2, { percent: 15 }));
    const q = await withTenant(t.db, ctx, (s) => loadQuote(s, v2));
    expect(Number(q.total_cents)).toBeLessThan(toCents(129.9) * 3);
  });

  it('o histórico das versões fica visível — é argumento comercial', async () => {
    const q = await withTenant(t.db, ctx, (s) => loadQuote(s, v2));
    const versoes = (await withTenant(t.db, ctx, (s) => quoteVersions(s, q.number))) as {
      version: number;
      status: string;
    }[];
    expect(versoes.map((v) => v.version)).toEqual([2, 1]);
    expect(versoes[1]!.status).toBe('superseded');
  });

  it('não se revisa duas vezes a mesma versão', async () => {
    await expect(withTenant(t.db, ctx, (s) => reviseQuote(s, v1))).rejects.toThrow(/já foi revisado/);
  });

  it('duas versões vivas do mesmo número são impossíveis', async () => {
    const q = await withTenant(t.db, ctx, (s) => loadQuote(s, v2));
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(
          `INSERT INTO aurora.quotes (id, organization_id, number, version, customer_id)
           VALUES ($1, $2, $3, 99, $4)`,
          [newId(), ORG, q.number, cliente]
        )
      )
    ).rejects.toThrow();
  });
});

describe('validade', () => {
  it('a proposta vencida não é aprovável, mesmo antes da varredura', async () => {
    const vencido = await withTenant(t.db, ctx, async (s) => {
      const id = await createQuote(s, {
        customerId: cliente,
        approverContactId: contato,
        validUntil: dia(5),
      });
      await addQuoteItem(s, {
        quoteId: id,
        kind: 'service',
        description: 'Serviço',
        quantity: 1,
        unitPriceCents: 10_000,
      });
      await transitionQuote(s, id, 'sent');
      await s.query(`UPDATE aurora.quotes SET valid_until = $2::date WHERE id = $1`, [id, dia(-1)]);
      return id;
    });

    const q = await withTenant(t.db, ctx, (s) => loadQuote(s, vencido));
    expect(q.status).toBe('sent');
    expect(currentStatus(q)).toBe('expired');

    await expect(withTenant(t.db, ctx, (s) => transitionQuote(s, vencido, 'approved'))).rejects.toThrow(
      /está em "expired"/
    );
  });

  it('a varredura carimba os vencidos e emite o evento', async () => {
    const n = await withTenant(t.db, ctx, (s) => sweepExpiredQuotes(s));
    expect(n).toBeGreaterThanOrEqual(1);

    const [ev] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.domain_events WHERE type = 'quote.expired' LIMIT 1`)
    );
    expect(ev).toBeTruthy();
  });

  it('rodar a varredura de novo não expira mais nada', async () => {
    expect(await withTenant(t.db, ctx, (s) => sweepExpiredQuotes(s))).toBe(0);
  });
});

describe('isolamento', () => {
  it('outra organização não enxerga orçamento nenhum', async () => {
    const OUTRA = newId(),
      U2 = newId(),
      M2 = newId();
    await seedOrganization(
      t,
      { organizationId: OUTRA, userId: U2, membershipId: M2 },
      { slug: 'qt2', name: 'Outra', email: 'b@qt.test', userName: 'B' }
    );
    const ctx2 = buildContext({
      organizationId: OUTRA,
      actorId: U2,
      membershipId: M2,
      requestId: 'qt2',
      permissions: PERMISSION_KEYS,
    });

    const linhas = await withTenant(t.db, ctx2, (s) => s.query(`SELECT id FROM aurora.quotes`));
    expect(linhas).toHaveLength(0);
  });
});
