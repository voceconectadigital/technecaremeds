/**
 * Aurora — orçamento integrado à OS (reunião 16/10/2026, Fase 7).
 *
 *   · gerar orçamento da OS com hora técnica e peça, valores como TEXTO
 *     decimal → totais exatos em centavos;
 *   · enviar: OS em execução passa a "aguardando aprovação do orçamento"
 *     (motivo `quote_approval`); a ficha mostra o orçamento vivo;
 *   · aprovar devolve a OS à execução; reprovar exige motivo;
 *   · quem envia sem executar OS (financeiro) não quebra o envio;
 *   · solicitante não cria orçamento; outra organização não lê.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext, centsFromDecimal } from '@aurora/domain';
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
  createCatalogItem,
  createItem,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const ORG_B = newId();
const GESTORA = 'gestora@orc.test';
const OPERADOR = 'operador@orc.test';
const FINANCEIRO = 'financeiro@orc.test';
const SOLICITANTE = 'sol@orc.test';
const ADMIN_B = 'admin@orc-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospital: string, os1: string, os2: string, motivo: string, fusivel: string, aprovador: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, { slug: 'orc', name: 'Prestadora', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'orc-b', name: 'B', email: ADMIN_B, userName: 'B' });
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, ids.membershipId, base.roles.get('manager')!);
      hospital = await createCustomer(s, { name: 'Hospital A' });
      const sede = await createLocation(s, {
        customerId: hospital,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'Sede',
      });
      const uti = await createLocation(s, {
        customerId: hospital,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI',
      });
      const [corretiva] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
      );
      os1 = (
        await createWorkOrder(s, {
          customerId: hospital,
          locationId: uti,
          workOrderTypeId: corretiva!.id,
          title: 'Monitor queimado',
        })
      ).id;
      os2 = (
        await createWorkOrder(s, {
          customerId: hospital,
          locationId: uti,
          workOrderTypeId: corretiva!.id,
          title: 'Bomba sem fluxo',
        })
      ).id;
      motivo = await createCatalogItem(s, {
        catalogKey: 'rejection_reason',
        key: 'preco',
        label: 'Preço acima do orçado',
      });
      fusivel = await createItem(s, { sku: 'FUS-5A', name: 'Fusível 5A', unit: 'un' });
      aprovador = newId();
      await s.query(
        `INSERT INTO aurora.customer_contacts (id, organization_id, customer_id, name, email)
       VALUES ($1, $2, $3, 'Dra. Diretora', 'diretora@hospital.test')`,
        [aprovador, ORG, hospital]
      );
    }
  );
  const memOp = newId();
  const memFin = newId();
  const memSol = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memOp },
    { email: OPERADOR, userName: 'Op' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memFin },
    { email: FINANCEIRO, userName: 'Fin' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memSol },
    {
      email: SOLICITANTE,
      userName: 'Sol',
      seatType: 'portal',
      customerIds: [hospital],
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memOp, base.roles.get('operator')!);
      await assignRole(s, memFin, base.roles.get('finance')!);
      await assignRole(s, memSol, base.roles.get('requester')!);
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

async function orcamento(os: string, quem = GESTORA): Promise<string> {
  const q = await http.post('/v1/quotes').set(auth(quem)).send({
    customerId: hospital,
    workOrderId: os,
    nature: 'parts_and_services',
    validUntil: '2099-12-31',
    approverContactId: aprovador,
  });
  expect(q.status, JSON.stringify(q.body)).toBe(201);
  const h = await http
    .post(`/v1/quotes/${q.body.id}/items`)
    .set(auth(quem))
    .send({ kind: 'service', description: 'Hora técnica', quantity: 2, unitPrice: '150.50' });
  expect(h.status, JSON.stringify(h.body)).toBe(201);
  const p = await http
    .post(`/v1/quotes/${q.body.id}/items`)
    .set(auth(quem))
    .send({ kind: 'part', itemId: fusivel, description: 'Fusível 5A', quantity: 3, unitPrice: '0,10' });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  return q.body.id;
}

describe('contatos do cliente (aprovador)', () => {
  it('lista e cadastra; contato sem e-mail nem telefone → 422', async () => {
    const l = await http.get(`/v1/customers/${hospital}/contacts`).set(auth(GESTORA));
    expect(l.body.items.map((c: { name: string }) => c.name)).toContain('Dra. Diretora');
    const ok = await http
      .post(`/v1/customers/${hospital}/contacts`)
      .set(auth(FINANCEIRO))
      .send({ name: 'Compras', email: 'compras@hospital.test' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const sem = await http
      .post(`/v1/customers/${hospital}/contacts`)
      .set(auth(GESTORA))
      .send({ name: 'Ninguém' });
    expect(sem.status).toBe(422);
    const sol = await http
      .post(`/v1/customers/${hospital}/contacts`)
      .set(auth(SOLICITANTE))
      .send({ name: 'X', email: 'x@x.test' });
    expect(sol.status).toBe(403);
  });
});

describe('dinheiro sem float', () => {
  it('centsFromDecimal é exato', () => {
    expect(centsFromDecimal('0.10')).toBe(10);
    expect(centsFromDecimal('150,5')).toBe(15050);
    expect(centsFromDecimal('1234.56')).toBe(123456);
    expect(() => centsFromDecimal('1.234')).toThrow();
    expect(() => centsFromDecimal('-5')).toThrow();
  });
});

describe('orçamento da OS', () => {
  let q1: string;
  it('gera com hora técnica e peça; total exato em centavos', async () => {
    q1 = await orcamento(os1);
    const d = await http.get(`/v1/quotes/${q1}`).set(auth(GESTORA));
    expect(d.status).toBe(200);
    // 2 × 150,50 + 3 × 0,10 = 301,30
    expect(Number(d.body.quote.total_cents)).toBe(30130);
    const ficha = await http.get(`/v1/work-orders/${os1}`).set(auth(GESTORA));
    expect(ficha.body.quote_summary.id).toBe(q1);
    expect(ficha.body.quote_summary.status).toBe('draft');
  });

  it('valor inválido → 422', async () => {
    const r = await http
      .post(`/v1/quotes/${q1}/items`)
      .set(auth(GESTORA))
      .send({ kind: 'part', itemId: fusivel, description: 'Peça', quantity: 1, unitPrice: '12.345' });
    expect(r.status).toBe(422);
  });

  it('enviar com a OS em execução: a OS passa a aguardar aprovação', async () => {
    const exec = await http
      .post(`/v1/work-orders/${os1}/transitions`)
      .set(auth(OPERADOR))
      .send({ to: 'in_progress' });
    expect(exec.status, JSON.stringify(exec.body)).toBe(201);
    const env = await http.post(`/v1/quotes/${q1}/transitions`).set(auth(GESTORA)).send({ to: 'sent' });
    expect(env.status, JSON.stringify(env.body)).toBe(201);
    const ficha = await http.get(`/v1/work-orders/${os1}`).set(auth(GESTORA));
    expect(ficha.body.status_category).toBe('waiting');
    expect(ficha.body.wait_reason_key).toBe('quote_approval');
    expect(ficha.body.quote_summary.status).toBe('sent');
  });

  it('aprovar devolve a OS à execução, com trilha', async () => {
    const r = await http
      .post(`/v1/quotes/${q1}/transitions`)
      .set(auth(GESTORA))
      .send({ to: 'approved', acceptanceNote: 'ok por telefone' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const ficha = await http.get(`/v1/work-orders/${os1}`).set(auth(GESTORA));
    expect(ficha.body.status_category).toBe('in_progress');
    expect(ficha.body.quote_summary.status).toBe('approved');
  });

  it('reprovar exige motivo', async () => {
    const q2 = await orcamento(os2);
    await http.post(`/v1/quotes/${q2}/transitions`).set(auth(GESTORA)).send({ to: 'sent' });
    const sem = await http.post(`/v1/quotes/${q2}/transitions`).set(auth(GESTORA)).send({ to: 'rejected' });
    expect(sem.status).not.toBe(201);
    const com = await http
      .post(`/v1/quotes/${q2}/transitions`)
      .set(auth(GESTORA))
      .send({ to: 'rejected', rejectionReasonId: motivo, note: 'acima do orçado' });
    expect(com.status, JSON.stringify(com.body)).toBe(201);
    const ficha = await http.get(`/v1/work-orders/${os2}`).set(auth(GESTORA));
    expect(ficha.body.quote_summary.status).toBe('rejected');
  });

  it('o financeiro (que não executa OS) envia sem quebrar', async () => {
    await http.post(`/v1/work-orders/${os2}/transitions`).set(auth(OPERADOR)).send({ to: 'in_progress' });
    const q3 = await orcamento(os2, FINANCEIRO);
    const env = await http.post(`/v1/quotes/${q3}/transitions`).set(auth(FINANCEIRO)).send({ to: 'sent' });
    expect(env.status, JSON.stringify(env.body)).toBe(201);
  });

  it('solicitante não cria; outra organização não lê', async () => {
    const sol = await http
      .post('/v1/quotes')
      .set(auth(SOLICITANTE))
      .send({ customerId: hospital, workOrderId: os1 });
    expect(sol.status).toBe(403);
    const b = await http.get(`/v1/quotes/${q1}`).set(auth(ADMIN_B));
    expect(b.status).toBe(404);
  });
});
