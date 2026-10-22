/**
 * Aurora — Painel de Controle, setores, cadastro de equipamento e planos de
 * manutenção pela HTTP (rodada "overdelivery").
 *
 * O QUE ESTE ARQUIVO PROVA
 *
 * Que cada tela nova respeita a mesma borda que o resto do produto:
 *
 *   · o HOSPITAL (vínculo restrito ao próprio cliente) só vê o próprio
 *     cliente no painel, nos indicadores, nos planos e no cronograma — e
 *     pedir outro cliente responde 404;
 *   · a PRESTADORA vizinha (outra organização) não vê nada desta, nem
 *     consegue usar um identificador desta num cadastro dela;
 *   · setor de outro cliente, equipamento de outro cliente e procedimento de
 *     outro tipo são recusados NO SERVIDOR, com o campo nomeado;
 *   · o checklist guarda nominal e tolerância como dado, e nada aqui calcula
 *     conformidade.
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
  provisionFactoryRoles,
  assignRole,
  provisionStarterLocationTypes,
  provisionWorkOrderStates,
  createCustomer,
  createLocation,
  createCatalogItem,
  createAssetCategory,
  createAsset,
  createPlan,
  addPlanTask,
  generateCycle,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import {
  insightControlPanel,
  plansBoard,
  plansSchedule,
  checklistTemplatesDetail,
  assetsFormOptions,
} from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG = newId();
const OUTRA = newId();
const GESTOR = 'gestora@painel.test';
const HOSPITAL = 'hospital@painel.test';
const TECNICO = 'tecnico@painel.test';
const VIZINHA = 'gestora@vizinha.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

let clienteA: string, clienteB: string;
let setorA: string, setorB: string, unidadeA: string;
let ativoA1: string, ativoB1: string;
let categoria: string;
let setorDaVizinha: string, ativoDaVizinha: string;

const DE = '2026-01-01T00:00:00.000Z';
const ATE = '2027-01-31T00:00:00.000Z';

function conferir(
  schema: {
    safeParse: (v: unknown) => {
      success: boolean;
      error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
    };
  },
  body: unknown
) {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new Error(r.error!.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n'));
  }
}

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, {
    slug: 'painel',
    name: 'Prestadora Painel',
    email: GESTOR,
    userName: 'Gestora',
  });

  const sys = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  const hospitalMem = newId();
  const tecnicoMem = newId();
  await withTenant(t.db, sys, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, ids.membershipId, papeis.get('maintenance_manager')!);
    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);

    clienteA = await createCustomer(s, { name: 'Hospital Alfa' });
    clienteB = await createCustomer(s, { name: 'Hospital Beta' });
    unidadeA = await createLocation(s, {
      customerId: clienteA,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede Alfa',
    });
    const unidadeB = await createLocation(s, {
      customerId: clienteB,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede Beta',
    });
    setorA = await createLocation(s, {
      customerId: clienteA,
      parentId: unidadeA,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    setorB = await createLocation(s, {
      customerId: clienteB,
      parentId: unidadeB,
      locationTypeId: tipos.get('setor')!,
      name: 'Bloco Cirúrgico',
    });

    categoria = await createAssetCategory(s, { name: 'Monitor multiparamétrico' });
    ativoA1 = await createAsset(s, {
      name: 'Monitor Alfa 1',
      customerId: clienteA,
      assetCategoryId: categoria,
      locationId: setorA,
    });
    await createAsset(s, {
      name: 'Monitor Alfa 2',
      customerId: clienteA,
      assetCategoryId: categoria,
      locationId: setorA,
    });
    ativoB1 = await createAsset(s, {
      name: 'Monitor Beta 1',
      customerId: clienteB,
      assetCategoryId: categoria,
      locationId: setorB,
    });

    const preventiva = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });
    await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'calibracao',
      label: 'Calibração',
      systemKey: 'calibration',
    });

    // Um plano por cliente, com ciclo aberto: é o que o painel e o cronograma leem.
    for (const [cli, setor] of [
      [clienteA, setorA],
      [clienteB, setorB],
    ] as const) {
      const plano = await createPlan(s, {
        name: `Preventiva ${cli === clienteA ? 'Alfa' : 'Beta'}`,
        customerId: cli,
        autoGenerate: false,
        anchorDate: new Date('2026-01-01T00:00:00Z'),
      });
      const tarefa = await addPlanTask(s, {
        planId: plano,
        name: 'Inspeção geral',
        targetKind: 'location_subtree',
        targetLocationId: setor,
        workOrderTypeId: preventiva,
        frequencyUnit: 'quarter',
        leadTimeDays: 3650,
        toleranceDays: 5,
      });
      await generateCycle(s, tarefa);
    }

    await t.raw('SELECT 1');
    void hospitalMem;
  });

  // O hospital: vínculo restrito ao cliente A, papel de gestor do cliente.
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: hospitalMem },
    {
      email: HOSPITAL,
      userName: 'Hospital Alfa',
      customerIds: [clienteA],
      seatType: 'portal',
    }
  );
  // Técnico: sem procedure.create nem maintenance_plan.create.
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: tecnicoMem },
    {
      email: TECNICO,
      userName: 'Técnico',
    }
  );
  await withTenant(t.db, sys, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, hospitalMem, papeis.get('customer_manager')!);
    await assignRole(s, tecnicoMem, papeis.get('technician')!);
  });

  // A prestadora vizinha: outra organização, com o próprio cadastro.
  const viz = { organizationId: OUTRA, userId: newId(), membershipId: newId() };
  await seedOrganization(t, viz, {
    slug: 'vizinha',
    name: 'Prestadora Vizinha',
    email: VIZINHA,
    userName: 'Vizinha',
  });
  const sysViz = buildContext({ organizationId: OUTRA, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysViz, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, viz.membershipId, papeis.get('maintenance_manager')!);
    const tipos = await provisionStarterLocationTypes(s);
    const cli = await createCustomer(s, { name: 'Hospital Alfa' });
    const uni = await createLocation(s, {
      customerId: cli,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede',
    });
    setorDaVizinha = await createLocation(s, {
      customerId: cli,
      parentId: uni,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    const cat = await createAssetCategory(s, { name: 'Monitor' });
    ativoDaVizinha = await createAsset(s, {
      name: 'Monitor da vizinha',
      customerId: cli,
      assetCategoryId: cat,
      locationId: setorDaVizinha,
    });
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

/* -------------------------------------------------------------------------- */

