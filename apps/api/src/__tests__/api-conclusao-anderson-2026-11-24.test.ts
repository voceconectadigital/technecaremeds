/**
 * Aurora — respostas do Anderson de 24/11/2026 pela HTTP: contrato que para o atendimento (D-4),
 * renovação (D-7), horas da OS (D-3) e o assistente de planos (vídeo de 13/11/2026).
 *
 * O que se confere aqui é a FRONTEIRA: as rotas novas existem com o contrato zod, cada uma exige a
 * sua permissão, a outra organização não alcança nada, e o bloqueio volta como 409 explicado — na
 * API, e não só na tela.
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
  provisionStarterLocationTypes,
  createCustomer,
  createLocation,
  createAssetCategory,
  createAsset,
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  organizationToday,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG_A = newId();
const ORG_B = newId();
const ADMIN_A = 'admin@and2411-a.test';
const TECNICO_A = 'tecnico@and2411-a.test';
const ADMIN_B = 'admin@and2411-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hoje: string;
let cliente: string, setor: string, ventilador: string, monitor: string;
let clienteLivre: string, ativoLivre: string;
let natCorretiva: string;
let contrato: string;

const sistema = (org: string) =>
  buildContext({ organizationId: org, actorKind: 'system', requestId: newId() });

beforeAll(async () => {
  t = await createTestDatabase();
  const idsA = { organizationId: ORG_A, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, idsA, { slug: 'and2411-a', name: 'Org A', email: ADMIN_A, userName: 'Admin A' });
  await seedOrganization(t, idsB, { slug: 'and2411-b', name: 'Org B', email: ADMIN_B, userName: 'Admin B' });
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
    await withTenant(t.db, sistema(org), async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, membro, base.roles.get(papel)!);
    });
  }
  await withTenant(t.db, sistema(ORG_A), async (s) => {
    hoje = await organizationToday(s);
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital Santa Clara' });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Bloco A',
    });
    setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI Adulto',
    });
    const vent = await createAssetCategory(s, { name: 'Ventilador pulmonar' });
    const mon = await createAssetCategory(s, { name: 'Monitor' });
    ventilador = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: vent,
      locationId: setor,
    });
    monitor = await createAsset(s, {
      name: 'Monitor 01',
      customerId: cliente,
      assetCategoryId: mon,
      locationId: setor,
    });
    clienteLivre = await createCustomer(s, { name: 'Clínica Sem Contrato' });
    ativoLivre = await createAsset(s, { name: 'Bomba 01', customerId: clienteLivre, assetCategoryId: mon });
    for (const [key, title] of [
      ['prev_ventilador', 'Preventiva de ventilador'],
      ['prev_monitor', 'Preventiva de monitor'],
    ] as const) {
      const tpl = await createChecklistTemplate(s, { key, title });
      await addChecklistItem(s, { templateId: tpl, kind: 'boolean', label: 'Funciona?' });
      await publishChecklist(s, tpl);
    }
    const [c] = await s.query<{ id: string }>(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'
        AND archived_at IS NULL LIMIT 1`
    );
    natCorretiva = c!.id;
  });

  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);
  app = await createApp({ db: t.db, env });
  await app.init();
  http = request(app.getHttpServer());
}, 180_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('D-4/D-7 · contrato pela HTTP', () => {
  it('cria vigente com renovação automática; sem término, a renovação automática é recusada', async () => {
    const semFim = await http
      .post('/v1/contracts')
      .set(auth(ADMIN_A))
      .send({ customerId: cliente, kind: 'full_service', startsOn: hoje, autoRenew: true });
    expect(semFim.status).toBe(422);
    const r = await http
      .post('/v1/contracts')
      .set(auth(ADMIN_A))
      .send({
        customerId: cliente,
        kind: 'full_service',
        startsOn: hoje,
        endsOn: `${Number(hoje.slice(0, 4)) + 1}${hoje.slice(4)}`,
        autoRenew: true,
        coverAllAssets: true,
        activate: true,
      });
    expect(r.status).toBe(201);
    contrato = r.body.id;
  });

  it('o técnico não suspende nem renova; a outra organização não alcança o contrato', async () => {
    const corpo = { hold: 'suspended', reason: 'Inadimplência do mês' };
    expect(
      (await http.post(`/v1/contracts/${contrato}/service-hold`).set(auth(TECNICO_A)).send(corpo)).status
    ).toBe(403);
    expect((await http.post(`/v1/contracts/${contrato}/renew`).set(auth(TECNICO_A)).send({})).status).toBe(
      403
    );
    expect(
      (await http.post(`/v1/contracts/${contrato}/service-hold`).set(auth(ADMIN_B)).send(corpo)).status
    ).toBe(404);
    expect((await http.get(`/v1/contracts/${contrato}/renewals`).set(auth(ADMIN_B))).status).toBe(404);
    expect(
      (await http.get(`/v1/contracts/${contrato}/technical-hours?from=${hoje}&to=${hoje}`).set(auth(ADMIN_B)))
        .status
    ).toBe(404);
  });

  it('suspenso: abrir chamado e OS volta 409 com o motivo; a ficha da OS mostra o bloqueio; consulta segue 200', async () => {
    const os = await http.post('/v1/work-orders').set(auth(ADMIN_A)).send({
      customer_id: cliente,
      work_order_type_id: natCorretiva,
      title: 'Alarme de pressão',
      asset_id: ventilador,
    });
    expect(os.status).toBe(201);

    const curto = await http
      .post(`/v1/contracts/${contrato}/service-hold`)
      .set(auth(ADMIN_A))
      .send({ hold: 'suspended', reason: 'curto' });
    expect(curto.status).toBe(422);
    const hold = await http
      .post(`/v1/contracts/${contrato}/service-hold`)
      .set(auth(ADMIN_A))
      .send({ hold: 'suspended', reason: 'Inadimplência do mês de outubro' });
    expect(hold.status).toBe(201);
    expect(hold.body).toEqual({ changed: true });

    const chamado = await http
      .post('/v1/service-requests')
      .set(auth(ADMIN_A))
      .send({ customer_id: cliente, summary: 'Ventilador alarmando', asset_id: ventilador });
    expect(chamado.status).toBe(409);
    expect(chamado.body.message).toMatch(/somente consulta/);
    expect(chamado.body.details.service_block).toMatchObject({ reason: 'suspended' });

    const novaOs = await http.post('/v1/work-orders').set(auth(ADMIN_A)).send({
      customer_id: cliente,
      work_order_type_id: natCorretiva,
      title: 'Outra',
      asset_id: monitor,
    });
    expect(novaOs.status).toBe(409);

    const transicao = await http
      .post(`/v1/work-orders/${os.body.id}/transitions`)
      .set(auth(ADMIN_A))
      .send({ to: 'in_progress' });
    expect(transicao.status).toBe(409);

    const ficha = await http.get(`/v1/work-orders/${os.body.id}`).set(auth(ADMIN_A));
    expect(ficha.status).toBe(200);
    expect(ficha.body.service_block).toMatchObject({
      reason: 'suspended',
      hold_reason: 'Inadimplência do mês de outubro',
    });

    const lista = await http.get(`/v1/contracts?customerId=${cliente}`).set(auth(ADMIN_A));
    expect(lista.body.items[0]).toMatchObject({ service_hold: 'suspended' });

    // outro cliente da mesma organização, sem contrato: atende normalmente
    const livre = await http
      .post('/v1/service-requests')
      .set(auth(ADMIN_A))
      .send({ customer_id: clienteLivre, summary: 'Bomba com erro', asset_id: ativoLivre });
    expect(livre.status).toBe(201);
  });

  it('reativa e renova à mão; o histórico de renovações aparece', async () => {
    const r = await http
      .post(`/v1/contracts/${contrato}/service-release`)
      .set(auth(ADMIN_A))
      .send({ reason: 'Pago' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ changed: true });
    const ren = await http
      .post(`/v1/contracts/${contrato}/renew`)
      .set(auth(ADMIN_A))
      .send({ note: 'Aditivo 1' });
    expect(ren.status).toBe(201);
    expect(ren.body.new_ends_on > ren.body.previous_ends_on).toBe(true);
    const hist = await http.get(`/v1/contracts/${contrato}/renewals`).set(auth(ADMIN_A));
    expect(hist.status).toBe(200);
    expect(hist.body.items).toHaveLength(1);
    expect(hist.body.items[0]).toMatchObject({ mode: 'manual', note: 'Aditivo 1', seq: 1 });
  });
});

describe('D-3 · horas da OS pela HTTP', () => {
  it('concluir sem horas → 422; com horas → 201; a apuração do contrato separa por natureza', async () => {
    const os = await http.post('/v1/work-orders').set(auth(ADMIN_A)).send({
      customer_id: cliente,
      work_order_type_id: natCorretiva,
      title: 'Troca de sensor',
      asset_id: monitor,
    });
    expect(os.status).toBe(201);
    expect(
      (
        await http
          .post(`/v1/work-orders/${os.body.id}/transitions`)
          .set(auth(ADMIN_A))
          .send({ to: 'in_progress' })
      ).status
    ).toBe(201);
    const sem = await http
      .post(`/v1/work-orders/${os.body.id}/transitions`)
      .set(auth(ADMIN_A))
      .send({ to: 'completed', resolution: 'Sensor trocado e testado', operational_result: 'released' });
    expect(sem.status).toBe(422);
    expect(sem.body.details.field).toBe('service_hours');
    const ruim = await http.post(`/v1/work-orders/${os.body.id}/transitions`).set(auth(ADMIN_A)).send({
      to: 'completed',
      resolution: 'Sensor trocado e testado',
      operational_result: 'released',
      service_started_at: 'ontem',
      service_ended_at: new Date().toISOString(),
    });
    expect(ruim.status).toBe(422);
    const com = await http
      .post(`/v1/work-orders/${os.body.id}/transitions`)
      .set(auth(ADMIN_A))
      .send({
        to: 'completed',
        resolution: 'Sensor trocado e testado',
        operational_result: 'released',
        service_started_at: new Date(Date.now() - 80 * 60_000).toISOString(),
        service_ended_at: new Date(Date.now() - 20 * 60_000).toISOString(),
      });
    expect(com.status).toBe(201);
    const ficha = await http.get(`/v1/work-orders/${os.body.id}`).set(auth(ADMIN_A));
    expect(ficha.body.service_started_at).toBeTruthy();
    expect(ficha.body.service_ended_at).toBeTruthy();

    const horas = await http
      .get(`/v1/contracts/${contrato}/technical-hours?from=${hoje}&to=${hoje}`)
      .set(auth(ADMIN_A));
    expect(horas.status).toBe(200);
    const corretiva = horas.body.totals.find((x: { group: string }) => x.group === 'corrective');
    expect(corretiva).toMatchObject({ work_orders: 1, minutes: 60 });
    expect(horas.body.items[0]).toMatchObject({ number: ficha.body.number, minutes: 60 });
    expect(
      (await http.get(`/v1/contracts/${contrato}/technical-hours?from=${hoje}`).set(auth(ADMIN_A))).status
    ).toBe(422);
  });
});

describe('planos · assistente por equipamento e edição pela HTTP', () => {
  let plano: string;
  let tarefas: Array<{ id: string; target_asset_id: string | null }>;

  it('sem procedimento num equipamento → 422; com um por equipamento → 201 e o ciclo abre na hora', async () => {
    const base = {
      name: 'Preventiva semestral — UTI Adulto',
      customer_id: cliente,
      sector_id: setor,
      kind: 'preventive',
      frequency_unit: 'semester',
      frequency_interval: 1,
      anchor_date: hoje,
      lead_time_days: 15,
      tolerance_days: 5,
      auto_generate: true,
    };
    const falta = await http
      .post('/v1/maintenance-plans')
      .set(auth(ADMIN_A))
      .send({
        ...base,
        items: [{ asset_id: ventilador, checklist_template_key: 'prev_ventilador' }, { asset_id: monitor }],
      });
    expect(falta.status).toBe(422);
    expect(falta.body.details.field).toBe('items.1.checklist_template_key');
    const r = await http
      .post('/v1/maintenance-plans')
      .set(auth(ADMIN_A))
      .send({
        ...base,
        items: [
          { asset_id: ventilador, checklist_template_key: 'prev_ventilador' },
          { asset_id: monitor, checklist_template_key: 'prev_monitor' },
        ],
      });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ task_count: 2, cycles_opened: 2, work_orders: 2 });
    plano = r.body.id;
    const det = await http.get(`/v1/maintenance-plans/${plano}`).set(auth(ADMIN_A));
    expect(det.status).toBe(200);
    tarefas = det.body.tasks;
    const titulos = det.body.tasks.map((x: { checklist_title: string }) => x.checklist_title).sort();
    expect(titulos).toEqual(['Preventiva de monitor', 'Preventiva de ventilador']);
    expect(det.body.tasks.every((x: { kind: string }) => x.kind === 'preventive')).toBe(true);
  });

  it('educação continuada sem data → 422 (a natureza Treinamento existe na organização)', async () => {
    const opcoes = await http.get('/v1/maintenance-plans/form-options').set(auth(ADMIN_A));
    expect(opcoes.body.kinds.find((k: { key: string }) => k.key === 'education')).toMatchObject({
      available: true,
    });
    const r = await http
      .post('/v1/maintenance-plans')
      .set(auth(ADMIN_A))
      .send({
        name: 'Educação continuada — UTI',
        customer_id: cliente,
        sector_id: setor,
        kind: 'education',
        frequency_unit: 'year',
        frequency_interval: 1,
        anchor_date: hoje,
        items: [{ asset_id: ventilador }],
      });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('items.0.first_due_on');
  });

  it('editar o plano e um equipamento; o técnico não edita; a outra organização não vê', async () => {
    expect(
      (
        await http
          .patch(`/v1/maintenance-plans/${plano}`)
          .set(auth(TECNICO_A))
          .send({ name: 'x' + 'y'.repeat(5) })
      ).status
    ).toBe(403);
    expect(
      (await http.patch(`/v1/maintenance-plans/${plano}`).set(auth(ADMIN_B)).send({ name: 'Tentativa B' }))
        .status
    ).toBe(404);
    expect((await http.get(`/v1/maintenance-plans/${plano}/history`).set(auth(ADMIN_B))).status).toBe(404);
    const p = await http
      .patch(`/v1/maintenance-plans/${plano}`)
      .set(auth(ADMIN_A))
      .send({ name: 'Preventiva UTI — revisada' });
    expect(p.status).toBe(200);
    const tarefa = await http
      .patch(`/v1/maintenance-plans/tasks/${tarefas[0]!.id}`)
      .set(auth(ADMIN_A))
      .send({ tolerance_days: 10, frequency_unit: 'quarter' });
    expect(tarefa.status).toBe(200);
    const tarefaB = await http
      .patch(`/v1/maintenance-plans/tasks/${tarefas[0]!.id}`)
      .set(auth(ADMIN_B))
      .send({ tolerance_days: 1 });
    expect(tarefaB.status).toBe(404);
    // o primeiro ciclo já abriu: o primeiro vencimento não muda mais
    const primeira = await http
      .patch(`/v1/maintenance-plans/tasks/${tarefas[0]!.id}`)
      .set(auth(ADMIN_A))
      .send({ first_due_on: hoje });
    expect(primeira.status).toBe(409);
  });

  it('retirar o equipamento com motivo; incluir de novo; o histórico mostra tudo', async () => {
    const monitorTarefa = tarefas.find((x) => x.target_asset_id === monitor)!;
    const curto = await http
      .post(`/v1/maintenance-plans/tasks/${monitorTarefa.id}/remove`)
      .set(auth(ADMIN_A))
      .send({ reason: 'curto' });
    expect(curto.status).toBe(422);
    const tira = await http
      .post(`/v1/maintenance-plans/tasks/${monitorTarefa.id}/remove`)
      .set(auth(ADMIN_A))
      .send({ reason: 'Monitor transferido de setor' });
    expect(tira.status).toBe(201);
    const volta = await http
      .post(`/v1/maintenance-plans/${plano}/items`)
      .set(auth(ADMIN_A))
      .send({ items: [{ asset_id: monitor, checklist_template_key: 'prev_monitor' }] });
    expect(volta.status).toBe(201);
    expect(volta.body.task_count).toBe(1);
    const hist = await http.get(`/v1/maintenance-plans/${plano}/history`).set(auth(ADMIN_A));
    expect(hist.status).toBe(200);
    expect(hist.body.items.length).toBeGreaterThanOrEqual(4);
  });
});
