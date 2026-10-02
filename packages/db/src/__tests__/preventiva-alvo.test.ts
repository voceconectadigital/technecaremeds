/**
 * Aurora — preventiva por família, modelo, fabricante e criticidade (0055 · gap V2 P1.4),
 * o alvo recortado pelo cliente do plano, e o checklist da tarefa anexado à OS.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import {
  createAssetCategory,
  createAsset,
  createCriticality,
  findOrCreateManufacturer,
  findOrCreateAssetModel,
} from '../assets';
import { provisionWorkOrderStates } from '../work-orders';
import {
  createPlan,
  addPlanTask,
  resolveTargetAssets,
  generateCycle,
  materializeCycle,
} from '../maintenance-plans';
import { createChecklistTemplate, addChecklistItem, publishChecklist } from '../execution';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'alvo',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let clienteA = '';
let clienteB = '';
let unidadeA = '';
let catVent = '';
let natureza = '';
let draeger = '';
let modeloX = '';
let critAlta = '';
const ativos: Record<string, string> = {};
const ontem = new Date(Date.now() - 86_400_000);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'alvo', name: 'Prestadora', email: 'a@alvo.test', userName: 'A' }
  );
  await withTenant(t.db, ctx, async (s) => {
    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    clienteA = await createCustomer(s, { name: 'Hospital A', isInternal: false });
    clienteB = await createCustomer(s, { name: 'Hospital B', isInternal: false });
    unidadeA = await createLocation(s, {
      customerId: clienteA,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede A',
    });
    const unidadeB = await createLocation(s, {
      customerId: clienteB,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede B',
    });
    catVent = await createAssetCategory(s, { name: 'Ventilador' });
    draeger = (await findOrCreateManufacturer(s, 'Dräger')).id;
    const outroFab = (await findOrCreateManufacturer(s, 'Outro Fabricante')).id;
    modeloX = (
      await findOrCreateAssetModel(s, { manufacturerId: draeger, categoryId: catVent, name: 'Evita X' })
    ).id;
    const modeloY = (
      await findOrCreateAssetModel(s, { manufacturerId: draeger, categoryId: catVent, name: 'Savina Y' })
    ).id;
    const modeloZ = (
      await findOrCreateAssetModel(s, { manufacturerId: outroFab, categoryId: catVent, name: 'Z' })
    ).id;
    critAlta = await createCriticality(s, { name: 'Alta', score: 3 });
    const critBaixa = await createCriticality(s, { name: 'Baixa', score: 1 });

    const novo = (nome: string, cliente: string, local: string, modelo: string, crit: string) =>
      createAsset(s, {
        name: nome,
        customerId: cliente,
        assetCategoryId: catVent,
        locationId: local,
        assetModelId: modelo,
        criticalityId: crit,
      });
    ativos.xAlta = await novo('A · Evita X alta', clienteA, unidadeA, modeloX, critAlta);
    ativos.xBaixa = await novo('A · Evita X baixa', clienteA, unidadeA, modeloX, critBaixa);
    ativos.yAlta = await novo('A · Savina Y alta', clienteA, unidadeA, modeloY, critAlta);
    ativos.zAlta = await novo('A · Z alta', clienteA, unidadeA, modeloZ, critAlta);
    // o ventilador do OUTRO cliente, mesma categoria, mesmo modelo
    ativos.bX = await novo('B · Evita X alta', clienteB, unidadeB, modeloX, critAlta);

    natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

async function tarefa(filtros: {
  filterAssetModelId?: string;
  filterManufacturerId?: string;
  filterCriticalityId?: string;
  checklistTemplateKey?: string;
}): Promise<string> {
  return withTenant(t.db, ctx, async (s) => {
    const plano = await createPlan(s, {
      name: `Plano ${newId().slice(-6)}`,
      customerId: clienteA,
      anchorDate: ontem,
    });
    return addPlanTask(s, {
      planId: plano,
      name: 'Preventiva semestral',
      targetKind: 'asset_category',
      targetCategoryId: catVent,
      workOrderTypeId: natureza,
      frequencyUnit: 'semester',
      ...filtros,
    });
  });
}

const nomes = (ids: string[]) =>
  ids.map((id) => Object.entries(ativos).find(([, v]) => v === id)?.[0]).sort();

describe('o alvo é recortado pelo cliente do plano (defeito da 0029)', () => {
  it('a categoria do plano do Hospital A não alcança o ventilador do Hospital B', async () => {
    const id = await tarefa({});
    const alcance = await withTenant(t.db, ctx, (s) => resolveTargetAssets(s, id));
    expect(nomes(alcance)).toEqual(['xAlta', 'xBaixa', 'yAlta', 'zAlta']);
    expect(alcance).not.toContain(ativos.bX);
  });
});

describe('filtros sobre o alvo', () => {
  it('por modelo', async () => {
    const id = await tarefa({ filterAssetModelId: modeloX });
    expect(nomes(await withTenant(t.db, ctx, (s) => resolveTargetAssets(s, id)))).toEqual([
      'xAlta',
      'xBaixa',
    ]);
  });

  it('por fabricante — atravessa os modelos dele', async () => {
    const id = await tarefa({ filterManufacturerId: draeger });
    expect(nomes(await withTenant(t.db, ctx, (s) => resolveTargetAssets(s, id)))).toEqual([
      'xAlta',
      'xBaixa',
      'yAlta',
    ]);
  });

  it('por criticidade — igualdade, sem inventar "a partir de"', async () => {
    const id = await tarefa({ filterCriticalityId: critAlta });
    expect(nomes(await withTenant(t.db, ctx, (s) => resolveTargetAssets(s, id)))).toEqual([
      'xAlta',
      'yAlta',
      'zAlta',
    ]);
  });

  it('os filtros se somam (família E fabricante E risco)', async () => {
    const id = await tarefa({ filterManufacturerId: draeger, filterCriticalityId: critAlta });
    expect(nomes(await withTenant(t.db, ctx, (s) => resolveTargetAssets(s, id)))).toEqual(['xAlta', 'yAlta']);
  });

  it('o ativo novo que casa com o filtro entra sozinho no próximo ciclo', async () => {
    const id = await tarefa({ filterAssetModelId: modeloX });
    const novo = await withTenant(t.db, ctx, (s) =>
      createAsset(s, {
        name: 'A · Evita X recém-chegado',
        customerId: clienteA,
        assetCategoryId: catVent,
        locationId: unidadeA,
        assetModelId: modeloX,
      })
    );
    expect(await withTenant(t.db, ctx, (s) => resolveTargetAssets(s, id))).toContain(novo);
  });

  it('filtro em alvo de ativo único é recusado — o ativo já é o alvo inteiro', async () => {
    await expect(
      withTenant(t.db, ctx, async (s) => {
        const plano = await createPlan(s, { name: 'Único', customerId: clienteA, anchorDate: ontem });
        return addPlanTask(s, {
          planId: plano,
          name: 'x',
          targetKind: 'asset',
          targetAssetId: ativos.xAlta,
          workOrderTypeId: natureza,
          frequencyUnit: 'year',
          filterCriticalityId: critAlta,
        });
      })
    ).rejects.toThrow(/plan_tasks_filters_need_scope/);
  });
});

describe('o checklist da tarefa vai junto com a OS', () => {
  it('materializar anexa a versão publicada mais recente da chave', async () => {
    await withTenant(t.db, ctx, async (s) => {
      const v1 = await createChecklistTemplate(s, { key: 'prev_vent', title: 'Preventiva de ventilador' });
      await addChecklistItem(s, {
        templateId: v1,
        kind: 'boolean',
        label: 'Alarmes ok',
        expectedBoolean: true,
      });
      await publishChecklist(s, v1);
    });
    const id = await tarefa({ filterAssetModelId: modeloX, checklistTemplateKey: 'prev_vent' });
    const anexados = await withTenant(t.db, ctx, async (s) => {
      const ciclo = await generateCycle(s, id, new Date());
      await materializeCycle(s, ciclo!.cycleId);
      return s.query<{ template_key: string; c: number }>(
        `SELECT r.template_key, count(*)::int AS c
           FROM aurora.plan_cycle_items i
           JOIN aurora.checklist_responses r ON r.work_order_id = i.work_order_id
          WHERE i.cycle_id = $1 GROUP BY r.template_key`,
        [ciclo!.cycleId]
      );
    });
    // três Evita X do Hospital A: os dois do arranjo e o recém-chegado do caso anterior
    expect(anexados).toEqual([{ template_key: 'prev_vent', c: 3 }]);
  });

  it('chave sem versão publicada não trava a preventiva — e a OS diz que o checklist faltou', async () => {
    const id = await tarefa({ filterCriticalityId: critAlta, checklistTemplateKey: 'nunca_publicado' });
    const descricoes = await withTenant(t.db, ctx, async (s) => {
      const ciclo = await generateCycle(s, id, new Date());
      await materializeCycle(s, ciclo!.cycleId);
      return s.query<{ description: string; respostas: number }>(
        `SELECT w.description,
                (SELECT count(*)::int FROM aurora.checklist_responses r WHERE r.work_order_id = w.id) AS respostas
           FROM aurora.plan_cycle_items i JOIN aurora.work_orders w ON w.id = i.work_order_id
          WHERE i.cycle_id = $1`,
        [ciclo!.cycleId]
      );
    });
    expect(descricoes.length).toBe(3);
    for (const d of descricoes) {
      expect(d.respostas).toBe(0);
      expect(d.description).toMatch(/"nunca_publicado".*não foi anexado/);
    }
  });
});
