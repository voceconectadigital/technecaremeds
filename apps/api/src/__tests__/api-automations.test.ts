/**
 * Aurora — automações pela HTTP (SPEC v0.2 §24 · EPIC-024).
 *
 * O critério do épico na borda: não há atalho para ativar sem simular, e o log
 * de execução é consultável — sem ele, automação é caixa-preta.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
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
  provisionWorkOrderStates,
  createCustomer,
  createLocation,
  createCatalogItem,
  createAssetCategory,
  createAsset,
  createWorkOrder,
  runAutomations,
  emitEvent,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const ADMIN_USER = newId(),
  ADMIN_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const EMAIL_ADMIN = 'admin@aut.test';
const EMAIL_TEC = 'tec@aut.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let os: string;
let ctx: ReturnType<typeof buildContext>;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: ADMIN_USER, membershipId: ADMIN_MEM },
    { slug: 'aut', name: 'Prestadora', email: EMAIL_ADMIN, userName: 'Administradora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );

  ctx = buildContext({
    organizationId: ORG,
    actorId: ADMIN_USER,
    membershipId: ADMIN_MEM,
    requestId: 'setup',
    permissions: PERMISSION_KEYS,
  });

  await withTenant(t.db, ctx, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, ADMIN_MEM, papeis.get('admin')!);
    await assignRole(s, TEC_MEM, papeis.get('technician')!);

    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    const cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const local = await createLocation(s, {
      customerId: cliente,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    const ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: local,
    });
    const natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });

    const w = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: 'Reparo',
      locationId: local,
      assetId: ativo,
      assigneeMembershipId: TEC_MEM,
    });
    os = w.id;

    for (let i = 0; i < 2; i++) {
      await emitEvent(s, {
        type: 'sla.breached',
        aggregateId: os,
        payload: { priority: 'emergency' },
      });
    }
  });

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

let regra: string;

describe('vocabulário e cadastro', () => {
  it('a tela recebe exatamente o que o motor faz', async () => {
    const r = await http.get('/v1/automations/vocabulary').set(auth(EMAIL_ADMIN)).expect(200);
    expect(r.body.actions.map((a: { kind: string }) => a.kind)).toContain('add_comment');
    expect(r.body.operators).toContain('in');
    expect(r.body.triggers).toContain('condition_watch');
  });

  it('o técnico não monta automação', async () => {
    await http.get('/v1/automations/vocabulary').set(auth(EMAIL_TEC)).expect(403);
    await http.post('/v1/automations').set(auth(EMAIL_TEC)).send({}).expect(403);
  });

  it('cria a regra em rascunho', async () => {
    const r = await http
      .post('/v1/automations')
      .set(auth(EMAIL_ADMIN))
      .send({
        name: 'Comentar em emergência estourada',
        triggerEvent: 'sla.breached',
        conditions: { all: [{ field: 'priority', op: 'eq', value: 'emergency' }] },
        actions: [{ kind: 'add_comment', params: { text: 'Emergência: priorizar' } }],
      })
      .expect(201);
    regra = r.body.id;

    const lista = await http.get('/v1/automations').set(auth(EMAIL_ADMIN)).expect(200);
    const minha = lista.body.items.find((x: { id: string }) => x.id === regra);
    expect(minha.state).toBe('draft');
    expect(Number(minha.action_count)).toBe(1);
  });

  it('regra sem nome é recusada', async () => {
    await http.post('/v1/automations').set(auth(EMAIL_ADMIN)).send({ actions: [] }).expect(422);
  });

  it('condição torta é recusada com o caminho', async () => {
    const r = await http
      .post('/v1/automations')
      .set(auth(EMAIL_ADMIN))
      .send({
        name: 'Torta',
        triggerEvent: 'sla.breached',
        conditions: { all: [{ field: 'x', op: 'in', value: 'nao_e_lista' }] },
        actions: [{ kind: 'add_comment', params: { text: 'oi' } }],
      })
      .expect(422);
    expect(r.body.message).toMatch(/exige uma lista/);
  });
});

describe('não há atalho para ativar', () => {
  it('ativar sem simular é recusado', async () => {
    const r = await http.post(`/v1/automations/${regra}/activate`).set(auth(EMAIL_ADMIN)).expect(409);
    expect(r.body.message).toMatch(/simule a regra antes de ativar/);
  });

  it('a simulação devolve a frase com o número', async () => {
    const r = await http
      .post(`/v1/automations/${regra}/simulate`)
      .set(auth(EMAIL_ADMIN))
      .send({})
      .expect(201);
    expect(r.body.matched).toBe(2);
    expect(r.body.summary).toMatch(/teria disparado 2 vez\(es\) nos últimos 30 dias/);
  });

  it('janela de simulação fora da faixa é recusada', async () => {
    await http
      .post(`/v1/automations/${regra}/simulate`)
      .set(auth(EMAIL_ADMIN))
      .send({ days: 900 })
      .expect(422);
  });

  it('depois de simular, ativa e pausa', async () => {
    expect(
      (await http.post(`/v1/automations/${regra}/activate`).set(auth(EMAIL_ADMIN)).expect(201)).body.state
    ).toBe('active');
    expect(
      (await http.post(`/v1/automations/${regra}/pause`).set(auth(EMAIL_ADMIN)).expect(201)).body.state
    ).toBe('paused');
    await http.post(`/v1/automations/${regra}/activate`).set(auth(EMAIL_ADMIN)).expect(201);
  });
});

describe('o log impede a caixa-preta', () => {
  it('cada corrida fica registrada com o resultado', async () => {
    await withTenant(t.db, ctx, (s) =>
      runAutomations(s, {
        type: 'sla.breached',
        aggregateType: 'work_order',
        aggregateId: os,
        payload: { priority: 'emergency' },
      })
    );

    const r = await http.get(`/v1/automations/${regra}/runs`).set(auth(EMAIL_ADMIN)).expect(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    expect(r.body.items[0].outcome).toBe('matched');
    expect(r.body.items[0].actions_run[0].kind).toBe('add_comment');
  });

  it('a corrida que não casa também fica registrada', async () => {
    await withTenant(t.db, ctx, (s) =>
      runAutomations(s, {
        type: 'sla.breached',
        aggregateType: 'work_order',
        aggregateId: os,
        payload: { priority: 'low' },
      })
    );

    const r = await http.get(`/v1/automations/${regra}/runs`).set(auth(EMAIL_ADMIN)).expect(200);
    expect(r.body.items[0].outcome).toBe('skipped_conditions');
  });
});
