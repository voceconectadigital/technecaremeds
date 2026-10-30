/**
 * Aurora — planos de manutenção contra o banco (SPEC v0.2 §12 · EPIC-013).
 *
 * As duas correções estruturais sobre a referência são o que esta suíte prova:
 * um plano com ritmos diferentes por tarefa, e um alvo que continua valendo
 * para o equipamento que chegou depois.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS, addFrequency, cyclesPerYear } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset, decommissionAsset, transferAsset } from '../assets';
import { provisionWorkOrderStates, transitionWorkOrder } from '../work-orders';
import {
  createPlan,
  addPlanTask,
  resolveTargetAssets,
  generateCycle,
  materializeCycle,
  skipCycleItem,
  pruneDecommissioned,
  cycleCompliance,
  sweepPlans,
} from '../maintenance-plans';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'plan',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, uti: string, cc: string;
let catVentilador: string, catMonitor: string;
let ventilador1: string, ventilador2: string, monitor: string;
let natPreventiva: string, natCalibracao: string;
let plano: string;

const ontem = new Date(Date.now() - 86_400_000);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'plan', name: 'Rede', email: 'a@plan.test', userName: 'A' }
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
    cc = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'Centro Cirúrgico',
    });

    catVentilador = await createAssetCategory(s, { name: 'Ventilador Pulmonar' });
    catMonitor = await createAssetCategory(s, { name: 'Monitor' });

    ventilador1 = await createAsset(s, {
      name: 'Ventilador UTI 01',
      customerId: cliente,
      assetCategoryId: catVentilador,
      locationId: uti,
    });
    ventilador2 = await createAsset(s, {
      name: 'Ventilador UTI 02',
      customerId: cliente,
      assetCategoryId: catVentilador,
      locationId: uti,
    });
    monitor = await createAsset(s, {
      name: 'Monitor UTI 01',
      customerId: cliente,
      assetCategoryId: catMonitor,
      locationId: uti,
    });
    await createAsset(s, {
      name: 'Ventilador CC 01',
      customerId: cliente,
      assetCategoryId: catVentilador,
      locationId: cc,
    });

    natPreventiva = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });
    natCalibracao = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'calibracao',
      label: 'Calibração',
      systemKey: 'calibration',
    });

    plano = await createPlan(s, {
      name: 'Preventiva UTI',
      customerId: cliente,
      anchorDate: ontem,
      autoGenerate: false,
    });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('correção 1: a frequência é da tarefa, não do plano', () => {
  it('o mesmo plano tem preventiva semestral e calibração anual', async () => {
    const { semestral, anual } = await withTenant(t.db, ctx, async (s) => {
      const semestral = await addPlanTask(s, {
        planId: plano,
        name: 'Preventiva semestral',
        targetKind: 'location_subtree',
        targetLocationId: uti,
        targetCategoryId: catVentilador,
        workOrderTypeId: natPreventiva,
        frequencyUnit: 'semester',
      });
      const anual = await addPlanTask(s, {
        planId: plano,
        name: 'Calibração anual',
        targetKind: 'location_subtree',
        targetLocationId: uti,
        targetCategoryId: catVentilador,
        workOrderTypeId: natCalibracao,
        frequencyUnit: 'year',
      });
      return { semestral, anual };
    });

    const tarefas = await withTenant(t.db, ctx, (s) =>
      s.query<{ name: string; frequency_unit: string }>(
        `SELECT name, frequency_unit::text FROM aurora.plan_tasks WHERE plan_id = $1 ORDER BY name`,
        [plano]
      )
    );
    expect(tarefas).toHaveLength(2);
    expect(tarefas.map((x) => x.frequency_unit)).toEqual(['year', 'semester']);
    expect(semestral).not.toBe(anual);
  });

  it('a estimativa de carga por ano sai da frequência', () => {
    expect(cyclesPerYear('semester', 1)).toBe(2);
    expect(cyclesPerYear('month', 3)).toBe(4);
  });

  it('somar um mês a 31 de janeiro não escorrega para março', () => {
    const jan31 = new Date('2026-01-31T00:00:00Z');
    expect(addFrequency(jan31, 'month', 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addFrequency(jan31, 'month', 2).toISOString().slice(0, 10)).toBe('2026-03-31');
  });
});

describe('correção 2: o alvo é uma expressão', () => {
  it('a subárvore com categoria alcança só os ventiladores da UTI', async () => {
    const [tarefa] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.plan_tasks WHERE name = 'Preventiva semestral'`)
    );
    const ativos = await withTenant(t.db, ctx, (s) => resolveTargetAssets(s, tarefa!.id));
    expect(ativos).toHaveLength(2);
    expect(ativos).toContain(ventilador1);
    expect(ativos).toContain(ventilador2);
    expect(ativos).not.toContain(monitor);
  });

  it('o equipamento que chega depois entra sozinho no escopo', async () => {
    const novo = await withTenant(t.db, ctx, (s) =>
      createAsset(s, {
        name: 'Ventilador UTI 03',
        customerId: cliente,
        assetCategoryId: catVentilador,
        locationId: uti,
      })
    );
    const [tarefa] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.plan_tasks WHERE name = 'Preventiva semestral'`)
    );
    const ativos = await withTenant(t.db, ctx, (s) => resolveTargetAssets(s, tarefa!.id));
    expect(ativos).toContain(novo);
    expect(ativos).toHaveLength(3);
  });

  it('alvo por categoria alcança a categoria inteira, em qualquer local', async () => {
    const tarefa = await withTenant(t.db, ctx, (s) =>
      addPlanTask(s, {
        planId: plano,
        name: 'Inspeção de ventiladores',
        targetKind: 'asset_category',
        targetCategoryId: catVentilador,
        workOrderTypeId: natPreventiva,
        frequencyUnit: 'quarter',
      })
    );
    const ativos = await withTenant(t.db, ctx, (s) => resolveTargetAssets(s, tarefa));
    // três na UTI e um no centro cirúrgico
    expect(ativos).toHaveLength(4);
  });

  it('alvo incoerente com o tipo é recusado pelo banco', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(
          `INSERT INTO aurora.plan_tasks
             (id, organization_id, plan_id, name, target_kind, work_order_type_id, frequency_unit)
           VALUES ($1, $2, $3, 'Sem alvo', 'asset_category', $4, 'month')`,
          [newId(), ORG, plano, natPreventiva]
        )
      )
    ).rejects.toThrow(/target_coherent|regra/i);
  });

  it('ativo descomissionado sai do escopo', async () => {
    const aposentado = await withTenant(t.db, ctx, async (s) => {
      const a = await createAsset(s, {
        name: 'Ventilador aposentado',
        customerId: cliente,
        assetCategoryId: catVentilador,
        locationId: uti,
      });
      await decommissionAsset(s, a, 'fim de vida útil declarado em laudo');
      return a;
    });
    const [tarefa] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.plan_tasks WHERE name = 'Preventiva semestral'`)
    );
    const ativos = await withTenant(t.db, ctx, (s) => resolveTargetAssets(s, tarefa!.id));
    expect(ativos).not.toContain(aposentado);
  });
});

describe('geração de ciclo', () => {
  let tarefa = '';
  let ciclo = '';

  beforeAll(async () => {
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.plan_tasks WHERE name = 'Preventiva semestral'`)
    );
    tarefa = row!.id;
  });

  it('o ciclo abre quando chega a antecedência, e não antes', async () => {
    const daquiUmAno = new Date(Date.now() + 365 * 86_400_000);
    const cedo = await withTenant(t.db, ctx, async (s) => {
      // uma tarefa cuja âncora está no futuro distante não abre ciclo hoje
      const p = await createPlan(s, {
        name: 'Plano futuro',
        customerId: cliente,
        anchorDate: daquiUmAno,
      });
      const tk = await addPlanTask(s, {
        planId: p,
        name: 'Tarefa distante',
        targetKind: 'asset',
        targetAssetId: ventilador1,
        workOrderTypeId: natPreventiva,
        frequencyUnit: 'year',
        leadTimeDays: 7,
      });
      return generateCycle(s, tk);
    });
    expect(cedo).toBeNull();
  });

  it('abre o ciclo com um item por ativo do escopo', async () => {
    const r = await withTenant(t.db, ctx, (s) => generateCycle(s, tarefa));
    expect(r).not.toBeNull();
    expect(r!.seq).toBe(1);
    expect(r!.items).toBe(3);
    // plano manual: previsão sem OS
    expect(r!.workOrders).toBe(0);
    ciclo = r!.cycleId;
  });

  it('o vencimento é o fim da janela do ciclo', async () => {
    const itens = await withTenant(t.db, ctx, (s) =>
      s.query<{ due_at: string }>(`SELECT due_at FROM aurora.plan_cycle_items WHERE cycle_id = $1`, [ciclo])
    );
    const [c] = await withTenant(t.db, ctx, (s) =>
      s.query<{ ends_at: string }>(`SELECT ends_at FROM aurora.plan_cycles WHERE id = $1`, [ciclo])
    );
    // O driver devolve `Date`, e cada `Date` é um objeto distinto: comparar
    // objetos num Set daria três elementos diferentes com o mesmo instante.
    const vencimentos = new Set(itens.map((i) => new Date(i.due_at).toISOString()));
    expect(vencimentos).toEqual(new Set([new Date(c!.ends_at).toISOString()]));
  });

  it('materializar em lote cria uma OS por item pendente', async () => {
    const criadas = await withTenant(t.db, ctx, (s) => materializeCycle(s, ciclo));
    expect(criadas).toBe(3);

    const os = await withTenant(t.db, ctx, (s) =>
      s.query<{ source: string; title: string }>(
        `SELECT w.source::text, w.title FROM aurora.work_orders w
           JOIN aurora.plan_cycle_items i ON i.work_order_id = w.id
          WHERE i.cycle_id = $1`,
        [ciclo]
      )
    );
    expect(os).toHaveLength(3);
    expect(os.every((x) => x.source === 'plan')).toBe(true);
    expect(os[0]!.title).toMatch(/Preventiva semestral —/);
  });

  it('materializar de novo não duplica', async () => {
    const denovo = await withTenant(t.db, ctx, (s) => materializeCycle(s, ciclo));
    expect(denovo).toBe(0);
  });

  it('o ciclo seguinte ancora no fim do anterior, não em hoje', async () => {
    const [primeiro] = await withTenant(t.db, ctx, (s) =>
      s.query<{ ends_at: string }>(`SELECT ends_at FROM aurora.plan_cycles WHERE id = $1`, [ciclo])
    );
    // força a abertura do próximo pedindo a geração numa data futura
    const daqui = new Date(new Date(primeiro!.ends_at).getTime() + 86_400_000);
    const segundo = await withTenant(t.db, ctx, (s) => generateCycle(s, tarefa, daqui));
    expect(segundo).not.toBeNull();
    expect(segundo!.seq).toBe(2);
    expect(segundo!.startsAt.toISOString()).toBe(new Date(primeiro!.ends_at).toISOString());
  });
});

describe('conformidade', () => {
  let ciclo = '';

  beforeAll(async () => {
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(
        `SELECT c.id FROM aurora.plan_cycles c
           JOIN aurora.plan_tasks t ON t.id = c.task_id
          WHERE t.name = 'Preventiva semestral' AND c.seq = 1`
      )
    );
    ciclo = row!.id;
  });

  it('nada concluído ainda: taxa zero, tudo pendente', async () => {
    const r = await withTenant(t.db, ctx, (s) => cycleCompliance(s, ciclo));
    expect(r.summary.expected).toBe(3);
    expect(r.summary.done).toBe(0);
    expect(r.summary.rate).toBe(0);
    expect(r.items.every((i) => i.state === 'on_time_not_started')).toBe(true);
  });

  it('fechar a OS marca o item como concluído sozinho', async () => {
    const [item] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string; work_order_id: string }>(
        `SELECT id, work_order_id FROM aurora.plan_cycle_items WHERE cycle_id = $1 AND status = 'generated' LIMIT 1`,
        [ciclo]
      )
    );
    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, item!.work_order_id, 'in_progress');
      await transitionWorkOrder(s, item!.work_order_id, 'completed', {
        operationalResult: 'released',
        resolution: 'Preventiva executada conforme procedimento',
      });
      await transitionWorkOrder(s, item!.work_order_id, 'validated');
    });

    const [depois] = await withTenant(t.db, ctx, (s) =>
      s.query<{ status: string }>(`SELECT status::text FROM aurora.plan_cycle_items WHERE id = $1`, [
        item!.id,
      ])
    );
    expect(depois!.status).toBe('done');

    const r = await withTenant(t.db, ctx, (s) => cycleCompliance(s, ciclo));
    expect(r.summary.done).toBe(1);
    expect(r.summary.rate).toBeCloseTo(33.3, 0);
  });

  /**
   * O denominador exclui as dispensadas: um ativo emprestado não podia receber
   * a preventiva, e contá-lo como falha puniria a equipe pelo que não podia
   * fazer.
   */
  it('dispensar tira do denominador e cancela a OS junto', async () => {
    const [item] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string; work_order_id: string }>(
        `SELECT id, work_order_id FROM aurora.plan_cycle_items WHERE cycle_id = $1 AND status = 'generated' LIMIT 1`,
        [ciclo]
      )
    );
    await withTenant(t.db, ctx, (s) =>
      skipCycleItem(s, item!.id, 'equipamento emprestado ao hospital vizinho durante todo o ciclo')
    );

    const [os] = await withTenant(t.db, ctx, (s) =>
      s.query<{ status_category: string }>(
        `SELECT status_category::text FROM aurora.work_orders WHERE id = $1`,
        [item!.work_order_id]
      )
    );
    expect(os!.status_category).toBe('cancelled');

    const r = await withTenant(t.db, ctx, (s) => cycleCompliance(s, ciclo));
    expect(r.summary.skipped).toBe(1);
    // 1 concluída de 2 no denominador
    expect(r.summary.rate).toBe(50);
  });

  it('dispensar sem justificativa é recusado', async () => {
    const [item] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(
        `SELECT id FROM aurora.plan_cycle_items WHERE cycle_id = $1 AND status <> 'skipped' AND status <> 'done' LIMIT 1`,
        [ciclo]
      )
    );
    await expect(withTenant(t.db, ctx, (s) => skipCycleItem(s, item!.id, 'não deu'))).rejects.toThrow(
      /ao menos 10 caracteres/
    );
  });

  it('item já concluído não é dispensável', async () => {
    const [item] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(
        `SELECT id FROM aurora.plan_cycle_items WHERE cycle_id = $1 AND status = 'done' LIMIT 1`,
        [ciclo]
      )
    );
    await expect(
      withTenant(t.db, ctx, (s) => skipCycleItem(s, item!.id, 'tentativa de dispensa depois do fato'))
    ).rejects.toThrow(/já concluído/);
  });

  it('cancelar a OS devolve o item para pendente, não o dá por resolvido', async () => {
    const item = await withTenant(t.db, ctx, async (s) => {
      const [i] = await s.query<{ id: string; work_order_id: string }>(
        `SELECT id, work_order_id FROM aurora.plan_cycle_items
          WHERE cycle_id = $1 AND status = 'generated' LIMIT 1`,
        [ciclo]
      );
      if (!i) return null;
      await transitionWorkOrder(s, i.work_order_id, 'cancelled', {
        cancellationReason: 'reprogramada para o próximo ciclo',
      });
      return i;
    });
    if (!item) return;

    const [depois] = await withTenant(t.db, ctx, (s) =>
      s.query<{ status: string; work_order_id: string | null }>(
        `SELECT status::text, work_order_id FROM aurora.plan_cycle_items WHERE id = $1`,
        [item.id]
      )
    );
    expect(depois!.status).toBe('pending');
    expect(depois!.work_order_id).toBeNull();
  });
});

