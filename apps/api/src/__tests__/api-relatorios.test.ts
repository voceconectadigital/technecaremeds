/**
 * Aurora — relatórios BASIC / ADVANCED / EXPERT: fundação (reunião 16/10/2026, Fase 9).
 *
 *   · o catálogo diz a situação de cada indicador; layout AGUARDANDO MODELO PDF OFICIAL;
 *   · os números do relatório são os MESMOS do Painel (mesma função, mesmo filtro);
 *   · indicador sem fórmula/definição sai sem valor, com a situação — nunca inventado;
 *   · PDF provisório com a faixa; escopo e tenant respeitados.
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
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { reportsCatalog, reportsGenerate } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG = newId();
const ORG_B = newId();
const GESTORA = 'gestora@rel.test';
const RESTRITA = 'restrita@rel.test';
const SOLICITANTE = 'sol@rel.test';
const ADMIN_B = 'admin@rel-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const DE = new Date(Date.now() - 30 * 86_400_000).toISOString();
const ATE = new Date(Date.now() + 86_400_000).toISOString();

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospitalA: string, hospitalB: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, { slug: 'rel', name: 'Prestadora', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'rel-b', name: 'B', email: ADMIN_B, userName: 'B' });
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, ids.membershipId, base.roles.get('manager')!);
      hospitalA = await createCustomer(s, { name: 'Hospital A' });
      hospitalB = await createCustomer(s, { name: 'Hospital B' });
      const sedeA = await createLocation(s, {
        customerId: hospitalA,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'A',
      });
      const sedeB = await createLocation(s, {
        customerId: hospitalB,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'B',
      });
      const [corretiva] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
      );
      for (let i = 0; i < 3; i++) {
        await createWorkOrder(s, {
          customerId: hospitalA,
          locationId: sedeA,
          workOrderTypeId: corretiva!.id,
          title: `OS A${i}`,
        });
      }
      await createWorkOrder(s, {
        customerId: hospitalB,
        locationId: sedeB,
        workOrderTypeId: corretiva!.id,
        title: 'OS B',
      });
    }
  );
  const memR = newId();
  const memS = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memR },
    {
      email: RESTRITA,
      userName: 'Restrita',
      customerIds: [hospitalA],
    }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memS },
    {
      email: SOLICITANTE,
      userName: 'Sol',
      seatType: 'portal',
      customerIds: [hospitalA],
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memR, base.roles.get('manager')!);
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

const gerar = (quem: string, body: Record<string, unknown>, pdf = false) =>
  http
    .post(`/v1/reports/generate${pdf ? '?format=pdf' : ''}`)
    .set(auth(quem))
    .send({ from: DE, to: ATE, ...body });

describe('catálogo', () => {
  it('três modelos; layout aguardando o modelo oficial; Expert sem fórmula marcado', async () => {
    const r = await http.get('/v1/reports/catalog').set(auth(GESTORA));
    expect(r.status).toBe(200);
    expect(reportsCatalog.response.safeParse(r.body).success).toBe(true);
    expect(r.body.tiers.map((x: { label: string }) => x.label)).toEqual(['Basic', 'Advanced', 'Expert']);
    expect(r.body.layout_status).toBe('awaiting_official_model');
    const fhemig = r.body.indicators.find((i: { key: string }) => i.key === 'fhemig_indicators');
    expect(fhemig.status).toBe('awaiting_official_model');
    expect(fhemig.note).toMatch(/AGUARDANDO MODELO PDF OFICIAL/);
  });
});

describe('geração com dados reais', () => {
  it('BASIC: chamados abertos = o número do Painel, com o mesmo filtro', async () => {
    const r = await gerar(GESTORA, { tier: 'basic' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(reportsGenerate.response.safeParse(r.body).success).toBe(true);
    const abertos = r.body.sections.find((x: { key: string }) => x.key === 'work_orders_opened');
    const painel = await http.get(`/v1/insights/control-panel?from=${DE}&to=${ATE}`).set(auth(GESTORA));
    expect(abertos.value).toBe(painel.body.kpis.opened.data.count);
    expect(abertos.value).toBe(4);
    expect(r.body.sections.some((x: { key: string }) => x.key === 'sla_compliance')).toBe(false);
  });

  it('ADVANCED herda o Basic e acrescenta SLA; obsolescência sem valor (aguardando definição)', async () => {
    const r = await gerar(GESTORA, { tier: 'advanced' });
    const chaves = r.body.sections.map((x: { key: string }) => x.key);
    expect(chaves).toContain('mttr');
    expect(chaves).toContain('sla_compliance');
    const obs = r.body.sections.find((x: { key: string }) => x.key === 'obsolescence');
    expect(obs.status).toBe('awaiting_definition');
    expect(obs.value).toBeNull();
  });

  it('EXPERT: indicadores sem modelo saem SEM número', async () => {
    const r = await gerar(GESTORA, { tier: 'expert' });
    const fhemig = r.body.sections.find((x: { key: string }) => x.key === 'fhemig_indicators');
    expect(fhemig.value).toBeNull();
    expect(fhemig.status).toBe('awaiting_official_model');
  });

  it('seleção de indicadores; indicador de outro modelo → 422', async () => {
    const ok = await gerar(GESTORA, { tier: 'basic', indicators: ['mttr', 'work_orders_completed'] });
    expect(ok.body.sections.map((x: { key: string }) => x.key)).toEqual(['mttr', 'work_orders_completed']);
    const fora = await gerar(GESTORA, { tier: 'basic', indicators: ['sla_compliance'] });
    expect(fora.status).toBe(422);
  });

  it('filtro de cliente; quem só vê o Hospital A conta só A; B fora do escopo → 404', async () => {
    const soA = await gerar(GESTORA, {
      tier: 'basic',
      indicators: ['work_orders_opened'],
      customer_id: hospitalA,
    });
    expect(soA.body.sections[0].value).toBe(3);
    const restrita = await gerar(RESTRITA, { tier: 'basic', indicators: ['work_orders_opened'] });
    expect(restrita.body.sections[0].value).toBe(3);
    const fora = await gerar(RESTRITA, { tier: 'basic', customer_id: hospitalB });
    expect(fora.status).toBe(404);
  });

  it('PDF provisório com a faixa; solicitante sem indicador → 403; outra organização: zero', async () => {
    const pdf = await gerar(GESTORA, { tier: 'basic' }, true)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    const corpo = (pdf.body as Buffer).toString('latin1');
    expect(corpo.startsWith('%PDF')).toBe(true);
    expect(corpo).toContain('AGUARDANDO MODELO PDF OFICIAL');
    expect((await gerar(SOLICITANTE, { tier: 'basic' })).status).toBe(403);
    const b = await gerar(ADMIN_B, { tier: 'basic', indicators: ['work_orders_opened'] });
    expect(b.body.sections[0].value).toBe(0);
  });
});
