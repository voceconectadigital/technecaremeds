/**
 * Aurora — pedidos da Store, pela HTTP (conversa com o cliente, 21/10/2026): comprar, acompanhar a
 * entrega e receber a nota fiscal.
 *
 *   · o cliente pede itens PUBLICADOS, com o preço de lista do momento (item sob consulta fica fora do total);
 *   · só a prestadora (quote.update) confirma, despacha e entrega; confirmar exige a previsão de entrega;
 *   · o cliente cancela o PRÓPRIO pedido, só enquanto "requested";
 *   · a nota fiscal sobe (PDF/imagem) e desce com os mesmos bytes; só quem alcança o cliente a vê;
 *   · escopo por cliente e isolamento entre organizações.
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
  createInventoryItem,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';
import { armazenamentoEmMemoria } from '../common/arquivos/memoria';

const ORG_A = newId();
const ORG_B = newId();
const PRESTADORA = 'prestadora@ped-a.test';
const CLIENTE = 'cliente@ped-a.test';
const OUTRO_CLIENTE = 'outro@ped-a.test';
const ADMIN_B = 'admin@ped-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospital: string, outroHospital: string;
let sensor: string, cabo: string, interno: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const idsA = { organizationId: ORG_A, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, idsA, {
    slug: 'ped-a',
    name: 'Prestadora',
    email: PRESTADORA,
    userName: 'Prestadora',
  });
  await seedOrganization(t, idsB, { slug: 'ped-b', name: 'Org B', email: ADMIN_B, userName: 'Admin B' });

  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, idsA.membershipId, base.roles.get('admin')!);
      hospital = await createCustomer(s, { name: 'Hospital Alfa' });
      outroHospital = await createCustomer(s, { name: 'Hospital Beta' });
      sensor = await createInventoryItem(s, {
        sku: 'SPO2-01',
        name: 'Sensor de SpO2',
        unit: 'un',
        listPrice: '150.00',
      });
      cabo = await createInventoryItem(s, { sku: 'ECG-01', name: 'Cabo ECG', unit: 'un' });
      interno = await createInventoryItem(s, {
        sku: 'INT-01',
        name: 'Peça interna',
        unit: 'un',
        listPrice: '10.00',
      });
    }
  );
  // Dois itens publicados na Store; o terceiro é interno.
  await t.admin.query(`UPDATE aurora.inventory_items SET store_published = true WHERE id = ANY($1::uuid[])`, [
    [sensor, cabo],
  ]);

  const memCli = newId();
  const memOutro = newId();
  await seedMember(
    t,
    { organizationId: ORG_A, userId: newId(), membershipId: memCli },
    { email: CLIENTE, userName: 'Clara Cliente', seatType: 'portal', customerIds: [hospital] }
  );
  await seedMember(
    t,
    { organizationId: ORG_A, userId: newId(), membershipId: memOutro },
    { email: OUTRO_CLIENTE, userName: 'Otávio Outro', seatType: 'portal', customerIds: [outroHospital] }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memCli, base.roles.get('requester')!);
      await assignRole(s, memOutro, base.roles.get('requester')!);
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
  app = await createApp({ db: t.db, env, arquivos: armazenamentoEmMemoria() });
  await app.init();
  http = request(app.getHttpServer());
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

let pedido: string;
let pedidoACancelar: string;
const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const depois = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

describe('fazer o pedido', () => {
  it('o cliente pede itens publicados: preço de lista do momento, e o "sob consulta" fica fora do total', async () => {
    const r = await http
      .post('/v1/store-orders')
      .set(auth(CLIENTE))
      .send({
        items: [
          { item_id: sensor, quantity: 2 },
          { item_id: cabo, quantity: 1 },
        ],
        note: 'Urgente para a UTI.',
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.number).toMatch(/^PED-\d{4}-0001$/);
    pedido = r.body.id;

    const d = await http.get(`/v1/store-orders/${pedido}`).set(auth(CLIENTE));
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({
      status: 'requested',
      customer_name: 'Hospital Alfa',
      total_cents: '30000',
      has_unpriced: true,
      note: 'Urgente para a UTI.',
    });
    expect(
      d.body.items
        .map((i: { sku: string; unit_price_cents: string | null }) => [i.sku, i.unit_price_cents])
        .sort()
    ).toEqual([
      ['ECG-01', null],
      ['SPO2-01', '15000'],
    ]);
    expect(d.body.events.map((e: { status: string }) => e.status)).toEqual(['requested']);
  });

  it('item interno (fora da Store), pedido vazio e quantidade zero são recusados', async () => {
    const fora = await http
      .post('/v1/store-orders')
      .set(auth(CLIENTE))
      .send({ items: [{ item_id: interno, quantity: 1 }] });
    expect(fora.status).toBe(404);
    expect((await http.post('/v1/store-orders').set(auth(CLIENTE)).send({ items: [] })).status).toBe(422);
    expect(
      (
        await http
          .post('/v1/store-orders')
          .set(auth(CLIENTE))
          .send({ items: [{ item_id: sensor, quantity: 0 }] })
      ).status
    ).toBe(422);
  });

  it('item repetido soma a quantidade', async () => {
    const r = await http
      .post('/v1/store-orders')
      .set(auth(CLIENTE))
      .send({
        items: [
          { item_id: sensor, quantity: 1 },
          { item_id: sensor, quantity: 2 },
        ],
      });
    expect(r.status).toBe(201);
    pedidoACancelar = r.body.id;
    const d = await http.get(`/v1/store-orders/${pedidoACancelar}`).set(auth(CLIENTE));
    expect(d.body.items).toHaveLength(1);
    expect(d.body.items[0].quantity).toBe('3.000');
    expect(d.body.total_cents).toBe('45000');
  });
});

describe('o cliente cancela o próprio pedido', () => {
  it('motivo curto é recusado; com motivo cancela; cancelar de novo, 409', async () => {
    expect(
      (
        await http
          .post(`/v1/store-orders/${pedidoACancelar}/cancel`)
          .set(auth(CLIENTE))
          .send({ reason: 'ops' })
      ).status
    ).toBe(422);
    const ok = await http
      .post(`/v1/store-orders/${pedidoACancelar}/cancel`)
      .set(auth(CLIENTE))
      .send({ reason: 'Pedi a quantidade errada.' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('cancelled');
    expect(
      (
        await http
          .post(`/v1/store-orders/${pedidoACancelar}/cancel`)
          .set(auth(CLIENTE))
          .send({ reason: 'De novo, por favor.' })
      ).status
    ).toBe(409);
  });

  it('outro cliente não cancela o pedido alheio (404: nem sabe que existe)', async () => {
    const r = await http
      .post(`/v1/store-orders/${pedido}/cancel`)
      .set(auth(OUTRO_CLIENTE))
      .send({ reason: 'Tentando cancelar o alheio.' });
    expect(r.status).toBe(404);
  });
});

describe('a prestadora leva o pedido adiante', () => {
  it('o cliente não confirma (403)', async () => {
    const r = await http
      .post(`/v1/store-orders/${pedido}/status`)
      .set(auth(CLIENTE))
      .send({ status: 'confirmed', expected_delivery: amanha });
    expect(r.status).toBe(403);
  });

  it('confirmar exige a previsão de entrega; pular passo é recusado', async () => {
    const url = `/v1/store-orders/${pedido}/status`;
    expect((await http.post(url).set(auth(PRESTADORA)).send({ status: 'confirmed' })).status).toBe(422);
    expect((await http.post(url).set(auth(PRESTADORA)).send({ status: 'delivered' })).status).toBe(409);
    const ok = await http
      .post(url)
      .set(auth(PRESTADORA))
      .send({ status: 'confirmed', expected_delivery: amanha });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('o cliente vê a previsão de entrega e a linha do tempo; cancelar depois de confirmado, não', async () => {
    const d = await http.get(`/v1/store-orders/${pedido}`).set(auth(CLIENTE));
    expect(d.body).toMatchObject({ status: 'confirmed', expected_delivery: amanha });
    expect(d.body.events.map((e: { status: string }) => e.status)).toEqual(['requested', 'confirmed']);
    const c = await http
      .post(`/v1/store-orders/${pedido}/cancel`)
      .set(auth(CLIENTE))
      .send({ reason: 'Mudei de ideia.' });
    expect(c.status).toBe(403);
  });

  it('postar a mesma situação só atualiza a previsão de entrega', async () => {
    const r = await http
      .post(`/v1/store-orders/${pedido}/status`)
      .set(auth(PRESTADORA))
      .send({ status: 'confirmed', expected_delivery: depois });
    expect(r.status).toBe(200);
    expect((await http.get(`/v1/store-orders/${pedido}`).set(auth(CLIENTE))).body.expected_delivery).toBe(
      depois
    );
  });
});

describe('a nota fiscal', () => {
  const pdf = Buffer.from('%PDF-1.4\nnota fiscal\n%%EOF\n');

  it('o cliente não anexa (403); a prestadora anexa PDF com número; outro tipo é recusado', async () => {
    const url = `/v1/store-orders/${pedido}/invoice`;
    const cliente = await http
      .put(url)
      .set(auth(CLIENTE))
      .set('content-type', 'application/pdf')
      .set('x-aurora-invoice-number', 'NF-1')
      .send(pdf);
    expect(cliente.status).toBe(403);
    const html = await http
      .put(url)
      .set(auth(PRESTADORA))
      .set('content-type', 'text/html')
      .set('x-aurora-invoice-number', 'NF-1')
      .send('<script>1</script>');
    expect(html.status).toBe(422);
    const semNumero = await http
      .put(url)
      .set(auth(PRESTADORA))
      .set('content-type', 'application/pdf')
      .send(pdf);
    expect(semNumero.status).toBe(422);

    const ok = await http
      .put(url)
      .set(auth(PRESTADORA))
      .set('content-type', 'application/pdf')
      .set('x-aurora-invoice-number', 'NF-2026-1234')
      .set('x-aurora-file-name', encodeURIComponent('Nota fiscal 1234.pdf'))
      .send(pdf);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ invoice_number: 'NF-2026-1234', file_name: 'Nota fiscal 1234.pdf' });
  });

  it('o cliente do pedido baixa os MESMOS bytes; o cliente de outro hospital não alcança', async () => {
    const parse = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    };
    const baixa = await http
      .get(`/v1/store-orders/${pedido}/invoice`)
      .set(auth(CLIENTE))
      .buffer(true)
      .parse(parse);
    expect(baixa.status).toBe(200);
    expect(baixa.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(baixa.body as Buffer, pdf)).toBe(0);
    expect((await http.get(`/v1/store-orders/${pedido}/invoice`).set(auth(OUTRO_CLIENTE))).status).toBe(404);

    const d = await http.get(`/v1/store-orders/${pedido}`).set(auth(CLIENTE));
    expect(d.body).toMatchObject({
      invoice_number: 'NF-2026-1234',
      invoice_file_name: 'Nota fiscal 1234.pdf',
    });
  });

  it('separa, despacha e entrega: a data de entrega fica gravada; pedido entregue não volta', async () => {
    const url = `/v1/store-orders/${pedido}/status`;
    // O cliente não move o pedido da prestadora (0084: "separado" é passo da prestadora).
    expect((await http.post(url).set(auth(CLIENTE)).send({ status: 'separated' })).status).toBe(403);
    expect((await http.post(url).set(auth(PRESTADORA)).send({ status: 'separated' })).status).toBe(200);
    // Separado não volta para aprovado.
    expect((await http.post(url).set(auth(PRESTADORA)).send({ status: 'confirmed' })).status).toBe(409);
    expect(
      (
        await http
          .post(url)
          .set(auth(PRESTADORA))
          .send({ status: 'shipped', note: 'Saiu com a transportadora.' })
      ).status
    ).toBe(200);
    expect((await http.post(url).set(auth(PRESTADORA)).send({ status: 'delivered' })).status).toBe(200);
    const d = await http.get(`/v1/store-orders/${pedido}`).set(auth(CLIENTE));
    expect(d.body.status).toBe('delivered');
    expect(d.body.delivered_at).toBeTruthy();
    expect(d.body.events.map((e: { status: string }) => e.status)).toEqual([
      'requested',
      'confirmed',
      'confirmed',
      'confirmed',
      'separated',
      'shipped',
      'delivered',
    ]);
    expect(
      (
        await http
          .post(url)
          .set(auth(PRESTADORA))
          .send({ status: 'cancelled', note: 'Cancelando já entregue.' })
      ).status
    ).toBe(409);
  });
});

describe('escopo e isolamento', () => {
  it('cada cliente lista só os próprios pedidos; a prestadora vê todos', async () => {
    const dele = await http.get('/v1/store-orders').set(auth(CLIENTE));
    expect(dele.body.items.map((o: { customer_name: string }) => o.customer_name)).toEqual([
      'Hospital Alfa',
      'Hospital Alfa',
    ]);
    expect((await http.get('/v1/store-orders').set(auth(OUTRO_CLIENTE))).body.items).toEqual([]);
    const todos = await http.get('/v1/store-orders').set(auth(PRESTADORA));
    expect(todos.body.items).toHaveLength(2);
    const so = await http.get('/v1/store-orders?status=delivered').set(auth(PRESTADORA));
    expect(so.body.items).toHaveLength(1);
  });

  it('outra organização não vê nem alcança por id', async () => {
    expect((await http.get('/v1/store-orders').set(auth(ADMIN_B))).body.items).toEqual([]);
    expect((await http.get(`/v1/store-orders/${pedido}`).set(auth(ADMIN_B))).status).toBe(404);
  });
});
