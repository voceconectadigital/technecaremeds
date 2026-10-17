/**
 * Aurora — indicadores contra o banco (SPEC v0.2 §25 · EPIC-021).
 *
 * O que esta suíte prova, além dos números: que a tabela de fato acompanha a OS
 * sem atraso, que a reconstrução chega ao mesmo resultado do gatilho, e que
 * nenhum indicador sai daqui sem a sua definição.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder, transitionWorkOrder } from '../work-orders';
import { logTime } from '../execution';
import {
  workOrdersOpened,
  workOrdersCompleted,
  backlog,
  mttr,
  mtbf,
  slaCompliance,
  timeByStatus,
  timeByWaitReason,
  preventiveVsCorrective,
  planCompliance,
  productivity,
  laborHours,
  firstResponseTime,
  rebuildFacts,
  serviceRating,
  openedVsClosed,
} from '../metrics';
import { createServiceRequest } from '../service-requests';
import { createTestDatabase, seedOrganization, seedMember, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'met',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, uti: string, cc: string;
let ventilador: string, monitor: string, catVent: string;
let corretiva: string, preventiva: string;

const PERIODO = { from: new Date(Date.now() - 30 * 86_400_000), to: new Date(Date.now() + 86_400_000) };

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'met', name: 'Prestadora', email: 'a@met.test', userName: 'A' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: 'tec@met.test', userName: 'Técnico' }
  );

  await withTenant(t.db, ctx, async (s) => {
    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede',
    });
    uti = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: lt.get('setor')!,
      name: 'UTI',
    });
    cc = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: lt.get('setor')!,
      name: 'Centro Cirúrgico',
    });

    catVent = await createAssetCategory(s, { name: 'Ventilador' });
    const catMon = await createAssetCategory(s, { name: 'Monitor' });
    ventilador = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: catVent,
      locationId: uti,
    });
    monitor = await createAsset(s, {
      name: 'Monitor 01',
      customerId: cliente,
      assetCategoryId: catMon,
      locationId: cc,
    });

    corretiva = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    preventiva = await createCatalogItem(s, {
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

async function os(opts: {
  tipo?: string;
  ativo?: string;
  local?: string;
  concluir?: boolean;
  abertaHaDias?: number;
  responsavel?: string | null;
}): Promise<string> {
  return withTenant(t.db, ctx, async (s) => {
    const w = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: opts.tipo ?? corretiva,
      title: 'OS de teste',
      locationId: opts.local ?? uti,
      assetId: opts.ativo ?? ventilador,
      assigneeMembershipId: opts.responsavel === undefined ? TEC_MEM : opts.responsavel,
    });

    if (opts.abertaHaDias) {
      const quando = new Date(Date.now() - opts.abertaHaDias * 86_400_000);
      await s.query(`UPDATE aurora.work_orders SET created_at = $2 WHERE id = $1`, [w.id, quando]);
      await s.query(`UPDATE aurora.fact_work_order SET opened_at = $2 WHERE work_order_id = $1`, [
        w.id,
        quando,
      ]);
    }

    if (opts.concluir) {
      await transitionWorkOrder(s, w.id, 'in_progress');
      await transitionWorkOrder(s, w.id, 'completed', { resolution: 'trocado o filtro e testado' });
    }

    return w.id;
  });
}

/* -------------------------------------------------------------------------- */

