/**
 * Aurora — avaliação e assinatura da OS pelo solicitante, pela HTTP
 * (conversa com o cliente, 21/10/2026).
 *
 *   · o campo de pendências lista as OS concluídas que a pessoa pediu;
 *   · avaliar (1 a 5) assina no mesmo ato, uma vez só, e só quem pediu avalia;
 *   · com pendência, o solicitante não abre chamado novo (o "obrigar"); a equipe não é travada;
 *   · depois de avaliar, a trava solta e o indicador conta a nota.
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
  createAssetCategory,
  createAsset,
  createServiceRequest,
  createWorkOrder,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const GESTORA = 'gestora@aval.test';
const SOLICITANTE = 'solicitante@aval.test';
const OUTRA = 'outra@aval.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospital: string, setor: string, os: string, osAndamento: string;
let memSolicitante: string, memOutra: string;

async function concluir(osId: string): Promise<void> {
  await t.admin.transaction(async (tx) => {
    await tx.query(`SET LOCAL session_replication_role = replica`);
    await tx.query(
      `UPDATE aurora.work_orders SET status_category = 'done', completed_at = now(), resolution = 'Sensor trocado.'
        WHERE id = $1`,
      [osId]
    );
  });
}

beforeAll(async () => {
  t = await createTestDatabase();
  const idsA = { organizationId: ORG, userId: newId(), membershipId: newId() };
  await seedOrganization(t, idsA, { slug: 'aval', name: 'Prestadora', email: GESTORA, userName: 'Gestora' });
  memSolicitante = newId();
  memOutra = newId();

  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, idsA.membershipId, base.roles.get('manager')!);
      hospital = await createCustomer(s, { name: 'Hospital Alfa' });
      const sede = await createLocation(s, {
        customerId: hospital,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'Sede',
      });
      setor = await createLocation(s, {
        customerId: hospital,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI',
      });
    }
  );

  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memSolicitante },
    { email: SOLICITANTE, userName: 'Sônia Solicitante', seatType: 'portal', customerIds: [hospital] }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memOutra },
    { email: OUTRA, userName: 'Outra Pessoa', seatType: 'portal', customerIds: [hospital] }
  );
  const ctxSol = buildContext({
    organizationId: ORG,
    actorId: (
      await t.admin.query<{ user_id: string }>(`SELECT user_id FROM aurora.memberships WHERE id = $1`, [
        memSolicitante,
      ])
    )[0]!.user_id,
    membershipId: memSolicitante,
    requestId: 'sol',
    permissions: ['service_request.create', 'work_order.read'],
  });
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memSolicitante, base.roles.get('requester')!);
      await assignRole(s, memOutra, base.roles.get('requester')!);
    }
  );

  let ativo = '';
  let natureza = '';
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's3' }),
    async (s) => {
      const cat = await createAssetCategory(s, { name: 'Ventilador' });
      ativo = await createAsset(s, {
        name: 'Ventilador 01',
        customerId: hospital,
        assetCategoryId: cat,
        locationId: setor,
      });
      const [tipo] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
      );
      natureza = tipo!.id;
    }
  );
  // As duas solicitações são da Sônia (o requerente vem do vínculo do contexto).
  await withTenant(t.db, ctxSol, async (ss) => {
    const sr1 = await createServiceRequest(ss, {
      customerId: hospital,
      summary: 'Alarme disparando',
      submit: true,
    });
    const sr2 = await createServiceRequest(ss, {
      customerId: hospital,
      summary: 'Tela apagada',
      submit: true,
    });
    os = (
      await createWorkOrder(ss, {
        customerId: hospital,
        workOrderTypeId: natureza,
        title: 'Reparo do alarme',
        locationId: setor,
        assetId: ativo,
        serviceRequestId: sr1.id,
        publish: true,
      })
    ).id;
    osAndamento = (
      await createWorkOrder(ss, {
        customerId: hospital,
        workOrderTypeId: natureza,
        title: 'Reparo da tela',
        locationId: setor,
        assetId: ativo,
        serviceRequestId: sr2.id,
        publish: true,
      })
    ).id;
  });
  await concluir(os);

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

describe('o campo de pendências', () => {
  it('lista a OS concluída que a pessoa pediu; a que ainda anda fica de fora', async () => {
    const r = await http.get('/v1/evaluations/pending').set(auth(SOLICITANTE));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.items[0]).toMatchObject({ work_order_id: os, title: 'Reparo do alarme' });
  });

  it('quem não pediu nada recebe a lista vazia', async () => {
    const r = await http.get('/v1/evaluations/pending').set(auth(OUTRA));
    expect(r.body).toEqual({ items: [], total: 0 });
  });

  it('a ficha da avaliação diz que a Sônia pode avaliar, e a outra pessoa não', async () => {
    const dela = await http.get(`/v1/work-orders/${os}/evaluation`).set(auth(SOLICITANTE));
    expect(dela.body).toMatchObject({ evaluation: null, can_evaluate: true });
    const outra = await http.get(`/v1/work-orders/${os}/evaluation`).set(auth(OUTRA));
    expect(outra.body).toMatchObject({ evaluation: null, can_evaluate: false });
  });
});

describe('o "obrigar"', () => {
  it('com pendência, a solicitante não abre chamado novo (409, dizendo o que fazer)', async () => {
    const r = await http.post('/v1/service-requests').set(auth(SOLICITANTE)).send({
      customer_id: hospital,
      location_id: setor,
      summary: 'Outro problema no leito 2',
      source: 'portal',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/avaliar e assinar/);
  });

  it('quem não tem pendência abre normalmente', async () => {
    const r = await http.post('/v1/service-requests').set(auth(OUTRA)).send({
      customer_id: hospital,
      location_id: setor,
      summary: 'Cadeira quebrada no posto',
      source: 'portal',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});

describe('avaliar e assinar', () => {
  it('nota fora de 1 a 5 é recusada (422)', async () => {
    const r = await http.post(`/v1/work-orders/${os}/evaluation`).set(auth(SOLICITANTE)).send({ rating: 6 });
    expect(r.status).toBe(422);
  });

  it('quem não pediu a OS recebe 404 — e não descobre que ela existe', async () => {
    const r = await http.post(`/v1/work-orders/${os}/evaluation`).set(auth(OUTRA)).send({ rating: 5 });
    expect(r.status).toBe(404);
  });

  it('OS que ainda não terminou não se avalia (409)', async () => {
    const r = await http
      .post(`/v1/work-orders/${osAndamento}/evaluation`)
      .set(auth(SOLICITANTE))
      .send({ rating: 5 });
    expect(r.status).toBe(409);
  });

  it('avalia e assina no mesmo ato (201), e a ficha passa a mostrar a avaliação', async () => {
    const r = await http
      .post(`/v1/work-orders/${os}/evaluation`)
      .set(auth(SOLICITANTE))
      .send({ rating: 5, comment: 'Rápido e educado.' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.signature_id).toBeTruthy();

    const ficha = await http.get(`/v1/work-orders/${os}/evaluation`).set(auth(SOLICITANTE));
    expect(ficha.body.can_evaluate).toBe(false);
    expect(ficha.body.evaluation).toMatchObject({
      rating: 5,
      comment: 'Rápido e educado.',
      evaluator_name: 'Sônia Solicitante',
    });
  });

  it('uma vez só (409)', async () => {
    const r = await http.post(`/v1/work-orders/${os}/evaluation`).set(auth(SOLICITANTE)).send({ rating: 1 });
    expect(r.status).toBe(409);
  });

  it('a pendência some e a trava solta: a solicitante abre o chamado', async () => {
    expect((await http.get('/v1/evaluations/pending').set(auth(SOLICITANTE))).body.total).toBe(0);
    const r = await http.post('/v1/service-requests').set(auth(SOLICITANTE)).send({
      customer_id: hospital,
      location_id: setor,
      summary: 'Outro problema no leito 2',
      source: 'portal',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});
