/**
 * Aurora — estoque interno × Store (reunião 16/10/2026, Fase 8).
 *
 *   · item e almoxarifado por HTTP; almoxarifado de CLIENTE é privado (escopo);
 *   · entrada com custo (texto decimal) e referência; mínimo/máximo;
 *   · saída só pela OS (razão vinculado) — a curva ABC e o relatório por
 *     período leem esses movimentos;
 *   · custo só com `inventory.read_costs` (sai da consulta);
 *   · Store: só item publicado, SEM saldo; pedir proposta vira oportunidade;
 *   · outra organização não vê nada.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext } from '@aurora/domain';
import {
  createTestDatabase,
  seedOrganization,
  seedMember,
  type TestDatabase,
} from '@aurora/db/testing/harness';
import {
  withTenant,
  assignRole,
  createCustomer,
  createLocation,
  createWorkOrder,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { inventoryAbc, storeItemsList } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG = newId();
const ORG_B = newId();
const GESTORA = 'gestora@estoque.test';
const OPERADOR = 'operador@estoque.test';
const RESTRITO = 'restrito@estoque.test';
const SOLICITANTE = 'sol@estoque.test';
const ADMIN_B = 'admin@estoque-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const DE = new Date(Date.now() - 30 * 86_400_000).toISOString();
const ATE = new Date(Date.now() + 86_400_000).toISOString();

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospitalA: string, hospitalB: string, os: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, {
    slug: 'estoque',
    name: 'Prestadora',
    email: GESTORA,
    userName: 'Gestora',
  });
  await seedOrganization(t, idsB, { slug: 'estoque-b', name: 'B', email: ADMIN_B, userName: 'B' });
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, ids.membershipId, base.roles.get('manager')!);
      hospitalA = await createCustomer(s, { name: 'Hospital A' });
      hospitalB = await createCustomer(s, { name: 'Hospital B' });
      const sede = await createLocation(s, {
        customerId: hospitalA,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'Sede',
      });
      const [corretiva] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
      );
      os = (
        await createWorkOrder(s, {
          customerId: hospitalA,
          locationId: sede,
          workOrderTypeId: corretiva!.id,
          title: 'Troca de peças',
        })
      ).id;
    }
  );
  const memOp = newId();
  const memRestrito = newId();
  const memSol = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memOp },
    { email: OPERADOR, userName: 'Op' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memRestrito },
    {
      email: RESTRITO,
      userName: 'Restrito',
      customerIds: [hospitalA],
    }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memSol },
    {
      email: SOLICITANTE,
      userName: 'Sol',
      seatType: 'portal',
      customerIds: [hospitalA],
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memOp, base.roles.get('operator')!);
      await assignRole(s, memRestrito, base.roles.get('manager')!);
      await assignRole(s, memSol, base.roles.get('requester')!);
      // PF-14: o operador lança peça só na OS atribuída a ele.
      await s.query(`UPDATE aurora.work_orders SET assignee_membership_id = $2 WHERE id = $1`, [os, memOp]);
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_B, actorKind: 'system', requestId: 's3' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, idsB.membershipId, base.roles.get('admin')!);
    }
  );

  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);
  app = await createApp({ db: t.db, env });
  await app.init();
  http = request(app.getHttpServer());
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

let central: string, doHospitalB: string, filtro: string, sensor: string;

describe('cadastro e entrada', () => {
  it('cria itens e almoxarifados (da prestadora e de um cliente)', async () => {
    const i1 = await http
      .post('/v1/inventory/items')
      .set(auth(GESTORA))
      .send({ sku: 'FIL-01', name: 'Filtro HEPA', list_price: '89.90' });
    expect(i1.status, JSON.stringify(i1.body)).toBe(201);
    filtro = i1.body.id;
    const i2 = await http
      .post('/v1/inventory/items')
      .set(auth(GESTORA))
      .send({ sku: 'SEN-02', name: 'Sensor de fluxo' });
    sensor = i2.body.id;
    const dup = await http
      .post('/v1/inventory/items')
      .set(auth(GESTORA))
      .send({ sku: 'FIL-01', name: 'Outro' });
    expect([409, 422]).toContain(dup.status);
    central = (await http.post('/v1/inventory/warehouses').set(auth(GESTORA)).send({ name: 'Central' })).body
      .id;
    const wb = await http
      .post('/v1/inventory/warehouses')
      .set(auth(GESTORA))
      .send({ name: 'Almox. Hospital B', customer_id: hospitalB });
    expect(wb.status).toBe(201);
    doHospitalB = wb.body.id;
  });

  it('entrada com custo e referência; quantidade/valor inválidos → 422', async () => {
    const r1 = await http
      .post('/v1/inventory/receipts')
      .set(auth(GESTORA))
      .send({ item_id: filtro, warehouse_id: central, qty: 10, unit_cost: '40.00', reference: 'NF 1234' });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    await http
      .post('/v1/inventory/receipts')
      .set(auth(GESTORA))
      .send({ item_id: sensor, warehouse_id: central, qty: 5, unit_cost: '300,00', reference: 'NF 1235' });
    const ruim = await http
      .post('/v1/inventory/receipts')
      .set(auth(GESTORA))
      .send({ item_id: filtro, warehouse_id: central, qty: 1, unit_cost: '4.005', reference: 'NF x' });
    expect(ruim.status).toBe(422);
  });

  it('mínimo e máximo; máximo menor que mínimo → 422', async () => {
    const ok = await http
      .put('/v1/inventory/limits')
      .set(auth(GESTORA))
      .send({ item_id: filtro, warehouse_id: central, min_qty: 2, max_qty: 20 });
    expect(ok.status).toBe(200);
    const ruim = await http
      .put('/v1/inventory/limits')
      .set(auth(GESTORA))
      .send({ item_id: filtro, warehouse_id: central, min_qty: 5, max_qty: 1 });
    expect(ruim.status).toBe(422);
    const saldos = await http.get('/v1/inventory/balances').set(auth(GESTORA));
    const linha = saldos.body.items.find((b: { item_id: string }) => b.item_id === filtro);
    expect(Number(linha.max_qty)).toBe(20);
    expect(linha.warehouse_owner).toBe('organization');
  });
});

describe('saída só via OS, ABC e relatório', () => {
  it('a saída para a OS é vinculada e entra na curva ABC', async () => {
    const r1 = await http
      .post(`/v1/inventory/work-orders/${os}/parts`)
      .set(auth(OPERADOR))
      .send({ item_id: filtro, warehouse_id: central, qty: 3 });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    await http
      .post(`/v1/inventory/work-orders/${os}/parts`)
      .set(auth(OPERADOR))
      .send({ item_id: sensor, warehouse_id: central, qty: 1 });
    const abc = await http.get(`/v1/inventory/abc?from=${DE}&to=${ATE}`).set(auth(GESTORA));
    expect(abc.status, JSON.stringify(abc.body)).toBe(200);
    expect(inventoryAbc.response.safeParse(abc.body).success).toBe(true);
    // sensor: 1 × 300 = 300; filtro: 3 × 40 = 120 → sensor é A.
    expect(abc.body.items[0].name).toBe('Sensor de fluxo');
    expect(abc.body.items[0].abc_class).toBe('A');
    expect(abc.body.total_value_cents).toBe(42000);
    expect(abc.body.rule).toMatch(/Pareto/);
  });

  it('o relatório do período mostra entradas e consumo por OS', async () => {
    const r = await http.get(`/v1/inventory/period-report?from=${DE}&to=${ATE}`).set(auth(GESTORA));
    expect(r.status).toBe(200);
    const f = r.body.items.find((x: { sku: string }) => x.sku === 'FIL-01');
    expect(f.received).toBe(10);
    expect(f.consumed_by_work_orders).toBe(3);
    expect(f.on_hand_now).toBe(7);
  });

  it('valor em estoque e ABC exigem read_costs; o operador não vê custo', async () => {
    expect((await http.get('/v1/inventory/valuation').set(auth(GESTORA))).status).toBe(200);
    expect((await http.get(`/v1/inventory/abc?from=${DE}&to=${ATE}`).set(auth(OPERADOR))).status).toBe(403);
    const saldos = await http.get('/v1/inventory/balances').set(auth(OPERADOR));
    expect(saldos.body.items.every((b: { average_cost: unknown }) => b.average_cost === null)).toBe(true);
  });
});

describe('estoque do cliente é privado', () => {
  it('quem só tem o Hospital A não vê o almoxarifado do Hospital B', async () => {
    const lista = await http.get('/v1/inventory/warehouses').set(auth(RESTRITO));
    expect(lista.body.items.map((w: { id: string }) => w.id)).not.toContain(doHospitalB);
    const entrada = await http
      .post('/v1/inventory/receipts')
      .set(auth(RESTRITO))
      .send({ item_id: filtro, warehouse_id: doHospitalB, qty: 1, unit_cost: '1.00', reference: 'NF 9' });
    expect(entrada.status).toBe(404);
  });

  it('outra organização não vê itens nem almoxarifados', async () => {
    const itens = await http.get('/v1/inventory/items').set(auth(ADMIN_B));
    expect(itens.body.items).toEqual([]);
    const w = await http.get('/v1/inventory/warehouses').set(auth(ADMIN_B));
    expect(w.body.items).toEqual([]);
  });
});

describe('Store', () => {
  it('só item publicado, sem saldo', async () => {
    const vazio = await http.get('/v1/store/items').set(auth(SOLICITANTE));
    expect(vazio.status).toBe(200);
    expect(vazio.body.items).toEqual([]);
    const pub = await http
      .patch(`/v1/inventory/items/${filtro}`)
      .set(auth(GESTORA))
      .send({ store_published: true, store_summary: 'Filtro HEPA para ventilador.' });
    expect(pub.status).toBe(200);
    const r = await http.get('/v1/store/items').set(auth(SOLICITANTE));
    expect(storeItemsList.response.safeParse(r.body).success).toBe(true);
    expect(r.body.items).toHaveLength(1);
    expect(JSON.stringify(r.body)).not.toMatch(/on_hand|available|average_cost|reserved/);
    expect(r.body.items[0].list_price_cents).toBe('8990');
  });

  it('pedir proposta vira oportunidade do cliente do vínculo', async () => {
    const r = await http
      .post('/v1/store/requests')
      .set(auth(SOLICITANTE))
      .send({ item_id: filtro, quantity: 4, notes: 'urgente' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [op] = await withTenant(
      t.db,
      buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'v' }),
      (s) =>
        s.query<{ customer_id: string; origin: string; need: string }>(
          `SELECT customer_id, origin::text AS origin, need FROM aurora.opportunities WHERE id = $1`,
          [r.body.opportunity_id]
        )
    );
    expect(op!.customer_id).toBe(hospitalA);
    expect(op!.origin).toBe('customer_request');
    expect(op!.need).toMatch(/4 × Filtro HEPA/);
  });

  it('item não publicado → 404; outra organização não vê a Store de A', async () => {
    expect(
      (await http.post('/v1/store/requests').set(auth(SOLICITANTE)).send({ item_id: sensor, quantity: 1 }))
        .status
    ).toBe(404);
    const b = await http.get('/v1/store/items').set(auth(ADMIN_B));
    expect(b.body.items).toEqual([]);
  });
});
