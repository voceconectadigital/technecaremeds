/**
 * Aurora — Qualidade: espelhamento dos serviços concluídos (pedido de Anderson, 06/11/2026).
 *
 * "Cada manutenção preventiva que for concluída vai para lá. Cada calibração que for concluída,
 * vai para lá. Cada qualificação que for concluída, vai para lá."
 *
 *   · entram as OS CONCLUÍDAS (Concluída, Validada, Fechada) de preventiva, calibração, TSE e
 *     qualificação — com plano, procedimentos (um por resposta), equipamento e parecer;
 *   · não entram rascunho, aberta, em execução, cancelada, negada nem corretiva;
 *   · consultar de novo (ou concluir de novo depois de reabrir) não duplica: é consulta derivada;
 *   · OS concluída ANTES desta mudança aparece (não há backfill a fazer);
 *   · escopo de cliente/setor e isolamento entre organizações; sem `work_order.read`, 403;
 *   · nada vira certificado: a lista de certificados continua a mesma.
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
  createPlan,
  addPlanTask,
  generateCycle,
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  attachChecklist,
  createWorkOrder,
  transitionWorkOrder,
  provisionOrganizationBaseline,
  type TenantSession,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';
import { armazenamentoEmMemoria } from '../common/arquivos/memoria';

const ORG_A = newId();
const ORG_B = newId();
const GESTORA = 'gestora@serv-a.test';
const RESTRITA = 'restrita@serv-a.test';
const SO_DOCS = 'docs@serv-a.test';
const ADMIN_B = 'admin@serv-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospital: string, outroHospital: string;
const os: Record<string, { id: string; number: string | null }> = {};
let respostaPrev = '';
let respostaPrev2 = '';

const sistema = (org: string) =>
  buildContext({ organizationId: org, actorKind: 'system', requestId: 's', permissions: PERMISSION_KEYS });

async function natureza(s: TenantSession, k: string): Promise<string> {
  return (
    await s.query<{ id: string }>(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = $1`,
      [k]
    )
  )[0]!.id;
}

/** Abre, executa e conclui (Concluída = categoria `review`) uma OS de equipamento. */
async function concluida(
  s: TenantSession,
  o: { customerId: string; assetId: string; tipo: string; title: string }
) {
  const w = await createWorkOrder(s, {
    customerId: o.customerId,
    workOrderTypeId: await natureza(s, o.tipo),
    title: o.title,
    assetId: o.assetId,
  });
  await transitionWorkOrder(s, w.id, 'in_progress');
  await transitionWorkOrder(s, w.id, 'completed', {
    resolution: 'Serviço executado conforme o procedimento',
    operationalResult: 'released',
  });
  return w;
}

