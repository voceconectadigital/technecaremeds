/**
 * Aurora — planos: vários procedimentos na mesma OS, versão do procedimento presa à OS, fronteira
 * de "vencido" no quadro e ranking por conformidade (rodada de 29/10/2026).
 *
 *   · OS-15  várias TAREFAS do mesmo plano para o mesmo ativo continuam sendo OS separadas (cada
 *            uma com o seu checklist); a tarefa com procedimentos ADICIONAIS (0087) gera UMA OS com
 *            um checklist por procedimento, e a resposta de um não aceita item do outro;
 *   · PLN-12 a OS gerada mantém a versão do procedimento depois que ele é revisado; a OS nova
 *            nasce com a versão nova;
 *   · PLN-03 no quadro, vencido = depois de due_at + tolerância (um dia antes não, um dia depois sim);
 *   · REL-12 o ranking é pela taxa, não pelo volume;
 *   · PLN-01 inativar preserva os ciclos e as OS já gerados; a varredura não abre ciclo novo.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS, ValidationError } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates } from '../work-orders';
import {
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  answerChecklistItem,
} from '../execution';
import { reviseTemplate } from '../procedures';
import {
  createPlan,
  addPlanTask,
  generateCycle,
  materializeCycle,
  setPlanActive,
  sweepPlans,
} from '../maintenance-plans';
import { createGuidedPlan, planBoard, rankByCompliance, complianceRate } from '../plan-board';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'planos-proc',
  permissions: PERMISSION_KEYS,
});
const TUDO = { customerIds: null, locationPaths: null };
const DIA = 86_400_000;

let t: TestDatabase;
let cliente: string, uti: string, monitor: string;
let natPreventiva: string;
let tplPrev: string, tplTse: string;
let itemPrev: string, itemTse: string;

/** As respostas de checklist de uma OS: chave, versão e id do modelo. */
async function checklistsDa(os: string) {
  return withTenant(t.db, ctx, (s) =>
    s.query<{ id: string; template_id: string; template_key: string; template_version: number }>(
      `SELECT id, template_id, template_key, template_version FROM aurora.checklist_responses
        WHERE work_order_id = $1 ORDER BY template_key`,
      [os]
    )
  );
}

async function osDoCiclo(cycleId: string): Promise<string[]> {
  const rows = await withTenant(t.db, ctx, (s) =>
    s.query<{ work_order_id: string }>(
      `SELECT work_order_id FROM aurora.plan_cycle_items WHERE cycle_id = $1 AND work_order_id IS NOT NULL`,
      [cycleId]
    )
  );
  return rows.map((r) => r.work_order_id);
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'planos-proc', name: 'Rede', email: 'a@planos-proc.test', userName: 'A' }
  );
  await withTenant(t.db, ctx, async (s) => {
    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade',
    });
    uti = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    const cat = await createAssetCategory(s, { name: 'Monitor' });
    monitor = await createAsset(s, {
      name: 'Monitor UTI 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: uti,
    });
    natPreventiva = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });

    tplPrev = await createChecklistTemplate(s, { key: 'prev_monitor', title: 'Preventiva de monitor' });
    itemPrev = await addChecklistItem(s, { templateId: tplPrev, kind: 'boolean', label: 'Alarmes ok?' });
    await publishChecklist(s, tplPrev);

    tplTse = await createChecklistTemplate(s, {
      key: 'tse_monitor',
      title: 'TSE de monitor',
      procedureKind: 'electrical_safety',
    });
    itemTse = await addChecklistItem(s, {
      templateId: tplTse,
      kind: 'number',
      label: 'Corrente de fuga',
      unit: 'µA',
    });
    await publishChecklist(s, tplTse);
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

const tarefa = (planId: string, nome: string, extra: Partial<Parameters<typeof addPlanTask>[1]> = {}) =>
  withTenant(t.db, ctx, (s) =>
    addPlanTask(s, {
      planId,
      name: nome,
      targetKind: 'asset',
      targetAssetId: monitor,
      workOrderTypeId: natPreventiva,
      frequencyUnit: 'year',
      leadTimeDays: 3650,
      toleranceDays: 5,
      ...extra,
    })
  );

