/**
 * Aurora — "possui contrato?" e o perfil do contrato (Básico · Completo · Expert).
 *
 * Confirmado pelo cliente: o tipo de contrato é o PERFIL, e só ele. "Atendimento
 * sob demanda" ou "preventiva programada" não são tipo.
 *
 * O que fica provado aqui:
 *   · cliente sem contrato nasce sem contrato nenhum — nada é criado "para
 *     preencher campo";
 *   · com contrato, o perfil é obrigatório, e o contrato nasce DE VERDADE, em
 *     rascunho, com o perfil — a fonte de verdade é o contrato, não o cliente;
 *   · "possui contrato" é derivado do contrato: encerrado deixa de contar;
 *   · contrato anterior ao perfil continua sem perfil — nada é inferido;
 *   · a lista de contratos traz o perfil e filtra por ele;
 *   · declarar contrato exige `contract.create`.
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
import { withTenant, provisionFactoryRoles, assignRole, createCustomer } from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const ADMIN_USER = newId(),
  ADMIN_MEM = newId();
const CAD_USER = newId(),
  CAD_MEM = newId();
const EMAIL_ADMIN = 'gestora@perfil.test';
const EMAIL_CAD = 'cadastro@perfil.test';
const auth = (email: string) => `Bearer local:${email}:${email}`;

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

interface ClienteResp {
  id: string;
  name: string;
  has_contract: boolean;
  contract_profile: string | null;
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: ADMIN_USER, membershipId: ADMIN_MEM },
    { slug: 'perfil', name: 'Engenharia Perfil', email: EMAIL_ADMIN, userName: 'Gestora' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  let papelCadastro = '';
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, ADMIN_MEM, roles.get('admin')!);
    // Cadastra cliente, mas não contrato: é quem prova a porta lateral fechada.
    const proprio = await provisionFactoryRoles(s, [
      {
        key: 'cadastro_clientes',
        name: 'Cadastro de clientes',
        description: 'Só clientes',
        seatType: 'staff',
        permissions: ['customer.read', 'customer.create'],
      },
    ]);
    papelCadastro = proprio.get('cadastro_clientes')!;
    await createCustomer(s, { name: 'Engenharia Perfil', isInternal: true });
  });
  await seedMember(
    t,
    { organizationId: ORG, userId: CAD_USER, membershipId: CAD_MEM },
    { email: EMAIL_CAD, userName: 'Cadastro' }
  );
  await withTenant(t.db, sysCtx, (s) => assignRole(s, CAD_MEM, papelCadastro));

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

const criar = (corpo: Record<string, unknown>, email = EMAIL_ADMIN) =>
  http.post('/v1/customers').set('authorization', auth(email)).send(corpo);

const contratosDe = async (clienteId: string) =>
  (await http.get('/v1/contracts').query({ customerId: clienteId }).set('authorization', auth(EMAIL_ADMIN)))
    .body.items as Array<Record<string, unknown>>;

const cliente = async (id: string): Promise<ClienteResp> =>
  (await http.get(`/v1/customers/${id}`).set('authorization', auth(EMAIL_ADMIN))).body.customer;

const ids: Record<string, string> = {};

describe('cadastro de cliente: possui contrato?', () => {
  it('NÃO: o cliente nasce sem contrato, e nenhum contrato é criado', async () => {
    const r = await criar({ name: 'Clínica Sem Contrato', has_contract: false });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ has_contract: false, contract_profile: null });
    expect(await contratosDe(r.body.id)).toEqual([]);
    ids.sem = r.body.id;
  });

  it('pergunta omitida vale como NÃO (o diálogo do meio da solicitação)', async () => {
    const r = await criar({ name: 'Clínica Sem Pergunta' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ has_contract: false, contract_profile: null });
    expect(await contratosDe(r.body.id)).toEqual([]);
  });

  it.each([
    ['basic', 'Hospital Básico'],
    ['complete', 'Hospital Completo'],
    ['expert', 'Hospital Expert'],
  ])('SIM + %s: o contrato nasce em rascunho, com o perfil', async (perfil, nome) => {
    const r = await criar({ name: nome, has_contract: true, contract_profile: perfil });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ has_contract: true, contract_profile: perfil });

    const contratos = await contratosDe(r.body.id);
    expect(contratos).toHaveLength(1);
    expect(contratos[0]).toMatchObject({
      profile: perfil,
      status: 'draft',
      // Natureza não é inventada; título não é inventado.
      kind: null,
      title: null,
      customer_name: nome,
    });
    ids[perfil] = r.body.id;
  });

  it('SIM sem tipo é 422 no campo do tipo — e nada é gravado', async () => {
    const r = await criar({ name: 'Hospital Sem Tipo', has_contract: true });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('contract_profile');

    const lista = await http.get('/v1/customers').set('authorization', auth(EMAIL_ADMIN));
    expect(lista.body.items.map((c: ClienteResp) => c.name)).not.toContain('Hospital Sem Tipo');
  });

  it('tipo sem SIM é 422: tipo só vale para quem tem contrato', async () => {
    const r = await criar({ name: 'Hospital Contraditório', contract_profile: 'basic' });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('contract_profile');
  });

  it('"sob demanda" não é tipo de contrato', async () => {
    const r = await criar({
      name: 'Hospital Sob Demanda',
      has_contract: true,
      contract_profile: 'on_demand',
    });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('contract_profile');
  });

  it('declarar contrato exige contract.create; sem contrato, o mesmo vínculo cadastra', async () => {
    const negado = await criar(
      { name: 'Hospital Lateral', has_contract: true, contract_profile: 'basic' },
      EMAIL_CAD
    );
    expect(negado.status).toBe(403);
    expect(JSON.stringify(negado.body)).toContain('contract.create');

    const ok = await criar({ name: 'Hospital Lateral', has_contract: false }, EMAIL_CAD);
    expect(ok.status).toBe(201);
  });

  it('a lista de clientes traz o contrato de cada um', async () => {
    const r = await http.get('/v1/customers').set('authorization', auth(EMAIL_ADMIN));
    const porNome = new Map(r.body.items.map((c: ClienteResp) => [c.name, c]));
    expect(porNome.get('Clínica Sem Contrato')).toMatchObject({
      has_contract: false,
      contract_profile: null,
    });
    expect(porNome.get('Hospital Básico')).toMatchObject({ has_contract: true, contract_profile: 'basic' });
    expect(porNome.get('Hospital Completo')).toMatchObject({
      has_contract: true,
      contract_profile: 'complete',
    });
    expect(porNome.get('Hospital Expert')).toMatchObject({ has_contract: true, contract_profile: 'expert' });
  });
});

describe('contratos: o perfil é o tipo', () => {
  let antigo: string;

  it('contrato sem perfil (anterior à classificação) continua sem perfil — nada é inferido', async () => {
    const r = await http
      .post('/v1/contracts')
      .set('authorization', auth(EMAIL_ADMIN))
      .send({ customerId: ids.sem, kind: 'full_service', startsOn: '2026-01-01' });
    expect(r.status).toBe(201);
    antigo = r.body.id;

    const detalhe = await http.get(`/v1/contracts/${antigo}`).set('authorization', auth(EMAIL_ADMIN));
    expect(detalhe.body.contract).toMatchObject({ kind: 'full_service', profile: null });

    // O cliente passa a TER contrato, com perfil ainda não definido.
    expect(await cliente(ids.sem!)).toMatchObject({ has_contract: true, contract_profile: null });
  });

  it('a rota de contratos aceita o perfil, e recusa o que não é perfil', async () => {
    const ok = await http
      .post('/v1/contracts')
      .set('authorization', auth(EMAIL_ADMIN))
      .send({ customerId: ids.basic, profile: 'expert', startsOn: '2026-02-01' });
    expect(ok.status).toBe(201);
    const det = await http.get(`/v1/contracts/${ok.body.id}`).set('authorization', auth(EMAIL_ADMIN));
    expect(det.body.contract).toMatchObject({ profile: 'expert', kind: null });

    const ruim = await http
      .post('/v1/contracts')
      .set('authorization', auth(EMAIL_ADMIN))
      .send({ customerId: ids.basic, profile: 'premium', startsOn: '2026-02-01' });
    expect(ruim.status).toBe(422);
  });

  it('filtra por perfil — e "none" acha os que ainda não têm', async () => {
    const de = async (profile: string) =>
      (
        await http.get('/v1/contracts').query({ profile }).set('authorization', auth(EMAIL_ADMIN))
      ).body.items.map((c: { profile: string | null }) => c.profile);

    expect(await de('basic')).toEqual(['basic']);
    expect(await de('complete')).toEqual(['complete']);
    expect((await de('expert')).sort()).toEqual(['expert', 'expert']);
    expect(await de('none')).toEqual([null]);

    const invalido = await http
      .get('/v1/contracts')
      .query({ profile: 'sob_demanda' })
      .set('authorization', auth(EMAIL_ADMIN));
    expect(invalido.status).toBe(422);
  });

  it('contrato encerrado deixa de contar: o cliente volta a "sem contrato"', async () => {
    const r = await http
      .post(`/v1/contracts/${antigo}/terminate`)
      .set('authorization', auth(EMAIL_ADMIN))
      .send({ reason: 'cliente encerrou' });
    expect(r.status).toBe(201);
    expect(await cliente(ids.sem!)).toMatchObject({ has_contract: false, contract_profile: null });
  });
});