describe('Painel de Controle', () => {
  it('responde o painel inteiro numa ida, e satisfaz o contrato', async () => {
    const r = await http.get('/v1/insights/control-panel').query({ from: DE, to: ATE }).set(auth(GESTOR));
    expect(r.status).toBe(200);
    conferir(insightControlPanel.response, r.body);
    expect(r.body.customers.map((c: { name: string }) => c.name)).toEqual(['Hospital Alfa', 'Hospital Beta']);
    expect(r.body.park.total).toBe(3);
    expect(r.body.series.length).toBeGreaterThan(0);
    // O parque por setor: a UTI do Alfa tem dois.
    const uti = r.body.park.bySector.find((x: { location_id: string }) => x.location_id === setorA);
    expect(uti.assets).toBe(2);
  });

  it('a série soma o mesmo que o cartão do período', async () => {
    const r = await http.get('/v1/insights/control-panel').query({ from: DE, to: ATE }).set(auth(GESTOR));
    const somaAbertas = r.body.series.reduce((a: number, p: { opened: number }) => a + p.opened, 0);
    expect(somaAbertas).toBe(r.body.kpis.opened.data.count);
  });

  it('o HOSPITAL só vê o próprio cliente — no filtro, no parque, nos setores', async () => {
    const r = await http.get('/v1/insights/control-panel').query({ from: DE, to: ATE }).set(auth(HOSPITAL));
    expect(r.status).toBe(200);
    expect(r.body.customers.map((c: { id: string }) => c.id)).toEqual([clienteA]);
    expect(r.body.sectors.map((c: { id: string }) => c.id)).toEqual([setorA]);
    expect(r.body.park.total).toBe(2);
  });

  it('o HOSPITAL pedindo outro cliente recebe 404, e não um painel vazio', async () => {
    const r = await http
      .get('/v1/insights/control-panel')
      .query({ from: DE, to: ATE, customerId: clienteB })
      .set(auth(HOSPITAL));
    expect(r.status).toBe(404);
  });

  it('as rotas de indicador avulsas também respeitam o escopo do vínculo', async () => {
    const r = await http.get('/v1/insights/plan-compliance').query({ from: DE, to: ATE }).set(auth(HOSPITAL));
    expect(r.status).toBe(200);
    const g = await http.get('/v1/insights/plan-compliance').query({ from: DE, to: ATE }).set(auth(GESTOR));
    // Dois equipamentos do Alfa no ciclo; o Beta tem um. O hospital vê só os dele.
    expect(r.body.data.expected).toBe(2);
    expect(g.body.data.expected).toBe(3);
    const fora = await http
      .get('/v1/insights/mttr')
      .query({ from: DE, to: ATE, customerId: clienteB })
      .set(auth(HOSPITAL));
    expect(fora.status).toBe(404);
  });

  it('a PRESTADORA vizinha não vê nada desta organização', async () => {
    const r = await http.get('/v1/insights/control-panel').query({ from: DE, to: ATE }).set(auth(VIZINHA));
    expect(r.status).toBe(200);
    expect(r.body.customers).toHaveLength(1);
    expect(r.body.park.total).toBe(1);
    const fora = await http
      .get('/v1/insights/control-panel')
      .query({ from: DE, to: ATE, customerId: clienteA })
      .set(auth(VIZINHA));
    expect(fora.status).toBe(404);
  });

  it('MTTR por fatia: sem corretiva concluída é NULO, nunca zero', async () => {
    const r = await http.get('/v1/insights/control-panel').query({ from: DE, to: ATE }).set(auth(GESTOR));
    for (const p of r.body.series) {
      expect(p.mttrSamples).toBe(0);
      expect(p.mttrMinutes).toBeNull();
    }
  });

  it('as preventivas do painel seguem o mesmo filtro e o mesmo escopo', async () => {
    const g = await http.get('/v1/insights/control-panel').query({ from: DE, to: ATE }).set(auth(GESTOR));
    const h = await http.get('/v1/insights/control-panel').query({ from: DE, to: ATE }).set(auth(HOSPITAL));
    const b = await http
      .get('/v1/insights/control-panel')
      .query({ from: DE, to: ATE, customerId: clienteB })
      .set(auth(GESTOR));
    // Três equipamentos em ciclo: dois do Alfa (hospital), um do Beta.
    expect(g.body.preventives.totals.scheduled).toBe(3);
    expect(h.body.preventives.totals.scheduled).toBe(2);
    expect(b.body.preventives.totals.scheduled).toBe(1);
    const t = g.body.preventives.totals;
    expect(t.done + t.pending + t.late + t.skipped).toBe(t.scheduled);
  });

  it('setor fora do escopo no filtro responde 404', async () => {
    const r = await http
      .get('/v1/insights/control-panel')
      .query({ from: DE, to: ATE, sectorId: setorB })
      .set(auth(HOSPITAL));
    expect(r.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */

describe('Setores e Cliente → Setor → Equipamento', () => {
  it('a ficha do cliente traz os setores com a contagem de equipamentos', async () => {
    const r = await http.get(`/v1/customers/${clienteA}`).set(auth(GESTOR));
    expect(r.status).toBe(200);
    const uti = r.body.locations.find((l: { id: string }) => l.id === setorA);
    expect(uti.location_type_key).toBe('setor');
    expect(uti.asset_count).toBe(2);
    expect(uti.allows_assets).toBe(true);
  });

  it('cria um setor com nome livre e o renomeia', async () => {
    const tipos = await http.get('/v1/location-types').set(auth(GESTOR));
    const setor = tipos.body.items.find((x: { key: string }) => x.key === 'setor');
    const c = await http
      .post('/v1/locations')
      .set(auth(GESTOR))
      .send({ customer_id: clienteA, parent_id: unidadeA, location_type_id: setor.id, name: 'Imaginologia' });
    expect(c.status).toBe(201);
    const p = await http
      .patch(`/v1/locations/${c.body.id}`)
      .set(auth(GESTOR))
      .send({ name: 'Imagem e Diagnóstico' });
    expect(p.status).toBe(200);
    const d = await http.get(`/v1/customers/${clienteA}`).set(auth(GESTOR));
    expect(d.body.locations.some((l: { name: string }) => l.name === 'Imagem e Diagnóstico')).toBe(true);
  });

  it('renomear setor fora do escopo responde 404', async () => {
    const r = await http.patch(`/v1/locations/${setorB}`).set(auth(HOSPITAL)).send({ name: 'Invasão' });
    // O hospital nem tem location.update; a recusa vem antes — 403. O que
    // importa é não renomear. A vizinha, que tem a permissão, recebe 404.
    expect([403, 404]).toContain(r.status);
    const v = await http.patch(`/v1/locations/${setorA}`).set(auth(VIZINHA)).send({ name: 'Invasão' });
    expect(v.status).toBe(404);
  });

  it('opções do formulário de equipamento satisfazem o contrato', async () => {
    const r = await http.get('/v1/assets/form-options').set(auth(GESTOR));
    expect(r.status).toBe(200);
    conferir(assetsFormOptions.response, r.body);
    expect(r.body.categories.some((c: { id: string }) => c.id === categoria)).toBe(true);
  });

  it('cadastra equipamento com cliente E setor', async () => {
    const r = await http.post('/v1/assets').set(auth(GESTOR)).send({
      tag: 'TAG-4',
      name: 'Desfibrilador UTI',
      customer_id: clienteA,
      location_id: setorA,
      asset_category_id: categoria,
      tag: 'DEF-01',
    });
    expect(r.status).toBe(201);
    const ficha = await http.get(`/v1/assets/${r.body.id}`).set(auth(GESTOR));
    expect(ficha.body.location_id).toBe(setorA);
    expect(ficha.body.customer_id).toBe(clienteA);
  });

  it('sem setor, o cadastro é recusado', async () => {
    const r = await http
      .post('/v1/assets')
      .set(auth(GESTOR))
      .send({ tag: 'TAG-5', name: 'Sem setor', customer_id: clienteA, asset_category_id: categoria });
    expect(r.status).toBe(422);
  });

  it('SETOR DE OUTRO CLIENTE é recusado, com o campo nomeado', async () => {
    const r = await http.post('/v1/assets').set(auth(GESTOR)).send({
      tag: 'TAG-6',
      name: 'Intruso',
      customer_id: clienteA,
      location_id: setorB,
      asset_category_id: categoria,
    });
    expect(r.status).toBe(422);
    expect(r.body.field ?? r.body.details?.field).toBe('location_id');
  });

  it('SETOR DE OUTRA ORGANIZAÇÃO não é encontrado', async () => {
    const r = await http.post('/v1/assets').set(auth(GESTOR)).send({
      tag: 'TAG-7',
      name: 'Intruso',
      customer_id: clienteA,
      location_id: setorDaVizinha,
      asset_category_id: categoria,
    });
    expect(r.status).toBe(422);
  });

  it('local que não recebe equipamento (unidade) é recusado', async () => {
    const r = await http.post('/v1/assets').set(auth(GESTOR)).send({
      tag: 'TAG-8',
      name: 'Na unidade',
      customer_id: clienteA,
      location_id: unidadeA,
      asset_category_id: categoria,
    });
    expect(r.status).toBe(422);
  });

  it('edita os dados cadastrais; cliente e setor não mudam por aqui', async () => {
    const r = await http
      .patch(`/v1/assets/${ativoA1}`)
      .set(auth(GESTOR))
      .send({ name: 'Monitor Alfa 1 (leito 3)', serial_number: 'SN-123' });
    expect(r.status).toBe(200);
    const ficha = await http.get(`/v1/assets/${ativoA1}`).set(auth(GESTOR));
    expect(ficha.body.name).toBe('Monitor Alfa 1 (leito 3)');
    expect(ficha.body.serial_number).toBe('SN-123');
    const mover = await http.patch(`/v1/assets/${ativoA1}`).set(auth(GESTOR)).send({ location_id: setorB });
    expect(mover.status).toBe(422);
  });

  it('EQUIPAMENTO DE OUTRO TENANT não é editável', async () => {
    const r = await http.patch(`/v1/assets/${ativoDaVizinha}`).set(auth(GESTOR)).send({ name: 'Invasão' });
    expect(r.status).toBe(404);
  });

  it('a lista de ativos filtra por cliente', async () => {
    const r = await http.get('/v1/assets').query({ customer: clienteB }).set(auth(GESTOR));
    expect(r.status).toBe(200);
    expect(r.body.items.map((a: { id: string }) => a.id)).toEqual([ativoB1]);
  });
});

/* -------------------------------------------------------------------------- */

let templatePreventiva: string;
let templateCalibracao: string;

describe('Checklist / procedimento (motor existente)', () => {
  it('cria checklist com itens e publica', async () => {
    const r = await http
      .post('/v1/checklist-templates')
      .set(auth(GESTOR))
      .send({
        title: 'Preventiva de monitor',
        publish: true,
        items: [
          { kind: 'text', label: 'Número de série conferido' },
          { kind: 'boolean', label: 'Alarmes sonoros funcionam?' },
          { kind: 'number', label: 'Horas de uso', unit: 'h' },
          {
            kind: 'option',
            label: 'Estado do cabo de força',
            options: ['Conforme', 'Não conforme', 'Não se aplica'],
            failing_options: ['Não conforme'],
          },
          { kind: 'text', label: 'Observações', required: false },
        ],
      });
    expect(r.status).toBe(201);
    templatePreventiva = r.body.key;
    const d = await http.get(`/v1/checklist-templates/${r.body.id}`).set(auth(GESTOR));
    conferir(checklistTemplatesDetail.response, d.body);
    expect(d.body.template.status).toBe('published');
    expect(d.body.items).toHaveLength(5);
  });

  it('procedimento de calibração guarda nominal e tolerância como DADO', async () => {
    const r = await http
      .post('/v1/checklist-templates')
      .set(auth(GESTOR))
      .send({
        title: 'Calibração de PNI',
        procedure_kind: 'calibration',
        publish: true,
        items: [
          {
            kind: 'measurement',
            label: 'Pressão a 100 mmHg',
            unit: 'mmHg',
            nominal_value: 100,
            tolerance_minus: 3,
            tolerance_plus: 3,
            tolerance_mode: 'absolute',
            readings_required: 3,
          },
        ],
      });
    expect(r.status).toBe(201);
    templateCalibracao = r.body.key;
    const d = await http.get(`/v1/checklist-templates/${r.body.id}`).set(auth(GESTOR));
    const ponto = d.body.items[0];
    expect(ponto.nominal_value).toBe(100);
    expect(ponto.tolerance_plus).toBe(3);
    expect(ponto.tolerance_mode).toBe('absolute');
    expect(d.body.template.procedure_kind).toBe('calibration');
  });

  it('medição sem unidade é recusada pelo motor', async () => {
    const r = await http
      .post('/v1/checklist-templates')
      .set(auth(GESTOR))
      .send({ title: 'Sem unidade', items: [{ kind: 'measurement', label: 'Ponto', nominal_value: 1 }] });
    expect(r.status).toBe(422);
  });

  it('revisar cria a versão seguinte, e a anterior continua existindo', async () => {
    const lista = await http.get('/v1/checklist-templates').set(auth(GESTOR));
    const base = lista.body.items.find((x: { key: string }) => x.key === templatePreventiva);
    const r = await http
      .post(`/v1/checklist-templates/${base.id}/revisions`)
      .set(auth(GESTOR))
      .send({
        title: 'Preventiva de monitor',
        publish: true,
        items: [{ kind: 'text', label: 'Item revisado' }],
      });
    expect(r.status).toBe(201);
    expect(r.body.version).toBe(2);
    const d = await http.get(`/v1/checklist-templates/${r.body.id}`).set(auth(GESTOR));
    expect(d.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('quem não tem procedure.create não cria checklist', async () => {
    const r = await http
      .post('/v1/checklist-templates')
      .set(auth(TECNICO))
      .send({ title: 'Do técnico', items: [{ kind: 'text', label: 'x' }] });
    expect(r.status).toBe(403);
  });
});

/* -------------------------------------------------------------------------- */

describe('Planos de manutenção — criação orientada', () => {
  const base = () => ({
    name: 'Preventiva semestral UTI',
    customer_id: clienteA,
    sector_id: setorA,
    kind: 'preventive',
    checklist_template_key: templatePreventiva,
    frequency_unit: 'semester',
    frequency_interval: 1,
    anchor_date: '2026-11-01',
  });

  it('o formulário diz quais tipos o domínio suporta aqui', async () => {
    const r = await http.get('/v1/maintenance-plans/form-options').set(auth(GESTOR));
    expect(r.status).toBe(200);
    const tipos = Object.fromEntries(
      r.body.kinds.map((k: { key: string; available: boolean }) => [k.key, k.available])
    );
    expect(tipos).toEqual({
      preventive: true,
      calibration: true,
      electrical_safety: false,
      qualification: false,
    });
  });

  it('setor inteiro vira UMA tarefa por expressão', async () => {
    const r = await http.post('/v1/maintenance-plans').set(auth(GESTOR)).send(base());
    expect(r.status).toBe(201);
    expect(r.body.task_count).toBe(1);
    const d = await http.get(`/v1/maintenance-plans/${r.body.id}`).set(auth(GESTOR));
    expect(d.body.tasks[0].target_kind).toBe('location_subtree');
    expect(d.body.tasks[0].checklist_template_key).toBe(templatePreventiva);
  });

  it('equipamentos escolhidos viram uma tarefa cada', async () => {
    const r = await http
      .post('/v1/maintenance-plans')
      .set(auth(GESTOR))
      .send({
        ...base(),
        name: 'Calibração PNI',
        kind: 'calibration',
        checklist_template_key: templateCalibracao,
        frequency_unit: 'year',
        asset_ids: [ativoA1],
      });
    expect(r.status).toBe(201);
    expect(r.body.task_count).toBe(1);
  });

  it('SETOR DE OUTRO CLIENTE é recusado', async () => {
    const r = await http
      .post('/v1/maintenance-plans')
      .set(auth(GESTOR))
      .send({ ...base(), sector_id: setorB });
    expect(r.status).toBe(422);
    expect(r.body.field ?? r.body.details?.field).toBe('sector_id');
  });

  it('EQUIPAMENTO DE OUTRO CLIENTE é recusado', async () => {
    const r = await http
      .post('/v1/maintenance-plans')
      .set(auth(GESTOR))
      .send({ ...base(), asset_ids: [ativoB1] });
    expect(r.status).toBe(422);
  });

  it('EQUIPAMENTO e SETOR DE OUTRO TENANT são recusados', async () => {
    const a = await http
      .post('/v1/maintenance-plans')
      .set(auth(GESTOR))
      .send({ ...base(), asset_ids: [ativoDaVizinha] });
    expect(a.status).toBe(422);
    const s = await http
      .post('/v1/maintenance-plans')
      .set(auth(GESTOR))
      .send({ ...base(), sector_id: setorDaVizinha });
    expect(s.status).toBe(422);
  });

  it('procedimento de outro tipo é recusado (calibração num plano preventivo)', async () => {
    const r = await http
      .post('/v1/maintenance-plans')
      .set(auth(GESTOR))
      .send({ ...base(), checklist_template_key: templateCalibracao });
    expect(r.status).toBe(422);
    expect(r.body.field ?? r.body.details?.field).toBe('checklist_template_key');
  });

  it('tipo sem natureza de OS no catálogo é recusado (TSE aqui)', async () => {
    const r = await http
      .post('/v1/maintenance-plans')
      .set(auth(GESTOR))
      .send({ ...base(), kind: 'electrical_safety', checklist_template_key: null });
    expect(r.status).toBe(422);
  });

  it('educação continuada não existe no domínio e não é aceita', async () => {
    const r = await http
      .post('/v1/maintenance-plans')
      .set(auth(GESTOR))
      .send({ ...base(), kind: 'continuing_education' });
    expect(r.status).toBe(422);
  });

  it('o hospital não cria plano', async () => {
    const r = await http.post('/v1/maintenance-plans').set(auth(HOSPITAL)).send(base());
    expect(r.status).toBe(403);
  });
});

describe('Planos — painel, cronograma e escopo', () => {
  it('o painel conta programados por estado e satisfaz o contrato', async () => {
    const r = await http.get('/v1/maintenance-plans/board').query({ from: DE, to: ATE }).set(auth(GESTOR));
    expect(r.status).toBe(200);
    conferir(plansBoard.response, r.body);
    expect(r.body.totals.scheduled).toBe(3);
    expect(r.body.byCustomer).toHaveLength(2);
    const soma = r.body.totals.done + r.body.totals.pending + r.body.totals.late + r.body.totals.skipped;
    expect(soma).toBe(r.body.totals.scheduled);
  });

  it('o cronograma traz reais e PREVISTOS, marcados', async () => {
    const r = await http.get('/v1/maintenance-plans/schedule').query({ from: DE, to: ATE }).set(auth(GESTOR));
    expect(r.status).toBe(200);
    conferir(plansSchedule.response, r.body);
    expect(r.body.items.some((i: { projected: boolean }) => !i.projected)).toBe(true);
    expect(r.body.items.some((i: { projected: boolean }) => i.projected)).toBe(true);
    for (const i of r.body.items.filter((x: { projected: boolean }) => x.projected)) {
      expect(i.id).toBeNull();
      expect(i.state).toBe('planned');
    }
  });

  it('o HOSPITAL só vê os planos e o cronograma do próprio cliente', async () => {
    const lista = await http.get('/v1/maintenance-plans').set(auth(HOSPITAL));
    expect(lista.status).toBe(200);
    expect(new Set(lista.body.items.map((p: { customer_id: string }) => p.customer_id))).toEqual(
      new Set([clienteA])
    );

    const crono = await http
      .get('/v1/maintenance-plans/schedule')
      .query({ from: DE, to: ATE })
      .set(auth(HOSPITAL));
    expect(crono.body.items.every((i: { customer_id: string }) => i.customer_id === clienteA)).toBe(true);

    const painel = await http
      .get('/v1/maintenance-plans/board')
      .query({ from: DE, to: ATE })
      .set(auth(HOSPITAL));
    expect(painel.body.byCustomer.map((c: { key: string }) => c.key)).toEqual([clienteA]);

    const outro = await http
      .get('/v1/maintenance-plans/board')
      .query({ from: DE, to: ATE, customer: clienteB })
      .set(auth(HOSPITAL));
    expect(outro.status).toBe(404);

    const planoB = lista.body.items.length; // só para não haver dúvida do tamanho
    expect(planoB).toBeGreaterThan(0);
  });

  it('o detalhe de plano de outro cliente responde 404 ao hospital', async () => {
    const todos = await http.get('/v1/maintenance-plans').set(auth(GESTOR));
    const doBeta = todos.body.items.find((p: { customer_id: string }) => p.customer_id === clienteB);
    const r = await http.get(`/v1/maintenance-plans/${doBeta.id}`).set(auth(HOSPITAL));
    expect(r.status).toBe(404);
  });

  it('a PRESTADORA vizinha não vê os planos desta', async () => {
    const r = await http
      .get('/v1/maintenance-plans/schedule')
      .query({ from: DE, to: ATE })
      .set(auth(VIZINHA));
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(0);
    const l = await http.get('/v1/checklist-templates').set(auth(VIZINHA));
    expect(l.body.items).toHaveLength(0);
  });
});
