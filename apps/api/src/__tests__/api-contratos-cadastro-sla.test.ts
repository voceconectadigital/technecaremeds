/**
 * Aurora — contrato no cadastro do cliente pela HTTP (Anderson, 10/11/2026 — 0090).
 *
 * Criar já cobrindo todos os equipamentos e vigente; editar SLA geral, modalidade, equipes,
 * precificação e pagamento; ver de onde vem o SLA do equipamento; quem pode; e a outra
 * organização não alcança nada disso.
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
  provisionOrganizationBaseline,
  createCustomer,
  createAssetCategory,
  createAsset,
  createSlaPolicy,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG_A = newId();
const ORG_B = newId();
const ADMIN_A = 'admin@ctr-a.test';
const TECNICO_A = 'tecnico@ctr-a.test';
const ADMIN_B = 'admin@ctr-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let cliente: string, ventilador: string, monitor: string;
let politicaGeral: string, politicaExcecao: string, politicaDeB: string;
let contrato: string;

const hoje = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  t = await createTestDatabase();
  const idsA = { organizationId: ORG_A, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, idsA, { slug: 'ctr-a', name: 'Org A', email: ADMIN_A, userName: 'Admin A' });
  await seedOrganization(t, idsB, { slug: 'ctr-b', name: 'Org B', email: ADMIN_B, userName: 'Admin B' });
  const tecnico = newId();
  await seedMember(
    t,
    { organizationId: ORG_A, userId: newId(), membershipId: tecnico },
    { email: TECNICO_A, userName: 'Técnico' }
  );
  for (const [org, membro, papel] of [
    [ORG_A, idsA.membershipId, 'admin'],
    [ORG_A, tecnico, 'technician'],
    [ORG_B, idsB.membershipId, 'admin'],
  ] as const) {
    await withTenant(
      t.db,
      buildContext({ organizationId: org, actorKind: 'system', requestId: newId() }),
      async (s) => {
        const base = await provisionOrganizationBaseline(s);
        await assignRole(s, membro, base.roles.get(papel)!);
      }
    );
  }
  const sistema = (org: string) =>
    buildContext({ organizationId: org, actorKind: 'system', requestId: newId() });
  await withTenant(t.db, sistema(ORG_A), async (s) => {
    cliente = await createCustomer(s, { name: 'Hospital do Contrato' });
    const cat = await createAssetCategory(s, { name: 'Monitor' });
    ventilador = await createAsset(s, { name: 'Ventilador', customerId: cliente, assetCategoryId: cat });
    monitor = await createAsset(s, { name: 'Monitor', customerId: cliente, assetCategoryId: cat });
    politicaGeral = await createSlaPolicy(s, { name: 'SLA geral 4h' });
    politicaExcecao = await createSlaPolicy(s, { name: 'Exceção 2h' });
  });
  await withTenant(t.db, sistema(ORG_B), async (s) => {
    politicaDeB = await createSlaPolicy(s, { name: 'Política da B' });
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

describe('contrato pelo cadastro do cliente', () => {
  it('as opções trazem as políticas de SLA da organização — só as dela', async () => {
    const r = await http.get('/v1/contracts/options').set(auth(ADMIN_A));
    expect(r.status).toBe(200);
    const nomes = r.body.sla_policies.map((p: { name: string }) => p.name);
    expect(nomes).toEqual(expect.arrayContaining(['SLA geral 4h', 'Exceção 2h']));
    expect(nomes).not.toContain('Política da B');
  });

  it('o técnico não cria contrato', async () => {
    const r = await http
      .post('/v1/contracts')
      .set(auth(TECNICO_A))
      .send({ customerId: cliente, kind: 'full_service', startsOn: hoje });
    expect(r.status).toBe(403);
  });

  it('recusa política de SLA de outra organização', async () => {
    const r = await http
      .post('/v1/contracts')
      .set(auth(ADMIN_A))
      .send({ customerId: cliente, kind: 'full_service', startsOn: hoje, slaPolicyId: politicaDeB });
    expect(r.status).toBe(422);
  });

  it('cria vigente, cobrindo todos os equipamentos, com os três conceitos separados', async () => {
    const r = await http
      .post('/v1/contracts')
      .set(auth(ADMIN_A))
      .send({
        customerId: cliente,
        kind: 'full_service',
        startsOn: hoje,
        slaPolicyId: politicaGeral,
        serviceFrequency: 'quarterly',
        fixedTeamPackages: [10, 1],
        billingModel: 'per_call',
        paymentTerms: 'monthly',
        coverAllAssets: true,
        activate: true,
      });
    expect(r.status).toBe(201);
    contrato = r.body.id;

    const lista = await http.get(`/v1/contracts?customerId=${cliente}`).set(auth(ADMIN_A));
    expect(lista.status).toBe(200);
    expect(lista.body.items).toHaveLength(1);
    expect(lista.body.items[0]).toMatchObject({
      status: 'active',
      sla_policy_name: 'SLA geral 4h',
      service_frequency: 'quarterly',
      fixed_team_packages: [1, 10],
      billing_model: 'per_call',
      payment_terms: 'monthly',
      covers_all_assets: true,
    });
  });

  it('recusa modalidade e equipe fora da lista', async () => {
    for (const corpo of [
      { serviceFrequency: 'daily' },
      { fixedTeamPackages: [11] },
      { paymentTerms: 'troca' },
    ]) {
      const r = await http.patch(`/v1/contracts/${contrato}`).set(auth(ADMIN_A)).send(corpo);
      expect(r.status).toBe(422);
    }
  });

  it('o equipamento sem exceção mostra o SLA GERAL do contrato como origem', async () => {
    const r = await http.get(`/v1/assets/${ventilador}/effective-sla`).set(auth(ADMIN_A));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      source: 'contract',
      policy_id: politicaGeral,
      policy_name: 'SLA geral 4h',
      contract_id: contrato,
    });
  });

  it('a exceção do equipamento aparece como exceção, e só nele', async () => {
    const put = await http
      .patch(`/v1/assets/${monitor}`)
      .set(auth(ADMIN_A))
      .send({ sla_enabled: true, sla_policy_id: politicaExcecao });
    expect(put.status).toBeLessThan(300);
    const r = await http.get(`/v1/assets/${monitor}/effective-sla`).set(auth(ADMIN_A));
    expect(r.body).toMatchObject({ source: 'asset', policy_name: 'Exceção 2h', contract_id: contrato });

    const ativos = await http.get(`/v1/contracts/${contrato}/assets`).set(auth(ADMIN_A));
    const porNome = Object.fromEntries(
      ativos.body.items.map((a: { name: string; has_own_sla: boolean }) => [a.name, a.has_own_sla])
    );
    expect(porNome).toEqual({ Monitor: true, Ventilador: false });
  });

  it('editar troca o SLA geral e limpa a modalidade; o técnico não edita', async () => {
    const negado = await http
      .patch(`/v1/contracts/${contrato}`)
      .set(auth(TECNICO_A))
      .send({ serviceFrequency: 'weekly' });
    expect(negado.status).toBe(403);

    const r = await http.patch(`/v1/contracts/${contrato}`).set(auth(ADMIN_A)).send({
      slaPolicyId: politicaExcecao,
      serviceFrequency: null,
      billingModel: 'per_hour',
      paymentTerms: 'upfront',
    });
    expect(r.status).toBe(200);
    const d = await http.get(`/v1/contracts/${contrato}`).set(auth(ADMIN_A));
    expect(d.body.contract).toMatchObject({
      sla_policy_name: 'Exceção 2h',
      service_frequency: null,
      fixed_team_packages: [1, 10],
      billing_model: 'per_hour',
      payment_terms: 'upfront',
    });
  });

  it('a outra organização não lista, não lê, não edita e não resolve o SLA', async () => {
    const lista = await http.get(`/v1/contracts?customerId=${cliente}`).set(auth(ADMIN_B));
    expect(lista.body.items).toEqual([]);
    const d = await http.get(`/v1/contracts/${contrato}`).set(auth(ADMIN_B));
    expect(d.status).toBeGreaterThanOrEqual(400);
    const e = await http.patch(`/v1/contracts/${contrato}`).set(auth(ADMIN_B)).send({ notes: 'invasão' });
    expect(e.status).toBe(404);
    const s = await http.get(`/v1/assets/${ventilador}/effective-sla`).set(auth(ADMIN_B));
    expect(s.status).toBe(404);
  });
});