const plano = (nome: string) =>
  withTenant(t.db, ctx, (s) =>
    createPlan(s, {
      name: nome,
      customerId: cliente,
      autoGenerate: false,
      anchorDate: new Date('2026-01-01T00:00:00Z'),
    })
  );

describe('OS-15 · mais de um procedimento', () => {
  it('duas TAREFAS do mesmo plano no mesmo ativo: duas OS, cada uma com o seu checklist', async () => {
    const p = await plano('Duas tarefas');
    const a = await tarefa(p, 'Preventiva', { checklistTemplateKey: 'prev_monitor' });
    const b = await tarefa(p, 'TSE', { checklistTemplateKey: 'tse_monitor' });
    const ca = await withTenant(t.db, ctx, (s) => generateCycle(s, a));
    const cb = await withTenant(t.db, ctx, (s) => generateCycle(s, b));
    await withTenant(t.db, ctx, (s) => materializeCycle(s, ca!.cycleId));
    await withTenant(t.db, ctx, (s) => materializeCycle(s, cb!.cycleId));
    const [osA] = await osDoCiclo(ca!.cycleId);
    const [osB] = await osDoCiclo(cb!.cycleId);
    expect(osA).not.toBe(osB);
    expect((await checklistsDa(osA!)).map((r) => r.template_key)).toEqual(['prev_monitor']);
    expect((await checklistsDa(osB!)).map((r) => r.template_key)).toEqual(['tse_monitor']);
  });

  it('a tarefa com procedimento adicional gera UMA OS com os dois checklists, sem misturar respostas', async () => {
    const p = await plano('Combinado');
    const id = await tarefa(p, 'Preventiva + TSE', {
      checklistTemplateKey: 'prev_monitor',
      // A principal repetida entre as adicionais não duplica o checklist.
      extraChecklistTemplateKeys: ['tse_monitor', 'prev_monitor'],
    });
    const ciclo = await withTenant(t.db, ctx, (s) => generateCycle(s, id));
    await withTenant(t.db, ctx, (s) => materializeCycle(s, ciclo!.cycleId));
    const [os] = await osDoCiclo(ciclo!.cycleId);
    const respostas = await checklistsDa(os!);
    expect(respostas.map((r) => r.template_key)).toEqual(['prev_monitor', 'tse_monitor']);
    const prev = respostas.find((r) => r.template_key === 'prev_monitor')!;
    const tse = respostas.find((r) => r.template_key === 'tse_monitor')!;

    await withTenant(t.db, ctx, (s) => answerChecklistItem(s, prev.id, itemPrev, { boolean: true }));
    await withTenant(t.db, ctx, (s) => answerChecklistItem(s, tse.id, itemTse, { number: 42 }));
    // O item da TSE não entra na resposta da preventiva: o banco recusa.
    await expect(
      withTenant(t.db, ctx, (s) => answerChecklistItem(s, prev.id, itemTse, { number: 1 }))
    ).rejects.toThrow(/pertence a outro checklist/);

    const porResposta = await withTenant(t.db, ctx, (s) =>
      s.query<{ response_id: string; item_id: string }>(
        `SELECT response_id, item_id FROM aurora.checklist_answers WHERE response_id = ANY($1::uuid[])`,
        [[prev.id, tse.id]]
      )
    );
    expect(porResposta.filter((a) => a.response_id === prev.id).map((a) => a.item_id)).toEqual([itemPrev]);
    expect(porResposta.filter((a) => a.response_id === tse.id).map((a) => a.item_id)).toEqual([itemTse]);
  });

  it('procedimento adicional sem versão publicada: os outros vão, e a OS diz qual faltou', async () => {
    await withTenant(t.db, ctx, (s) => createChecklistTemplate(s, { key: 'rascunho_x', title: 'Rascunho' }));
    const p = await plano('Com rascunho');
    const id = await tarefa(p, 'Preventiva + rascunho', {
      checklistTemplateKey: 'prev_monitor',
      extraChecklistTemplateKeys: ['rascunho_x'],
    });
    const ciclo = await withTenant(t.db, ctx, (s) => generateCycle(s, id));
    await withTenant(t.db, ctx, (s) => materializeCycle(s, ciclo!.cycleId));
    const [os] = await osDoCiclo(ciclo!.cycleId);
    expect((await checklistsDa(os!)).map((r) => r.template_key)).toEqual(['prev_monitor']);
    const [d] = await withTenant(t.db, ctx, (s) =>
      s.query<{ description: string }>(`SELECT description FROM aurora.work_orders WHERE id = $1`, [os])
    );
    expect(d!.description).toContain('"rascunho_x"');
  });

  it('a criação orientada recusa procedimento adicional sem versão publicada', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        createGuidedPlan(
          s,
          {
            name: 'Guiado com rascunho',
            customerId: cliente,
            sectorId: uti,
            assetIds: [],
            kind: 'preventive',
            checklistTemplateKey: 'prev_monitor',
            extraChecklistTemplateKeys: ['rascunho_x'],
            frequencyUnit: 'year',
            frequencyInterval: 1,
            anchorDate: new Date('2026-01-01T00:00:00Z'),
            leadTimeDays: 7,
            toleranceDays: 3,
            autoGenerate: false,
          },
          TUDO
        )
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('PLN-12 · a OS gerada guarda a versão do procedimento', () => {
  it('revisar o procedimento não muda a OS antiga; a OS nova nasce com a versão nova', async () => {
    const p = await plano('Versão presa');
    const id = await tarefa(p, 'Preventiva versionada', {
      checklistTemplateKey: 'prev_monitor',
      frequencyUnit: 'quarter',
    });
    const c1 = await withTenant(t.db, ctx, (s) => generateCycle(s, id));
    await withTenant(t.db, ctx, (s) => materializeCycle(s, c1!.cycleId));
    const [os1] = await osDoCiclo(c1!.cycleId);
    const [r1] = await checklistsDa(os1!);
    expect(r1!.template_version).toBe(1);
    await withTenant(t.db, ctx, (s) => answerChecklistItem(s, r1!.id, itemPrev, { boolean: true }));

    // O procedimento é revisado e a v2 publicada (com outro item).
    const v2 = await withTenant(t.db, ctx, (s) =>
      reviseTemplate(s, tplPrev, {
        title: 'Preventiva de monitor',
        items: [{ kind: 'text', label: 'Item da revisão' }],
        publish: true,
      })
    );
    expect(v2.version).toBe(2);

    // A OS antiga continua na v1, com a resposta intacta.
    const [r1Depois] = await checklistsDa(os1!);
    expect(r1Depois).toMatchObject({ template_id: tplPrev, template_version: 1 });
    const respostas = await withTenant(t.db, ctx, (s) =>
      s.query<{ item_id: string; value_boolean: boolean }>(
        `SELECT item_id, value_boolean FROM aurora.checklist_answers WHERE response_id = $1`,
        [r1!.id]
      )
    );
    expect(respostas).toEqual([{ item_id: itemPrev, value_boolean: true }]);

    // O ciclo seguinte gera a OS nova já com a v2.
    const c2 = await withTenant(t.db, ctx, (s) => generateCycle(s, id));
    await withTenant(t.db, ctx, (s) => materializeCycle(s, c2!.cycleId));
    const [os2] = await osDoCiclo(c2!.cycleId);
    const [r2] = await checklistsDa(os2!);
    expect(r2).toMatchObject({ template_id: v2.id, template_version: 2 });
  });
});

describe('PLN-03 · fronteira de vencido no quadro (due_at + tolerância)', () => {
  it('um dia antes do fim da tolerância é pendente; um dia depois é vencido', async () => {
    const p = await plano('Fronteira');
    const id = await tarefa(p, 'Fronteira', { toleranceDays: 5 });
    const ciclo = await withTenant(t.db, ctx, (s) => generateCycle(s, id));
    const due = ciclo!.endsAt.getTime();
    const f = { from: new Date(due - DIA), to: new Date(due + DIA), customerId: cliente };
    const filtro = { ...f };
    const linha = async (agora: Date) => {
      const b = await withTenant(t.db, ctx, (s) => planBoard(s, filtro, TUDO, agora));
      return b.byPlan.find((x) => x.key === p)!;
    };
    // No dia do vencimento: dentro do prazo.
    expect((await linha(new Date(due))).pending).toBe(1);
    // Vencimento + 4 dias (um antes do fim da tolerância de 5): ainda pendente.
    expect((await linha(new Date(due + 4 * DIA))).pending).toBe(1);
    // Exatamente no fim da tolerância: ainda não venceu.
    expect((await linha(new Date(due + 5 * DIA))).late).toBe(0);
    // Vencimento + 6 dias (um depois): vencido.
    const depois = await linha(new Date(due + 6 * DIA));
    expect(depois.late).toBe(1);
    expect(depois.pending).toBe(0);
  });
});

describe('REL-12 · ranking pela taxa, não pelo volume', () => {
  it('o maior volume com taxa menor fica abaixo', () => {
    const r = rankByCompliance([
      { key: 'grande', label: 'Plano grande', done: 50, pending: 30, late: 20, skipped: 0 },
      { key: 'pequeno', label: 'Plano pequeno', done: 2, pending: 0, late: 0, skipped: 1 },
      { key: 'vazio', label: 'Plano dispensado', done: 0, pending: 0, late: 0, skipped: 3 },
      { key: 'medio', label: 'Plano médio', done: 5, pending: 0, late: 5, skipped: 0 },
    ]);
    expect(r.map((x) => x.key)).toEqual(['pequeno', 'grande', 'medio', 'vazio']);
    expect(r[0]).toMatchObject({ position: 1, denominator: 2, scheduled: 3, rate: 100 });
    expect(r[3]).toMatchObject({ position: 4, denominator: 0, rate: null });
  });

  it('empate na taxa: mais atividades no denominador primeiro', () => {
    const r = rankByCompliance([
      { key: 'a', label: 'A', done: 1, pending: 1, late: 0, skipped: 0 },
      { key: 'b', label: 'B', done: 5, pending: 5, late: 0, skipped: 0 },
    ]);
    expect(r.map((x) => x.key)).toEqual(['b', 'a']);
  });

  it('a taxa da fatia tira os dispensados do denominador', () => {
    expect(complianceRate({ done: 1, pending: 0, late: 1, skipped: 2 })).toBe(50);
    expect(complianceRate({ done: 0, pending: 0, late: 0, skipped: 2 })).toBeNull();
  });
});

describe('PLN-01 · inativar preserva o histórico e trava o futuro', () => {
  it('ciclos e OS ficam; nenhum ciclo novo pela varredura nem à mão', async () => {
    const p = await plano('Liga e desliga');
    const id = await tarefa(p, 'Liga e desliga', { frequencyUnit: 'quarter' });
    const c1 = await withTenant(t.db, ctx, (s) => generateCycle(s, id));
    await withTenant(t.db, ctx, (s) => materializeCycle(s, c1!.cycleId));

    const r = await withTenant(t.db, ctx, (s) => setPlanActive(s, p, false, 'cliente suspendeu o contrato'));
    expect(r).toEqual({ changed: true, isActive: false });
    expect(await withTenant(t.db, ctx, (s) => generateCycle(s, id))).toBeNull();
    await withTenant(t.db, ctx, (s) => sweepPlans(s));
    const ciclos = await withTenant(t.db, ctx, (s) =>
      s.query<{ seq: number }>(`SELECT seq FROM aurora.plan_cycles WHERE task_id = $1`, [id])
    );
    expect(ciclos.map((c) => Number(c.seq))).toEqual([1]);
    expect(await osDoCiclo(c1!.cycleId)).toHaveLength(1);

    const [linha] = await withTenant(t.db, ctx, (s) =>
      s.query<{ active_change_reason: string; active_changed_by: string }>(
        `SELECT active_change_reason, active_changed_by FROM aurora.maintenance_plans WHERE id = $1`,
        [p]
      )
    );
    expect(linha).toEqual({ active_change_reason: 'cliente suspendeu o contrato', active_changed_by: USER });
  });
});
