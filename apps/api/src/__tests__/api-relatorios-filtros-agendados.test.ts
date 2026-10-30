/**
 * Aurora — rodada de 29/10/2026 nos relatórios:
 *
 *   · REL-03 — o gerador filtra por SETOR (escolhido no diálogo), TIPO DE MANUTENÇÃO da OS e
 *     FAMÍLIA/tipo de equipamento, sempre no escopo de quem pede (`GET /reports/options`);
 *   · REL-13 / AUT-05 — o nível contratado pelo cliente é teto também no relatório AGENDADO:
 *     recusado ao criar a automação e, se o contrato mudou depois, a execução não manda o
 *     relatório acima do nível e registra o motivo no log, sem avisar ninguém;
 *   · REL-15 — os filtros do relatório viram parâmetros da automação e a execução os respeita;
 *   · REL-07 — cada indicador sai com a versão da fórmula, a data e a fonte (JSON, PDF, Excel);
 *   · marca — nenhum PDF ou planilha de relatório diz "Aurora" (o nome técnico interno).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext, findIndicator } from '@aurora/domain';
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
  createWorkOrder,
  createAsset,
  createAssetCategory,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { reportsCatalog, reportsGenerate, reportsOptions } from '@aurora/contracts';
import { createApp } from '../bootstrap';
import { abaPorNome, celulas, lerZip } from './apoio/ler-xlsx';

const ORG = newId();
const ADMIN = 'admin@relf.test';
const RESTRITA = 'restrita@relf.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const DE = new Date(Date.now() - 30 * 86_400_000).toISOString();
const ATE = new Date(Date.now() + 86_400_000).toISOString();

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
const memR = newId();
let hospitalA: string, hospitalB: string;
let utiA: string, ccA: string, setorB: string;
let suporteDeVida: string, monitor: string, diagnostico: string;

const sistema = () => buildContext({ organizationId: ORG, actorKind: 'system', requestId: newId() });
const consultar = <T>(sql: string, p: unknown[] = []) =>
  withTenant(t.db, sistema(), (s) => s.query<T>(sql, p));
const contratar = (cliente: string, tier: string | null) =>
  consultar(`UPDATE aurora.customers SET report_tier = $2 WHERE id = $1`, [cliente, tier]);

const baixar = (rota: string, corpo: Record<string, unknown>, quem = ADMIN) =>
  http
    .post(rota)
    .set(auth(quem))
    .send(corpo)
    .buffer(true)
    .parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(t, ids, { slug: 'relf', name: 'Prestadora', email: ADMIN, userName: 'Admin' });
  await withTenant(t.db, sistema(), async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, ids.membershipId, base.roles.get('admin')!);
    hospitalA = await createCustomer(s, { name: 'Hospital A' });
    hospitalB = await createCustomer(s, { name: 'Hospital B' });
    const setor = base.locationTypes.get('setor')!;
    const unidade = base.locationTypes.get('unidade')!;
    const sedeA = await createLocation(s, { customerId: hospitalA, locationTypeId: unidade, name: 'Sede A' });
    const sedeB = await createLocation(s, { customerId: hospitalB, locationTypeId: unidade, name: 'Sede B' });
    const naSede = (customerId: string, parentId: string, name: string) =>
      createLocation(s, { customerId, parentId, locationTypeId: setor, name });
    utiA = await naSede(hospitalA, sedeA, 'UTI');
    ccA = await naSede(hospitalA, sedeA, 'Centro Cirúrgico');
    setorB = await naSede(hospitalB, sedeB, 'Pronto-Socorro');
    suporteDeVida = base.families.get('life_support')!;
    diagnostico = base.families.get('diagnosis')!;
    monitor = await createAssetCategory(s, { name: 'Monitor multiparamétrico', parentId: suporteDeVida });
    const ativo = await createAsset(s, {
      name: 'Monitor 01',
      customerId: hospitalA,
      assetCategoryId: monitor,
      locationId: utiA,
    });
    const tipo = async (k: string) =>
      (
        await s.query<{ id: string }>(
          `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = $1`,
          [k]
        )
      )[0]!.id;
    const corretiva = await tipo('corrective');
    const preventiva = await tipo('preventive');
    // Hospital A: 2 corretivas na UTI (uma no monitor), 1 preventiva no Centro Cirúrgico. B: 1 corretiva.
    await createWorkOrder(s, {
      customerId: hospitalA,
      locationId: utiA,
      workOrderTypeId: corretiva,
      title: 'Corretiva do monitor',
      assetId: ativo,
    });
    await createWorkOrder(s, {
      customerId: hospitalA,
      locationId: utiA,
      workOrderTypeId: corretiva,
      title: 'Corretiva da UTI',
    });
    await createWorkOrder(s, {
      customerId: hospitalA,
      locationId: ccA,
      workOrderTypeId: preventiva,
      title: 'Preventiva do centro',
    });
    await createWorkOrder(s, {
      customerId: hospitalB,
      locationId: setorB,
      workOrderTypeId: corretiva,
      title: 'Corretiva do hospital B',
    });
  });
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memR },
    { email: RESTRITA, userName: 'Restrita', customerIds: [hospitalA] }
  );
  await withTenant(t.db, sistema(), async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, memR, base.roles.get('manager')!);
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

const gerar = (corpo: Record<string, unknown>, quem = ADMIN) =>
  http
    .post('/v1/reports/generate')
    .set(auth(quem))
    .send({ from: DE, to: ATE, ...corpo });
const abertas = async (corpo: Record<string, unknown>, quem = ADMIN): Promise<number> => {
  const r = await gerar({ tier: 'basic', indicators: ['work_orders_opened'], ...corpo }, quem);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.sections[0].value as number;
};

describe('REL-03: os filtros do gerador', () => {
  it('as opções vêm no escopo: setores só dos clientes que a pessoa alcança; os sete tipos de manutenção; famílias', async () => {
    const tudo = await http.get('/v1/reports/options').set(auth(ADMIN));
    expect(tudo.status).toBe(200);
    expect(reportsOptions.response.safeParse(tudo.body).success).toBe(true);
    expect(tudo.body.sectors.map((x: { id: string }) => x.id).sort()).toEqual([utiA, ccA, setorB].sort());
    expect(tudo.body.work_order_types.map((x: { key: string }) => x.key)).toEqual([
      'corrective',
      'preventive',
      'technical_instruction',
      'training',
      'calibration',
      'electrical_safety',
      'qualification',
    ]);
    const cats = tudo.body.asset_categories as Array<{
      id: string;
      parent_id: string | null;
      family_key: string | null;
    }>;
    expect(cats.find((c) => c.id === suporteDeVida)?.family_key).toBe('life_support');
    expect(cats.find((c) => c.id === monitor)?.parent_id).toBe(suporteDeVida);

    const restrita = await http.get('/v1/reports/options').set(auth(RESTRITA));
    expect(restrita.body.sectors.map((x: { id: string }) => x.id).sort()).toEqual([utiA, ccA].sort());
  });

  it('tipo de manutenção: corretiva e preventiva separadas; tipo inválido → 422', async () => {
    expect(await abertas({})).toBe(4);
    expect(await abertas({ work_order_type: 'corrective' })).toBe(3);
    expect(await abertas({ work_order_type: 'preventive' })).toBe(1);
    expect(await abertas({ work_order_type: 'training' })).toBe(0);
    expect((await gerar({ tier: 'basic', work_order_type: 'livre' })).status).toBe(422);
    const r = await gerar({
      tier: 'basic',
      indicators: ['work_orders_opened'],
      work_order_type: 'preventive',
    });
    expect(reportsGenerate.response.safeParse(r.body).success).toBe(true);
    expect(r.body.filters).toMatchObject({
      work_order_type: 'preventive',
      work_order_type_label: 'Preventiva',
    });
  });

  it('com tipo de manutenção, a conformidade de outro tipo de plano fica fora do relatório', async () => {
    const r = await gerar({
      tier: 'basic',
      indicators: ['work_orders_opened', 'compliance_calibration'],
      work_order_type: 'corrective',
    });
    expect(r.body.sections.map((x: { key: string }) => x.key)).toEqual(['work_orders_opened']);
    const cal = await gerar({
      tier: 'basic',
      indicators: ['work_orders_opened', 'compliance_calibration'],
      work_order_type: 'calibration',
    });
    expect(cal.body.sections.map((x: { key: string }) => x.key)).toEqual([
      'work_orders_opened',
      'compliance_calibration',
    ]);
  });

  it('setor escolhido no gerador, sem cliente: recorta pelo setor; o setor fora do escopo é 404', async () => {
    expect(await abertas({ sector_id: utiA })).toBe(2);
    expect(await abertas({ sector_id: ccA, work_order_type: 'preventive' })).toBe(1);
    expect(await abertas({ sector_id: utiA }, RESTRITA)).toBe(2);
    expect((await gerar({ tier: 'basic', sector_id: setorB }, RESTRITA)).status).toBe(404);
  });

  it('família inclui os tipos dela; o tipo é só ele; outra família, zero', async () => {
    expect(await abertas({ asset_category_id: suporteDeVida })).toBe(1);
    expect(await abertas({ asset_category_id: monitor })).toBe(1);
    expect(await abertas({ asset_category_id: diagnostico })).toBe(0);
    const r = await gerar({
      tier: 'basic',
      indicators: ['work_orders_opened'],
      asset_category_id: suporteDeVida,
    });
    expect(r.body.filters.asset_category).toBeTruthy();
  });
});

describe('REL-13: setor sem cliente não pula a trava do pedido manual', () => {
  it('o setor da UTI é do Hospital A (Basic): Advanced → 403', async () => {
    await contratar(hospitalA, 'basic');
    try {
      const r = await gerar({ tier: 'advanced', sector_id: utiA });
      expect(r.status).toBe(403);
      expect(r.body.message).toMatch(/Hospital A inclui o relatório Basic/);
      expect((await gerar({ tier: 'basic', sector_id: utiA })).status).toBe(201);
    } finally {
      await contratar(hospitalA, null);
    }
  });
});

describe('REL-13 / AUT-05: a trava do nível contratado no relatório AGENDADO', () => {
  const criar = (params: Record<string, unknown>, nome = 'Relatório mensal') =>
    http
      .post('/v1/automations')
      .set(auth(ADMIN))
      .send({
        name: nome,
        triggerKind: 'schedule',
        triggerCron: '0 8 1 * *',
        triggerTimezone: 'America/Sao_Paulo',
        actions: [{ kind: 'send_report', params }],
      });
  const ligar = async (id: string) => {
    expect((await http.post(`/v1/automations/${id}/simulate`).set(auth(ADMIN)).send({})).status).toBe(201);
    expect((await http.post(`/v1/automations/${id}/activate`).set(auth(ADMIN)).send({})).status).toBe(201);
  };
  const saidas = (regra: string) =>
    consultar<{
      recipient_membership_id: string;
      filters: Record<string, unknown>;
      sections: Array<{ key: string; value: number }>;
    }>(
      `SELECT recipient_membership_id, filters, sections FROM aurora.automation_report_outputs WHERE rule_id = $1`,
      [regra]
    );

  it('ao CRIAR: cliente Basic não recebe Advanced (422 com a frase do contrato); Basic passa', async () => {
    await contratar(hospitalA, 'basic');
    try {
      const r = await criar({ recipients: [ids.membershipId], tier: 'advanced', customerId: hospitalA });
      expect(r.status).toBe(422);
      expect(r.body.message).toMatch(
        /O contrato de Hospital A inclui o relatório Basic; o Advanced não está contratado/
      );
      // Só o setor (sem cliente) também é o Hospital A.
      expect((await criar({ recipients: [ids.membershipId], tier: 'expert', sectorId: utiA })).status).toBe(
        422
      );
      // Destinatário restrito ao Hospital A, sem cliente na regra: a trava vale para ele.
      const restrita = await criar({ recipients: [memR], tier: 'advanced' });
      expect(restrita.status).toBe(422);
      expect(restrita.body.message).toMatch(/destinatários só alcança/);
      // A carteira inteira para quem vê a organização toda não é contrato de um cliente.
      expect(
        (await criar({ recipients: [ids.membershipId], tier: 'expert' }, 'Carteira Expert')).status
      ).toBe(201);
      expect(
        (await criar({ recipients: [memR], tier: 'basic', customerId: hospitalA }, 'Basic do Hospital A'))
          .status
      ).toBe(201);
    } finally {
      await contratar(hospitalA, null);
    }
  });

  it('na EXECUÇÃO: o contrato baixou depois — nada sai, o log diz por quê, ninguém é avisado', async () => {
    await contratar(hospitalA, 'expert');
    const r = await criar(
      { recipients: [ids.membershipId, memR], tier: 'advanced', customerId: hospitalA },
      'Advanced do Hospital A'
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await ligar(r.body.id);
    await contratar(hospitalA, 'basic');
    try {
      const run = await http.post(`/v1/automations/${r.body.id}/run-now`).set(auth(ADMIN)).send({});
      expect(run.body.outcome).toBe('failed');
      const log = await http.get(`/v1/automations/${r.body.id}/runs`).set(auth(ADMIN));
      expect(log.body.items).toHaveLength(1);
      expect(log.body.items[0].error).toMatch(/nível acima do contratado/);
      expect(log.body.items[0].error).toMatch(/Advanced não está contratado/);
      expect(await saidas(r.body.id)).toHaveLength(0);
      const avisos = await consultar(
        `SELECT 1 FROM aurora.notifications WHERE type_key = 'automation.scheduled_report' AND title LIKE '%Hospital A%'`
      );
      expect(avisos).toHaveLength(0);
    } finally {
      await contratar(hospitalA, null);
    }
  });

  it('sem cliente na regra: quem vê a carteira recebe; a restrita ao Hospital A (Basic) fica de fora, com aviso no log', async () => {
    const r = await criar(
      { recipients: [ids.membershipId, memR], tier: 'advanced', indicators: ['work_orders_opened'] },
      'Carteira'
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await ligar(r.body.id);
    await contratar(hospitalA, 'basic');
    try {
      const run = await http.post(`/v1/automations/${r.body.id}/run-now`).set(auth(ADMIN)).send({});
      expect(run.body.outcome).toBe('matched');
      expect(run.body.actions[0].detail).toMatch(
        /1 destinatário\(s\) pulado\(s\): nível acima do contratado/
      );
      const s = await saidas(r.body.id);
      expect(s.map((x) => x.recipient_membership_id)).toEqual([ids.membershipId]);
    } finally {
      await contratar(hospitalA, null);
    }
  });
});

describe('REL-15: os filtros do relatório viram a automação', () => {
  it('nível, indicadores, cliente, setor, tipo de manutenção e família: aceitos ao salvar e respeitados na execução', async () => {
    const params = {
      recipients: [ids.membershipId],
      tier: 'basic',
      indicators: ['work_orders_opened'],
      customerId: hospitalA,
      sectorId: utiA,
      workOrderType: 'corrective',
      assetCategoryId: suporteDeVida,
      periodDays: 30,
    };
    const r = await http
      .post('/v1/automations')
      .set(auth(ADMIN))
      .send({
        name: 'Do relatório',
        triggerKind: 'schedule',
        triggerCron: '0 8 * * 1',
        triggerTimezone: 'America/Sao_Paulo',
        actions: [{ kind: 'send_report', params }],
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await http.post(`/v1/automations/${r.body.id}/simulate`).set(auth(ADMIN)).send({})).status).toBe(
      201
    );
    expect((await http.post(`/v1/automations/${r.body.id}/activate`).set(auth(ADMIN)).send({})).status).toBe(
      201
    );
    // "Executar agora" mede até o minuto corrente: as OS do cenário nasceram neste minuto, então
    // recuam duas horas no fato (só a abertura) para caber no período do relatório agendado.
    await t.admin.transaction((tx) =>
      tx.query(`UPDATE aurora.fact_work_order SET opened_at = opened_at - interval '2 hours'`)
    );
    const run = await http.post(`/v1/automations/${r.body.id}/run-now`).set(auth(ADMIN)).send({});
    expect(run.body.outcome).toBe('matched');
    const [saida] = await consultar<{
      filters: Record<string, unknown>;
      sections: Array<{ key: string; value: number; formula_version: string }>;
    }>(`SELECT filters, sections FROM aurora.automation_report_outputs WHERE rule_id = $1`, [r.body.id]);
    // Só a corretiva da UTI do Hospital A no monitor (família suporte à vida).
    expect(saida!.sections[0]).toMatchObject({ key: 'work_orders_opened', value: 1, formula_version: 'v1' });
    expect(saida!.filters).toMatchObject({
      customer: 'Hospital A',
      sector: 'UTI',
      work_order_type: 'corrective',
    });

    const ruim = await http
      .post('/v1/automations')
      .set(auth(ADMIN))
      .send({
        name: 'x',
        triggerKind: 'schedule',
        triggerCron: '0 8 * * 1',
        actions: [{ kind: 'send_report', params: { ...params, workOrderType: 'livre' } }],
      });
    expect(ruim.status).toBe(422);
  });
});

describe('REL-07: versão das fórmulas', () => {
  it('o catálogo versiona o que existe e NÃO versiona o pendente', async () => {
    const r = await http.get('/v1/reports/catalog').set(auth(ADMIN));
    expect(reportsCatalog.response.safeParse(r.body).success).toBe(true);
    const por = (k: string) => r.body.indicators.find((i: { key: string }) => i.key === k);
    expect(por('work_orders_opened')).toMatchObject({
      formula_version: 'v1',
      formula_defined_on: '2026-10-17',
    });
    expect(por('mttr')).toMatchObject({ formula_version: 'v1-provisoria' });
    expect(por('work_order_rating')).toMatchObject({
      formula_version: 'v1',
      formula_defined_on: '2026-10-21',
    });
    expect(por('obsolescence')).toMatchObject({ formula_version: 'pendente', formula_defined_on: null });
    expect(findIndicator('obsolescence')!.source).toBeNull();
  });

  it('a seção do JSON, o rodapé do PDF e a aba do Excel trazem a versão', async () => {
    const j = await gerar({ tier: 'basic', indicators: ['work_orders_opened', 'mttr'] });
    expect(j.body.sections.map((s: { formula_version: string }) => s.formula_version)).toEqual([
      'v1',
      'v1-provisoria',
    ]);
    expect(j.body.pending.every((p: { formula_version: string }) => p.formula_version === 'pendente')).toBe(
      true
    );

    const pdf = await baixar('/v1/reports/generate?format=pdf', { from: DE, to: ATE, tier: 'basic' });
    const corpo = (pdf.body as Buffer).toString('latin1');
    expect(corpo).toContain('(Vers\\343o das f\\363rmulas)');

    const x = await baixar('/v1/reports/generate?format=xlsx', { from: DE, to: ATE, tier: 'basic' });
    const ind = celulas(abaPorNome(lerZip(x.body as Buffer), 'Indicadores'));
    const titulos = [...ind.entries()].filter(([ref]) => /^[A-Z]+1$/.test(ref)).map(([, c]) => c.valor);
    expect(titulos).toEqual(
      expect.arrayContaining(['Versão da fórmula', 'Definição em', 'Fonte da definição'])
    );
    expect([...ind.values()].some((c) => c.valor === 'pendente')).toBe(true);
  });
});

describe('marca: o nome técnico "Aurora" não chega ao cliente', () => {
  it('PDF e Excel do Basic, Advanced, Expert e Patrimonial', async () => {
    const corpos: Array<[string, string]> = [];
    for (const tier of ['basic', 'advanced', 'expert']) {
      for (const formato of ['pdf', 'xlsx']) {
        const r = await baixar(`/v1/reports/generate?format=${formato}`, { from: DE, to: ATE, tier });
        expect(r.status, `${tier} ${formato}`).toBe(200);
        corpos.push([`${tier}.${formato}`, conteudo(r.body as Buffer, formato)]);
      }
    }
    for (const formato of ['pdf', 'xlsx']) {
      const r = await baixar(`/v1/reports/assets?format=${formato}`, {});
      expect(r.status, `patrimonial ${formato}`).toBe(200);
      corpos.push([`patrimonial.${formato}`, conteudo(r.body as Buffer, formato)]);
    }
    for (const [nome, texto] of corpos) expect(texto, nome).not.toMatch(/aurora/i);
    const basic = corpos.find(([n]) => n === 'basic.pdf')![1];
    expect(basic).toContain('T\\351chne Care');
  });
});

/** O texto pesquisável: o PDF é texto puro; a planilha, o XML de cada parte do zip. */
function conteudo(buf: Buffer, formato: string): string {
  if (formato === 'pdf') return buf.toString('latin1');
  return [...lerZip(buf).values()].map((b) => b.toString('utf8')).join('\n');
}
