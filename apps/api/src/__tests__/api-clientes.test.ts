/**
 * Aurora — cadastro de clientes pela HTTP (EPIC-003).
 *
 * Suíte própria, e não um bloco a mais em `api-directory`: aquela prova o modo
 * single-customer com UM cliente interno, e cadastrar um segundo ali dentro
 * faria a prova depender da ordem dos testes.
 *
 * O que fica provado aqui:
 *   · a criação devolve o cliente inteiro, na mesma forma da lista;
 *   · a segunda organização com cliente deixa de ser single-customer;
 *   · nome repetido é 409 nomeando o campo, não "erro interno";
 *   · `is_internal` não entra pelo formulário;
 *   · quem não tem `customer.create` recebe 403 com a permissão nomeada;
 *   · a ficha respeita o escopo — cliente fora dele é 404.
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
  provisionFactoryRoles,
  assignRole,
  provisionStarterLocationTypes,
  createCustomer,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const ADMIN_USER = newId(),
  ADMIN_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const EMAIL_ADMIN = 'gestora@clientes.test';
const EMAIL_TEC = 'tecnico@clientes.test';
const auth = (email: string) => `Bearer local:${email}:${email}`;

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let interno: string;
let tipos: Map<string, string>;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: ADMIN_USER, membershipId: ADMIN_MEM },
    { slug: 'engenharia', name: 'Engenharia Clínica', email: EMAIL_ADMIN, userName: 'Gestora' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  let papelTecnico = '';
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, ADMIN_MEM, roles.get('admin')!);
    papelTecnico = roles.get('technician')!;
    tipos = await provisionStarterLocationTypes(s);
    interno = await createCustomer(s, { name: 'Engenharia Clínica', isInternal: true });
  });

  // O técnico só enxerga o cliente interno: é o que prova que a ficha de um
  // cliente fora do escopo não vaza nem a existência dele.
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico', customerIds: [interno] }
  );
  await withTenant(t.db, sysCtx, (s) => assignRole(s, TEC_MEM, papelTecnico));

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

describe('cadastrar cliente', () => {
  it('devolve o cliente na mesma forma da lista, com as contagens zeradas', async () => {
    const r = await http.post('/v1/customers').set('authorization', auth(EMAIL_ADMIN)).send({
      name: '  Hospital São Lucas ',
      trade_name: 'São Lucas',
      tax_id: '12.345.678/0001-90',
      segment: 'hospital',
      code: '',
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      name: 'Hospital São Lucas',
      trade_name: 'São Lucas',
      tax_id: '12.345.678/0001-90',
      segment: 'hospital',
      // Vazio é "não informado": vira null, e não uma string vazia.
      code: null,
      is_internal: false,
      status: 'active',
      location_count: 0,
      asset_count: 0,
    });
    hospital = r.body.id;
  });

  it('com dois clientes a organização deixa de ser single-customer', async () => {
    const r = await http.get('/v1/customers').set('authorization', auth(EMAIL_ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.single_customer).toBe(false);
    expect(r.body.items.map((c: { name: string }) => c.name)).toEqual([
      'Engenharia Clínica',
      'Hospital São Lucas',
    ]);
  });

  it('nome repetido, mesmo com outra caixa, é 409 nomeando o campo', async () => {
    const r = await http
      .post('/v1/customers')
      .set('authorization', auth(EMAIL_ADMIN))
      .send({ name: 'hospital são lucas' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('conflict');
    expect(r.body.details.field).toBe('name');
    expect(r.body.message).toContain('nome');
  });

  it('documento com número de dígitos errado é 422 no campo tax_id', async () => {
    const r = await http
      .post('/v1/customers')
      .set('authorization', auth(EMAIL_ADMIN))
      .send({ name: 'Clínica Boa Vista', tax_id: '123' });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('tax_id');
  });

  it('o cliente interno não nasce pelo formulário', async () => {
    const r = await http
      .post('/v1/customers')
      .set('authorization', auth(EMAIL_ADMIN))
      .send({ name: 'Outro interno', is_internal: true });
    expect(r.status).toBe(422);
  });

  it('o técnico não cadastra cliente: 403 com a permissão nomeada', async () => {
    const r = await http
      .post('/v1/customers')
      .set('authorization', auth(EMAIL_TEC))
      .send({ name: 'Cliente pirata' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('customer.create');
  });
});

describe('ficha do cliente', () => {
  it('a primeira unidade, criada pela rota de locais, aparece na ficha e na contagem', async () => {
    const criada = await http
      .post('/v1/locations')
      .set('authorization', auth(EMAIL_ADMIN))
      .send({
        customer_id: hospital,
        location_type_id: tipos.get('unidade'),
        name: 'Unidade Centro',
      });
    expect(criada.status).toBe(201);

    const r = await http.get(`/v1/customers/${hospital}`).set('authorization', auth(EMAIL_ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.customer.location_count).toBe(1);
    expect(r.body.locations).toHaveLength(1);
    expect(r.body.locations[0]).toMatchObject({
      name: 'Unidade Centro',
      location_type_key: 'unidade',
      parent_id: null,
    });
  });

  it('cliente fora do escopo do vínculo é 404, e não 403', async () => {
    const r = await http.get(`/v1/customers/${hospital}`).set('authorization', auth(EMAIL_TEC));
    expect(r.status).toBe(404);
  });

  it('identificador que não existe é 404', async () => {
    const r = await http.get(`/v1/customers/${newId()}`).set('authorization', auth(EMAIL_ADMIN));
    expect(r.status).toBe(404);
  });
});