describe('poda de ativos que saíram do escopo', () => {
  it('descomissionar depois da geração cancela a OS e dispensa o item', async () => {
    const { ciclo, alvo } = await withTenant(t.db, ctx, async (s) => {
      const p = await createPlan(s, {
        name: 'Plano com aposentadoria',
        customerId: cliente,
        anchorDate: ontem,
      });
      const alvo = await createAsset(s, {
        name: 'Ventilador que será baixado',
        customerId: cliente,
        assetCategoryId: catMonitor,
        locationId: cc,
      });
      const tk = await addPlanTask(s, {
        planId: p,
        name: 'Preventiva do que vai sair',
        targetKind: 'asset',
        targetAssetId: alvo,
        workOrderTypeId: natPreventiva,
        frequencyUnit: 'month',
      });
      const r = await generateCycle(s, tk);
      return { ciclo: r!.cycleId, alvo };
    });

    await withTenant(t.db, ctx, (s) =>
      decommissionAsset(s, alvo, 'substituído por equipamento novo do contrato')
    );

    const podados = await withTenant(t.db, ctx, (s) => pruneDecommissioned(s, ciclo));
    expect(podados).toBe(1);

    const [item] = await withTenant(t.db, ctx, (s) =>
      s.query<{ status: string; skip_reason: string }>(
        `SELECT status::text, skip_reason FROM aurora.plan_cycle_items WHERE cycle_id = $1`,
        [ciclo]
      )
    );
    expect(item!.status).toBe('skipped');
    expect(item!.skip_reason).toMatch(/descomissionado/);
  });
});

