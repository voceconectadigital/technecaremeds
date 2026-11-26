/**
 * Regularização dos planos antigos com procedimento errado (26/11/2026).
 *
 * Ensaia, com dados sintéticos, a sequência que será proposta para produção:
 * desligar o plano antigo, DISPENSAR (não cancelar) os itens das OS intocadas,
 * preservar a OS em execução e criar o plano novo com um procedimento por
 * equipamento, sem duplicar OS e sem nada voltar a gerar a OS errada.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant, type TenantSession } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, transitionWorkOrder } from '../work-orders';
import { createChecklistTemplate, addChecklistItem, publishChecklist } from '../execution';
import { addComment } from '../work-order-detail';
import { createContract, addCoverage, activateContract } from '../contracts';
import { holdContractService, releaseContractService, organizationToday } from '../contract-service';
import {
  materializeCycle,
  restoreHeldCycleItems,
  setPlanActive,
  skipCycleItem,
  sweepPlans,
} from '../maintenance-plans';
import { createGuidedPlan, executePlanItem, updatePlanTask } from '../plan-board';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'regulariza-2611',
  permissions: PERMISSION_KEYS,
});
const TUDO = { customerIds: null, locationPaths: null };

let t: TestDatabase;
let hoje: string;

let cliente: string, setor: string, contrato: string;
let vent: string, mon: string, bomba: string;

const em = <T>(fn: (s: TenantSession) => Promise<T>) => withTenant(t.db, ctx, fn);

interface ItemOs {
  item_id: string;
  item: string;
  asset_id: string;
  due: string;
  os_id: string | null;
  os_sit: string | null;
  procs: string | null;
}

/** Itens e OS de um plano, com o procedimento que cada OS recebeu. */
const itensDo = (planId: string) =>
  em((s) =>
    s.query<ItemOs>(
      `SELECT i.id AS item_id, i.status::text AS item, i.asset_id, i.due_at::date::text AS due,
              w.id AS os_id, w.status_category::text AS os_sit,
              (SELECT string_agg(cr.template_key, '+' ORDER BY cr.template_key)
                 FROM aurora.checklist_responses cr WHERE cr.work_order_id = w.id) AS procs
         FROM aurora.plan_cycle_items i
         JOIN aurora.plan_cycles c ON c.id = i.cycle_id
         LEFT JOIN aurora.work_orders w ON w.id = i.work_order_id
        WHERE c.plan_id = $1
        ORDER BY c.seq, i.asset_id`,
      [planId]
    )
  );

/** OS não canceladas e não concluídas de cada equipamento do cliente. */
const abertasPorEquipamento = () =>
  em((s) =>
    s.query<{ asset_id: string; n: number }>(
      `SELECT asset_id, count(*)::int AS n FROM aurora.work_orders
        WHERE customer_id = $1 AND status_category NOT IN ('cancelled', 'done', 'closed')
        GROUP BY asset_id`,
      [cliente]
    )
  );

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'regulariza-2611', name: 'Prestadora', email: 'a@regulariza-2611.test', userName: 'Ana' }
  );
  await em(async (s) => {
    hoje = await organizationToday(s);
    await provisionWorkOrderStates(s);
    const catVent = await createAssetCategory(s, { name: 'Ventilador pulmonar' });
    const catMon = await createAssetCategory(s, { name: 'Monitor multiparamétrico' });
    const catBomba = await createAssetCategory(s, { name: 'Bomba de infusão' });
    await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });
    for (const [key, title] of [
      ['prev_incubadora', 'Preventiva de incubadora'], // o procedimento ERRADO dos planos antigos
      ['prev_ventilador', 'Preventiva de ventilador pulmonar'],
      ['prev_monitor', 'Preventiva de monitor multiparamétrico'],
      ['prev_bomba', 'Preventiva de bomba de infusão'],
    ] as const) {
      const tpl = await createChecklistTemplate(s, { key, title });
      await addChecklistItem(s, { templateId: tpl, kind: 'boolean', label: 'Funciona?' });
      await publishChecklist(s, tpl);
    }
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Cliente sintético' });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade',
    });
    setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'Imagem',
    });
    const novo = (name: string, cat: string) =>
      createAsset(s, { name, customerId: cliente, assetCategoryId: cat, locationId: setor });
    vent = await novo('Ventilador sintético', catVent);
    mon = await novo('Monitor sintético', catMon);
    bomba = await novo('Bomba sintética', catBomba);
    contrato = await createContract(s, {
      customerId: cliente,
      kind: 'full_service',
      startsOn: hoje,
      endsOn: `${Number(hoje.slice(0, 4)) + 1}${hoje.slice(4)}`,
      autoRenew: false,
    });
    await addCoverage(s, { contractId: contrato, kind: 'customer' });
    await activateContract(s, contrato);
  });
}, 180_000);

