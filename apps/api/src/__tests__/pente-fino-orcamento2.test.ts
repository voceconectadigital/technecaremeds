/**
 * Aurora — PF-71: "Gerar orçamento" da OS numa chamada só.
 *
 *   · `POST /v1/work-orders/:id/quotes` cria cabeçalho e linhas na MESMA
 *     transação; o cliente é o da OS;
 *   · linha inválida (item inexistente, quantidade com 4 casas, peça sem item)
 *     → 422 citando a linha, e NENHUM orçamento fica gravado;
 *   · reenviar o mesmo `clientRequestId` devolve o mesmo orçamento, sem criar
 *     outro; o mesmo identificador com outro conteúdo → 409;
 *   · a falha não "queima" o identificador: corrigido, o reenvio cria;
 *   · fora do escopo → 404 (ScopeGuard pela OS); sem `quote.create` → 403;
 *   · outra organização não enxerga a OS.
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
  createItem,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const ORG_B = newId();
const GESTORA = 'gestora@pf71.test';
const OPERADOR = 'operador@pf71.test';
const RESTRITA = 'restrita@pf71.test';
const ADMIN_B = 'admin@pf71-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospitalA: string, hospitalB: string, osA: string, osB: string, fusivel: string, aprovador: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, { slug: 'pf71', name: 'Prestadora', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'pf71-b', name: 'B', email: ADMIN_B, userName: 'B' });
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, ids.membershipId, base.roles.get('manager')!);
      hospitalA = await createCustomer(s, { name: 'Hospital A' });
      hospitalB = await createCustomer(s, { name: 'Hospital B' });
      const [corretiva] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
      );
      const local = async (customerId: string) =>
        createLocation(s, { customerId, locationTypeId: base.locationTypes.get('unidade')!, name: 'Sede' });
      osA = (
        await createWorkOrder(s, {
          customerId: hospitalA,
          locationId: await local(hospitalA),
          workOrderTypeId: corretiva!.id,
          title: 'Monitor queimado',
        })
      ).id;
      osB = (
        await createWorkOrder(s, {
          customerId: hospitalB,
          locationId: await local(hospitalB),
          workOrderTypeId: corretiva!.id,
          title: 'Bomba sem fluxo',
        })
      ).id;
      fusivel = await createItem(s, { sku: 'FUS-PF71', name: 'Fusível 5A', unit: 'un' });
      aprovador = newId();
      await s.query(
        `INSERT INTO aurora.customer_contacts (id, organization_id, customer_id, name, email)
         VALUES ($1, $2, $3, 'Dra. Diretora', 'diretora@hospital.test')`,
        [aprovador, ORG, hospitalA]
      );
    }
  );
  const memOp = newId();
  const memRestrita = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memOp },
    { email: OPERADOR, userName: 'Op' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memRestrita },
    { email: RESTRITA, userName: 'Restrita', customerIds: [hospitalA] }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memOp, base.roles.get('operator')!);
      await assignRole(s, memRestrita, base.roles.get('manager')!);
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

const corpo = (over: Record<string, unknown> = {}) => ({
  clientRequestId: newId(),
  nature: 'parts_and_services',
  validUntil: '2099-12-31',
  approverContactId: aprovador,
  items: [
    { kind: 'service', description: 'Hora técnica', quantity: 2, unitPrice: '150.50' },
    { kind: 'part', itemId: fusivel, description: 'Fusível 5A', quantity: 3, unitPrice: '0,10' },
  ],
  ...over,
});

async function orcamentosDa(os: string): Promise<number> {
  const [r] = await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'conta' }),
    (s) =>
      s.query<{ n: number }>(`SELECT count(*)::int AS n FROM aurora.quotes WHERE work_order_id = $1`, [os])
  );
  return r!.n;
}

describe('PF-71 — orçamento da OS numa transação só', () => {
  it('cria cabeçalho e linhas juntos; o cliente é o da OS; total exato em centavos', async () => {
    const antes = await orcamentosDa(osA);
    const r = await http.post(`/v1/work-orders/${osA}/quotes`).set(auth(GESTORA)).send(corpo());
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const d = await http.get(`/v1/quotes/${r.body.id}`).set(auth(GESTORA));
    expect(d.status).toBe(200);
    expect(d.body.quote.customer_id).toBe(hospitalA);
    expect(d.body.quote.work_order_id).toBe(osA);
    expect(d.body.quote.status).toBe('draft');
    expect(d.body.quote.approver_contact_id).toBe(aprovador);
    // 2 × 150,50 + 3 × 0,10 = 301,30
    expect(Number(d.body.quote.total_cents)).toBe(30130);
    expect(d.body.items.map((i: { kind: string }) => i.kind)).toEqual(['service', 'part']);
    expect(d.body.items[1].field_consumed_qty).toBe('0.000');
    expect(await orcamentosDa(osA)).toBe(antes + 1);

    const ficha = await http.get(`/v1/work-orders/${osA}`).set(auth(GESTORA));
    expect(ficha.body.quote_summary.id).toBe(r.body.id);
  });

  it('linha inválida → 422 citando a linha, e nenhum orçamento fica gravado', async () => {
    const antes = await orcamentosDa(osA);

    const itemInexistente = await http
      .post(`/v1/work-orders/${osA}/quotes`)
      .set(auth(GESTORA))
      .send(
        corpo({
          items: [
            { kind: 'service', description: 'Hora técnica', quantity: 1, unitPrice: '100' },
            { kind: 'part', itemId: newId(), description: 'Fantasma', quantity: 1, unitPrice: '1' },
          ],
        })
      );
    expect(itemInexistente.status, JSON.stringify(itemInexistente.body)).toBe(422);
    expect(itemInexistente.body.message).toMatch(/^linha 2:/);

    const quatroCasas = await http
      .post(`/v1/work-orders/${osA}/quotes`)
      .set(auth(GESTORA))
      .send(
        corpo({
          items: [
            { kind: 'service', description: 'Hora técnica', quantity: 1, unitPrice: '100' },
            { kind: 'service', description: 'Deslocamento', quantity: 1.0005, unitPrice: '10' },
          ],
        })
      );
    expect(quatroCasas.status).toBe(422);
    expect(quatroCasas.body.message).toMatch(/^linha 2:/);

    const pecaSemItem = await http
      .post(`/v1/work-orders/${osA}/quotes`)
      .set(auth(GESTORA))
      .send(corpo({ items: [{ kind: 'part', description: 'Sem catálogo', quantity: 1, unitPrice: '1' }] }));
    expect(pecaSemItem.status).toBe(422);

    const semLinhas = await http
      .post(`/v1/work-orders/${osA}/quotes`)
      .set(auth(GESTORA))
      .send(corpo({ items: [] }));
    expect(semLinhas.status).toBe(422);

    expect(await orcamentosDa(osA)).toBe(antes);
  });

  it('reenvio com o mesmo identificador devolve o MESMO orçamento, sem criar outro', async () => {
    const antes = await orcamentosDa(osA);
    const b = corpo();
    const r1 = await http.post(`/v1/work-orders/${osA}/quotes`).set(auth(GESTORA)).send(b);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    const r2 = await http.post(`/v1/work-orders/${osA}/quotes`).set(auth(GESTORA)).send(b);
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.body.id).toBe(r1.body.id);
    expect(await orcamentosDa(osA)).toBe(antes + 1);

    // Mesmo identificador, outro conteúdo: recusa alta, nada novo.
    const outro = await http
      .post(`/v1/work-orders/${osA}/quotes`)
      .set(auth(GESTORA))
      .send({ ...b, validUntil: '2099-11-30' });
    expect(outro.status).toBe(409);
    expect(await orcamentosDa(osA)).toBe(antes + 1);
  });

  it('a falha não queima o identificador: corrigido, o reenvio cria', async () => {
    const antes = await orcamentosDa(osA);
    const id = newId();
    const ruim = await http
      .post(`/v1/work-orders/${osA}/quotes`)
      .set(auth(GESTORA))
      .send(
        corpo({
          clientRequestId: id,
          items: [{ kind: 'part', itemId: newId(), description: 'Fantasma', quantity: 1, unitPrice: '1' }],
        })
      );
    expect(ruim.status).toBe(422);
    const bom = await http
      .post(`/v1/work-orders/${osA}/quotes`)
      .set(auth(GESTORA))
      .send(corpo({ clientRequestId: id }));
    expect(bom.status, JSON.stringify(bom.body)).toBe(201);
    expect(await orcamentosDa(osA)).toBe(antes + 1);
  });

  it('fora do escopo → 404, sem gravar; dentro do escopo, cria', async () => {
    const antes = await orcamentosDa(osB);
    const fora = await http
      .post(`/v1/work-orders/${osB}/quotes`)
      .set(auth(RESTRITA))
      .send(corpo({ approverContactId: null }));
    expect(fora.status).toBe(404);
    expect(await orcamentosDa(osB)).toBe(antes);

    const dentro = await http.post(`/v1/work-orders/${osA}/quotes`).set(auth(RESTRITA)).send(corpo());
    expect(dentro.status, JSON.stringify(dentro.body)).toBe(201);
  });

  it('sem `quote.create` → 403; outra organização → 404; contato de outro cliente → 422', async () => {
    const antes = await orcamentosDa(osA);
    const op = await http.post(`/v1/work-orders/${osA}/quotes`).set(auth(OPERADOR)).send(corpo());
    expect(op.status).toBe(403);

    const b = await http
      .post(`/v1/work-orders/${osA}/quotes`)
      .set(auth(ADMIN_B))
      .send(corpo({ approverContactId: null }));
    expect(b.status).toBe(404);

    const contatoErrado = await http.post(`/v1/work-orders/${osB}/quotes`).set(auth(GESTORA)).send(corpo());
    expect(contatoErrado.status).toBe(422);
    expect(await orcamentosDa(osA)).toBe(antes);
  });
});