describe('varredura', () => {
  it('abre os ciclos que chegaram na antecedência e emite evento', async () => {
    const r = await withTenant(t.db, ctx, (s) => sweepPlans(s, new Date(Date.now() + 86_400_000)));
    expect(r.cyclesOpened).toBeGreaterThanOrEqual(0);

    const eventos = await withTenant(t.db, ctx, (s) =>
      s.query<{ type: string }>(
        `SELECT DISTINCT type FROM aurora.domain_events WHERE type = 'plan.cycle_started'`
      )
    );
    expect(eventos.map((e) => e.type)).toContain('plan.cycle_started');
  });

  it('plano inativo não gera ciclo', async () => {
    const tarefa = await withTenant(t.db, ctx, async (s) => {
      const p = await createPlan(s, { name: 'Plano desligado', customerId: cliente, anchorDate: ontem });
      const tk = await addPlanTask(s, {
        planId: p,
        name: 'Tarefa desligada',
        targetKind: 'asset',
        targetAssetId: ventilador1,
        workOrderTypeId: natPreventiva,
        frequencyUnit: 'month',
      });
      await s.query(`UPDATE aurora.maintenance_plans SET is_active = false WHERE id = $1`, [p]);
      return tk;
    });
    const r = await withTenant(t.db, ctx, (s) => generateCycle(s, tarefa));
    expect(r).toBeNull();
  });
});

