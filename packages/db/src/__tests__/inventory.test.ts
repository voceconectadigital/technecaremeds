/**
 * Aurora — estoque contra o banco (SPEC v0.2 §15 · EPIC-015).
 *
 * O caso que define o desenho: duas OS disputando a última peça. O resultado
 * certo é uma delas saber que não tem — não as duas acharem que têm e as duas
 * travarem, que é o que produz os 789 registros de "aguardando peça" da
 * referência.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder, transitionWorkOrder } from '../work-orders';
import { setCompletionRequirements, completionCheck } from '../execution';
import {
  createWarehouse,
  createItem,
  setMinimum,
  recordMovement,
  adjust,
  reverseMovement,
  reserve,
  consume,
  releaseReservations,
  returnToStock,
  transfer,
  balances,
  ledger,
  workOrderParts,
} from '../inventory';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'inv',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, setor: string, ativo: string, natureza: string;
let central: string, van: string;
let filtro: string, valvula: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'inv', name: 'Rede', email: 'a@inv.test', userName: 'A' }
  );

  await withTenant(t.db, ctx, async (s) => {
    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade',
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

    central = await createWarehouse(s, { name: 'Almoxarifado central', kind: 'central' });
    van = await createWarehouse(s, { name: 'Carro do técnico', kind: 'van', ownerMembershipId: MEM });
    filtro = await createItem(s, { sku: 'FLT-001', name: 'Filtro bacteriológico', leadTimeDays: 15 });
    valvula = await createItem(s, { sku: 'VLV-001', name: 'Válvula de exalação' });
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

describe('entrada e custo médio móvel', () => {
  it('a primeira entrada define a média', async () => {
    await withTenant(t.db, ctx, (s) =>
      recordMovement(s, {
        itemId: filtro,
        warehouseId: central,
        kind: 'receipt',
        qty: 10,
        unitCost: 20,
      })
    );
    const [b] = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: central }));
    expect(Number(b!.on_hand)).toBe(10);
    expect(Number(b!.average_cost)).toBe(20);
  });

  it('a segunda entrada pondera pela quantidade', async () => {
    await withTenant(t.db, ctx, (s) =>
      recordMovement(s, {
        itemId: filtro,
        warehouseId: central,
        kind: 'receipt',
        qty: 10,
        unitCost: 30,
      })
    );
    const [b] = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: central }));
    expect(Number(b!.on_hand)).toBe(20);
    expect(Number(b!.average_cost)).toBe(25);
  });

  it('a saída NÃO altera a média — recalcular ali faria o custo derivar a cada baixa', async () => {
    await withTenant(t.db, ctx, (s) =>
      recordMovement(s, { itemId: filtro, warehouseId: central, kind: 'issue', qty: 5, unitCost: 25 })
    );
    const [b] = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: central }));
    expect(Number(b!.on_hand)).toBe(15);
    expect(Number(b!.average_cost)).toBe(25);
  });
});

describe('saldo negativo é recusado por restrição, não por leitura prévia', () => {
  it('baixar mais do que existe é recusado, dizendo quanto há', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        recordMovement(s, { itemId: filtro, warehouseId: central, kind: 'issue', qty: 999 })
      )
    ).rejects.toThrow(/saldo insuficiente: há 15/);
  });

  it('o almoxarifado que permite negativo ainda exige justificativa', async () => {
    const permissivo = await withTenant(t.db, ctx, (s) =>
      createWarehouse(s, { name: 'Consignado do fornecedor', kind: 'consignment', allowNegative: true })
    );
    await expect(
      withTenant(t.db, ctx, (s) =>
        recordMovement(s, { itemId: filtro, warehouseId: permissivo, kind: 'issue', qty: 3 })
      )
    ).rejects.toThrow(/exige justificativa/);

    const id = await withTenant(t.db, ctx, (s) =>
      recordMovement(s, {
        itemId: filtro,
        warehouseId: permissivo,
        kind: 'issue',
        qty: 3,
        reason: 'consumo antecipado do consignado, nota a receber',
      })
    );
    expect(id).toBeTruthy();
  });
});

describe('o razão é imutável', () => {
  it('movimento não se edita nem se apaga', async () => {
    const [mov] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>('SELECT id FROM aurora.stock_movements LIMIT 1')
    );
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.stock_movements SET qty = 1 WHERE id = $1`, [mov!.id])
      )
    ).rejects.toThrow(/não se altera nem se apaga|permission denied|permissão/i);
    await expect(
      withTenant(t.db, ctx, (s) => s.query('DELETE FROM aurora.stock_movements WHERE id = $1', [mov!.id]))
    ).rejects.toThrow(/não se altera nem se apaga|permission denied|permissão/i);
  });

  it('a correção é um movimento inverso com elo para o original', async () => {
    const errado = await withTenant(t.db, ctx, (s) =>
      recordMovement(s, { itemId: valvula, warehouseId: central, kind: 'receipt', qty: 100, unitCost: 5 })
    );
    const [antes] = await withTenant(t.db, ctx, (s) =>
      s.query<{ on_hand: string }>(
        `SELECT on_hand FROM aurora.stock_balances WHERE item_id = $1 AND warehouse_id = $2`,
        [valvula, central]
      )
    );
    expect(Number(antes!.on_hand)).toBe(100);

    const estorno = await withTenant(t.db, ctx, (s) =>
      reverseMovement(s, errado, 'entrada lançada com quantidade errada')
    );
    const [depois] = await withTenant(t.db, ctx, (s) =>
      s.query<{ on_hand: string }>(
        `SELECT on_hand FROM aurora.stock_balances WHERE item_id = $1 AND warehouse_id = $2`,
        [valvula, central]
      )
    );
    expect(Number(depois!.on_hand)).toBe(0);

    const [linha] = await withTenant(t.db, ctx, (s) =>
      s.query<{ reverses_id: string; reason: string }>(
        `SELECT reverses_id, reason FROM aurora.stock_movements WHERE id = $1`,
        [estorno]
      )
    );
    expect(linha!.reverses_id).toBe(errado);
    expect(linha!.reason).toMatch(/^Estorno:/);
  });

  it('estornar duas vezes é recusado', async () => {
    const [mov] = await withTenant(t.db, ctx, (s) =>
      s.query<{ reverses_id: string }>(
        `SELECT reverses_id FROM aurora.stock_movements WHERE reverses_id IS NOT NULL LIMIT 1`
      )
    );
    await expect(
      withTenant(t.db, ctx, (s) => reverseMovement(s, mov!.reverses_id, 'de novo'))
    ).rejects.toThrow(/já foi estornado/);
  });

  it('ajuste sem justificativa é recusado', async () => {
    await expect(withTenant(t.db, ctx, (s) => adjust(s, filtro, central, -1, 'x'))).rejects.toThrow(
      /exige justificativa/
    );
  });

  it('o extrato traz a movimentação na ordem do razão', async () => {
    const linhas = await withTenant(t.db, ctx, (s) => ledger(s, filtro, central));
    expect(linhas.length).toBeGreaterThanOrEqual(3);
    const seqs = linhas.map((l) => Number(l.sequence));
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
  });
});

describe('reserva reduz o disponível, não o físico', () => {
  let osA = '';
  let osB = '';

  beforeAll(async () => {
    osA = await novaOs('OS que reserva primeiro');
    osB = await novaOs('OS que chega depois');
    await withTenant(t.db, ctx, (s) =>
      recordMovement(s, { itemId: valvula, warehouseId: central, kind: 'receipt', qty: 1, unitCost: 40 })
    );
  });

  it('reservar não tira nada da prateleira', async () => {
    await withTenant(t.db, ctx, (s) => reserve(s, osA, valvula, central, 1));
    const b = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: central }));
    const linha = b.find((x) => x.item_id === valvula)!;
    expect(Number(linha.on_hand)).toBe(1);
    expect(Number(linha.reserved)).toBe(1);
    expect(Number(linha.available)).toBe(0);
  });

  /**
   * O caso que o estoque existe para resolver: duas OS disputando a última
   * peça. A segunda descobre que não tem — em vez de as duas acharem que têm e
   * as duas travarem depois.
   */
  it('a segunda OS não consegue reservar a mesma peça', async () => {
    await expect(withTenant(t.db, ctx, (s) => reserve(s, osB, valvula, central, 1))).rejects.toThrow(
      /reserved_within_hand|regra/i
    );
  });

  it('consumir tira do físico e da reserva ao mesmo tempo, com custo congelado', async () => {
    const [reservaA] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.stock_reservations WHERE work_order_id = $1`, [osA])
    );
    const mov = await withTenant(t.db, ctx, (s) => consume(s, reservaA!.id, 1));

    const [linha] = await withTenant(t.db, ctx, (s) =>
      s.query<{ qty: string; unit_cost: string; ref_type: string; ref_id: string }>(
        `SELECT qty, unit_cost, ref_type, ref_id FROM aurora.stock_movements WHERE id = $1`,
        [mov]
      )
    );
    expect(Number(linha!.qty)).toBe(-1);
    expect(Number(linha!.unit_cost)).toBe(40);
    expect(linha!.ref_type).toBe('work_order');
    expect(linha!.ref_id).toBe(osA);

    const b = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: central }));
    const saldo = b.find((x) => x.item_id === valvula)!;
    expect(Number(saldo.on_hand)).toBe(0);
    expect(Number(saldo.reserved)).toBe(0);
  });

  it('consumir mais do que a reserva tem é recusado, dizendo quanto há', async () => {
    const [reservaA] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.stock_reservations WHERE work_order_id = $1`, [osA])
    );
    await expect(withTenant(t.db, ctx, (s) => consume(s, reservaA!.id, 1))).rejects.toThrow(
      /a reserva tem 0 disponível/
    );
  });

  it('a devolução volta ao estoque com elo para a OS', async () => {
    const mov = await withTenant(t.db, ctx, (s) => returnToStock(s, osA, valvula, central, 1));
    const [linha] = await withTenant(t.db, ctx, (s) =>
      s.query<{ qty: string; ref_id: string }>(
        `SELECT qty, ref_id FROM aurora.stock_movements WHERE id = $1`,
        [mov]
      )
    );
    expect(Number(linha!.qty)).toBe(1);
    expect(linha!.ref_id).toBe(osA);
  });
});

