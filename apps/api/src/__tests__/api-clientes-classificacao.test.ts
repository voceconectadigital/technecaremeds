/**
 * Aurora — cliente EAS × empresa corporativa, edição e setores (reunião 16/10/2026, Fase 2).
 *
 *   · cadastro com classificação e subtipo coerentes (incoerente → 422);
 *   · edição pelo PATCH, com escopo (fora → 404) e isolamento entre tenants;
 *   · cliente interno não vira empresa corporativa;
 *   · setor sempre de um cliente da própria organização;
 *   · organização nova provisionada pelo ponto de partida já tem "Setor".
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
import { withTenant, assignRole, createCustomer, provisionOrganizationBaseline } from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { customersUpdate } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG_A = newId();
const ORG_B = newId();
const GESTORA = 'gestora@clientes-a.test';
const RESTRITA = 'restrita@clientes-a.test';
const SOLICITANTE = 'solicitante@clientes-a.test';
const ADMIN_B = 'admin@clientes-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let interno: string, outro: string, clienteDeB: string;
let tiposA: Map<string, string>;

beforeAll(async () => {
  t = await createTestDatabase();
  const idsA = { organizationId: ORG_A, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, idsA, { slug: 'clientes-a', name: 'Org A', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'clientes-b', name: 'Org B', email: ADMIN_B, userName: 'Admin B' });

  const restrita = newId();
  const solicitante = newId();
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      tiposA = base.locationTypes;
      await assignRole(s, idsA.membershipId, base.roles.get('manager')!);
      interno = await createCustomer(s, { name: 'Clínica Própria', isInternal: true });
      outro = await createCustomer(s, { name: 'Hospital Fora do Escopo' });
    }
  );
  await seedMember(
    t,
    { organizationId: ORG_A, userId: newId(), membershipId: restrita },
    {
      email: RESTRITA,
      userName: 'Restrita',
      customerIds: [interno],
    }
  );
  await seedMember(
    t,
    { organizationId: ORG_A, userId: newId(), membershipId: solicitante },
    {
      email: SOLICITANTE,
      userName: 'Solicitante',
      seatType: 'portal',
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const papeis = await provisionOrganizationBaseline(s);
      await assignRole(s, restrita, papeis.roles.get('manager')!);
      await assignRole(s, solicitante, papeis.roles.get('requester')!);
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_B, actorKind: 'system', requestId: 's3' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, idsB.membershipId, base.roles.get('admin')!);
      clienteDeB = await createCustomer(s, { name: 'Hospital de B' });
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

let hospital: string;

describe('cadastro com classificação', () => {
  it('EAS · Hospital', async () => {
    const r = await http
      .post('/v1/customers')
      .set(auth(GESTORA))
      .send({ name: 'Hospital São Lucas', kind: 'eas', subtype: 'hospital' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.kind).toBe('eas');
    expect(r.body.subtype).toBe('hospital');
    hospital = r.body.id;
  });

  it('Empresa corporativa · Engenharia clínica', async () => {
    const r = await http
      .post('/v1/customers')
      .set(auth(GESTORA))
      .send({ name: 'EngClin Ltda', kind: 'corporate', subtype: 'engenharia_clinica' });
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe('corporate');
  });

  it('sem classificação, nasce EAS (compatível com o cadastro antigo)', async () => {
    const r = await http.post('/v1/customers').set(auth(GESTORA)).send({ name: 'Clínica Antiga' });
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe('eas');
    expect(r.body.subtype).toBeNull();
  });

  it('subtipo de outra classificação → 422', async () => {
    const r = await http
      .post('/v1/customers')
      .set(auth(GESTORA))
      .send({ name: 'Incoerente', kind: 'corporate', subtype: 'hospital' });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('subtype');
  });

  it('solicitante não cadastra nem edita cliente', async () => {
    expect((await http.post('/v1/customers').set(auth(SOLICITANTE)).send({ name: 'Xis' })).status).toBe(403);
    expect(
      (await http.patch(`/v1/customers/${hospital}`).set(auth(SOLICITANTE)).send({ name: 'Xis' })).status
    ).toBe(403);
  });
});

describe('edição (PATCH /customers/:id)', () => {
  it('troca a classificação e limpa o subtipo antigo', async () => {
    const r = await http
      .patch(`/v1/customers/${hospital}`)
      .set(auth(GESTORA))
      .send({ kind: 'corporate', trade_name: 'São Lucas Serviços' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(customersUpdate.response.safeParse(r.body).success).toBe(true);
    expect(r.body.kind).toBe('corporate');
    expect(r.body.subtype).toBeNull();
    expect(r.body.trade_name).toBe('São Lucas Serviços');
  });

  it('subtipo coerente com o novo tipo', async () => {
    const r = await http
      .patch(`/v1/customers/${hospital}`)
      .set(auth(GESTORA))
      .send({ kind: 'eas', subtype: 'clinica_imagem' });
    expect(r.status).toBe(200);
    expect(r.body.subtype).toBe('clinica_imagem');
  });

  it('cliente interno não vira empresa corporativa', async () => {
    const r = await http.patch(`/v1/customers/${interno}`).set(auth(GESTORA)).send({ kind: 'corporate' });
    expect(r.status).toBe(422);
  });

  it('fora do escopo do vínculo → 404', async () => {
    const r = await http.patch(`/v1/customers/${outro}`).set(auth(RESTRITA)).send({ name: 'Invadido' });
    expect(r.status).toBe(404);
  });

  it('cliente de outra organização → 404, nos dois sentidos', async () => {
    expect(
      (await http.patch(`/v1/customers/${clienteDeB}`).set(auth(GESTORA)).send({ name: 'Xis' })).status
    ).toBe(404);
    expect(
      (await http.patch(`/v1/customers/${hospital}`).set(auth(ADMIN_B)).send({ name: 'Xis' })).status
    ).toBe(404);
  });
});

describe('setores', () => {
  it('setor nasce sob o cliente e aparece na ficha', async () => {
    const unidade = await http
      .post('/v1/locations')
      .set(auth(GESTORA))
      .send({ customer_id: hospital, location_type_id: tiposA.get('unidade'), name: 'Sede' });
    expect(unidade.status, JSON.stringify(unidade.body)).toBe(201);
    const uti = await http
      .post('/v1/locations')
      .set(auth(GESTORA))
      .send({
        customer_id: hospital,
        parent_id: unidade.body.id,
        location_type_id: tiposA.get('setor'),
        name: 'UTI Neonatal',
      });
    expect(uti.status).toBe(201);
    const ficha = await http.get(`/v1/customers/${hospital}`).set(auth(GESTORA));
    const setores = ficha.body.locations.filter(
      (l: { location_type_key: string }) => l.location_type_key === 'setor'
    );
    expect(setores.map((s: { name: string }) => s.name)).toEqual(['UTI Neonatal']);
  });

  it('não cria setor em cliente de outra organização', async () => {
    const r = await http
      .post('/v1/locations')
      .set(auth(GESTORA))
      .send({
        customer_id: clienteDeB,
        location_type_id: tiposA.get('setor'),
        name: 'UTI invasora',
      });
    expect([404, 422]).toContain(r.status);
  });
});

describe('ponto de partida da organização', () => {
  it('é idempotente e entrega o tipo Setor e as situações de OS', async () => {
    const ctx = buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 'idem' });
    const [antes] = await withTenant(t.db, ctx, (s) =>
      s.query<{ tipos: number; situacoes: number; papeis: number }>(
        `SELECT (SELECT count(*) FROM aurora.location_types)::int AS tipos,
                (SELECT count(*) FROM aurora.work_order_statuses)::int AS situacoes,
                (SELECT count(*) FROM aurora.roles)::int AS papeis`
      )
    );
    await withTenant(t.db, ctx, (s) => provisionOrganizationBaseline(s));
    const [depois] = await withTenant(t.db, ctx, (s) =>
      s.query<{ tipos: number; situacoes: number; papeis: number; setor: number }>(
        `SELECT (SELECT count(*) FROM aurora.location_types)::int AS tipos,
                (SELECT count(*) FROM aurora.work_order_statuses)::int AS situacoes,
                (SELECT count(*) FROM aurora.roles)::int AS papeis,
                (SELECT count(*) FROM aurora.location_types WHERE key = 'setor')::int AS setor`
      )
    );
    expect(depois).toEqual({ ...antes, setor: 1 });
    expect(depois!.situacoes).toBeGreaterThan(0);
  });
});
