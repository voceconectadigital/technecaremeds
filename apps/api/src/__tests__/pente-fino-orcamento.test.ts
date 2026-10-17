/**
 * Aurora — pente-fino de 17/10/2026: orçamento e estoque pela HTTP.
 *
 *   · a LISTA de orçamentos e o preço por cliente respeitam o escopo do vínculo;
 *   · desconto em orçamento enviado → 409; dinheiro em número arredonda
 *     meio-para-cima (1.005 → R$ 1,01); quantidade com 4 casas e valor que
 *     estoura a coluna → 422 (não 500);
 *   · remover linha pelo orçamento errado → 404;
 *   · extrato sem custo para quem não tem `inventory.read_costs`, e 404 para
 *     almoxarifado de cliente fora do escopo;
 *   · a OS não consome do almoxarifado de outro cliente; ajuste e
 *     transferência conferem o escopo do almoxarifado.
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
  createWorkOrder,
  createWarehouse,
  createItem,
  recordMovement,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const GESTORA = 'gestora@pf-orc.test';
const RESTRITO = 'restrito@pf-orc.test';
const OPERADOR = 'operador@pf-orc.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const dia = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospitalA: string, hospitalB: string, contatoA: string, osA: string;
let central: string, almoxB: string, filtro: string;
let orcA: string, orcB: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, { slug: 'pf-orc', name: 'Prestadora', email: GESTORA, userName: 'Gestora' });
  const sys = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'pf-orc' });
  await withTenant(t.db, sys, async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, ids.membershipId, base.roles.get('manager')!);
    hospitalA = await createCustomer(s, { name: 'Hospital A' });
    hospitalB = await createCustomer(s, { name: 'Hospital B' });
    contatoA = newId();
    await s.query(
      `INSERT INTO aurora.customer_contacts (id, organization_id, customer_id, name, email)
       VALUES ($1, $2, $3, 'Compras', 'compras@a.test')`,
      [contatoA, ORG, hospitalA]
    );
    const [corretiva] = await s.query<{ id: string }>(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
    );
    osA = (await createWorkOrder(s, { customerId: hospitalA, workOrderTypeId: corretiva!.id, title: 'OS A' }))
      .id;
    central = await createWarehouse(s, { name: 'Central' });
    almoxB = await createWarehouse(s, { name: 'Almox. B' });
    await s.query(`UPDATE aurora.warehouses SET customer_id = $2 WHERE id = $1`, [almoxB, hospitalB]);
    filtro = await createItem(s, { sku: 'PF-FLT', name: 'Filtro' });
    await recordMovement(s, { itemId: filtro, warehouseId: central, kind: 'receipt', qty: 10, unitCost: 40 });
    await recordMovement(s, { itemId: filtro, warehouseId: almoxB, kind: 'receipt', qty: 10, unitCost: 40 });
  });
  const memRestrito = newId();
  const memOp = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memRestrito },
    { email: RESTRITO, userName: 'Restrito', customerIds: [hospitalA] }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memOp },
    { email: OPERADOR, userName: 'Operador' }
  );
  await withTenant(t.db, sys, async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, memRestrito, base.roles.get('manager')!);
    await assignRole(s, memOp, base.roles.get('operator')!);
  });

  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);
  app = await createApp({ db: t.db, env });
  await app.init();
  http = request(app.getHttpServer());

  orcA = (await http.post('/v1/quotes').set(auth(GESTORA)).send({ customerId: hospitalA })).body.id;
  orcB = (await http.post('/v1/quotes').set(auth(GESTORA)).send({ customerId: hospitalB })).body.id;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('escopo nas listas de orçamento', () => {
  it('quem só tem o Hospital A lista só os orçamentos do Hospital A', async () => {
    const r = await http.get('/v1/quotes').set(auth(RESTRITO));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const ids = r.body.items.map((q: { id: string }) => q.id);
    expect(ids).toContain(orcA);
    expect(ids).not.toContain(orcB);
    // Filtrar pelo cliente fora do escopo não fura o recorte.
    const b = await http.get(`/v1/quotes?customerId=${hospitalB}`).set(auth(RESTRITO));
    expect(b.body.items).toEqual([]);
    // Quem enxerga tudo continua vendo os dois.
    const todos = await http.get('/v1/quotes').set(auth(GESTORA));
    expect(todos.body.items.map((q: { id: string }) => q.id)).toEqual(expect.arrayContaining([orcA, orcB]));
  });

  it('o preço de um cliente fora do escopo é 404', async () => {
    const fora = await http
      .get(`/v1/quotes/price?itemId=${filtro}&customerId=${hospitalB}`)
      .set(auth(RESTRITO));
    expect(fora.status).toBe(404);
    const dentro = await http
      .get(`/v1/quotes/price?itemId=${filtro}&customerId=${hospitalA}`)
      .set(auth(RESTRITO));
    expect(dentro.status).toBe(200);
  });
});

describe('dinheiro e quantidade na borda', () => {
  it('número 1.005 vira 101 centavos (meio-para-cima), não 100', async () => {
    const r = await http
      .post(`/v1/quotes/${orcA}/items`)
      .set(auth(GESTORA))
      .send({ kind: 'service', description: 'Ajuste', quantity: 1, unitPrice: 1.005 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const d = await http.get(`/v1/quotes/${orcA}`).set(auth(GESTORA));
    const linha = d.body.items.find((i: { id: string }) => i.id === r.body.id);
    expect(linha.unit_price_cents).toBe('101');
  });

  it('quantidade com 4 casas e valor que estoura a coluna → 422', async () => {
    const casas = await http
      .post(`/v1/quotes/${orcA}/items`)
      .set(auth(GESTORA))
      .send({ kind: 'service', description: 'X', quantity: '1.2345', unitPrice: '10.00' });
    expect(casas.status).toBe(422);
    const enorme = await http
      .post(`/v1/quotes/${orcA}/items`)
      .set(auth(GESTORA))
      .send({ kind: 'service', description: 'X', quantity: '999999999', unitPrice: '999999999999.99' });
    expect(enorme.status, JSON.stringify(enorme.body)).toBe(422);
    const numeroGigante = await http
      .post(`/v1/quotes/${orcA}/items`)
      .set(auth(GESTORA))
      .send({ kind: 'service', description: 'X', quantity: 1, unitPrice: 1e20 });
    expect(numeroGigante.status).toBe(422);
  });

  it('remover linha pelo orçamento errado → 404', async () => {
    const linha = await http
      .post(`/v1/quotes/${orcA}/items`)
      .set(auth(GESTORA))
      .send({ kind: 'service', description: 'Removível', quantity: 1, unitPrice: '5.00' });
    const errado = await http.post(`/v1/quotes/${orcB}/items/${linha.body.id}/remove`).set(auth(GESTORA));
    expect(errado.status).toBe(404);
    const certo = await http.post(`/v1/quotes/${orcA}/items/${linha.body.id}/remove`).set(auth(GESTORA));
    expect(certo.status).toBe(201);
  });

  it('desconto em orçamento enviado → 409; em rascunho, só acréscimo preserva o desconto', async () => {
    const pct = await http.post(`/v1/quotes/${orcA}/discount`).set(auth(GESTORA)).send({ percent: 10 });
    expect(pct.status, JSON.stringify(pct.body)).toBe(201);
    const so = await http.post(`/v1/quotes/${orcA}/discount`).set(auth(GESTORA)).send({ additions: '2.00' });
    expect(so.status).toBe(201);
    const [q] = await withTenant(
      t.db,
      buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'v' }),
      (s) =>
        s.query<{ p: string | null }>(
          `SELECT general_discount_percent::text AS p FROM aurora.quotes WHERE id = $1`,
          [orcA]
        )
    );
    expect(Number(q!.p)).toBe(10);

    const ruim = await http.post(`/v1/quotes/${orcA}/discount`).set(auth(GESTORA)).send({ percent: 150 });
    expect(ruim.status).toBe(422);

    const enviado = (
      await http
        .post('/v1/quotes')
        .set(auth(GESTORA))
        .send({ customerId: hospitalA, approverContactId: contatoA, validUntil: dia(20) })
    ).body.id;
    await http
      .post(`/v1/quotes/${enviado}/items`)
      .set(auth(GESTORA))
      .send({ kind: 'service', description: 'Serviço', quantity: 1, unitPrice: '100.00' });
    const envio = await http
      .post(`/v1/quotes/${enviado}/transitions`)
      .set(auth(GESTORA))
      .send({ to: 'sent' });
    expect(envio.status, JSON.stringify(envio.body)).toBe(201);
    const depois = await http.post(`/v1/quotes/${enviado}/discount`).set(auth(GESTORA)).send({ percent: 5 });
    expect(depois.status).toBe(409);
  });

  it('OS de outro cliente no orçamento → 422', async () => {
    const r = await http
      .post('/v1/quotes')
      .set(auth(GESTORA))
      .send({ customerId: hospitalB, workOrderId: osA });
    expect(r.status).toBe(422);
  });
});

describe('estoque: custo e escopo', () => {
  it('o extrato sai sem custo para quem não tem read_costs', async () => {
    const op = await http.get(`/v1/inventory/ledger?item=${filtro}&warehouse=${central}`).set(auth(OPERADOR));
    expect(op.status, JSON.stringify(op.body)).toBe(200);
    expect(op.body.items.length).toBeGreaterThan(0);
    expect(op.body.items.every((m: { unit_cost: unknown }) => m.unit_cost === null)).toBe(true);
    const gestora = await http
      .get(`/v1/inventory/ledger?item=${filtro}&warehouse=${central}`)
      .set(auth(GESTORA));
    expect(gestora.body.items.some((m: { unit_cost: unknown }) => m.unit_cost !== null)).toBe(true);
  });

  it('extrato, ajuste e transferência de almoxarifado de cliente fora do escopo → 404', async () => {
    const extrato = await http
      .get(`/v1/inventory/ledger?item=${filtro}&warehouse=${almoxB}`)
      .set(auth(RESTRITO));
    expect(extrato.status).toBe(404);
    const ajuste = await http
      .post('/v1/inventory/adjustments')
      .set(auth(RESTRITO))
      .send({ item_id: filtro, warehouse_id: almoxB, qty: -1, reason: 'quebra na prateleira' });
    expect(ajuste.status).toBe(404);
    const transf = await http
      .post('/v1/inventory/transfers')
      .set(auth(RESTRITO))
      .send({ item_id: filtro, from_warehouse_id: almoxB, to_warehouse_id: central, qty: 1 });
    expect(transf.status).toBe(404);
  });

  it('a OS do Hospital A não consome do almoxarifado do Hospital B', async () => {
    const r = await http
      .post(`/v1/inventory/work-orders/${osA}/parts`)
      .set(auth(GESTORA))
      .send({ item_id: filtro, warehouse_id: almoxB, qty: 1 });
    expect(r.status).toBe(422);
    const ok = await http
      .post(`/v1/inventory/work-orders/${osA}/parts`)
      .set(auth(GESTORA))
      .send({ item_id: filtro, warehouse_id: central, qty: 1 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.movement_id).toBeTruthy();
    expect(ok.body.reservation_id).toBeTruthy();
  });
});