describe('cancelar a OS devolve a reserva', () => {
  it('a peça reservada volta a ficar disponível', async () => {
    const os = await novaOs('OS que vai ser cancelada');
    await withTenant(t.db, ctx, (s) => reserve(s, os, filtro, central, 3));

    const antes = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: central }));
    expect(Number(antes.find((x) => x.item_id === filtro)!.reserved)).toBe(3);

    await withTenant(t.db, ctx, (s) =>
      transitionWorkOrder(s, os, 'cancelled', { cancellationReason: 'cliente resolveu internamente' })
    );

    const depois = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: central }));
    expect(Number(depois.find((x) => x.item_id === filtro)!.reserved)).toBe(0);

    const partes = await withTenant(t.db, ctx, (s) => workOrderParts(s, os));
    expect(partes[0]!.released_at).not.toBeNull();
  });

  it('liberar de novo não faz nada', async () => {
    const [os] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.work_orders WHERE title = 'OS que vai ser cancelada'`)
    );
    const n = await withTenant(t.db, ctx, (s) => releaseReservations(s, os!.id));
    expect(n).toBe(0);
  });
});

describe('transferência entre almoxarifados', () => {
  it('duas pernas, saldo conservado, custo levado junto', async () => {
    await withTenant(t.db, ctx, (s) => transfer(s, filtro, central, van, 4, 'abastecimento do carro'));

    const b = await withTenant(t.db, ctx, (s) => balances(s));
    const naVan = b.find((x) => x.item_id === filtro && x.warehouse_id === van)!;
    expect(Number(naVan.on_hand)).toBe(4);
    expect(Number(naVan.average_cost)).toBe(25);
  });

  it('transferir para o mesmo almoxarifado é recusado', async () => {
    await expect(withTenant(t.db, ctx, (s) => transfer(s, filtro, central, central, 1))).rejects.toThrow(
      /mesmo almoxarifado/
    );
  });

  it('transferir mais do que há na origem é recusado, e nada é movido', async () => {
    const antes = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: van }));
    await expect(withTenant(t.db, ctx, (s) => transfer(s, filtro, van, central, 999))).rejects.toThrow(
      /saldo insuficiente/
    );
    const depois = await withTenant(t.db, ctx, (s) => balances(s, { warehouseId: van }));
    expect(depois.find((x) => x.item_id === filtro)!.on_hand).toBe(
      antes.find((x) => x.item_id === filtro)!.on_hand
    );
  });
});

describe('estoque mínimo emite evento, não automação fixa', () => {
  it('cruzar o mínimo emite stock.below_minimum', async () => {
    await withTenant(t.db, ctx, (s) => setMinimum(s, filtro, van, 10));
    await withTenant(t.db, ctx, (s) =>
      recordMovement(s, { itemId: filtro, warehouseId: van, kind: 'issue', qty: 1 })
    );

    const eventos = await withTenant(t.db, ctx, (s) =>
      s.query<{ type: string; payload: { sku: string; on_hand: number } }>(
        `SELECT type, payload FROM aurora.domain_events WHERE type = 'stock.below_minimum' ORDER BY sequence DESC LIMIT 1`
      )
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.payload.sku).toBe('FLT-001');
    expect(eventos[0]!.payload.on_hand).toBe(3);
  });

  it('a consulta de reposição lista só o que está abaixo do mínimo', async () => {
    const abaixo = await withTenant(t.db, ctx, (s) => balances(s, { belowMinimum: true }));
    expect(abaixo).toHaveLength(1);
    expect(abaixo[0]!.warehouse_id).toBe(van);
  });
});

describe('peça pendente trava a conclusão da OS', () => {
  it('reserva não consumida aparece no bloco de conclusão', async () => {
    const os = await novaOs('OS com peça pendente');
    await withTenant(t.db, ctx, async (s) => {
      await setCompletionRequirements(s, natureza, ['parts_confirmed']);
      await recordMovement(s, {
        itemId: filtro,
        warehouseId: central,
        kind: 'receipt',
        qty: 5,
        unitCost: 25,
      });
      await reserve(s, os, filtro, central, 2);
    });

    const antes = await withTenant(t.db, ctx, (s) => completionCheck(s, os, ['parts_confirmed']));
    expect(antes.ok).toBe(false);
    expect(antes.missing[0]!.detail).toMatch(/1 peça\(s\) sem confirmação/);

    const [reserva] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.stock_reservations WHERE work_order_id = $1`, [os])
    );
    await withTenant(t.db, ctx, (s) => consume(s, reserva!.id, 2));

    const depois = await withTenant(t.db, ctx, (s) => completionCheck(s, os, ['parts_confirmed']));
    expect(depois.ok).toBe(true);

    // limpa a exigência para não contaminar os testes seguintes
    await withTenant(t.db, ctx, (s) => setCompletionRequirements(s, natureza, []));
  });
});

describe('isolamento', () => {
  it('o saldo de uma organização não aparece na outra', async () => {
    const outraOrg = newId();
    const outroUser = newId();
    const outroMem = newId();
    await seedOrganization(
      t,
      { organizationId: outraOrg, userId: outroUser, membershipId: outroMem },
      { slug: 'inv-b', name: 'Rede B', email: 'b@inv.test', userName: 'B' }
    );
    const ctxB = buildContext({
      organizationId: outraOrg,
      actorId: outroUser,
      membershipId: outroMem,
      requestId: 'inv-b',
      permissions: PERMISSION_KEYS,
    });
    const b = await withTenant(t.db, ctxB, (s) => balances(s));
    expect(b).toEqual([]);
  });
});
