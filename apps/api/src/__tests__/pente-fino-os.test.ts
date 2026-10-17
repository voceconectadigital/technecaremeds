/**
 * Aurora — pente-fino 17/10/2026: integridade da ordem de serviço pela HTTP.
 *
 *   · OS com ativo ou local de outro cliente → 422, pela criação e pelo aceite;
 *   · o solicitante não força "em atendimento", "concluída", "encerrada" nem
 *     cancela a solicitação aceita; o segundo aceite é recusado;
 *   · check-in em duas OS → 409; check-out depois de a OS ser cancelada → 201;
 *     check-in reenviado com o mesmo x-aurora-client-operation → o mesmo
 *     desfecho, não 409;
 *   · checklist de OS fechada → 409 para quem não tem work_order.edit_closed.
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
  assignRole,
  createCustomer,
  createLocation,
  createAssetCategory,
  createAsset,
  createWorkOrder,
  transitionWorkOrder,
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  attachChecklist,
  answerChecklistItem,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const GESTORA = 'gestora@pente-os.test';
const OPERADOR = 'operador@pente-os.test';
const SOLICITANTE = 'solicitante@pente-os.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const JUST = { justification: 'GPS do tablet desligado pela TI do hospital' };

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospital = '',
  clinica = '',
  uti = '',
  setorClinica = '',
  ativoHospital = '',
  ativoClinica = '',
  corretiva = '';
let os1 = '',
  os2 = '',
  osFechada = '',
  resposta = '',
  item = '';

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, {
    slug: 'pente-os',
    name: 'Prestadora',
    email: GESTORA,
    userName: 'Gestora',
  });
  const memOp = newId();
  const memSol = newId();
  const sistema = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' });
  const tudo = buildContext({
    organizationId: ORG,
    actorId: ids.userId,
    membershipId: ids.membershipId,
    requestId: 's-tudo',
    permissions: PERMISSION_KEYS,
  });

  await withTenant(t.db, sistema, async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, ids.membershipId, base.roles.get('manager')!);
    hospital = await createCustomer(s, { name: 'Hospital A' });
    clinica = await createCustomer(s, { name: 'Clínica B' });
    uti = await createLocation(s, {
      customerId: hospital,
      locationTypeId: base.locationTypes.get('unidade')!,
      name: 'UTI',
    });
    setorClinica = await createLocation(s, {
      customerId: clinica,
      locationTypeId: base.locationTypes.get('unidade')!,
      name: 'Sede da clínica',
    });
    const cat = await createAssetCategory(s, {
      name: 'Ventilador',
      parentId: base.families.get('life_support'),
    });
    ativoHospital = await createAsset(s, {
      name: 'Vent Hospital',
      customerId: hospital,
      assetCategoryId: cat,
      locationId: uti,
    });
    ativoClinica = await createAsset(s, {
      name: 'Vent Clínica',
      customerId: clinica,
      assetCategoryId: cat,
      locationId: setorClinica,
    });
    const [tipo] = await s.query<{ id: string }>(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
    );
    corretiva = tipo!.id;
  });

  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memOp },
    { email: OPERADOR, userName: 'Operador', customerIds: [hospital], locationIds: [uti] }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memSol },
    { email: SOLICITANTE, userName: 'Solicitante', seatType: 'portal', customerIds: [hospital] }
  );
  await withTenant(t.db, sistema, async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, memOp, base.roles.get('operator')!);
    await assignRole(s, memSol, base.roles.get('requester')!);
  });

  await withTenant(t.db, tudo, async (s) => {
    // PF-14: o Operador executa só a OS atribuída a ele — as desta suíte são dele.
    const nova = (title: string) =>
      createWorkOrder(s, {
        customerId: hospital,
        locationId: uti,
        workOrderTypeId: corretiva,
        title,
        assigneeMembershipId: memOp,
      });
    os1 = (await nova('Check-in 1')).id;
    os2 = (await nova('Check-in 2')).id;
    osFechada = (await nova('Fechada com checklist')).id;
    const template = await createChecklistTemplate(s, { key: 'pente_fino_api', title: 'Pente-fino' });
    item = await addChecklistItem(s, {
      templateId: template,
      kind: 'boolean',
      label: 'Aterramento íntegro',
      expectedBoolean: true,
    });
    await publishChecklist(s, template);
    resposta = await attachChecklist(s, osFechada, template);
    await transitionWorkOrder(s, osFechada, 'in_progress');
    await answerChecklistItem(s, resposta, item, { boolean: true });
    await transitionWorkOrder(s, osFechada, 'completed', { resolution: 'concluída para o teste' });
    await transitionWorkOrder(s, osFechada, 'validated');
    await transitionWorkOrder(s, osFechada, 'closed');
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

describe('a OS não mistura clientes', () => {
  it('POST /work-orders com ativo de outro cliente → 422', async () => {
    const r = await http.post('/v1/work-orders').set(auth(GESTORA)).send({
      customer_id: hospital,
      location_id: uti,
      asset_id: ativoClinica,
      work_order_type_id: corretiva,
      title: 'Ativo da clínica na OS do hospital',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.message).toMatch(/ativo informado pertence a outro cliente/);
  });

  it('POST /work-orders com local de outro cliente → 422', async () => {
    const r = await http.post('/v1/work-orders').set(auth(GESTORA)).send({
      customer_id: hospital,
      location_id: setorClinica,
      work_order_type_id: corretiva,
      title: 'Local da clínica na OS do hospital',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.message).toMatch(/local informado pertence a outro cliente/);
  });
});

describe('solicitação: aceite e transições', () => {
  let pedido = '';

  beforeAll(async () => {
    const r = await http
      .post('/v1/service-requests')
      .set(auth(SOLICITANTE))
      .send({ customer_id: hospital, location_id: uti, summary: 'Ventilador alarmando' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    pedido = r.body.id;
    const tri = await http
      .post(`/v1/service-requests/${pedido}/transitions`)
      .set(auth(GESTORA))
      .send({ to: 'triage' });
    expect(tri.status, JSON.stringify(tri.body)).toBe(201);
  });

  const aceitar = (targets: unknown[]) =>
    http.post(`/v1/work-orders/from-request/${pedido}`).set(auth(GESTORA)).send({ targets });

  it('aceite com alvo de outro cliente → 422, e a solicitação continua em triagem', async () => {
    const a = await aceitar([{ asset_id: ativoClinica, work_order_type_id: corretiva }]);
    expect(a.status, JSON.stringify(a.body)).toBe(422);
    expect(a.body.message).toMatch(/targets\[0\]\.asset_id/);
    const l = await aceitar([{ location_id: setorClinica, work_order_type_id: corretiva }]);
    expect(l.status, JSON.stringify(l.body)).toBe(422);
    const det = await http.get(`/v1/service-requests/${pedido}`).set(auth(GESTORA));
    expect(det.body.status).toBe('triage');
  });

  it('aceite válido gera a OS; o segundo aceite é recusado', async () => {
    const r = await aceitar([{ asset_id: ativoHospital, work_order_type_id: corretiva }]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.work_orders).toHaveLength(1);
    const de_novo = await aceitar([{ work_order_type_id: corretiva }]);
    expect(de_novo.status).toBe(409);
  });

  it('o solicitante não força em atendimento, concluída, encerrada nem cancela a aceita', async () => {
    for (const corpo of [
      { to: 'in_service' },
      { to: 'fulfilled' },
      { to: 'closed' },
      { to: 'cancelled', cancellation_reason: 'não preciso mais' },
    ]) {
      const r = await http
        .post(`/v1/service-requests/${pedido}/transitions`)
        .set(auth(SOLICITANTE))
        .send(corpo);
      expect(r.status, `${corpo.to}: ${JSON.stringify(r.body)}`).toBeGreaterThanOrEqual(400);
    }
    const det = await http.get(`/v1/service-requests/${pedido}`).set(auth(GESTORA));
    expect(det.body.status).toBe('accepted');
    const doSolicitante = await http.get(`/v1/service-requests/${pedido}`).set(auth(SOLICITANTE));
    expect(doSolicitante.body.available_transitions).toEqual([]);
  });

  it('nem a gestora cancela a solicitação aceita com OS ativa', async () => {
    const r = await http
      .post(`/v1/service-requests/${pedido}/transitions`)
      .set(auth(GESTORA))
      .send({ to: 'cancelled', cancellation_reason: 'cliente desistiu' });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/ordem\(ns\) de serviço ativa/);
  });
});

describe('check-in e check-out', () => {
  it('check-in em duas OS ao mesmo tempo → 409', async () => {
    const a = await http.post(`/v1/work-orders/${os1}/check-in`).set(auth(OPERADOR)).send(JUST);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const b = await http.post(`/v1/work-orders/${os2}/check-in`).set(auth(OPERADOR)).send(JUST);
    expect(b.status).toBe(409);
    expect(b.body.message).toMatch(/cronômetro aberto seu na OS/);
  });

  it('OS cancelada: o check-out continua possível, e libera a pessoa', async () => {
    const c = await http
      .post(`/v1/work-orders/${os1}/transitions`)
      .set(auth(GESTORA))
      .send({ to: 'cancelled', cancellation_reason: 'cliente desistiu' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const saida = await http.post(`/v1/work-orders/${os1}/check-out`).set(auth(OPERADOR)).send(JUST);
    expect(saida.status, JSON.stringify(saida.body)).toBe(201);
    const horas = await http.get(`/v1/work-orders/${os1}/time-entries`).set(auth(GESTORA));
    expect(horas.body.open_entries).toBe(0);
  });

  it('check-in reenviado com o mesmo identificador de operação devolve o mesmo desfecho', async () => {
    const op = newId();
    const primeira = await http
      .post(`/v1/work-orders/${os2}/check-in`)
      .set({ ...auth(OPERADOR), 'x-aurora-client-operation': op })
      .send(JUST);
    expect(primeira.status, JSON.stringify(primeira.body)).toBe(201);
    const reenvio = await http
      .post(`/v1/work-orders/${os2}/check-in`)
      .set({ ...auth(OPERADOR), 'x-aurora-client-operation': op })
      .send(JUST);
    expect(reenvio.status, JSON.stringify(reenvio.body)).toBe(201);
    expect(reenvio.body.visit_id).toBe(primeira.body.visit_id);
    const saida = await http.post(`/v1/work-orders/${os2}/check-out`).set(auth(OPERADOR)).send(JUST);
    expect(saida.status, JSON.stringify(saida.body)).toBe(201);
  });
});

describe('checklist de OS fechada', () => {
  it('responder de novo → 409 para quem não tem work_order.edit_closed', async () => {
    const r = await http
      .post(`/v1/checklist-responses/${resposta}/answers`)
      .set(auth(OPERADOR))
      .send({ item_id: item, boolean: false });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.message).toMatch(/não mudam mais/);
  });
});
