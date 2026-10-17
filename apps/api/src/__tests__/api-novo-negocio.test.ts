/**
 * Aurora — "Novo Negócio": provisionamento lógico de tenant (reunião 16/10/2026, Fase 11).
 *
 *   · só o admin GLOBAL de plataforma (concessão explícita em platform_admins)
 *     cria e lista negócios; admin de UMA organização recebe 403;
 *   · o negócio novo nasce com base de fábrica, marca, domínio PEDIDO
 *     (pending_dns) e o primeiro administrador;
 *   · dois tenants criados aqui são isolados entre si — e do admin de
 *     plataforma, que vê o REGISTRO, não o dado de negócio.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext } from '@aurora/domain';
import { createTestDatabase, seedOrganization, type TestDatabase } from '@aurora/db/testing/harness';
import { withTenant, assignRole, provisionOrganizationBaseline } from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { organizationsCurrent, platformTenantsList } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG_PLAT = newId();
const ORG_X = newId();
const PLAT = 'plataforma@nn.test';
const ADMIN_X = 'admin@x.test';
const ALFA = 'admin@alfa.test';
const BETA = 'admin@beta.test';
const auth = (email: string, org?: string) => ({
  authorization: `Bearer local:${email}:${email}`,
  ...(org ? { 'x-aurora-organization': org } : {}),
});

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
const idsPlat = { organizationId: ORG_PLAT, userId: newId(), membershipId: newId() };
const idsX = { organizationId: ORG_X, userId: newId(), membershipId: newId() };
let alfa: string;
let beta: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(t, idsPlat, {
    slug: 'operadora',
    name: 'Operadora',
    email: PLAT,
    userName: 'Plataforma',
  });
  await seedOrganization(t, idsX, { slug: 'org-x', name: 'X', email: ADMIN_X, userName: 'X' });
  for (const [org, mem] of [
    [ORG_PLAT, idsPlat.membershipId],
    [ORG_X, idsX.membershipId],
  ] as const) {
    await withTenant(
      t.db,
      buildContext({ organizationId: org, actorKind: 'system', requestId: 's' }),
      async (s) => {
        const base = await provisionOrganizationBaseline(s);
        await assignRole(s, mem, base.roles.get('admin')!);
      }
    );
  }
  // Concessão EXPLÍCITA, como o DBA faria — não existe rota para isto.
  await t.raw(
    `INSERT INTO aurora.platform_admins (user_id, granted_by, reason) VALUES ($1, 'dba', 'teste da Fase 11')`,
    [idsPlat.userId]
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

const novo = (quem: string, body: Record<string, unknown>) =>
  http.post('/v1/platform/tenants').set(auth(quem)).send(body);

describe('admin global de plataforma', () => {
  it('só quem foi concedido explicitamente; admin de uma organização não é admin da plataforma', async () => {
    expect((await http.get('/v1/platform/me').set(auth(PLAT))).body.platform_admin).toBe(true);
    expect((await http.get('/v1/platform/me').set(auth(ADMIN_X))).body.platform_admin).toBe(false);
    expect((await http.get('/v1/platform/tenants').set(auth(ADMIN_X))).status).toBe(403);
    const r = await novo(ADMIN_X, {
      slug: 'invasor',
      name: 'Invasor',
      admin: { email: 'i@i.test', name: 'I' },
    });
    expect(r.status).toBe(403);
  });
});

describe('provisionamento', () => {
  it('cria dois negócios com marca, domínio pedido e primeiro administrador', async () => {
    const a = await novo(PLAT, {
      slug: 'hospital-alfa',
      name: 'Hospital Alfa Engenharia Clínica',
      branding: { display_name: 'Alfa EC', primary_color: '#0b6e4f', support_email: 'suporte@alfa.test' },
      domain: 'alfa.exemplo.test',
      admin: { email: ALFA, name: 'Ana Alfa' },
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    alfa = a.body.organization_id;
    const b = await novo(PLAT, {
      slug: 'clinica-beta',
      name: 'Clínica Beta',
      admin: { email: BETA, name: 'Bia Beta' },
    });
    expect(b.status).toBe(201);
    beta = b.body.organization_id;
    expect(alfa).not.toBe(beta);
  });

  it('recusa slug repetido (409) e marca inválida (422)', async () => {
    const dup = await novo(PLAT, {
      slug: 'hospital-alfa',
      name: 'De novo',
      admin: { email: 'z@z.test', name: 'Z' },
    });
    expect(dup.status).toBe(409);
    const ocupadoPorOutro = await novo(PLAT, {
      slug: 'org-x',
      name: 'X2',
      admin: { email: 'z@z.test', name: 'Z' },
    });
    expect(ocupadoPorOutro.status).toBe(409);
    const cor = await novo(PLAT, {
      slug: 'cor-ruim',
      name: 'Cor',
      branding: { primary_color: 'verde' },
      admin: { email: 'z@z.test', name: 'Z' },
    });
    expect(cor.status).toBe(422);
  });

  it('o registro lista os negócios; domínio fica pending_dns (não automatizado)', async () => {
    const r = await http.get('/v1/platform/tenants').set(auth(PLAT));
    expect(r.status).toBe(200);
    expect(platformTenantsList.response.safeParse(r.body).success).toBe(true);
    const slugs = r.body.items.map((x: { slug: string }) => x.slug);
    expect(slugs).toEqual(expect.arrayContaining(['operadora', 'org-x', 'hospital-alfa', 'clinica-beta']));
    const a = r.body.items.find((x: { slug: string }) => x.slug === 'hospital-alfa');
    expect(a.domain).toEqual({ host: 'alfa.exemplo.test', status: 'pending_dns' });
    expect(a.branding.primary_color).toBe('#0b6e4f');
  });

  it('o administrador do negócio novo entra, vê a marca e tem a base de fábrica (perfis, situações)', async () => {
    const org = await http.get('/v1/organizations/current').set(auth(ALFA));
    expect(org.status, JSON.stringify(org.body)).toBe(200);
    expect(organizationsCurrent.response.safeParse(org.body).success).toBe(true);
    expect(org.body).toMatchObject({
      id: alfa,
      slug: 'hospital-alfa',
      branding: { display_name: 'Alfa EC' },
    });
    const convite = await http
      .post('/v1/organizations/current/members')
      .set(auth(ALFA))
      .send({ email: 'operador@alfa.test', name: 'Op Alfa', profile: 'operator' });
    expect(convite.status, JSON.stringify(convite.body)).toBe(201);
    const situacoes = await withTenant(
      t.db,
      buildContext({ organizationId: alfa, actorKind: 'system', requestId: 'q' }),
      (s) => s.query<{ key: string }>(`SELECT key FROM aurora.work_order_statuses`)
    );
    expect(situacoes.map((x) => x.key)).toEqual(expect.arrayContaining(['open', 'denied', 'completed']));
  });
});

describe('isolamento entre os dois negócios', () => {
  let clienteAlfa: string;

  it('cliente criado em Alfa não aparece em Beta, nem para a plataforma, nem por id', async () => {
    const c = await http.post('/v1/customers').set(auth(ALFA)).send({ name: 'Hospital do Alfa' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    clienteAlfa = c.body.id;
    const doBeta = await http.get('/v1/customers').set(auth(BETA));
    expect(doBeta.body.items.map((x: { id: string }) => x.id)).not.toContain(clienteAlfa);
    expect((await http.get(`/v1/customers/${clienteAlfa}`).set(auth(BETA))).status).toBe(404);
    const daPlataforma = await http.get('/v1/customers').set(auth(PLAT));
    expect(daPlataforma.body.items.map((x: { id: string }) => x.id)).not.toContain(clienteAlfa);
  });

  it('cabeçalho de organização forjado não abre o outro negócio', async () => {
    const r = await http.get('/v1/customers').set(auth(BETA, alfa));
    expect([401, 403, 404]).toContain(r.status);
  });

  it('o admin de plataforma vira admin de um negócio só quando é convidado nele (vínculo explícito)', async () => {
    const r = await novo(PLAT, { slug: 'gama', name: 'Gama', admin: { email: PLAT, name: 'Plataforma' } });
    expect(r.status).toBe(201);
    expect(r.body.reused_user).toBe(true);
    const orgs = await http.get('/v1/me/organizations').set(auth(PLAT));
    expect(orgs.body.items ?? orgs.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ organization_id: r.body.organization_id })])
    );
  });
});