describe('a tabela de fato acompanha a OS', () => {
  it('a OS publicada nasce no fato, com a natureza e o caminho do local', async () => {
    const id = await os({});
    const [f] = await withTenant(t.db, ctx, (s) =>
      s.query<{ work_order_type_key: string; location_path: string; opened_at: Date | null }>(
        `SELECT work_order_type_key, location_path, opened_at FROM aurora.fact_work_order
          WHERE work_order_id = $1`,
        [id]
      )
    );
    expect(f!.work_order_type_key).toBe('corrective');
    expect(f!.location_path.length).toBeGreaterThan(0);
    expect(f!.opened_at).not.toBeNull();
  });

  it('o rascunho não conta como demanda aberta', async () => {
    const rascunho = await withTenant(t.db, ctx, async (s) => {
      const w = await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: corretiva,
        title: 'Rascunho',
        locationId: uti,
        assetId: ventilador,
        publish: false,
      });
      return w.id;
    });

    const [f] = await withTenant(t.db, ctx, (s) =>
      s.query<{ opened_at: Date | null }>(
        `SELECT opened_at FROM aurora.fact_work_order WHERE work_order_id = $1`,
        [rascunho]
      )
    );
    expect(f!.opened_at).toBeNull();
  });

  it('concluir grava o tempo de resolução no mesmo instante', async () => {
    const id = await os({ concluir: true });
    const [f] = await withTenant(t.db, ctx, (s) =>
      s.query<{ resolution_minutes: number | null; completed_at: Date | null }>(
        `SELECT resolution_minutes, completed_at FROM aurora.fact_work_order WHERE work_order_id = $1`,
        [id]
      )
    );
    expect(f!.completed_at).not.toBeNull();
    expect(f!.resolution_minutes).not.toBeNull();
  });

  it('as horas apontadas entram no fato por soma, não por incremento', async () => {
    const id = await os({});
    await withTenant(t.db, ctx, (s) =>
      logTime(s, {
        workOrderId: id,
        membershipId: TEC_MEM,
        startedAt: new Date(Date.now() - 7_200_000),
        endedAt: new Date(Date.now() - 3_600_000),
      })
    );

    const [f] = await withTenant(t.db, ctx, (s) =>
      s.query<{ labor_minutes: number }>(
        `SELECT labor_minutes FROM aurora.fact_work_order WHERE work_order_id = $1`,
        [id]
      )
    );
    expect(Number(f!.labor_minutes)).toBe(60);
  });

  it('a reconstrução chega ao mesmo lugar do gatilho', async () => {
    const antes = await withTenant(t.db, ctx, (s) =>
      s.query<{ work_order_id: string; status_category: string; labor_minutes: number }>(
        `SELECT work_order_id, status_category, labor_minutes FROM aurora.fact_work_order
          ORDER BY work_order_id`
      )
    );

    const total = await withTenant(t.db, ctx, (s) => rebuildFacts(s));
    expect(total).toBe(antes.length);

    const depois = await withTenant(t.db, ctx, (s) =>
      s.query<{ work_order_id: string; status_category: string; labor_minutes: number }>(
        `SELECT work_order_id, status_category, labor_minutes FROM aurora.fact_work_order
          ORDER BY work_order_id`
      )
    );
    expect(depois.map((x) => x.status_category)).toEqual(antes.map((x) => x.status_category));
    expect(depois.map((x) => Number(x.labor_minutes))).toEqual(antes.map((x) => Number(x.labor_minutes)));
  });
});

describe('todo número vem com a sua definição', () => {
  it('as concluídas contam só o que foi entregue no período', async () => {
    const r = await withTenant(t.db, ctx, (s) => workOrdersCompleted(s, PERIODO));
    expect(r.data.count).toBeGreaterThan(0);
    expect(r.definition.exclusions[0]).toMatch(/canceladas/);
  });

  it('o volume traz numerador, exclusões e período', async () => {
    const r = await withTenant(t.db, ctx, (s) => workOrdersOpened(s, PERIODO));
    expect(r.data.count).toBeGreaterThan(0);
    expect(r.definition.numerator).toMatch(/abertura caiu dentro do período/);
    expect(r.definition.exclusions[0]).toMatch(/rascunho/);
    expect(r.period.from).toBe(PERIODO.from.toISOString());
  });

  it('o MTTR avisa que a fórmula da referência não pôde ser confirmada', async () => {
    const r = await withTenant(t.db, ctx, (s) => mttr(s, PERIODO));
    expect(r.definition.comparability).toMatch(/não pôde ser confirmada/);
  });
});

describe('backlog', () => {
  it('conta o que está aberto e distribui por faixa de idade', async () => {
    await os({ abertaHaDias: 100 });
    await os({ abertaHaDias: 45 });
    await os({ abertaHaDias: 2 });

    const r = await withTenant(t.db, ctx, (s) => backlog(s));
    expect(r.data.count).toBeGreaterThanOrEqual(3);
    expect(r.data.buckets['90+']).toBeGreaterThanOrEqual(1);
    expect(r.data.buckets['31-90']).toBeGreaterThanOrEqual(1);
    expect(r.data.oldestDays).toBeGreaterThanOrEqual(100);
  });

  it('a OS concluída sai do backlog', async () => {
    const antes = await withTenant(t.db, ctx, (s) => backlog(s));
    const id = await os({});
    const meio = await withTenant(t.db, ctx, (s) => backlog(s));
    expect(meio.data.count).toBe(antes.data.count + 1);

    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, id, 'in_progress');
      await transitionWorkOrder(s, id, 'completed', { resolution: 'resolvido em campo' });
    });

    const depois = await withTenant(t.db, ctx, (s) => backlog(s));
    expect(depois.data.count).toBe(antes.data.count);
  });

  it('o filtro por subárvore de local separa os setores', async () => {
    await os({ local: cc, ativo: monitor });
    const [caminho] = await withTenant(t.db, ctx, (s) =>
      s.query<{ path: string }>(`SELECT path FROM aurora.locations WHERE id = $1`, [cc])
    );

    const r = await withTenant(t.db, ctx, (s) => backlog(s, new Date(), { locationPath: caminho!.path }));
    const total = await withTenant(t.db, ctx, (s) => backlog(s));
    expect(r.data.count).toBeGreaterThan(0);
    expect(r.data.count).toBeLessThan(total.data.count);
  });
});

