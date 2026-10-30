/**
 * Aurora — planos: ativar/inativar, ▶ Play, conformidade por plano, vários setores, relatório
 * de conformidade e as listas de espera da tela Hoje (rodada de 29/10/2026).
 *
 *   · PLN-01  ativar/inativar por rota, só com `maintenance_plan.update`, auditado; inativo não
 *             abre ciclo (nem OS futura) e sai da projeção; o que já foi gerado continua;
 *   · PLN-02  "planos ativos" conta PLANOS, e respeita cliente, setor e tipo;
 *   · PLN-04  cliente + setores + tipo ao mesmo tempo;
 *   · PLN-09  equipamentos elegíveis do plano → executar → OS;
 *   · PLN-10  taxa por plano = realizados ÷ (programados − dispensados);
 *   · PLN-11  vários setores; setor fora do escopo ou de outra organização → 404;
 *   · REL-12  ranking por conformidade (não por volume), com a definição, e o .xlsx;
 *   · ORC-05  aguardando peças / orçamento: contadores = listas, recortes e escopo.
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
  provisionOrganizationBaseline,
  createWorkOrder,
  transitionWorkOrder,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { plansBoard, plansComplianceReport, plansEligibleItems, todayWaiting } from '@aurora/contracts';
import { createApp } from '../bootstrap';
import { abaPorNome, celulas, lerZip } from './apoio/ler-xlsx';

const ORG = newId();
const ORG_B = newId();
const GESTORA = 'gestora@planos-conf.test';
const OPERADOR = 'operador@planos-conf.test';
const HOSPITAL = 'hospital@planos-conf.test';
const VIZINHA = 'admin@planos-conf-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const DE = '2025-11-01T00:00:00.000Z';
const ATE = '2027-10-01T00:00:00.000Z';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

let clienteA: string, clienteB: string;
let uti: string, cc: string, ped: string, setorB: string, setorDaVizinha: string;
let planoUti: string, planoCc: string, planoPed: string, planoB: string;
let tarefaPed: string;
let itemUtiAberto: string;
let memOperador: string;
let osPecaA: string, osOrcamentoCc: string, osOrcamentoUti: string, orcamentoSemOs: string;

const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
const ctxCompleto = () =>
  buildContext({
    organizationId: ORG,
    actorId: ids.userId,
    membershipId: ids.membershipId,
    requestId: 'setup',
    permissions: PERMISSION_KEYS,
  });

beforeAll(async () => {
  t = await createTestDatabase();
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, {
    slug: 'planos-conf',
    name: 'Prestadora',
    email: GESTORA,
    userName: 'Gestora',
  });
  await seedOrganization(t, idsB, { slug: 'planos-conf-b', name: 'Vizinha', email: VIZINHA, userName: 'B' });

  await withTenant(t.db, ctxCompleto(), async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, ids.membershipId, base.roles.get('manager')!);
    clienteA = await createCustomer(s, { name: 'Hospital Alfa' });
    clienteB = await createCustomer(s, { name: 'Hospital Beta' });
    const sedeA = await createLocation(s, {
      customerId: clienteA,
      locationTypeId: base.locationTypes.get('unidade')!,
      name: 'Sede Alfa',
    });
    const sedeB = await createLocation(s, {
      customerId: clienteB,
      locationTypeId: base.locationTypes.get('unidade')!,
      name: 'Sede Beta',
    });
    const setor = (customerId: string, parentId: string, name: string) =>
      createLocation(s, { customerId, parentId, locationTypeId: base.locationTypes.get('setor')!, name });
    uti = await setor(clienteA, sedeA, 'UTI');
    cc = await setor(clienteA, sedeA, 'Centro Cirúrgico');
    ped = await setor(clienteA, sedeA, 'Pediatria');
    setorB = await setor(clienteB, sedeB, 'Emergência');

    const cat = await createAssetCategory(s, { name: 'Monitor', parentId: base.families.get('diagnosis') });
    const ativo = (name: string, customerId: string, locationId: string) =>
      createAsset(s, { name, customerId, assetCategoryId: cat, locationId });
    await ativo('Monitor UTI 1', clienteA, uti);
    await ativo('Monitor UTI 2', clienteA, uti);
    await ativo('Monitor CC 1', clienteA, cc);
    await ativo('Monitor PED 1', clienteA, ped);
    await ativo('Monitor Beta 1', clienteB, setorB);

    const tpl = await createChecklistTemplate(s, { key: 'prev_conf', title: 'Preventiva de monitor' });
    await addChecklistItem(s, { templateId: tpl, kind: 'boolean', label: 'Alarmes ok?', required: true });
    await publishChecklist(s, tpl);
    const tse = await createChecklistTemplate(s, {
      key: 'tse_conf',
      title: 'TSE de monitor',
      procedureKind: 'electrical_safety',
    });
    await addChecklistItem(s, { templateId: tse, kind: 'number', label: 'Corrente de fuga', unit: 'µA' });
    await publishChecklist(s, tse);

    const natureza = async (k: string) =>
      (
        await s.query<{ id: string }>(
          `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = $1`,
          [k]
        )
      )[0]!.id;
    const plano = async (name: string, customerId: string, local: string, kind: string, chave?: string) => {
      const p = await createPlan(s, {
        name,
        customerId,
        autoGenerate: false,
        anchorDate: new Date('2026-01-01T00:00:00Z'),
      });
      const tarefa = await addPlanTask(s, {
        planId: p,
        name: `${name} — tarefa`,
        targetKind: 'location_subtree',
        targetLocationId: local,
        workOrderTypeId: await natureza(kind),
        frequencyUnit: 'quarter',
        leadTimeDays: 3650,
        toleranceDays: 5,
        checklistTemplateKey: chave ?? null,
      });
      await generateCycle(s, tarefa);
      return { p, tarefa };
    };
    planoUti = (await plano('Preventiva UTI', clienteA, uti, 'preventive', 'prev_conf')).p;
    planoCc = (await plano('Preventiva CC', clienteA, cc, 'preventive')).p;
    const pedido = await plano('Calibração Pediatria', clienteA, ped, 'calibration');
    planoPed = pedido.p;
    tarefaPed = pedido.tarefa;
    planoB = (await plano('Preventiva Beta', clienteB, setorB, 'preventive')).p;

    // UTI: um realizado e um em aberto (vencido) → 50 %. CC: o único item dispensado → sem
    // denominador. Pediatria e Beta: um vencido cada → 0 %.
    const itensUti = await s.query<{ id: string }>(
      `SELECT i.id FROM aurora.plan_cycle_items i JOIN aurora.plan_tasks t ON t.id = i.task_id
        WHERE t.plan_id = $1 ORDER BY i.id`,
      [planoUti]
    );
    await s.query(`UPDATE aurora.plan_cycle_items SET status = 'done' WHERE id = $1`, [itensUti[0]!.id]);
    itemUtiAberto = itensUti[1]!.id;
    await s.query(
      `UPDATE aurora.plan_cycle_items SET status = 'skipped', skip_reason = 'equipamento emprestado'
        WHERE task_id IN (SELECT id FROM aurora.plan_tasks WHERE plan_id = $1)`,
      [planoCc]
    );
  });

  memOperador = newId();
  const memHospital = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memOperador },
    { email: OPERADOR, userName: 'Operador Um' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memHospital },
    { email: HOSPITAL, userName: 'Hospital', seatType: 'portal', customerIds: [clienteA] }
  );
  await withTenant(t.db, ctxCompleto(), async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, memOperador, base.roles.get('operator')!);
    await assignRole(s, memHospital, base.roles.get('customer_manager')!);

    // As esperas da tela Hoje (ORC-05).
    const motivo = async (k: string) =>
      (await s.query<{ id: string }>(`SELECT id FROM aurora.wait_reasons WHERE key = $1`, [k]))[0]!.id;
    const corretiva = (
      await s.query<{ id: string }>(
        `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
      )
    )[0]!.id;
    const os = async (title: string, customerId: string, locationId: string, assignee?: string) =>
      (
        await createWorkOrder(s, {
          customerId,
          workOrderTypeId: corretiva,
          title,
          locationId,
          assigneeMembershipId: assignee ?? null,
        })
      ).id;
    osPecaA = await os('Troca de cabo — UTI', clienteA, uti, memOperador);
    await transitionWorkOrder(s, osPecaA, 'in_progress');
    await transitionWorkOrder(s, osPecaA, 'waiting', { waitReasonId: await motivo('parts') });

    const osPecaB = await os('Troca de bateria — Beta', clienteB, setorB);
    await transitionWorkOrder(s, osPecaB, 'in_progress');
    await transitionWorkOrder(s, osPecaB, 'waiting', { waitReasonId: await motivo('parts') });

    osOrcamentoCc = await os('Reparo de placa — CC', clienteA, cc);
    await transitionWorkOrder(s, osOrcamentoCc, 'in_progress');
    await transitionWorkOrder(s, osOrcamentoCc, 'waiting', { waitReasonId: await motivo('quote_approval') });

    osOrcamentoUti = await os('Orçar sensor — UTI', clienteA, uti);
  });

  // Orçamentos enviados e sem resposta: um ligado à OS da UTI, um sem OS.
  orcamentoSemOs = newId();
  await t.raw(
    `INSERT INTO aurora.quotes (id, organization_id, number, customer_id, work_order_id, status, sent_at)
     VALUES ($1, $2, 'QT-T-1', $3, $4, 'sent', now()), ($5, $2, 'QT-T-2', $3, NULL, 'viewed', now())`,
    [newId(), ORG, clienteA, osOrcamentoUti, orcamentoSemOs]
  );

  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_B, actorKind: 'system', requestId: 'b' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, idsB.membershipId, base.roles.get('admin')!);
      const cli = await createCustomer(s, { name: 'Outro' });
      const sede = await createLocation(s, {
        customerId: cli,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'Sede',
      });
      setorDaVizinha = await createLocation(s, {
        customerId: cli,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI',
      });
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
}, 180_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

const quadro = (q: Record<string, string | string[]>, quem = GESTORA) =>
  http
    .get('/v1/maintenance-plans/board')
    .query({ from: DE, to: ATE, ...q })
    .set(auth(quem));

/* -------------------------------------------------------------------------- */