beforeAll(async () => {
  t = await createTestDatabase();
  const idsA = { organizationId: ORG_A, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, idsA, { slug: 'serv-a', name: 'Org A', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'serv-b', name: 'Org B', email: ADMIN_B, userName: 'Admin B' });

  await withTenant(t.db, sistema(ORG_A), async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, idsA.membershipId, base.roles.get('maintenance_manager')!);
    hospital = await createCustomer(s, { name: 'Hospital Alfa' });
    outroHospital = await createCustomer(s, { name: 'Hospital Beta' });
    const local = async (customerId: string, nome: string) => {
      const sede = await createLocation(s, {
        customerId,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: `Sede ${nome}`,
      });
      return createLocation(s, {
        customerId,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: `UTI ${nome}`,
      });
    };
    const utiA = await local(hospital, 'Alfa');
    const utiB = await local(outroHospital, 'Beta');
    const cat = await createAssetCategory(s, { name: 'Monitor' });
    const monitorA = await createAsset(s, {
      name: 'Monitor 01',
      customerId: hospital,
      assetCategoryId: cat,
      locationId: utiA,
    });
    const monitorB = await createAsset(s, {
      name: 'Monitor 99',
      customerId: outroHospital,
      assetCategoryId: cat,
      locationId: utiB,
    });

    // Dois procedimentos publicados: a OS de preventiva executa os dois (correspondência preservada).
    const prev = await createChecklistTemplate(s, { key: 'prev_mon', title: 'Preventiva de monitor' });
    await addChecklistItem(s, { templateId: prev, kind: 'boolean', label: 'Alarmes ok?', required: true });
    await publishChecklist(s, prev);
    const tse = await createChecklistTemplate(s, {
      key: 'tse_mon',
      title: 'TSE de monitor',
      procedureKind: 'electrical_safety',
    });
    await addChecklistItem(s, { templateId: tse, kind: 'number', label: 'Corrente de fuga', unit: 'µA' });
    await publishChecklist(s, tse);

    // O plano de origem: a OS de preventiva nasce de um item de ciclo.
    const plano = await createPlan(s, {
      name: 'Preventiva UTI Alfa',
      customerId: hospital,
      autoGenerate: false,
      anchorDate: new Date('2026-01-01T00:00:00Z'),
    });
    const tarefa = await addPlanTask(s, {
      planId: plano,
      name: 'Preventiva trimestral',
      targetKind: 'location_subtree',
      targetLocationId: utiA,
      workOrderTypeId: await natureza(s, 'preventive'),
      frequencyUnit: 'quarter',
      leadTimeDays: 3650,
      toleranceDays: 5,
      checklistTemplateKey: 'prev_mon',
    });
    await generateCycle(s, tarefa);

    const wPrev = await createWorkOrder(s, {
      customerId: hospital,
      workOrderTypeId: await natureza(s, 'preventive'),
      title: 'Preventiva do monitor 01',
      assetId: monitorA,
      source: 'plan',
    });
    const [item] = await s.query<{ id: string }>(
      `SELECT i.id FROM aurora.plan_cycle_items i WHERE i.task_id = $1 AND i.asset_id = $2 LIMIT 1`,
      [tarefa, monitorA]
    );
    await s.query(
      `UPDATE aurora.plan_cycle_items SET status = 'generated', work_order_id = $2 WHERE id = $1`,
      [item!.id, wPrev.id]
    );
    respostaPrev = await attachChecklist(s, wPrev.id, prev);
    respostaPrev2 = await attachChecklist(s, wPrev.id, tse);
    await transitionWorkOrder(s, wPrev.id, 'in_progress');
    await transitionWorkOrder(s, wPrev.id, 'completed', {
      resolution: 'Preventiva executada',
      operationalResult: 'released',
    });
    os.prev = wPrev;

    os.cal = await concluida(s, {
      customerId: hospital,
      assetId: monitorA,
      tipo: 'calibration',
      title: 'Calibração do monitor 01',
    });
    os.tse = await concluida(s, {
      customerId: hospital,
      assetId: monitorA,
      tipo: 'electrical_safety',
      title: 'TSE do monitor 01',
    });
    os.qual = await concluida(s, {
      customerId: hospital,
      assetId: monitorA,
      tipo: 'qualification',
      title: 'Qualificação do monitor 01',
    });
    os.calB = await concluida(s, {
      customerId: outroHospital,
      assetId: monitorB,
      tipo: 'calibration',
      title: 'Calibração do monitor 99',
    });
    os.corretiva = await concluida(s, {
      customerId: hospital,
      assetId: monitorA,
      tipo: 'corrective',
      title: 'Corretiva do monitor 01',
    });

    // O que NÃO pode entrar.
    os.aberta = await createWorkOrder(s, {
      customerId: hospital,
      workOrderTypeId: await natureza(s, 'calibration'),
      title: 'Calibração ainda aberta',
      assetId: monitorA,
    });
    os.emExecucao = await createWorkOrder(s, {
      customerId: hospital,
      workOrderTypeId: await natureza(s, 'calibration'),
      title: 'Calibração em execução',
      assetId: monitorA,
    });
    await transitionWorkOrder(s, os.emExecucao.id, 'in_progress');
    os.rascunho = await createWorkOrder(s, {
      customerId: hospital,
      workOrderTypeId: await natureza(s, 'qualification'),
      title: 'Qualificação em rascunho',
      assetId: monitorA,
      publish: false,
    });
    os.cancelada = await createWorkOrder(s, {
      customerId: hospital,
      workOrderTypeId: await natureza(s, 'preventive'),
      title: 'Preventiva cancelada',
      assetId: monitorA,
    });
    await transitionWorkOrder(s, os.cancelada.id, 'cancelled', {
      cancellationReason: 'Equipamento emprestado a outra unidade',
    });
  });

  // Restrita: só o Hospital Alfa. Só-documentos: lê certificados mas não OS.
  const memRestrita = newId();
  const memDocs = newId();
  await seedMember(
    t,
    { organizationId: ORG_A, userId: newId(), membershipId: memRestrita },
    { email: RESTRITA, userName: 'Restrita', customerIds: [hospital] }
  );
  await seedMember(
    t,
    { organizationId: ORG_A, userId: newId(), membershipId: memDocs },
    { email: SO_DOCS, userName: 'Só documentos' }
  );
  await withTenant(t.db, sistema(ORG_A), async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, memRestrita, base.roles.get('maintenance_manager')!);
    const papel = newId();
    await s.query(
      `INSERT INTO aurora.roles (id, organization_id, key, name) VALUES ($1, $2, 'so_docs', 'Só documentos')`,
      [papel, ORG_A]
    );
    await s.query(
      `INSERT INTO aurora.role_permissions (organization_id, role_id, permission_key) VALUES ($1, $2, 'document.read')`,
      [ORG_A, papel]
    );
    await assignRole(s, memDocs, papel);
  });
  await withTenant(t.db, sistema(ORG_B), async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, idsB.membershipId, base.roles.get('admin')!);
  });

  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);
  app = await createApp({ db: t.db, env, arquivos: armazenamentoEmMemoria() });
  await app.init();
  http = request(app.getHttpServer());
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