describe('MTTR e MTBF', () => {
  it('o MTTR sai em minutos, com o tamanho da amostra', async () => {
    const r = await withTenant(t.db, ctx, (s) => mttr(s, PERIODO));
    expect(r.data.samples).toBeGreaterThan(0);
    expect(r.data.value).not.toBeNull();
    expect(r.coverage?.note).toMatch(/calculado sobre/);
  });

  it('a preventiva não entra no MTTR', async () => {
    const antes = await withTenant(t.db, ctx, (s) => mttr(s, PERIODO));
    await os({ tipo: preventiva, concluir: true });
    const depois = await withTenant(t.db, ctx, (s) => mttr(s, PERIODO));
    expect(depois.data.samples).toBe(antes.data.samples);
  });

  it('mês sem corretiva concluída devolve nulo, não zero', async () => {
    const vazio = {
      from: new Date('2020-01-01T00:00:00Z'),
      to: new Date('2020-02-01T00:00:00Z'),
    };
    const r = await withTenant(t.db, ctx, (s) => mttr(s, vazio));
    expect(r.data.value).toBeNull();
    expect(r.data.samples).toBe(0);
  });

  it('o ativo com uma corretiva só não entra no MTBF, e a cobertura diz', async () => {
    const soUma = await withTenant(t.db, ctx, (s) =>
      createAsset(s, {
        name: 'Bomba de infusão',
        customerId: cliente,
        assetCategoryId: catVent,
        locationId: uti,
      })
    );
    await os({ ativo: soUma });

    const r = await withTenant(t.db, ctx, (s) => mtbf(s, PERIODO));
    // O ventilador tem várias; a bomba tem uma. Só o primeiro produz intervalo.
    expect(r.data.assetsWithInterval).toBeGreaterThanOrEqual(1);
    expect(r.coverage!.excluded).toBeGreaterThanOrEqual(1);
    expect(r.coverage!.note).toMatch(/ativos com corretiva/);
  });

  it('o MTBF tem valor quando há ao menos um intervalo', async () => {
    const r = await withTenant(t.db, ctx, (s) => mtbf(s, PERIODO));
    expect(r.data.value).not.toBeNull();
    expect(r.data.samples).toBeGreaterThan(0);
  });
});

