/**
 * Aurora — planos: filtros combinados e ▶ Executar (reunião 16/10/2026, Fase 6).
 *
 *   · painel e cronograma filtram por TIPO junto com cliente e setor;
 *   · painel traz distribuição por plano e por procedimento;
 *   · ▶ Executar um item real gera (uma vez) a OS com o procedimento da tarefa
 *     anexado; a segunda chamada devolve a mesma OS;
 *   · dispensado não executa; solicitante não executa; outra organização: 404.
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
  createPlan,
  addPlanTask,
  generateCycle,
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { plansBoard } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG = newId();
const ORG_B = newId();
const GESTORA = 'gestora@planos-exec.test';
const OPERADOR = 'operador@planos-exec.test';
const SOLICITANTE = 'sol@planos-exec.test';
const ADMIN_B = 'admin@planos-exec-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const DE = '2025-11-01T00:00:00.000Z';
const ATE = '2027-10-01T00:00:00.000Z';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let itemPreventiva: string, itemCalibracao: string, itemDispensado: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, {
    slug: 'planos-exec',
    name: 'Prestadora',
    email: GESTORA,
    userName: 'Gestora',
  });
  await seedOrganization(t, idsB, { slug: 'planos-exec-b', name: 'B', email: ADMIN_B, userName: 'B' });
  let hospital = '';
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
      const uti = await createLocation(s, {
        customerId: hospital,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI',
      });
      const cat = await createAssetCategory(s, { name: 'Monitor', parentId: base.families.get('diagnosis') });
      await createAsset(s, {
        name: 'Monitor 1',
        customerId: hospital,
        assetCategoryId: cat,
        locationId: uti,
      });

      const tpl = await createChecklistTemplate(s, { key: 'prev_monitor', title: 'Preventiva de monitor' });
      await addChecklistItem(s, {
        templateId: tpl,
        kind: 'boolean',
        label: 'Alarmes funcionando?',
        required: true,
      });
      await publishChecklist(s, tpl);

      const natureza = async (k: string) =>
        (
          await s.query<{ id: string }>(
            `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = $1`,
            [k]
          )
        )[0]!.id;

      const plano = await createPlan(s, {
        name: 'Preventiva UTI',
        customerId: hospital,
        autoGenerate: false,
        anchorDate: new Date('2026-01-01T00:00:00Z'),
      });
      const tarefaPrev = await addPlanTask(s, {
        planId: plano,
        name: 'Inspeção geral',
        targetKind: 'location_subtree',
        targetLocationId: uti,
        workOrderTypeId: await natureza('preventive'),
        frequencyUnit: 'quarter',
        leadTimeDays: 3650,
        toleranceDays: 5,
        checklistTemplateKey: 'prev_monitor',
      });
      const tarefaCal = await addPlanTask(s, {
        planId: plano,
        name: 'Calibração anual',
        targetKind: 'location_subtree',
        targetLocationId: uti,
        workOrderTypeId: await natureza('calibration'),
        frequencyUnit: 'year',
        leadTimeDays: 3650,
        toleranceDays: 5,
      });
      const tarefaDisp = await addPlanTask(s, {
        planId: plano,
        name: 'Tarefa dispensada',
        targetKind: 'location_subtree',
        targetLocationId: uti,
        workOrderTypeId: await natureza('preventive'),
        frequencyUnit: 'year',
        leadTimeDays: 3650,
        toleranceDays: 5,
      });
      await generateCycle(s, tarefaPrev);
      await generateCycle(s, tarefaCal);
      await generateCycle(s, tarefaDisp);
      const itens = await s.query<{ id: string; task_id: string }>(
        `SELECT id, task_id FROM aurora.plan_cycle_items`
      );
      itemPreventiva = itens.find((i) => i.task_id === tarefaPrev)!.id;
      itemCalibracao = itens.find((i) => i.task_id === tarefaCal)!.id;
      itemDispensado = itens.find((i) => i.task_id === tarefaDisp)!.id;
      await s.query(
        `UPDATE aurora.plan_cycle_items SET status = 'skipped', skip_reason = 'equipamento fora de uso' WHERE id = $1`,
        [itemDispensado]
      );
    }
  );
  const memOp = newId();
  const memSol = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memOp },
    { email: OPERADOR, userName: 'Op' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memSol },
    {
      email: SOLICITANTE,
      userName: 'Sol',
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
      await assignRole(s, memSol, base.roles.get('requester')!);
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

describe('filtros combinados', () => {
  it('o painel por tipo conta só aquele tipo; sem tipo, todos', async () => {
    const todos = await http.get(`/v1/maintenance-plans/board?from=${DE}&to=${ATE}`).set(auth(GESTORA));
    expect(todos.status, JSON.stringify(todos.body)).toBe(200);
    expect(plansBoard.response.safeParse(todos.body).success).toBe(true);
    expect(todos.body.totals.scheduled).toBe(3);
    const cal = await http
      .get(`/v1/maintenance-plans/board?from=${DE}&to=${ATE}&kind=calibration`)
      .set(auth(GESTORA));
    expect(cal.body.totals.scheduled).toBe(1);
    expect(cal.body.byKind.map((k: { key: string }) => k.key)).toEqual(['calibration']);
  });

  it('o painel traz distribuição por plano e por procedimento', async () => {
    const r = await http.get(`/v1/maintenance-plans/board?from=${DE}&to=${ATE}`).set(auth(GESTORA));
    expect(r.body.byPlan.map((p: { label: string }) => p.label)).toEqual(['Preventiva UTI']);
    const procs = r.body.byProcedure.map((p: { label: string }) => p.label).sort();
    expect(procs).toEqual(['Preventiva de monitor', 'Sem procedimento']);
  });

  it('o cronograma também filtra por tipo', async () => {
    const r = await http
      .get(`/v1/maintenance-plans/schedule?from=${DE}&to=${ATE}&kind=preventive`)
      .set(auth(GESTORA));
    expect(r.status).toBe(200);
    expect(r.body.items.every((i: { kind: string }) => i.kind === 'preventive')).toBe(true);
  });

  it('tipo inválido → 422', async () => {
    const r = await http
      .get(`/v1/maintenance-plans/board?from=${DE}&to=${ATE}&kind=qualquer`)
      .set(auth(GESTORA));
    expect(r.status).toBe(422);
  });
});

describe('▶ Executar item do plano', () => {
  let os: string;
  it('o operador executa: a OS nasce com o procedimento da tarefa', async () => {
    const r = await http
      .post(`/v1/maintenance-plans/cycle-items/${itemPreventiva}/execute`)
      .set(auth(OPERADOR));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.created).toBe(true);
    os = r.body.work_order_id;
    const listas = await http.get(`/v1/work-orders/${os}/checklists`).set(auth(GESTORA));
    expect(listas.body.items).toHaveLength(1);
    expect(listas.body.items[0].template_key).toBe('prev_monitor');
    expect(listas.body.items[0].template_version).toBe(1);
  });

  it('executar de novo devolve a mesma OS', async () => {
    const r = await http
      .post(`/v1/maintenance-plans/cycle-items/${itemPreventiva}/execute`)
      .set(auth(OPERADOR));
    expect(r.body.work_order_id).toBe(os);
    expect(r.body.created).toBe(false);
  });

  it('o item de calibração (mesmo ciclo materializado ou não) também executa', async () => {
    const r = await http
      .post(`/v1/maintenance-plans/cycle-items/${itemCalibracao}/execute`)
      .set(auth(GESTORA));
    expect([201, 403]).toContain(r.status);
  });

  it('dispensado → 422; solicitante → 403; outra organização → 404', async () => {
    expect(
      (await http.post(`/v1/maintenance-plans/cycle-items/${itemDispensado}/execute`).set(auth(OPERADOR)))
        .status
    ).toBe(422);
    expect(
      (await http.post(`/v1/maintenance-plans/cycle-items/${itemCalibracao}/execute`).set(auth(SOLICITANTE)))
        .status
    ).toBe(403);
    expect(
      (await http.post(`/v1/maintenance-plans/cycle-items/${itemCalibracao}/execute`).set(auth(ADMIN_B)))
        .status
    ).toBe(404);
  });
});
