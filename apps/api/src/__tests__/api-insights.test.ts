/**
 * Aurora — indicadores pela HTTP (SPEC v0.2 §25 · EPIC-021).
 *
 * O critério do épico na borda: nenhum número sai sem a sua definição, e o
 * técnico não enxerga o painel da gestão.
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
const SOLIC_USER = newId(),
  SOLIC_MEM = newId();
const EMAIL_GESTOR = 'gestor@ins.test';
const EMAIL_SOLIC = 'solicitante@ins.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

const DE = new Date(Date.now() - 30 * 86_400_000).toISOString();
const ATE = new Date(Date.now() + 86_400_000).toISOString();
const janela = `from=${DE}&to=${ATE}`;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: GESTOR_USER, membershipId: GESTOR_MEM },
    { slug: 'insapi', name: 'Prestadora', email: EMAIL_GESTOR, userName: 'Gestor' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: SOLIC_USER, membershipId: SOLIC_MEM },
    { email: EMAIL_SOLIC, userName: 'Solicitante' }
  );

  // O contexto de sistema não tem permissão nenhuma, e transição é filtrada
  // por permissão: o preparo precisa de um ator com poderes para percorrer o
  // grafo — o mesmo que a borda exigirá de quem operar de verdade.
  const sysCtx = buildContext({
    organizationId: ORG,
    actorId: GESTOR_USER,
    membershipId: GESTOR_MEM,
    requestId: 'setup',
    permissions: PERMISSION_KEYS,
  });
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, GESTOR_MEM, roles.get('maintenance_manager')!);
    await assignRole(s, SOLIC_MEM, roles.get('requester')!);

    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    const cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    const ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: unidade,
    });
    const corretiva = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });

    for (let i = 0; i < 3; i++) {
      const w = await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: corretiva,
        title: `OS ${i}`,
        locationId: unidade,
        assetId: ativo,
        assigneeMembershipId: GESTOR_MEM,
      });
      if (i < 2) {
        await transitionWorkOrder(s, w.id, 'in_progress');
        await transitionWorkOrder(s, w.id, 'completed', { resolution: 'concluída no teste' });
      }
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

describe('todo número vem com a sua definição', () => {
  it('o catálogo de definições responde sem consultar nada', async () => {
    const r = await http.get('/v1/insights/definitions').set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.items.length).toBeGreaterThanOrEqual(14);
    expect(r.body.items.every((d: { numerator: string }) => d.numerator.length > 10)).toBe(true);
  });

  it('o volume traz contagem, definição, período e filtros', async () => {
    const r = await http.get(`/v1/insights/work-orders/opened?${janela}`).set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.data.count).toBe(3);
    expect(r.body.definition.key).toBe('work_orders_opened');
    expect(r.body.period.from).toBe(DE);
    expect(r.body.filters).toHaveProperty('customerId');
  });

  it('o MTTR traz a amostra e o aviso de comparabilidade', async () => {
    const r = await http.get(`/v1/insights/mttr?${janela}`).set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.data.samples).toBe(2);
    expect(r.body.definition.comparability).toMatch(/não pôde ser confirmada/);
    expect(r.body.coverage.note).toMatch(/calculado sobre/);
  });

  it('o MTTR por fatia do painel soma as MESMAS amostras do indicador', async () => {
    const mttr = await http.get(`/v1/insights/mttr?${janela}`).set(auth(EMAIL_GESTOR)).expect(200);
    const painel = await http.get(`/v1/insights/control-panel?${janela}`).set(auth(EMAIL_GESTOR)).expect(200);
    const fatias = painel.body.series as Array<{ mttrMinutes: number | null; mttrSamples: number }>;
    expect(fatias.reduce((a, p) => a + p.mttrSamples, 0)).toBe(mttr.body.data.samples);
    // Fatia com amostra tem número; sem amostra, nulo — nunca zero inventado.
    for (const p of fatias) {
      if (p.mttrSamples > 0) expect(typeof p.mttrMinutes).toBe('number');
      else expect(p.mttrMinutes).toBeNull();
    }
  });

  it('o backlog vem com as faixas de idade', async () => {
    const r = await http.get('/v1/insights/backlog').set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.data.count).toBe(1);
    expect(r.body.data.buckets['0-7']).toBe(1);
  });

  it('o SLA sem política devolve taxa nula, e não 100 %', async () => {
    const r = await http.get(`/v1/insights/sla?${janela}`).set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.data.rate).toBeNull();
    expect(r.body.coverage.excluded).toBeGreaterThan(0);
  });
});

describe('validação de período', () => {
  it('sem período, os indicadores de série são recusados', async () => {
    const r = await http.get('/v1/insights/mttr').set(auth(EMAIL_GESTOR)).expect(422);
    expect(r.body.message).toMatch(/data ISO/);
  });

  it('período invertido é recusado', async () => {
    const r = await http.get(`/v1/insights/mttr?from=${ATE}&to=${DE}`).set(auth(EMAIL_GESTOR)).expect(422);
    expect(r.body.message).toMatch(/depois de "from"/);
  });

  it('período longo demais é recusado, com o limite dito', async () => {
    const r = await http
      .get(`/v1/insights/mttr?from=2020-01-01T00:00:00Z&to=2025-01-01T00:00:00Z`)
      .set(auth(EMAIL_GESTOR))
      .expect(422);
    expect(r.body.message).toMatch(/400 dias/);
  });

  it('filtro com identificador inválido é recusado', async () => {
    await http.get(`/v1/insights/mttr?${janela}&customerId=nao-e-uuid`).set(auth(EMAIL_GESTOR)).expect(422);
  });
});

describe('permissão', () => {
  it('o solicitante não abre o painel de indicadores', async () => {
    await http.get(`/v1/insights/mttr?${janela}`).set(auth(EMAIL_SOLIC)).expect(403);
    await http.get('/v1/insights/definitions').set(auth(EMAIL_SOLIC)).expect(403);
  });

  it('reconstruir a projeção exige permissão de administração', async () => {
    await http.post('/v1/insights/facts/rebuild').set(auth(EMAIL_SOLIC)).expect(403);
    const r = await http.post('/v1/insights/facts/rebuild').set(auth(EMAIL_GESTOR)).expect(201);
    expect(r.body.rebuilt).toBe(3);
  });
});

describe('as rotas não colidem entre si', () => {
  it('cada indicador tem o seu caminho literal', async () => {
    for (const rota of [
      'work-orders/completed',
      'preventive-vs-corrective',
      'time-by-status',
      'time-by-wait-reason',
      'plan-compliance',
      'productivity',
      'labor-hours',
      'first-response',
      'mtbf',
    ]) {
      await http.get(`/v1/insights/${rota}?${janela}`).set(auth(EMAIL_GESTOR)).expect(200);
    }
  });
});