describe('onde o fluxo trava', () => {
  it('o tempo por situação exclui a situação corrente', async () => {
    const id = await os({});
    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, id, 'in_progress');
      await transitionWorkOrder(s, id, 'completed', { resolution: 'concluída para medir o tempo' });
    });

    const r = await withTenant(t.db, ctx, (s) => timeByStatus(s, PERIODO));
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.definition.exclusions[0]).toMatch(/situação corrente/);
  });

  it('o tempo por motivo de espera traz o responsável pela liberação', async () => {
    const id = await os({});
    const motivo = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.wait_reasons WHERE key = 'parts'`).then((r) => r[0]!.id)
    );

    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, id, 'in_progress');
      await transitionWorkOrder(s, id, 'waiting', { waitReasonId: motivo });
      await transitionWorkOrder(s, id, 'in_progress');
    });

    const r = await withTenant(t.db, ctx, (s) => timeByWaitReason(s, PERIODO));
    const pecas = r.data.find((x) => x.key === 'parts');
    expect(pecas).toBeDefined();
    expect(pecas!.responsible).toBeTruthy();
    // A decisão do EPIC-008: aguardar peça é problema nosso e NÃO pausa o SLA.
    expect(pecas!.pausesSla).toBe(false);
  });
});

describe('maturidade e conformidade', () => {
  it('preventiva × corretiva sai em percentual, com a base à vista', async () => {
    const r = await withTenant(t.db, ctx, (s) => preventiveVsCorrective(s, PERIODO));
    expect(r.data.preventive).toBeGreaterThan(0);
    expect(r.data.corrective).toBeGreaterThan(0);
    expect(r.data.preventiveShare).not.toBeNull();
    expect(r.coverage?.note).toMatch(/OS concluídas/);
  });

  it('sem itens de plano no período, a conformidade é nula e não 100 %', async () => {
    const r = await withTenant(t.db, ctx, (s) => planCompliance(s, PERIODO));
    expect(r.data.expected).toBe(0);
    expect(r.data.rate).toBeNull();
  });
});

describe('pessoas', () => {
  it('a produtividade sai por pessoa, com OS e minutos', async () => {
    const r = await withTenant(t.db, ctx, (s) => productivity(s, PERIODO));
    const tecnico = r.data.find((x) => x.membershipId === TEC_MEM);
    expect(tecnico!.completed).toBeGreaterThan(0);
    expect(tecnico!.name).toBe('Técnico');
  });

  it('as horas gastas somam só apontamentos encerrados', async () => {
    const r = await withTenant(t.db, ctx, (s) => laborHours(s, PERIODO));
    expect(r.data.hours).toBeGreaterThan(0);
    expect(r.definition.exclusions[0]).toMatch(/abertos/);
  });
});

describe('SLA', () => {
  it('sem política configurada, o indicador não inventa prazo', async () => {
    const r = await withTenant(t.db, ctx, (s) => slaCompliance(s, PERIODO));
    expect(r.data.rate).toBeNull();
    // A cobertura conta as OS concluídas sem relógio: o denominador honesto.
    expect(r.coverage!.excluded).toBeGreaterThan(0);
  });
});

describe('tempo de primeira resposta', () => {
  it('sem solicitação triada, devolve nulo com a definição que substitui o TMAC', async () => {
    const r = await withTenant(t.db, ctx, (s) => firstResponseTime(s, PERIODO));
    expect(r.data.value).toBeNull();
    expect(r.definition.comparability).toMatch(/TMAC/);
  });
});

describe('avaliação da qualidade (service_rating)', () => {
  const nota = async (n: number | null, opts: { customerId?: string; local?: string } = {}) =>
    withTenant(t.db, ctx, async (s) => {
      const r = await createServiceRequest(s, {
        customerId: opts.customerId ?? cliente,
        summary: 'Solicitação avaliada',
        locationId: opts.customerId ? null : (opts.local ?? uti),
      });
      if (n !== null)
        await s.query(`UPDATE aurora.service_requests SET rating = $2 WHERE id = $1`, [r.id, n]);
      return r.id;
    });

  it('sem avaliação a média é nula — e não zero —, com a lista vazia', async () => {
    const r = await withTenant(t.db, ctx, (s) => serviceRating(s, PERIODO));
    expect(r.data.average).toBeNull();
    expect(r.data.count).toBe(0);
    expect(r.data.distribution).toEqual({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
  });

  it('média, quantidade e distribuição saem da MESMA lista; solicitação sem nota fica de fora', async () => {
    for (const n of [5, 5, 5, 4, 3]) await nota(n);
    await nota(null);
    const r = await withTenant(t.db, ctx, (s) => serviceRating(s, PERIODO));
    expect(r.data.count).toBe(5);
    expect(r.data.average).toBe(4.4);
    expect(r.data.distribution).toEqual({ '1': 0, '2': 0, '3': 1, '4': 1, '5': 3 });
    const soma = Object.values(r.data.distribution).reduce((a, b) => a + b, 0);
    expect(soma).toBe(r.data.count);
    expect(r.definition.unit).toBe('score');
  });

  it('o período recorta: fora dele não conta', async () => {
    const passado = {
      from: new Date(Date.now() - 400 * 86_400_000),
      to: new Date(Date.now() - 390 * 86_400_000),
    };
    const r = await withTenant(t.db, ctx, (s) => serviceRating(s, passado));
    expect(r.data.count).toBe(0);
    expect(r.data.average).toBeNull();
  });

  it('filtro de cliente e escopo do vínculo recortam a lista', async () => {
    const outro = await withTenant(t.db, ctx, (s) => createCustomer(s, { name: 'Outro Hospital' }));
    await nota(1, { customerId: outro });
    const so = await withTenant(t.db, ctx, (s) => serviceRating(s, PERIODO, { customerId: outro }));
    expect(so.data.count).toBe(1);
    expect(so.data.average).toBe(1);
    const escopado = await withTenant(t.db, ctx, (s) =>
      serviceRating(s, PERIODO, { scopeCustomerIds: [cliente] })
    );
    expect(escopado.data.count).toBe(5);
    expect(escopado.data.average).toBe(4.4);
  });
});

describe('Chamados Abertos x Encerrados (AxF)', () => {
  const dias = (n: number) => new Date(Date.now() - n * 86_400_000);

  /** Cria `abertas` OS dentro da janela e `encerradas` concluídas dentro dela, datando o fato. */
  async function cenario(janela: { from: Date; to: Date }, abertas: number, encerradas: number) {
    const meio = new Date((janela.from.getTime() + janela.to.getTime()) / 2);
    const antes = new Date(janela.from.getTime() - 5 * 86_400_000);
    const ids: string[] = [];
    for (let i = 0; i < Math.max(abertas, encerradas); i++) ids.push(await os({ concluir: i < encerradas }));
    await withTenant(t.db, ctx, async (s) => {
      for (let i = 0; i < ids.length; i++) {
        const abertaNaJanela = i < abertas;
        await s.query(
          `UPDATE aurora.fact_work_order SET opened_at = $2::timestamptz, completed_at = CASE WHEN $4::boolean THEN $3::timestamptz ELSE NULL END
            WHERE work_order_id = $1`,
          [ids[i], abertaNaJanela ? meio : antes, meio, i < encerradas]
        );
      }
    });
  }

  it('abaixo de 100 %: 1 encerrada para 4 abertas = 25 %', async () => {
    const j = { from: dias(300), to: dias(290) };
    await cenario(j, 4, 1);
    const r = await withTenant(t.db, ctx, (s) => openedVsClosed(s, j));
    expect(r.data).toMatchObject({ opened: 4, closed: 1, numerator: 1, denominator: 4, percent: 25 });
  });

  it('exatamente 100 %', async () => {
    const j = { from: dias(250), to: dias(240) };
    await cenario(j, 2, 2);
    const r = await withTenant(t.db, ctx, (s) => openedVsClosed(s, j));
    expect(r.data).toMatchObject({ opened: 2, closed: 2, percent: 100 });
  });

  it('acima de 100 %: encerrar no período o que foi aberto antes conta (fluxo, não coorte)', async () => {
    const j = { from: dias(200), to: dias(190) };
    await cenario(j, 1, 3); // 1 aberta na janela, 3 encerradas nela (2 abertas antes)
    const r = await withTenant(t.db, ctx, (s) => openedVsClosed(s, j));
    expect(r.data).toMatchObject({ opened: 1, closed: 3, percent: 300 });
  });

  it('é composto pelas MESMAS contagens do Painel — sem terceira fórmula', async () => {
    const r = await withTenant(t.db, ctx, (s) => openedVsClosed(s, PERIODO));
    const ab = await withTenant(t.db, ctx, (s) => workOrdersOpened(s, PERIODO));
    const en = await withTenant(t.db, ctx, (s) => workOrdersCompleted(s, PERIODO));
    expect(r.data.opened).toBe(ab.data.count);
    expect(r.data.closed).toBe(en.data.count);
  });

  it('sem OS aberta no período, o percentual é nulo (sem dado), não 0 % nem 100 %', async () => {
    const vazio = { from: dias(100), to: dias(90) };
    const r = await withTenant(t.db, ctx, (s) => openedVsClosed(s, vazio));
    expect(r.data.percent).toBeNull();
    expect(r.definition.exclusions.join(' ')).toMatch(/100 %/);
  });
});

describe('isolamento', () => {
  it('a tabela de fato respeita a organização', async () => {
    const OUTRA = newId(),
      U2 = newId(),
      M2 = newId();
    await seedOrganization(
      t,
      { organizationId: OUTRA, userId: U2, membershipId: M2 },
      { slug: 'met2', name: 'Outra', email: 'b@met.test', userName: 'B' }
    );
    const ctx2 = buildContext({
      organizationId: OUTRA,
      actorId: U2,
      membershipId: M2,
      requestId: 'met2',
      permissions: PERMISSION_KEYS,
    });

    const r = await withTenant(t.db, ctx2, (s) => backlog(s));
    expect(r.data.count).toBe(0);
  });
});