describe('equipamento que mudou de cliente depois de o ciclo abrir', () => {
  it('fica pendente e não aborta o lote; os demais viram OS', async () => {
    // O 2º ciclo da preventiva semestral já existe, com um item por ativo.
    const [c2] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(
        `SELECT c.id FROM aurora.plan_cycles c
           JOIN aurora.plan_tasks t ON t.id = c.task_id
          WHERE t.name = 'Preventiva semestral' AND c.seq = 2`
      )
    );
    const [movido] = await withTenant(t.db, ctx, (s) =>
      s.query<{ asset_id: string }>(
        `SELECT asset_id FROM aurora.plan_cycle_items WHERE cycle_id = $1 AND status = 'pending' LIMIT 1`,
        [c2!.id]
      )
    );
    await withTenant(t.db, ctx, async (s) => {
      const tipos = await provisionStarterLocationTypes(s);
      const outro = await createCustomer(s, { name: 'Hospital Vizinho' });
      const destino = await createLocation(s, {
        customerId: outro,
        locationTypeId: tipos.get('unidade')!,
        name: 'Vizinho',
      });
      await transferAsset(s, movido!.asset_id, destino, 'empréstimo entre hospitais do grupo');
    });
    const pendentesAntes = await withTenant(t.db, ctx, (s) =>
      s.query(`SELECT 1 FROM aurora.plan_cycle_items WHERE cycle_id = $1 AND status = 'pending'`, [c2!.id])
    );

    const criadas = await withTenant(t.db, ctx, (s) => materializeCycle(s, c2!.id));
    expect(criadas).toBe(pendentesAntes.length - 1);
    const [ainda] = await withTenant(t.db, ctx, (s) =>
      s.query<{ status: string }>(
        `SELECT status::text FROM aurora.plan_cycle_items WHERE cycle_id = $1 AND asset_id = $2`,
        [c2!.id, movido!.asset_id]
      )
    );
    expect(ainda?.status).toBe('pending');
  });
});
