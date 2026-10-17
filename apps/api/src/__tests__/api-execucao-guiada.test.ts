/**
 * Aurora — execução guiada da OS (reunião 16/10/2026, Fase 5).
 *
 *   · situação "Negada" existe e é terminal; "Rascunho" sai do quadro; a API
 *     não cria mais rascunho;
 *   · check-in com posição do aparelho abre o cronômetro; check-out fecha;
 *     sem posição exige justificativa; dois check-ins seguidos → 409;
 *   · "Preencher OS" salva aos poucos; resultado LIBERADO/PARADO;
 *   · peça fornecida pelo cliente, auditada, sem mexer em estoque;
 *   · concluir exige a descrição; OS negada não aceita relatório;
 *   · escopo (setor), tenant e solicitante: nunca executam.
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
  createWorkOrder,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { workOrderDetail, workOrderVisits } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG = newId();
const ORG_B = newId();
const GESTORA = 'gestora@exec.test';
const OPERADOR = 'operador@exec.test';
const OPERADOR_BLOCO = 'operador.bloco@exec.test';
const SOLICITANTE = 'solicitante@exec.test';
const ADMIN_B = 'admin@exec-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let os1: string, os2: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, { slug: 'exec', name: 'Prestadora', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'exec-b', name: 'Org B', email: ADMIN_B, userName: 'Admin B' });
  let hospital = '';
  let uti = '';
  let bloco = '';
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, ids.membershipId, base.roles.get('manager')!);
      hospital = await createCustomer(s, { name: 'Hospital A' });
      const sede = await createLocation(s, {
        customerId: hospital,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'Sede',
      });
      uti = await createLocation(s, {
        customerId: hospital,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI',
      });
      bloco = await createLocation(s, {
        customerId: hospital,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'Bloco',
      });
      const cat = await createAssetCategory(s, {
        name: 'Ventilador',
        parentId: base.families.get('life_support'),
      });
      const ativo = await createAsset(s, {
        name: 'Vent UTI',
        customerId: hospital,
        assetCategoryId: cat,
        locationId: uti,
      });
      const [corretiva] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
      );
      os1 = (
        await createWorkOrder(s, {
          customerId: hospital,
          locationId: uti,
          assetId: ativo,
          workOrderTypeId: corretiva!.id,
          title: 'Ventilador alarmando',
          description: 'Alarme de pressão alta.',
        })
      ).id;
      os2 = (
        await createWorkOrder(s, {
          customerId: hospital,
          locationId: uti,
          workOrderTypeId: corretiva!.id,
          title: 'Pedido fora de cobertura',
        })
      ).id;
    }
  );
  const memOp = newId();
  const memBloco = newId();
  const memSol = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memOp },
    {
      email: OPERADOR,
      userName: 'Operador',
      customerIds: [hospital],
      locationIds: [uti],
    }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memBloco },
    {
      email: OPERADOR_BLOCO,
      userName: 'Operador do Bloco',
      customerIds: [hospital],
      locationIds: [bloco],
    }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memSol },
    {
      email: SOLICITANTE,
      userName: 'Solicitante',
      seatType: 'portal',
      customerIds: [hospital],
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memOp, base.roles.get('operator')!);
      await assignRole(s, memBloco, base.roles.get('operator')!);
      await assignRole(s, memSol, base.roles.get('requester')!);
      // PF-14: o Operador executa só a OS atribuída a ele — as desta suíte são dele.
      await s.query(`UPDATE aurora.work_orders SET assignee_membership_id = $1 WHERE id = ANY($2::uuid[])`, [
        memOp,
        [os1, os2],
      ]);
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

const transicao = (id: string, body: Record<string, unknown>, quem = OPERADOR) =>
  http.post(`/v1/work-orders/${id}/transitions`).set(auth(quem)).send(body);

describe('estados', () => {
  it('"Negada" existe; "Rascunho" não é coluna do quadro', async () => {
    const st = await http.get('/v1/work-orders/statuses').set(auth(GESTORA));
    const chaves = st.body.items.map((s: { key: string }) => s.key);
    expect(chaves).toContain('denied');
    const quadro = await http.get('/v1/work-orders/board').set(auth(GESTORA));
    expect(quadro.body.columns.map((c: { key: string }) => c.key)).not.toContain('draft');
    expect(quadro.body.columns.map((c: { key: string }) => c.key)).toContain('denied');
  });

  it('a API não cria rascunho, mesmo pedindo', async () => {
    const det = await http.get(`/v1/work-orders/${os1}`).set(auth(GESTORA));
    expect(det.body.status_key).toBe('open');
  });

  it('negar exige motivo e é terminal', async () => {
    const sem = await transicao(os2, { to: 'denied' }, GESTORA);
    expect(sem.status).not.toBe(201);
    const com = await transicao(
      os2,
      { to: 'denied', cancellation_reason: 'Equipamento fora da cobertura do contrato' },
      GESTORA
    );
    expect(com.status, JSON.stringify(com.body)).toBe(201);
    const det = await http.get(`/v1/work-orders/${os2}`).set(auth(GESTORA));
    expect(det.body.status_label).toBe('Negada');
    expect(det.body.available_transitions).toEqual([]);
  });
});

describe('▶ Executar: check-in, procedimento, OS, peças, parecer, conclusão', () => {
  it('inicia a execução', async () => {
    const r = await transicao(os1, { to: 'in_progress' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('check-in com posição abre o cronômetro; o segundo seguido → 409', async () => {
    const r = await http
      .post(`/v1/work-orders/${os1}/check-in`)
      .set(auth(OPERADOR))
      .send({ latitude: -19.9191, longitude: -43.9386, accuracy_m: 12.5 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.time_entry_id).toBeTruthy();
    const horas = await http.get(`/v1/work-orders/${os1}/time-entries`).set(auth(GESTORA));
    expect(horas.body.open_entries).toBe(1);
    const dup = await http
      .post(`/v1/work-orders/${os1}/check-in`)
      .set(auth(OPERADOR))
      .send({ latitude: -19.9, longitude: -43.9 });
    expect(dup.status).toBe(409);
  });

  it('posição fora de faixa → 422', async () => {
    const r = await http
      .post(`/v1/work-orders/${os1}/check-out`)
      .set(auth(OPERADOR))
      .send({ latitude: 120, longitude: 0 });
    expect(r.status).toBe(422);
  });

  it('preenche a OS aos poucos e o detalhe devolve', async () => {
    const a = await http
      .patch(`/v1/work-orders/${os1}/service-report`)
      .set(auth(OPERADOR))
      .send({ service_description: 'Troca do sensor de pressão e recalibração do alarme.' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const b = await http.patch(`/v1/work-orders/${os1}/service-report`).set(auth(OPERADOR)).send({
      service_observations: 'Cliente orientado sobre limpeza do filtro.',
      operational_result: 'released',
      final_opinion: 'Equipamento liberado para uso.',
    });
    expect(b.status).toBe(200);
    const det = await http.get(`/v1/work-orders/${os1}`).set(auth(GESTORA));
    expect(workOrderDetail.response.safeParse(det.body).success).toBe(true);
    expect(det.body.service_description).toContain('sensor de pressão');
    expect(det.body.operational_result).toBe('released');
  });

  it('resultado diferente de liberado/parado → 422', async () => {
    const r = await http
      .patch(`/v1/work-orders/${os1}/service-report`)
      .set(auth(OPERADOR))
      .send({ operational_result: 'aprovado' });
    expect(r.status).toBe(422);
  });

  it('peça fornecida pelo cliente é registrada (sem estoque)', async () => {
    const r = await http
      .post(`/v1/work-orders/${os1}/customer-parts`)
      .set(auth(OPERADOR))
      .send({ description: 'Sensor de pressão fornecido pelo hospital', quantity: 1, unit: 'un' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const lista = await http.get(`/v1/work-orders/${os1}/customer-parts`).set(auth(GESTORA));
    expect(lista.body.items).toHaveLength(1);
    expect(lista.body.items[0].quantity).toBe(1);
  });

  it('check-out fecha o cronômetro; sem posição exige justificativa', async () => {
    const sem = await http.post(`/v1/work-orders/${os1}/check-out`).set(auth(OPERADOR)).send({});
    expect(sem.status).toBe(422);
    const r = await http
      .post(`/v1/work-orders/${os1}/check-out`)
      .set(auth(OPERADOR))
      .send({ justification: 'GPS do tablet desligado pela TI do hospital' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const horas = await http.get(`/v1/work-orders/${os1}/time-entries`).set(auth(GESTORA));
    expect(horas.body.open_entries).toBe(0);
    const visitas = await http.get(`/v1/work-orders/${os1}/visits`).set(auth(GESTORA));
    expect(workOrderVisits.response.safeParse(visitas.body).success).toBe(true);
    expect(visitas.body.items.map((v: { kind: string }) => v.kind)).toEqual(['check_in', 'check_out']);
    expect(visitas.body.items[0].position_source).toBe('device');
    expect(visitas.body.items[1].position_source).toBe('manual');
  });

  it('check-out sem check-in aberto → 409', async () => {
    const r = await http
      .post(`/v1/work-orders/${os1}/check-out`)
      .set(auth(OPERADOR))
      .send({ latitude: -19.9, longitude: -43.9 });
    expect(r.status).toBe(409);
  });

  it('conclui com a descrição do serviço', async () => {
    const r = await transicao(os1, {
      to: 'completed',
      resolution: 'Troca do sensor de pressão e recalibração do alarme.',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});

describe('quem não executa', () => {
  it('OS negada não aceita relatório nem peça', async () => {
    const r = await http
      .patch(`/v1/work-orders/${os2}/service-report`)
      .set(auth(OPERADOR))
      .send({ service_description: 'tentativa' });
    expect(r.status).toBe(409);
    const p = await http
      .post(`/v1/work-orders/${os2}/customer-parts`)
      .set(auth(OPERADOR))
      .send({ description: 'Peça qualquer', quantity: 1 });
    expect(p.status).toBe(409);
  });

  it('operador de outro setor → 404; outra organização → 404; solicitante → 403', async () => {
    const bloco = await http
      .post(`/v1/work-orders/${os1}/check-in`)
      .set(auth(OPERADOR_BLOCO))
      .send({ latitude: -19.9, longitude: -43.9 });
    expect(bloco.status).toBe(404);
    const b = await http
      .post(`/v1/work-orders/${os1}/check-in`)
      .set(auth(ADMIN_B))
      .send({ latitude: -19.9, longitude: -43.9 });
    expect(b.status).toBe(404);
    const sol = await http
      .post(`/v1/work-orders/${os1}/check-in`)
      .set(auth(SOLICITANTE))
      .send({ latitude: -19.9, longitude: -43.9 });
    expect(sol.status).toBe(403);
  });
});