afterAll(async () => {
  await t?.close();
});

describe('regularização de plano antigo (por setor, mensal, procedimento errado)', () => {
  let antigo: string;
  let osEmExecucao: string;
  let vencimento: string;

  it('cenário: o plano antigo gera uma OS por equipamento, todas com o procedimento errado', async () => {
    const r = await em((s) =>
      createGuidedPlan(
        s,
        {
          name: 'Preventiva mensal — Imagem (modelo antigo)',
          customerId: cliente,
          sectorId: setor,
          assetIds: [], // o setor inteiro como expressão: o modelo antigo
          kind: 'preventive',
          checklistTemplateKey: 'prev_incubadora',
          frequencyUnit: 'month',
          frequencyInterval: 1,
          anchorDate: new Date(`${hoje}T00:00:00Z`),
          leadTimeDays: 10,
          toleranceDays: 5,
          autoGenerate: true,
        },
        TUDO
      )
    );
    antigo = r.planId;
    expect(r.workOrders).toBe(3);
    const itens = await itensDo(antigo);
    expect(itens.map((i) => i.procs)).toEqual(['prev_incubadora', 'prev_incubadora', 'prev_incubadora']);
    vencimento = itens[0]!.due;

    // A OS da bomba já começou: ela é PRESERVADA (como as OS em execução de produção).
    osEmExecucao = itens.find((i) => i.asset_id === bomba)!.os_id!;
    await em(async (s) => {
      await transitionWorkOrder(s, osEmExecucao, 'in_progress');
      await addComment(s, { workOrderId: osEmExecucao, body: 'técnico no local', visibility: 'internal' });
    });
  });

  it('passo 1 e 2: desligar o plano e dispensar só as OS intocadas — a OS em execução fica como está', async () => {
    expect(
      await em((s) =>
        setPlanActive(s, antigo, false, 'Procedimento errado; substituído por plano por equipamento')
      )
    ).toEqual({ changed: true, isActive: false });

    const intocadas = (await itensDo(antigo)).filter((i) => i.asset_id !== bomba);
    for (const i of intocadas) {
      await em((s) =>
        skipCycleItem(s, i.item_id, 'Procedimento incompatível com o equipamento; substituído por plano novo')
      );
    }

    const depois = await itensDo(antigo);
    const [os] = await em((s) =>
      s.query<{ canceladas: number; motivo: string; execucao: string; comentarios: number }>(
        `SELECT (SELECT count(*)::int FROM aurora.work_orders WHERE id = ANY($1::uuid[]) AND status_category = 'cancelled') AS canceladas,
                (SELECT min(cancellation_reason) FROM aurora.work_orders WHERE id = ANY($1::uuid[])) AS motivo,
                (SELECT status_category::text FROM aurora.work_orders WHERE id = $2) AS execucao,
                (SELECT count(*)::int FROM aurora.work_order_comments WHERE work_order_id = $2) AS comentarios`,
        [intocadas.map((i) => i.os_id), osEmExecucao]
      )
    );
    expect(os).toMatchObject({ canceladas: 2, execucao: 'in_progress', comentarios: 1 });
    expect(os!.motivo).toMatch(/^Item do plano dispensado: Procedimento incompatível/);
    expect(
      depois
        .filter((i) => i.item === 'skipped')
        .map((i) => i.asset_id)
        .sort()
    ).toEqual([mon, vent].sort());
    expect(depois.find((i) => i.asset_id === bomba)).toMatchObject({
      item: 'generated',
      os_id: osEmExecucao,
    });

    // A dispensa e o desligamento ficam na trilha de auditoria, com o autor.
    const [trilha] = await em((s) =>
      s.query<{ itens: number; plano: number }>(
        `SELECT (SELECT count(*)::int FROM aurora.audit_logs WHERE entity_type = 'plan_cycle_items'
                   AND entity_id::text = ANY($1::text[]) AND actor_user_id = $3) AS itens,
                (SELECT count(*)::int FROM aurora.audit_logs WHERE entity_type = 'maintenance_plans'
                   AND entity_id::text = $2::text AND action = 'update' AND actor_user_id = $3) AS plano`,
        [intocadas.map((i) => i.item_id), antigo, USER]
      )
    );
    expect(trilha!.itens).toBeGreaterThanOrEqual(2);
    expect(trilha!.plano).toBeGreaterThanOrEqual(1);
  });

  it('nada recria a OS errada: Executar, Gerar OS do ciclo, varredura e retorno do contrato', async () => {
    const itens = await itensDo(antigo);
    const dispensado = itens.find((i) => i.item === 'skipped')!;
    await expect(em((s) => executePlanItem(s, dispensado.item_id, TUDO))).rejects.toThrow(/dispensado/);

    const [ciclo] = await em((s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.plan_cycles WHERE plan_id = $1`, [antigo])
    );
    expect(await em((s) => materializeCycle(s, ciclo!.id))).toBe(0);

    // A próxima abertura do mensal (o P4 abre sozinho 10 dias antes): nada, o plano está desligado.
    const proxima = new Date(`${vencimento}T12:00:00Z`);
    expect(await em((s) => sweepPlans(s, proxima))).toEqual({ cyclesOpened: 0, workOrders: 0 });

    // Suspender e reativar o contrato não "devolve" a dispensa manual.
    await em((s) => holdContractService(s, contrato, 'suspended', 'Ensaio de retenção do contrato'));
    await em((s) => releaseContractService(s, contrato, null));
    expect(await em((s) => restoreHeldCycleItems(s))).toEqual({ restored: 0, workOrders: 0 });

    expect((await itensDo(antigo)).map((i) => i.item).sort()).toEqual(['generated', 'skipped', 'skipped']);
  });

  it('passo 3: plano novo por equipamento, manual — sem OS duplicada, e cada OS com o procedimento certo', async () => {
    const mesSeguinte = (dia: string) => {
      const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
      return new Date(Date.UTC(a, m, d)).toISOString().slice(0, 10);
    };
    const r = await em((s) =>
      createGuidedPlan(
        s,
        {
          name: 'Preventiva mensal — Imagem (por equipamento)',
          customerId: cliente,
          sectorId: setor,
          assetIds: [],
          items: [
            // Mesmo vencimento do item dispensado: a preventiva deste mês continua prevista.
            { assetId: vent, checklistTemplateKey: 'prev_ventilador', firstDueOn: vencimento },
            { assetId: mon, checklistTemplateKey: 'prev_monitor', firstDueOn: vencimento },
            // A bomba já tem a OS deste mês em execução: o plano novo começa no ciclo SEGUINTE.
            { assetId: bomba, checklistTemplateKey: 'prev_bomba', firstDueOn: mesSeguinte(vencimento) },
          ],
          kind: 'preventive',
          checklistTemplateKey: null,
          frequencyUnit: 'month',
          frequencyInterval: 1,
          anchorDate: new Date(`${hoje}T00:00:00Z`),
          leadTimeDays: 10,
          toleranceDays: 5,
          autoGenerate: false,
        },
        TUDO
      )
    );
    expect(r).toMatchObject({ cyclesOpened: 2, workOrders: 0 }); // ventilador e monitor; a bomba ainda não

    // Conferido o ciclo, "Gerar OS deste ciclo".
    const ciclos = await em((s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.plan_cycles WHERE plan_id = $1 ORDER BY id`, [r.planId])
    );
    let criadas = 0;
    for (const c of ciclos) criadas += await em((s) => materializeCycle(s, c.id));
    expect(criadas).toBe(2);

    const novos = await itensDo(r.planId);
    const porAtivo = Object.fromEntries(novos.map((i) => [i.asset_id, i]));
    expect(porAtivo[vent]).toMatchObject({ procs: 'prev_ventilador', due: vencimento, os_sit: 'open' });
    expect(porAtivo[mon]).toMatchObject({ procs: 'prev_monitor', due: vencimento, os_sit: 'open' });
    expect(porAtivo[bomba]).toBeUndefined();

    // Exatamente uma OS em aberto por equipamento: a nova (ventilador, monitor) ou a em execução (bomba).
    const abertas = Object.fromEntries((await abertasPorEquipamento()).map((x) => [x.asset_id, x.n]));
    expect(abertas).toEqual({ [vent]: 1, [mon]: 1, [bomba]: 1 });
  });

  it('o mês seguinte: a varredura não cria OS errada nem duplicada', async () => {
    const proxima = new Date(`${vencimento}T12:00:00Z`);
    const r = await em((s) => sweepPlans(s, proxima));
    expect(r.workOrders).toBe(0); // o plano novo é manual; o antigo está desligado
    const [errada] = await em((s) =>
      s.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM aurora.checklist_responses cr
           JOIN aurora.work_orders w ON w.id = cr.work_order_id
          WHERE w.customer_id = $1 AND cr.template_key = 'prev_incubadora'
            AND w.status_category NOT IN ('cancelled')`,
        [cliente]
      )
    );
    expect(errada!.n).toBe(1); // só a OS em execução, preservada como estava
  });
});

describe('plano já por equipamento: corrigir o procedimento na própria tarefa', () => {
  it('troca o procedimento, cancela a OS intocada e gera de novo: uma OS só, a certa; a errada fica no histórico', async () => {
    const { outro, setorB, desf } = await em(async (s) => {
      const cat = await createAssetCategory(s, { name: 'Desfibrilador' });
      const tpl = await createChecklistTemplate(s, {
        key: 'prev_desfibrilador',
        title: 'Preventiva de desfibrilador',
      });
      await addChecklistItem(s, { templateId: tpl, kind: 'boolean', label: 'Descarga ok?' });
      await publishChecklist(s, tpl);
      const tipos = await provisionStarterLocationTypes(s);
      const outro = await createCustomer(s, { name: 'Outro cliente sintético' });
      const unidade = await createLocation(s, {
        customerId: outro,
        locationTypeId: tipos.get('unidade')!,
        name: 'Unidade B',
      });
      const setorB = await createLocation(s, {
        customerId: outro,
        parentId: unidade,
        locationTypeId: tipos.get('setor')!,
        name: 'Hemodinâmica',
      });
      const desf = await createAsset(s, {
        name: 'Desfibrilador sintético',
        customerId: outro,
        assetCategoryId: cat,
        locationId: setorB,
      });
      const ct = await createContract(s, {
        customerId: outro,
        kind: 'full_service',
        startsOn: hoje,
        endsOn: null,
      });
      await addCoverage(s, { contractId: ct, kind: 'customer' });
      await activateContract(s, ct);
      return { outro, setorB, desf };
    });

    const r = await em((s) =>
      createGuidedPlan(
        s,
        {
          name: 'Preventiva semestral — Hemodinâmica',
          customerId: outro,
          sectorId: setorB,
          assetIds: [],
          items: [{ assetId: desf, checklistTemplateKey: 'prev_incubadora' }], // o erro de produção
          kind: 'preventive',
          checklistTemplateKey: null,
          frequencyUnit: 'semester',
          frequencyInterval: 1,
          anchorDate: new Date(`${hoje}T00:00:00Z`),
          leadTimeDays: 400,
          toleranceDays: 5,
          autoGenerate: true,
        },
        TUDO
      )
    );
    expect(r.workOrders).toBe(1);
    const [antes] = await itensDo(r.planId);
    expect(antes!.procs).toBe('prev_incubadora');

    // 1) a tarefa passa a ter o procedimento certo; 2) a OS errada, intocada, é cancelada com motivo;
    // 3) "Gerar OS deste ciclo" cria a OS do MESMO item, agora com o procedimento certo.
    await em((s) => updatePlanTask(s, r.taskIds[0]!, { checklistTemplateKey: 'prev_desfibrilador' }));
    await em((s) =>
      transitionWorkOrder(s, antes!.os_id!, 'cancelled', {
        cancellationReason: 'Procedimento incompatível; gerada de novo com o procedimento do equipamento',
      })
    );
    const [ciclo] = await em((s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.plan_cycles WHERE plan_id = $1`, [r.planId])
    );
    expect(await em((s) => materializeCycle(s, ciclo!.id))).toBe(1);

    const [depois] = await itensDo(r.planId);
    expect(depois).toMatchObject({
      item_id: antes!.item_id,
      item: 'generated',
      due: antes!.due,
      procs: 'prev_desfibrilador',
    });
    expect(depois!.os_id).not.toBe(antes!.os_id);

    const [os] = await em((s) =>
      s.query<{ abertas: number; cancelada: string; resposta_antiga: number }>(
        `SELECT (SELECT count(*)::int FROM aurora.work_orders WHERE customer_id = $1
                   AND status_category NOT IN ('cancelled', 'done', 'closed')) AS abertas,
                (SELECT status_category::text FROM aurora.work_orders WHERE id = $2) AS cancelada,
                (SELECT count(*)::int FROM aurora.checklist_responses WHERE work_order_id = $2) AS resposta_antiga`,
        [outro, antes!.os_id]
      )
    );
    expect(os).toEqual({ abertas: 1, cancelada: 'cancelled', resposta_antiga: 1 });
  });
});