const servicos = (quem: string, query: Record<string, string> = {}) =>
  http.get('/v1/quality-records/services').query(query).set(auth(quem));
type Item = {
  work_order_id: string;
  kind: string;
  category: string;
  status_label: string;
  plan_name: string | null;
  plan_task_name: string | null;
  procedures: { response_id: string; title: string; version: number; procedure_kind: string | null }[];
  operational_result: string | null;
  asset_name: string | null;
  customer_name: string | null;
  completed_at: string | null;
};
const ids = (r: { body: { items: Item[] } }) => r.body.items.map((i) => i.work_order_id);

describe('o que entra e o que fica de fora', () => {
  it('as quatro naturezas concluídas entram; corretiva, aberta, em execução, rascunho e cancelada não', async () => {
    const r = await servicos(GESTORA);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const lista = ids(r);
    for (const k of ['prev', 'cal', 'tse', 'qual', 'calB']) expect(lista).toContain(os[k]!.id);
    for (const k of ['corretiva', 'aberta', 'emExecucao', 'rascunho', 'cancelada']) {
      expect(lista).not.toContain(os[k]!.id);
    }
    const tipos = new Set(r.body.items.map((i: Item) => i.kind));
    expect([...tipos].sort()).toEqual(['calibration', 'electrical_safety', 'preventive', 'qualification']);
  });

  it('a preventiva traz o plano de origem e os DOIS procedimentos, cada um com a sua resposta', async () => {
    const r = await servicos(GESTORA, { kind: 'preventive' });
    const prev = (r.body.items as Item[]).find((i) => i.work_order_id === os.prev!.id)!;
    expect(prev.plan_name).toBe('Preventiva UTI Alfa');
    expect(prev.plan_task_name).toBe('Preventiva trimestral');
    expect(prev.procedures.map((p) => p.response_id).sort()).toEqual([respostaPrev, respostaPrev2].sort());
    expect(prev.procedures.map((p) => p.title).sort()).toEqual(['Preventiva de monitor', 'TSE de monitor']);
    expect(prev.procedures.every((p) => p.version === 1)).toBe(true);
    expect(prev.operational_result).toBe('released');
    expect(prev.category).toBe('review');
    expect(prev.completed_at).not.toBeNull();
    expect(prev.asset_name).toBe('Monitor 01');
  });

  it('OS avulsa (sem plano) entra com plano nulo — "não se aplica", não inventado', async () => {
    const r = await servicos(GESTORA, { kind: 'calibration' });
    const cal = (r.body.items as Item[]).find((i) => i.work_order_id === os.cal!.id)!;
    expect(cal.plan_name).toBeNull();
    expect(cal.procedures).toEqual([]);
  });

  it('filtros: tipo, cliente, busca e período de conclusão', async () => {
    expect(ids(await servicos(GESTORA, { kind: 'qualification' }))).toEqual([os.qual!.id]);
    expect(ids(await servicos(GESTORA, { customer: outroHospital }))).toEqual([os.calB!.id]);
    expect(ids(await servicos(GESTORA, { q: 'UTI Alfa' }))).toEqual([os.prev!.id]);
    expect(ids(await servicos(GESTORA, { q: os.tse!.number! }))).toEqual([os.tse!.id]);
    const hoje = new Date().toISOString().slice(0, 10);
    expect(ids(await servicos(GESTORA, { from: '2000-01-01', to: '2000-12-31' }))).toEqual([]);
    expect(ids(await servicos(GESTORA, { from: '2000-01-01', to: '2999-12-31' })).length).toBe(5);
    expect(hoje).toMatch(/^\d{4}-/);
  });

  it('parâmetro inválido é 422, não 500', async () => {
    expect((await servicos(GESTORA, { kind: 'corrective' })).status).toBe(422);
    expect((await servicos(GESTORA, { from: '31/12/2026' })).status).toBe(422);
  });
});

