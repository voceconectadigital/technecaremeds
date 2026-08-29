/**
 * Aurora — busca global pela HTTP (SPEC v0.2 §27 · EPIC-023).
 *
 * O critério do épico na borda: uma tecla acha o registro sem saber a lista, e
 * o que está fora do escopo de quem procura não aparece — nem no contador.
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
  createWarehouse,
  createItem,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const COORD_USER = newId(),
  COORD_MEM = newId();
const SOLIC_USER = newId(),
  SOLIC_MEM = newId();
const EMAIL_COORD = 'coord@bsc.test';
const EMAIL_SOLIC = 'solicitante@bsc.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let ativo: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: COORD_USER, membershipId: COORD_MEM },
    { slug: 'bsc', name: 'Prestadora', email: EMAIL_COORD, userName: 'Coordenadora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: SOLIC_USER, membershipId: SOLIC_MEM },
    { email: EMAIL_SOLIC, userName: 'Solicitante' }
  );

  const ctx = buildContext({
    organizationId: ORG,
    actorId: COORD_USER,
    membershipId: COORD_MEM,
    requestId: 'setup',
    permissions: PERMISSION_KEYS,
  });

  await withTenant(t.db, ctx, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, COORD_MEM, papeis.get('coordinator')!);
    await assignRole(s, SOLIC_MEM, papeis.get('requester')!);

    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    const cliente = await createCustomer(s, { name: 'Hospital Santa Clara', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador pulmonar Servo-i',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: unidade,
      tag: 'VENT-01',
      assetNumber: '7737',
    });

    const natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: 'Alarme no ventilador 7737',
      locationId: unidade,
      assetId: ativo,
    });

    await createWarehouse(s, { name: 'Central', kind: 'central' });
    await createItem(s, { sku: 'FLT-7737', name: 'Filtro bacteriológico' });
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

describe('uma tecla acha o registro', () => {
  it('o patrimônio traz o ativo em primeiro, com os rótulos para agrupar', async () => {
    const r = await http.get('/v1/search?q=7737').set(auth(EMAIL_COORD)).expect(200);
    expect(r.body.hits[0].scope).toBe('asset');
    expect(r.body.hits[0].matchKind).toBe('identifier_exact');
    expect(r.body.scopeLabels.asset).toBe('Ativos');
  });

  it('a TAG acha o mesmo ativo', async () => {
    const r = await http.get('/v1/search?q=VENT-01').set(auth(EMAIL_COORD)).expect(200);
    expect(r.body.hits[0].id).toBe(ativo);
  });

  it('">" devolve a paleta de comandos', async () => {
    const r = await http.get('/v1/search?q=%3Eagenda').set(auth(EMAIL_COORD)).expect(200);
    expect(r.body.commandMode).toBe(true);
    expect(r.body.commands.map((c: { key: string }) => c.key)).toContain('go_schedule');
  });

  it('termo curto demais é recusado', async () => {
    const r = await http.get('/v1/search?q=a').set(auth(EMAIL_COORD)).expect(422);
    expect(r.body.message).toMatch(/ao menos 2 caracteres/);
  });

  it('sem termo é recusado', async () => {
    await http.get('/v1/search').set(auth(EMAIL_COORD)).expect(422);
  });

  it('termo longo demais é recusado antes de consultar', async () => {
    await http
      .get(`/v1/search?q=${'x'.repeat(200)}`)
      .set(auth(EMAIL_COORD))
      .expect(422);
  });
});

describe('o escopo corta antes da exibição', () => {
  it('quem não lê estoque não recebe item de estoque, nem no contador', async () => {
    // O solicitante não tem `inventory.read`. O item FLT-7737 casa com o termo,
    // e para ele simplesmente não existe — o corte é na consulta, não na tela.
    const coord = await http.get('/v1/search?q=7737').set(auth(EMAIL_COORD)).expect(200);
    const solicitante = await http.get('/v1/search?q=7737').set(auth(EMAIL_SOLIC)).expect(200);

    expect(coord.body.hits.some((h: { scope: string }) => h.scope === 'inventory_item')).toBe(true);
    expect(solicitante.body.hits.some((h: { scope: string }) => h.scope === 'inventory_item')).toBe(false);
    // E o que ele PODE ler continua vindo: o corte é por escopo, não por termo.
    expect(solicitante.body.hits.some((h: { scope: string }) => h.scope === 'asset')).toBe(true);
  });

  it('a paleta só oferece o que a pessoa pode executar', async () => {
    const solicitante = await http.get('/v1/search?q=%3E').set(auth(EMAIL_SOLIC)).expect(200);
    const chaves = solicitante.body.commands.map((c: { key: string }) => c.key);
    expect(chaves).not.toContain('new_work_order');
    expect(chaves).toContain('toggle_theme');
  });
});
