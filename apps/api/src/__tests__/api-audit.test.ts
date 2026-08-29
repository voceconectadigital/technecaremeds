/**
 * Aurora — trilha de auditoria pela HTTP (SPEC v0.2 §22 · EPIC-022).
 *
 * O critério do épico na borda: a história do próprio registro fica na tela
 * dele, com a permissão de ler o registro — e vasculhar a trilha inteira da
 * organização é perícia, com permissão própria.
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
  transitionWorkOrder,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const GESTOR_USER = newId(),
  GESTOR_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const EMAIL_GESTOR = 'gestor@adt.test';
const EMAIL_TEC = 'tec@adt.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let os: string;
let ativo: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: GESTOR_USER, membershipId: GESTOR_MEM },
    { slug: 'adt', name: 'Prestadora', email: EMAIL_GESTOR, userName: 'Gestor' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );

  const ctx = buildContext({
    organizationId: ORG,
    actorId: GESTOR_USER,
    membershipId: GESTOR_MEM,
    requestId: 'setup-auditoria',
    permissions: PERMISSION_KEYS,
  });

  await withTenant(t.db, ctx, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    // O gestor de manutenção tem `audit.read`; o técnico não.
    await assignRole(s, GESTOR_MEM, papeis.get('maintenance_manager')!);
    await assignRole(s, TEC_MEM, papeis.get('technician')!);

    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    const cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: unidade,
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
      locationId: unidade,
      assetId: ativo,
    });
    os = w.id;
    await transitionWorkOrder(s, os, 'in_progress');
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

describe('a trilha global é perícia', () => {
  it('quem não tem a permissão não a abre', async () => {
    await http.get('/v1/audit').set(auth(EMAIL_TEC)).expect(403);
  });

  it('quem tem recebe quem, o quê e o diff', async () => {
    const r = await http
      .get(`/v1/audit?entityType=work_orders&entityId=${os}`)
      .set(auth(EMAIL_GESTOR))
      .expect(200);

    expect(r.body.items.length).toBeGreaterThan(1);
    expect(r.body.items[0].actor_name).toBeTruthy();
    expect(r.body.items.at(-1).action).toBe('create');
  });

  it('ação desconhecida é recusada listando as válidas', async () => {
    const r = await http.get('/v1/audit?action=explodir').set(auth(EMAIL_GESTOR)).expect(422);
    expect(r.body.message).toMatch(/create, update, delete, restore/);
  });

  it('ator com identificador inválido é recusado', async () => {
    await http.get('/v1/audit?actorUserId=nao-e-uuid').set(auth(EMAIL_GESTOR)).expect(422);
  });

  it('data inválida é recusada', async () => {
    await http.get('/v1/audit?from=ontem').set(auth(EMAIL_GESTOR)).expect(422);
  });

  it('a requisição amarra tudo o que uma chamada mudou', async () => {
    const r = await http.get('/v1/audit/by-request/setup-auditoria').set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.items.length).toBeGreaterThan(3);
    expect(new Set(r.body.items.map((i: { entity_type: string }) => i.entity_type)).size).toBeGreaterThan(1);
  });
});

describe('a linha do tempo fica na tela do registro', () => {
  it('o técnico vê a história da OS que ele executa, sem permissão de perícia', async () => {
    const r = await http.get(`/v1/audit/timeline/work_orders/${os}`).set(auth(EMAIL_TEC)).expect(200);

    const especies = new Set(r.body.items.map((i: { kind: string }) => i.kind));
    expect(especies.has('change')).toBe(true);
    expect(especies.has('event')).toBe(true);
  });

  it('a mudança traz o diff e o fato traz o conteúdo', async () => {
    const r = await http.get(`/v1/audit/timeline/work_orders/${os}`).set(auth(EMAIL_GESTOR)).expect(200);

    const mudanca = r.body.items.find((i: { kind: string }) => i.kind === 'change');
    const fato = r.body.items.find((i: { kind: string }) => i.kind === 'event');
    expect(mudanca.changes).toBeTruthy();
    expect(mudanca.payload).toBeNull();
    expect(fato.payload).toBeTruthy();
    expect(fato.changes).toBeNull();
  });

  it('entidade fora da lista fechada é recusada, listando as disponíveis', async () => {
    const r = await http.get(`/v1/audit/timeline/users/${GESTOR_USER}`).set(auth(EMAIL_GESTOR)).expect(422);
    expect(r.body.message).toMatch(/disponíveis: work_orders/);
  });

  it('sem a permissão de ler o registro, é 403 e não 422', async () => {
    // O técnico não tem `contract.read`: o pedido está bem formado, quem pede é
    // que não pode.
    await http.get(`/v1/audit/timeline/contracts/${newId()}`).set(auth(EMAIL_TEC)).expect(403);
  });

  it('a linha do tempo do ativo também responde', async () => {
    const r = await http.get(`/v1/audit/timeline/assets/${ativo}`).set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.items.length).toBeGreaterThan(0);
  });
});