describe('idempotência e histórico', () => {
  it('consultar de novo não duplica, e nada é gravado em quality_records', async () => {
    const a = await servicos(GESTORA);
    const b = await servicos(GESTORA);
    expect(ids(b)).toEqual(ids(a));
    expect(new Set(ids(b)).size).toBe(ids(b).length);
    const certificados = await http.get('/v1/quality-records').set(auth(GESTORA));
    expect(certificados.body.items).toEqual([]);
  });

  it('reabrir tira da lista; concluir de novo devolve UMA linha, não duas', async () => {
    await withTenant(t.db, sistema(ORG_A), async (s) => {
      await transitionWorkOrder(s, os.qual!.id, 'in_progress', {
        reworkReason: 'Refazer a qualificação',
        reopenReason: 'Refazer a qualificação',
      });
    });
    expect(ids(await servicos(GESTORA))).not.toContain(os.qual!.id);
    await withTenant(t.db, sistema(ORG_A), async (s) => {
      await transitionWorkOrder(s, os.qual!.id, 'completed', {
        resolution: 'Qualificação refeita',
        operationalResult: 'released',
      });
    });
    const lista = ids(await servicos(GESTORA));
    expect(lista.filter((x) => x === os.qual!.id)).toHaveLength(1);
  });

  it('validada continua na lista, com a situação nova', async () => {
    await withTenant(t.db, sistema(ORG_A), async (s) => {
      await transitionWorkOrder(s, os.tse!.id, 'validated');
    });
    const r = await servicos(GESTORA, { kind: 'electrical_safety' });
    const tse = (r.body.items as Item[]).find((i) => i.work_order_id === os.tse!.id)!;
    expect(tse.category).toBe('done');
    expect(tse.status_label).toBe('Validada');
  });
});

describe('perfis e organizações', () => {
  it('escopo restrito ao Hospital Alfa não vê a calibração do Hospital Beta', async () => {
    const r = await servicos(RESTRITA);
    expect(r.status).toBe(200);
    expect(ids(r)).toContain(os.cal!.id);
    expect(ids(r)).not.toContain(os.calB!.id);
    expect(ids(await servicos(RESTRITA, { customer: outroHospital }))).toEqual([]);
  });

  it('quem lê documentos mas não lê OS recebe 403', async () => {
    expect((await servicos(SO_DOCS)).status).toBe(403);
  });

  it('outra organização não vê nada da primeira', async () => {
    const r = await servicos(ADMIN_B);
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
  });
});

describe('relatório de serviço (folha da OS)', () => {
  it('os checklists da OS trazem o título do procedimento e o campo das leituras', async () => {
    const r = await http.get(`/v1/work-orders/${os.prev!.id}/checklists`).set(auth(GESTORA));
    expect(r.status).toBe(200);
    const titulos = r.body.items.map((c: { template_title: string }) => c.template_title).sort();
    expect(titulos).toEqual(['Preventiva de monitor', 'TSE de monitor']);
  });

  it('a OS de escopo alheio continua 404 para a restrita (o link do relatório não vaza)', async () => {
    const r = await http.get(`/v1/work-orders/${os.calB!.id}`).set(auth(RESTRITA));
    expect(r.status).toBe(404);
  });
});