describe('PLN-02 · planos ativos ≠ programações, com os filtros do quadro', () => {
  it('sem filtro: 4 planos e 5 programados — contagens diferentes, de coisas diferentes', async () => {
    const r = await quadro({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(plansBoard.response.safeParse(r.body).success).toBe(true);
    expect(r.body.plans.active).toBe(4);
    expect(r.body.totals.scheduled).toBe(5);
  });

  it('respeita cliente, setor e tipo', async () => {
    expect((await quadro({ customer: clienteB })).body.plans.active).toBe(1);
    expect((await quadro({ kind: 'calibration' })).body.plans.active).toBe(1);
    const soUti = await quadro({ sector: uti });
    expect(soUti.body.plans.active).toBe(1);
    // Um plano, dois equipamentos programados: o número de planos não é o de programações.
    expect(soUti.body.totals.scheduled).toBe(2);
    expect((await quadro({ sector: [uti, cc] })).body.plans.active).toBe(2);
  });

  it('o hospital conta só os planos do próprio cliente', async () => {
    const r = await quadro({}, HOSPITAL);
    expect(r.body.plans.active).toBe(3);
  });
});

describe('PLN-04 / PLN-11 · filtros combinados e vários setores', () => {
  it('dois setores ao mesmo tempo: entra o que está em QUALQUER um deles', async () => {
    const r = await quadro({ sector: [uti, cc] });
    expect(r.status).toBe(200);
    expect(r.body.totals.scheduled).toBe(3);
    expect(r.body.bySector.map((x: { key: string }) => x.key).sort()).toEqual([uti, cc].sort());
  });

  it('cliente + setores + tipo, todos juntos', async () => {
    const prev = await quadro({ customer: clienteA, sector: [uti, ped], kind: 'preventive' });
    expect(prev.body.totals.scheduled).toBe(2);
    expect(prev.body.byPlan.map((p: { label: string }) => p.label)).toEqual(['Preventiva UTI']);
    const cal = await quadro({ customer: clienteA, sector: [uti, ped], kind: 'calibration' });
    expect(cal.body.totals.scheduled).toBe(1);
    expect(cal.body.byPlan.map((p: { label: string }) => p.label)).toEqual(['Calibração Pediatria']);
    // Setor de um cliente com o filtro de OUTRO cliente: a combinação não tem atividade.
    const cruzado = await quadro({ customer: clienteB, sector: uti });
    expect(cruzado.body.totals.scheduled).toBe(0);
  });

  it('o cronograma também aceita vários setores', async () => {
    const r = await http
      .get('/v1/maintenance-plans/schedule')
      .query({ from: DE, to: ATE, sector: [uti, ped] })
      .set(auth(GESTORA));
    expect(r.status).toBe(200);
    const setores = new Set(r.body.items.map((i: { sector_name: string }) => i.sector_name));
    expect(setores).toEqual(new Set(['UTI', 'Pediatria']));
  });

  it('setor fora do escopo ou de outra organização → 404, nunca um quadro vazio', async () => {
    expect((await quadro({ sector: [uti, setorB] }, HOSPITAL)).status).toBe(404);
    expect((await quadro({ sector: setorDaVizinha })).status).toBe(404);
    expect((await quadro({ sector: uti }, VIZINHA)).status).toBe(404);
  });
});

describe('PLN-10 · conformidade por plano', () => {
  it('cada plano traz a taxa: realizados ÷ (programados − dispensados)', async () => {
    const r = await quadro({});
    const taxa = (label: string) =>
      r.body.byPlan.find((p: { label: string }) => p.label === label).rate as number | null;
    expect(taxa('Preventiva UTI')).toBe(50);
    expect(taxa('Calibração Pediatria')).toBe(0);
    // Tudo dispensado: sem denominador é NULO, não zero.
    expect(taxa('Preventiva CC')).toBeNull();
  });
});

describe('REL-12 · relatório de conformidade', () => {
  const corpo = { from: DE, to: ATE };

  it('ranqueia pela TAXA, com a definição do denominador', async () => {
    const r = await http.post('/v1/maintenance-plans/compliance-report').set(auth(GESTORA)).send(corpo);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(plansComplianceReport.response.safeParse(r.body).success).toBe(true);
    expect(r.body.byPlan.map((p: { label: string }) => p.label)).toEqual([
      'Preventiva UTI',
      'Calibração Pediatria',
      'Preventiva Beta',
      'Preventiva CC',
    ]);
    expect(r.body.byPlan.map((p: { position: number }) => p.position)).toEqual([1, 2, 3, 4]);
    expect(r.body.byPlan[0]).toMatchObject({ done: 1, denominator: 2, scheduled: 2, rate: 50 });
    expect(r.body.byPlan[3]).toMatchObject({ skipped: 1, denominator: 0, rate: null });
    expect(r.body.definition.denominator).toMatch(/dispensados/);
    expect(r.body.totals.denominator).toBe(r.body.totals.scheduled - r.body.totals.skipped);
    // Por cliente: Alfa (1 de 3 = 33,3 %) acima de Beta (0 de 1).
    expect(r.body.byCustomer.map((c: { label: string }) => c.label)).toEqual([
      'Hospital Alfa',
      'Hospital Beta',
    ]);
    expect(r.body.byCustomer[0].rate).toBe(33.3);
  });

  it('o relatório aceita vários setores e ranqueia os setores pela taxa', async () => {
    const r = await http
      .post('/v1/maintenance-plans/compliance-report')
      .set(auth(GESTORA))
      .send({ ...corpo, sector_ids: [uti, ped] });
    expect(r.body.bySector.map((x: { label: string }) => x.label)).toEqual(['UTI', 'Pediatria']);
    expect(r.body.totals.scheduled).toBe(3);
  });

  it('o hospital só vê o próprio cliente; outro cliente → 404', async () => {
    const r = await http.post('/v1/maintenance-plans/compliance-report').set(auth(HOSPITAL)).send(corpo);
    expect(r.body.byCustomer.map((c: { key: string }) => c.key)).toEqual([clienteA]);
    const fora = await http
      .post('/v1/maintenance-plans/compliance-report')
      .set(auth(HOSPITAL))
      .send({ ...corpo, customer_id: clienteB });
    expect(fora.status).toBe(404);
  });

  it('exporta em Excel com os mesmos números e a definição', async () => {
    const r = await http
      .post('/v1/maintenance-plans/compliance-report?format=xlsx')
      .set(auth(GESTORA))
      .send(corpo)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    const arquivos = lerZip(r.body as Buffer);
    const plano = celulas(abaPorNome(arquivos, 'Por plano'));
    expect(plano.get('A2')?.valor).toBe('1');
    expect(plano.get('B2')?.valor).toBe('Preventiva UTI');
    expect(plano.get('C2')?.valor).toBe('50');
    expect(plano.get('E2')?.valor).toBe('2');
    expect(plano.get('B5')?.valor).toBe('Preventiva CC');
    expect(plano.get('C5')?.valor).toBe('Sem denominador');
    const definicao = abaPorNome(arquivos, 'Definição');
    expect(definicao).toContain('programados − dispensados');
  });

  it('formato desconhecido → 422', async () => {
    const r = await http
      .post('/v1/maintenance-plans/compliance-report?format=csv')
      .set(auth(GESTORA))
      .send(corpo);
    expect(r.status).toBe(422);
  });
});

describe('PLN-09 · ▶ Play: plano → equipamento elegível → OS', () => {
  it('lista só o que está em aberto (realizado e dispensado ficam de fora)', async () => {
    const r = await http.get(`/v1/maintenance-plans/${planoUti}/eligible-items`).set(auth(OPERADOR));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(plansEligibleItems.response.safeParse(r.body).success).toBe(true);
    expect(r.body.items.map((i: { id: string }) => i.id)).toEqual([itemUtiAberto]);
    expect(r.body.items[0].sector_name).toBe('UTI');
    const cc2 = await http.get(`/v1/maintenance-plans/${planoCc}/eligible-items`).set(auth(OPERADOR));
    expect(cc2.body.items).toEqual([]);
  });

  it('o item elegível executa e termina na OS; a OS aparece no item', async () => {
    const r = await http
      .post(`/v1/maintenance-plans/cycle-items/${itemUtiAberto}/execute`)
      .set(auth(OPERADOR));
    expect(r.status).toBe(201);
    const depois = await http.get(`/v1/maintenance-plans/${planoUti}/eligible-items`).set(auth(OPERADOR));
    expect(depois.body.items[0].work_order_id).toBe(r.body.work_order_id);
  });

  it('plano de outro cliente ao hospital, e de outra organização → 404', async () => {
    expect(
      (await http.get(`/v1/maintenance-plans/${planoB}/eligible-items`).set(auth(HOSPITAL))).status
    ).toBe(404);
    expect(
      (await http.get(`/v1/maintenance-plans/${planoUti}/eligible-items`).set(auth(VIZINHA))).status
    ).toBe(404);
  });
});

describe('ORC-05 · aguardando peças e aguardando orçamento', () => {
  const espera = (q: Record<string, string | string[]>, quem = GESTORA) =>
    http.get('/v1/today/waiting').query(q).set(auth(quem));

  it('contadores e listas saem da mesma consulta', async () => {
    const r = await espera({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(todayWaiting.response.safeParse(r.body).success).toBe(true);
    expect(r.body.counts).toEqual({ parts: 2, quote: 3 });
    expect(r.body.items).toHaveLength(5);
  });

  it('peças do cliente A: a OS certa, com o responsável e o setor', async () => {
    const r = await espera({ reason: 'parts', customer: clienteA });
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({
      kind: 'work_order',
      work_order_id: osPecaA,
      sector_id: uti,
      sector_name: 'UTI',
      assignee_membership_id: memOperador,
      assignee_name: 'Operador Um',
    });
    expect(r.body.counts.parts).toBe(1);
  });

  it('recorte por responsável', async () => {
    const r = await espera({ assignee: memOperador });
    expect(r.body.items.map((i: { work_order_id: string }) => i.work_order_id)).toEqual([osPecaA]);
  });

  it('orçamento: pelo motivo de espera, pelo orçamento enviado e o orçamento sem OS', async () => {
    const r = await espera({ reason: 'quote' });
    const linhas = r.body.items.map(
      (i: { kind: string; work_order_id: string | null; quote_id: string | null }) =>
        i.kind === 'quote' ? `orc:${i.quote_id}` : `os:${i.work_order_id}`
    );
    expect(new Set(linhas)).toEqual(
      new Set([`os:${osOrcamentoCc}`, `os:${osOrcamentoUti}`, `orc:${orcamentoSemOs}`])
    );
  });

  it('vários setores: só as OS desses setores (orçamento sem OS não tem setor)', async () => {
    const r = await espera({ reason: 'quote', sector: [uti, cc] });
    expect(new Set(r.body.items.map((i: { work_order_id: string }) => i.work_order_id))).toEqual(
      new Set([osOrcamentoCc, osOrcamentoUti])
    );
    const so = await espera({ reason: 'quote', sector: uti });
    expect(so.body.items.map((i: { work_order_id: string }) => i.work_order_id)).toEqual([osOrcamentoUti]);
  });

  it('o hospital vê só o próprio cliente; outro cliente ou setor → 404', async () => {
    const r = await espera({}, HOSPITAL);
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({ parts: 1, quote: 3 });
    expect(r.body.items.every((i: { customer_id: string }) => i.customer_id === clienteA)).toBe(true);
    expect((await espera({ customer: clienteB }, HOSPITAL)).status).toBe(404);
    expect((await espera({ sector: setorB }, HOSPITAL)).status).toBe(404);
  });

  it('a outra organização não vê nada', async () => {
    const r = await espera({}, VIZINHA);
    expect(r.body.counts).toEqual({ parts: 0, quote: 0 });
  });
});

describe('OS-15 · procedimentos adicionais pela criação orientada', () => {
  const corpo = {
    name: 'Preventiva + TSE da UTI',
    customer_id: '',
    sector_id: '',
    kind: 'preventive',
    checklist_template_key: 'prev_conf',
    extra_checklist_template_keys: ['tse_conf'],
    frequency_unit: 'year',
    frequency_interval: 1,
    anchor_date: '2027-06-01',
    auto_generate: false,
  };

  it('a tarefa guarda os procedimentos adicionais; a ficha os devolve', async () => {
    const r = await http
      .post('/v1/maintenance-plans')
      .set(auth(GESTORA))
      .send({ ...corpo, customer_id: clienteA, sector_id: uti });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const d = await http.get(`/v1/maintenance-plans/${r.body.id}`).set(auth(GESTORA));
    expect(d.body.tasks[0].checklist_template_key).toBe('prev_conf');
    expect(d.body.tasks[0].extra_checklist_template_keys).toEqual(['tse_conf']);
  });

  it('procedimento adicional inexistente é recusado com o campo nomeado', async () => {
    const r = await http
      .post('/v1/maintenance-plans')
      .set(auth(GESTORA))
      .send({
        ...corpo,
        name: 'Com procedimento que não existe',
        customer_id: clienteA,
        sector_id: uti,
        extra_checklist_template_keys: ['nao_existe'],
      });
    expect(r.status).toBe(422);
    expect(r.body.field ?? r.body.details?.field).toBe('extra_checklist_template_keys');
  });
});

/* As mudanças de estado do plano ficam por último: abrem ciclo novo e mexeriam nos números acima. */
describe('PLN-01 · ativar/inativar plano', () => {
  it('sem maintenance_plan.update → 403; outra organização → 404', async () => {
    expect(
      (await http.post(`/v1/maintenance-plans/${planoPed}/deactivate`).set(auth(OPERADOR)).send({})).status
    ).toBe(403);
    expect(
      (await http.post(`/v1/maintenance-plans/${planoPed}/deactivate`).set(auth(HOSPITAL)).send({})).status
    ).toBe(403);
    expect(
      (await http.post(`/v1/maintenance-plans/${planoPed}/deactivate`).set(auth(VIZINHA)).send({})).status
    ).toBe(404);
  });

  it('inativa com motivo: fica na ficha e na auditoria; o histórico continua', async () => {
    const ativosAntes = (await quadro({})).body.plans.active as number;
    const r = await http
      .post(`/v1/maintenance-plans/${planoPed}/deactivate`)
      .set(auth(GESTORA))
      .send({ reason: 'Contrato da pediatria suspenso' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toEqual({ is_active: false, changed: true });

    const d = await http.get(`/v1/maintenance-plans/${planoPed}`).set(auth(GESTORA));
    expect(d.body.plan.is_active).toBe(false);
    expect(d.body.plan.active_change_reason).toBe('Contrato da pediatria suspenso');
    expect(d.body.plan.active_changed_by_name).toBe('Gestora');

    const log = await t.raw(
      `SELECT changes FROM aurora.audit_logs
        WHERE entity_type = 'maintenance_plans' AND entity_id = $1 AND action = 'update'
        ORDER BY occurred_at DESC LIMIT 1`,
      [planoPed]
    );
    const changes = log[0]!.changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.is_active).toEqual({ from: true, to: false });

    // O que já foi gerado continua contando: inativar não apaga história.
    const b = await quadro({});
    expect(b.body.byPlan.some((p: { label: string }) => p.label === 'Calibração Pediatria')).toBe(true);
    expect(b.body.plans.active).toBe(ativosAntes - 1);
  });

  it('inativo não gera ciclo (nem OS futura) e sai da projeção do cronograma', async () => {
    const g = await http.post(`/v1/maintenance-plans/tasks/${tarefaPed}/cycles`).set(auth(GESTORA));
    expect(g.status).toBe(422);
    const crono = await http
      .get('/v1/maintenance-plans/schedule')
      .query({ from: DE, to: ATE })
      .set(auth(GESTORA));
    const previstos = crono.body.items.filter(
      (i: { projected: boolean; plan_id: string }) => i.projected && i.plan_id === planoPed
    );
    expect(previstos).toHaveLength(0);
  });

  it('reativar devolve a geração; pedir o mesmo estado não muda nada', async () => {
    const r = await http.post(`/v1/maintenance-plans/${planoPed}/activate`).set(auth(GESTORA)).send({});
    expect(r.body).toEqual({ is_active: true, changed: true });
    const de = await http.post(`/v1/maintenance-plans/${planoPed}/activate`).set(auth(GESTORA)).send({});
    expect(de.body).toEqual({ is_active: true, changed: false });
    const g = await http.post(`/v1/maintenance-plans/tasks/${tarefaPed}/cycles`).set(auth(GESTORA));
    expect(g.status, JSON.stringify(g.body)).toBe(201);
  });

  it('motivo maior que 500 caracteres → 422', async () => {
    const r = await http
      .post(`/v1/maintenance-plans/${planoPed}/deactivate`)
      .set(auth(GESTORA))
      .send({ reason: 'x'.repeat(501) });
    expect(r.status).toBe(422);
  });
});
