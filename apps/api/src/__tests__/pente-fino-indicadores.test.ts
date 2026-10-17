/**
 * Aurora — pendências de indicadores do pente-fino de 17/10/2026 (HTTP).
 *
 *   · PF-55 — `GET /insights/control-panel` devolve as metas que valem no
 *     recorte (a cor do Painel deixa de ser limiar fixo);
 *   · regra agendada: a lista de indicadores é conferida AO SALVAR (422);
 *   · PF-52 — `periodo: 'mes_anterior'` aceito; ambíguo com `periodDays`, 422.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext } from '@aurora/domain';
import { createTestDatabase, seedOrganization, type TestDatabase } from '@aurora/db/testing/harness';
import { withTenant, assignRole, createCustomer, provisionOrganizationBaseline } from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { insightControlPanel } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG = newId();
const ADMIN = 'admin@pf-ind.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospital: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(t, ids, { slug: 'pf-ind', name: 'Prestadora', email: ADMIN, userName: 'Admin' });
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, ids.membershipId, base.roles.get('admin')!);
      hospital = await createCustomer(s, { name: 'Hospital' });
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

const painel = (query: Record<string, string> = {}) =>
  http
    .get('/v1/insights/control-panel')
    .query({ from: '2026-09-17T03:00:00.000Z', to: '2026-10-18T02:59:59.999Z', ...query })
    .set(auth(ADMIN));

describe('PF-55 — metas no Painel', () => {
  it('sem meta configurada: cada indicador colorido vem nulo (a tela pinta neutro)', async () => {
    const r = await painel();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(insightControlPanel.response.safeParse(r.body).success).toBe(true);
    expect(r.body.targets.items.sla_compliance).toBeNull();
    expect(r.body.targets.items.park_availability_snapshot).toBeNull();
    expect(r.body.targets.target_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('com metas: a da organização, e a do cliente quando o recorte é dele', async () => {
    const meta = (body: Record<string, unknown>) =>
      http
        .post('/v1/indicator-targets')
        .set(auth(ADMIN))
        .send({ direction: 'HIGHER_IS_BETTER', valid_from: '2020-01-01', ...body });
    expect((await meta({ indicator_key: 'sla_compliance', value: 90 })).status).toBe(201);
    expect(
      (await meta({ indicator_key: 'park_availability_snapshot', value: 95, customer_id: hospital })).status
    ).toBe(201);
    const geral = await painel();
    expect(geral.body.targets.items.sla_compliance).toMatchObject({ value: 90, scope: 'organization' });
    expect(geral.body.targets.items.park_availability_snapshot).toBeNull();
    const doHospital = await painel({ customerId: hospital });
    expect(doHospital.body.targets.items.park_availability_snapshot).toMatchObject({
      value: 95,
      scope: 'customer',
      direction: 'HIGHER_IS_BETTER',
    });
  });
});

describe('regra agendada de relatório — conferida ao salvar', () => {
  const criar = (params: Record<string, unknown>) =>
    http
      .post('/v1/automations')
      .set(auth(ADMIN))
      .send({
        name: `Relatório ${newId()}`,
        triggerKind: 'schedule',
        triggerCron: '0 8 1 * *',
        triggerTimezone: 'America/Sao_Paulo',
        actions: [{ kind: 'send_report', params: { recipients: [ids.membershipId], ...params } }],
      });

  it('indicador fora do modelo ou aguardando definição → 422 com o motivo', async () => {
    const fora = await criar({ tier: 'basic', indicators: ['sla_compliance'] });
    expect(fora.status).toBe(422);
    expect(JSON.stringify(fora.body)).toMatch(/fora do modelo Basic/);
    const pendente = await criar({ tier: 'basic', indicators: ['requests_fulfilled_ratio'] });
    expect(pendente.status).toBe(422);
    expect(JSON.stringify(pendente.body)).toMatch(/aguardando definição/);
    expect((await criar({ tier: 'basic', indicators: ['mttr'] })).status).toBe(201);
  });

  it('mês anterior (PF-52) aceito; junto com periodDays é ambíguo → 422', async () => {
    expect((await criar({ tier: 'basic', periodo: 'mes_anterior' })).status).toBe(201);
    expect((await criar({ tier: 'basic', periodo: 'mes_anterior', periodDays: 30 })).status).toBe(422);
    expect((await criar({ tier: 'basic', periodo: 'semestre' })).status).toBe(422);
  });
});
