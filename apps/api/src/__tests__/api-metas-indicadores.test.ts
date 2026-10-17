/**
 * Aurora — metas configuráveis dos indicadores (relatórios, Fase 1 — 17/10/2026).
 *
 *   · meta por organização, com override por cliente e por contrato;
 *   · vigência (futura, expirada, no período do relatório);
 *   · ausência de meta: "SEM META CONFIGURADA", nunca zero;
 *   · gestor configura; operador só lê; solicitante não alcança;
 *   · recorte por cliente do vínculo e isolamento entre organizações.
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
  createContract,
  createLocation,
  createWorkOrder,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { indicatorTargetsCreate, indicatorTargetsList, reportsGenerate } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG = newId();
const ORG_B = newId();
const GESTORA = 'gestora@metas.test';
const RESTRITA = 'restrita@metas.test';
const OPERADOR = 'operador@metas.test';
const SOLICITANTE = 'sol@metas.test';
const ADMIN_B = 'admin@metas-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const DE = new Date(Date.now() - 30 * 86_400_000).toISOString();
const ATE = new Date(Date.now() + 86_400_000).toISOString();

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospitalA: string, hospitalB: string;
let contratoA: string, contratoB: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, { slug: 'metas', name: 'Prestadora', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'metas-b', name: 'B', email: ADMIN_B, userName: 'B' });
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, ids.membershipId, base.roles.get('manager')!);
      hospitalA = await createCustomer(s, { name: 'Hospital A' });
      hospitalB = await createCustomer(s, { name: 'Hospital B' });
      contratoA = await createContract(s, {
        customerId: hospitalA,
        kind: 'full_service',
        startsOn: '2026-01-01',
      });
      contratoB = await createContract(s, {
        customerId: hospitalB,
        kind: 'full_service',
        startsOn: '2026-01-01',
      });
      const sedeA = await createLocation(s, {
        customerId: hospitalA,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'A',
      });
      const [corretiva] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
      );
      for (let i = 0; i < 4; i++) {
        await createWorkOrder(s, {
          customerId: hospitalA,
          locationId: sedeA,
          workOrderTypeId: corretiva!.id,
          title: `OS A${i}`,
        });
      }
    }
  );
  const memR = newId();
  const memO = newId();
  const memS = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memR },
    { email: RESTRITA, userName: 'Restrita', customerIds: [hospitalA] }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memO },
    { email: OPERADOR, userName: 'Operador' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memS },
    { email: SOLICITANTE, userName: 'Sol', seatType: 'portal', customerIds: [hospitalA] }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memR, base.roles.get('manager')!);
      await assignRole(s, memO, base.roles.get('operator')!);
      await assignRole(s, memS, base.roles.get('requester')!);
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

const meta = (quem: string, body: Record<string, unknown>) =>
  http.post('/v1/indicator-targets').set(auth(quem)).send(body);

const gerar = (quem: string, body: Record<string, unknown>, pdf = false) =>
  http
    .post(`/v1/reports/generate${pdf ? '?format=pdf' : ''}`)
    .set(auth(quem))
    .send({ from: DE, to: ATE, ...body });

const secao = (r: { body: { sections: { key: string }[] } }, key: string) =>
  r.body.sections.find((x) => x.key === key) as Record<string, any>;

const SLA = { indicator_key: 'sla_compliance', direction: 'HIGHER_IS_BETTER', valid_from: '2026-01-01' };

describe('sem meta configurada', () => {
  it('"SEM META CONFIGURADA" — nunca zero; indicador informativo não tem rótulo de meta', async () => {
    const r = await gerar(GESTORA, { tier: 'advanced' });
    const sla = secao(r, 'sla_compliance');
    expect(sla.target).toBeNull();
    expect(sla.target_label).toBe('SEM META CONFIGURADA');
    expect(sla.target_evaluation).toBe('no_target');
    const abertos = secao(r, 'work_orders_opened');
    expect(abertos.target).toBeNull();
    expect(abertos.target_label).toBeNull();
    expect(abertos.target_evaluation).toBe('informational');
    const lista = await http.get('/v1/indicator-targets').set(auth(GESTORA));
    expect(lista.status).toBe(200);
    expect(lista.body.items).toEqual([]);
  });
});

describe('quem configura e quem só lê', () => {
  it('gestor cria a meta da organização (201, contrato válido); o catálogo dá a unidade', async () => {
    const r = await meta(GESTORA, { ...SLA, value: 90 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(indicatorTargetsCreate.response.safeParse(r.body).success).toBe(true);
    expect(r.body).toMatchObject({ scope: 'organization', unit: 'percent', timeline: 'active', value: 90 });
  });

  it('operador lê as metas, mas não configura (403)', async () => {
    const lista = await http.get('/v1/indicator-targets').set(auth(OPERADOR));
    expect(lista.status).toBe(200);
    expect(indicatorTargetsList.response.safeParse(lista.body).success).toBe(true);
    expect(lista.body.items).toHaveLength(1);
    expect((await meta(OPERADOR, { ...SLA, customer_id: hospitalA, value: 95 })).status).toBe(403);
  });

  it('solicitante não alcança nem a leitura (403)', async () => {
    expect((await http.get('/v1/indicator-targets').set(auth(SOLICITANTE))).status).toBe(403);
    expect((await meta(SOLICITANTE, { ...SLA, value: 50 })).status).toBe(403);
  });

  it('sem credencial → 401', async () => {
    expect((await http.post('/v1/indicator-targets').send({ ...SLA, value: 1 })).status).toBe(401);
  });

  it('vínculo restrito ao Hospital A: configura a de A, não a da organização, nem a de B', async () => {
    const org = await meta(RESTRITA, { ...SLA, indicator_key: 'service_rating', value: 4 });
    expect(org.status).toBe(403);
    const fora = await meta(RESTRITA, { ...SLA, customer_id: hospitalB, value: 95 });
    expect(fora.status).toBe(404);
    const ok = await meta(RESTRITA, { ...SLA, customer_id: hospitalA, value: 95 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.scope).toBe('customer');
  });
});

describe('validação contra o catálogo', () => {
  it('indicador informativo, sentido contrário, unidade errada, inexistente e campo extra → 422', async () => {
    const ruim = async (b: Record<string, unknown>) => (await meta(GESTORA, b)).status;
    expect(await ruim({ ...SLA, indicator_key: 'work_orders_opened', value: 10 })).toBe(422);
    expect(await ruim({ ...SLA, direction: 'LOWER_IS_BETTER', value: 90 })).toBe(422);
    expect(await ruim({ ...SLA, unit: 'minutes', value: 90 })).toBe(422);
    expect(await ruim({ ...SLA, indicator_key: 'inventado', value: 90 })).toBe(422);
    expect(await ruim({ ...SLA, value: -5 })).toBe(422);
    expect(await ruim({ ...SLA, valid_from: '2026-05-01', valid_to: '2026-04-01', value: 90 })).toBe(422);
    expect(await ruim({ ...SLA, valid_from: '01/05/2026', value: 90 })).toBe(422);
    expect(await ruim({ ...SLA, value: 90, organization_id: ORG_B })).toBe(422);
  });

  it('vigência sobreposta no mesmo escopo → 409', async () => {
    const r = await meta(GESTORA, { ...SLA, valid_from: '2026-06-01', value: 91 });
    expect(r.status).toBe(409);
  });

  it('contrato de outro cliente → 404/422; contrato sem cliente → 422', async () => {
    const outro = await meta(GESTORA, { ...SLA, customer_id: hospitalA, contract_id: contratoB, value: 99 });
    expect([404, 422]).toContain(outro.status);
    const semCliente = await meta(GESTORA, { ...SLA, contract_id: contratoA, value: 99 });
    expect(semCliente.status).toBe(422);
  });
});

describe('precedência no relatório: contrato → cliente → organização', () => {
  it('organização: vale quando o relatório não escolhe cliente', async () => {
    const r = await gerar(GESTORA, { tier: 'advanced', indicators: ['sla_compliance'] });
    expect(reportsGenerate.response.safeParse(r.body).success).toBe(true);
    expect(secao(r, 'sla_compliance').target).toMatchObject({ scope: 'organization', value: 90 });
  });

  it('override por cliente: o Hospital A tem 95; o Hospital B continua com a da organização', async () => {
    const a = await gerar(GESTORA, {
      tier: 'advanced',
      indicators: ['sla_compliance'],
      customer_id: hospitalA,
    });
    expect(secao(a, 'sla_compliance').target).toMatchObject({ scope: 'customer', value: 95 });
    const b = await gerar(GESTORA, {
      tier: 'advanced',
      indicators: ['sla_compliance'],
      customer_id: hospitalB,
    });
    expect(secao(b, 'sla_compliance').target).toMatchObject({ scope: 'organization', value: 90 });
  });

  it('override por contrato vence o cliente; o contrato traz o cliente dele', async () => {
    const c = await meta(GESTORA, { ...SLA, customer_id: hospitalA, contract_id: contratoA, value: 98 });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.scope).toBe('contract');
    const r = await gerar(GESTORA, {
      tier: 'advanced',
      indicators: ['sla_compliance'],
      contract_id: contratoA,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(secao(r, 'sla_compliance').target).toMatchObject({ scope: 'contract', value: 98 });
    expect(r.body.filters.customer).toBe('Hospital A');
    expect(r.body.filters.contract).toMatch(/^CT-/);
    // só o cliente, sem o contrato: volta para a do cliente
    const cli = await gerar(GESTORA, {
      tier: 'advanced',
      indicators: ['sla_compliance'],
      customer_id: hospitalA,
    });
    expect(secao(cli, 'sla_compliance').target).toMatchObject({ scope: 'customer', value: 95 });
  });

  it('contrato de outro cliente que o filtro → 422; contrato fora do escopo do vínculo → 404', async () => {
    const dif = await gerar(GESTORA, {
      tier: 'advanced',
      indicators: ['sla_compliance'],
      customer_id: hospitalA,
      contract_id: contratoB,
    });
    expect(dif.status).toBe(422);
    const fora = await gerar(RESTRITA, {
      tier: 'advanced',
      indicators: ['sla_compliance'],
      contract_id: contratoB,
    });
    expect(fora.status).toBe(404);
    const inexistente = await gerar(GESTORA, {
      tier: 'advanced',
      indicators: ['sla_compliance'],
      contract_id: newId(),
    });
    expect(inexistente.status).toBe(404);
  });

  it('o vínculo restrito ao Hospital A enxerga a meta da organização e a de A', async () => {
    // PF-50 (pente-fino 17/10/2026): restrito a UM cliente e sem escolher
    // cliente, os números já são só do Hospital A — então a régua é a meta de
    // A, e não a da organização inteira.
    const r = await gerar(RESTRITA, { tier: 'advanced', indicators: ['sla_compliance'] });
    expect(secao(r, 'sla_compliance').target).toMatchObject({ scope: 'customer', value: 95 });
    // A meta da organização continua visível a ele (é a que vale sem meta de A).
    const lista = await http.get('/v1/indicator-targets?indicator_key=sla_compliance').set(auth(RESTRITA));
    expect(lista.body.items.some((x: { scope: string; value: number }) => x.scope === 'organization')).toBe(
      true
    );
    const a = await gerar(RESTRITA, {
      tier: 'advanced',
      indicators: ['sla_compliance'],
      customer_id: hospitalA,
    });
    expect(secao(a, 'sla_compliance').target).toMatchObject({ scope: 'customer', value: 95 });
  });

  it('a lista do vínculo restrito traz organização, cliente A e contrato de A — e nada de B', async () => {
    const lista = await http.get('/v1/indicator-targets?indicator_key=sla_compliance').set(auth(RESTRITA));
    const escopos = lista.body.items.map((x: { scope: string }) => x.scope).sort();
    expect(escopos).toEqual(['contract', 'customer', 'organization']);
    // o contrato é de A: visível; nenhuma meta de B existe aqui
    expect(lista.body.items.every((x: { customer_id: string | null }) => x.customer_id !== hospitalB)).toBe(
      true
    );
  });
});

describe('vigência', () => {
  it('meta expirada vale para o período em que estava em vigor, e não para o atual; a futura espera', async () => {
    const velha = await meta(GESTORA, {
      indicator_key: 'mttr',
      direction: 'LOWER_IS_BETTER',
      valid_from: '2020-01-01',
      valid_to: '2020-12-31',
      value: 4000,
    });
    expect(velha.status).toBe(201);
    expect(velha.body.timeline).toBe('expired');
    const atual = await meta(GESTORA, {
      indicator_key: 'mttr',
      direction: 'LOWER_IS_BETTER',
      valid_from: '2021-01-01',
      valid_to: '2098-12-31',
      value: 3000,
    });
    expect(atual.body.timeline).toBe('active');
    const futura = await meta(GESTORA, {
      indicator_key: 'mttr',
      direction: 'LOWER_IS_BETTER',
      valid_from: '2099-01-01',
      value: 2500,
    });
    expect(futura.body.timeline).toBe('future');

    const hoje = await gerar(GESTORA, { tier: 'basic', indicators: ['mttr'] });
    expect(secao(hoje, 'mttr').target).toMatchObject({ value: 3000, valid_from: '2021-01-01' });
    const passado = await gerar(GESTORA, {
      tier: 'basic',
      indicators: ['mttr'],
      from: '2020-03-01T00:00:00.000Z',
      to: '2020-03-31T23:59:59.000Z',
    });
    expect(secao(passado, 'mttr').target).toMatchObject({ value: 4000 });
    expect(passado.body.filters.target_day).toBe('2020-03-31');
    // período sem nenhuma meta em vigor (antes de 2020): sem meta
    const antes = await gerar(GESTORA, {
      tier: 'basic',
      indicators: ['mttr'],
      from: '2019-03-01T00:00:00.000Z',
      to: '2019-03-31T23:59:59.000Z',
    });
    expect(secao(antes, 'mttr').target_label).toBe('SEM META CONFIGURADA');
  });

  it('meta cumprida / não cumprida, no sentido da meta', async () => {
    const m = await meta(GESTORA, {
      indicator_key: 'backlog',
      direction: 'LOWER_IS_BETTER',
      valid_from: '2026-01-01',
      value: 3,
    });
    expect(m.status).toBe(201);
    const r = await gerar(GESTORA, { tier: 'advanced', indicators: ['backlog'] });
    const b = secao(r, 'backlog');
    expect(b.value).toBe(4); // 4 OS abertas no cenário de teste do Painel
    expect(b.target_evaluation).toBe('not_met');
    await http.patch(`/v1/indicator-targets/${m.body.id}`).set(auth(GESTORA)).send({ value: 10 });
    const r2 = await gerar(GESTORA, { tier: 'advanced', indicators: ['backlog'] });
    expect(secao(r2, 'backlog').target_evaluation).toBe('met');
  });
});

describe('alterar e arquivar', () => {
  it('PATCH valor/observação; arquivar tira da lista e do relatório', async () => {
    const m = await meta(GESTORA, {
      indicator_key: 'service_rating',
      direction: 'HIGHER_IS_BETTER',
      valid_from: '2026-01-01',
      value: 4.5,
    });
    expect(m.body.unit).toBe('score');
    const p = await http
      .patch(`/v1/indicator-targets/${m.body.id}`)
      .set(auth(GESTORA))
      .send({ value: 4.7, note: 'meta do contrato 2026' });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ value: 4.7, note: 'meta do contrato 2026' });
    const naoAltera = await http
      .patch(`/v1/indicator-targets/${m.body.id}`)
      .set(auth(GESTORA))
      .send({ indicator_key: 'backlog' });
    expect(naoAltera.status).toBe(422);
    const r = await gerar(GESTORA, { tier: 'basic', indicators: ['service_rating'] });
    expect(secao(r, 'service_rating').target.value).toBe(4.7);
    expect(secao(r, 'service_rating').target_evaluation).toBe('no_value');

    expect((await http.delete(`/v1/indicator-targets/${m.body.id}`).set(auth(OPERADOR))).status).toBe(403);
    const del = await http.delete(`/v1/indicator-targets/${m.body.id}`).set(auth(GESTORA));
    expect(del.status).toBe(200);
    const depois = await gerar(GESTORA, { tier: 'basic', indicators: ['service_rating'] });
    expect(secao(depois, 'service_rating').target_label).toBe('SEM META CONFIGURADA');
    const linha = await t.raw(`SELECT deleted_at FROM aurora.indicator_targets WHERE id = $1`, [m.body.id]);
    expect(linha[0]!.deleted_at).not.toBeNull();
  });

  it('o vínculo restrito não altera nem arquiva a meta de outro escopo (404)', async () => {
    const org = (
      await http.get('/v1/indicator-targets?indicator_key=sla_compliance').set(auth(GESTORA))
    ).body.items.find((x: { scope: string }) => x.scope === 'organization');
    expect(
      (await http.patch(`/v1/indicator-targets/${org.id}`).set(auth(RESTRITA)).send({ value: 1 })).status
    ).toBe(403);
    expect((await http.delete(`/v1/indicator-targets/${org.id}`).set(auth(RESTRITA))).status).toBe(403);
  });
});

describe('isolamento entre organizações', () => {
  it('a organização B não vê, não altera e não herda as metas de A', async () => {
    const lista = await http.get('/v1/indicator-targets').set(auth(ADMIN_B));
    expect(lista.status).toBe(200);
    expect(lista.body.items).toEqual([]);

    const alvo = (await http.get('/v1/indicator-targets').set(auth(GESTORA))).body.items[0];
    expect(
      (await http.patch(`/v1/indicator-targets/${alvo.id}`).set(auth(ADMIN_B)).send({ value: 1 })).status
    ).toBe(404);
    expect((await http.delete(`/v1/indicator-targets/${alvo.id}`).set(auth(ADMIN_B))).status).toBe(404);

    const rb = await gerar(ADMIN_B, { tier: 'advanced', indicators: ['sla_compliance'] });
    expect(secao(rb, 'sla_compliance').target).toBeNull();
    expect(secao(rb, 'sla_compliance').target_label).toBe('SEM META CONFIGURADA');

    // B configura a sua; a de A não muda
    const mb = await meta(ADMIN_B, { ...SLA, value: 70 });
    expect(mb.status).toBe(201);
    const ra = await gerar(GESTORA, { tier: 'advanced', indicators: ['sla_compliance'] });
    expect(secao(ra, 'sla_compliance').target.value).toBe(90);
    // e B não consegue apontar para cliente ou contrato de A
    expect(
      (await meta(ADMIN_B, { ...SLA, customer_id: hospitalA, value: 70 })).status
    ).toBeGreaterThanOrEqual(404);
    const rc = await gerar(ADMIN_B, {
      tier: 'advanced',
      indicators: ['sla_compliance'],
      contract_id: contratoA,
    });
    expect(rc.status).toBe(404);
  });
});

describe('PDF provisório', () => {
  it('mostra a meta, o rótulo de sem meta e marca o provisório', async () => {
    // obsolescence é PENDING_DEFINITION: pedir é 422, e não gera PDF
    const recusado = await gerar(GESTORA, { tier: 'advanced', indicators: ['obsolescence'] }, true);
    expect(recusado.status).toBe(422);
    const ok = await gerar(GESTORA, { tier: 'advanced', indicators: ['sla_compliance', 'mtbf'] }, true)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
    expect(ok.status).toBe(200);
    const corpo = (ok.body as Buffer).toString('latin1');
    expect(corpo).toContain('AGUARDANDO MODELO PDF OFICIAL');
    expect(corpo).toContain('SEM META CONFIGURADA'); // mtbf não tem meta
    expect(corpo).toContain('PROVIS'); // mtbf é PROVISIONAL
  });
});
