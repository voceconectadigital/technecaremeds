/**
 * Aurora — relatórios BASIC / ADVANCED / EXPERT: fundação (reunião 16/10/2026, Fase 9).
 *
 *   · o catálogo diz a situação de cada indicador; nenhum layout "aguardando modelo" (29/10/2026);
 *   · os números do relatório são os MESMOS do Painel (mesma função, mesmo filtro);
 *   · indicador sem fórmula/definição sai sem valor, com a situação — nunca inventado;
 *   · PDF Basic no padrão do Advanced (REL-08); Excel com a mesma permissão e o mesmo escopo
 *     (REL-10); escopo e tenant respeitados.
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
  createWorkOrder,
  createAsset,
  provisionOrganizationBaseline,
  buildReport,
  buildReportSeries,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { reportsCatalog, reportsGenerate } from '@aurora/contracts';
import { createApp } from '../bootstrap';
import { abaPorNome, celulas, lerZip } from './apoio/ler-xlsx';

const ORG = newId();
const ORG_B = newId();
const GESTORA = 'gestora@rel.test';
const RESTRITA = 'restrita@rel.test';
const SOLICITANTE = 'sol@rel.test';
const ADMIN_B = 'admin@rel-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const DE = new Date(Date.now() - 30 * 86_400_000).toISOString();
const ATE = new Date(Date.now() + 86_400_000).toISOString();

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospitalA: string, hospitalB: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, { slug: 'rel', name: 'Prestadora', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'rel-b', name: 'B', email: ADMIN_B, userName: 'B' });
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, ids.membershipId, base.roles.get('manager')!);
      hospitalA = await createCustomer(s, { name: 'Hospital A' });
      hospitalB = await createCustomer(s, { name: 'Hospital B' });
      const sedeA = await createLocation(s, {
        customerId: hospitalA,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'A',
      });
      const sedeB = await createLocation(s, {
        customerId: hospitalB,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'B',
      });
      const [corretiva] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
      );
      for (let i = 0; i < 3; i++) {
        await createWorkOrder(s, {
          customerId: hospitalA,
          locationId: sedeA,
          workOrderTypeId: corretiva!.id,
          title: `OS A${i}`,
        });
      }
      await createWorkOrder(s, {
        customerId: hospitalB,
        locationId: sedeB,
        workOrderTypeId: corretiva!.id,
        title: 'OS B',
      });
    }
  );
  const memR = newId();
  const memS = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memR },
    {
      email: RESTRITA,
      userName: 'Restrita',
      customerIds: [hospitalA],
    }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memS },
    {
      email: SOLICITANTE,
      userName: 'Sol',
      seatType: 'portal',
      customerIds: [hospitalA],
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memR, base.roles.get('manager')!);
      await assignRole(s, memS, base.roles.get('requester')!);
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

const gerar = (quem: string, body: Record<string, unknown>, pdf = false) =>
  http
    .post(`/v1/reports/generate${pdf ? '?format=pdf' : ''}`)
    .set(auth(quem))
    .send({ from: DE, to: ATE, ...body });

describe('catálogo', () => {
  it('três modelos; layouts definidos; cada indicador com código, unidade, situação e sentido', async () => {
    const r = await http.get('/v1/reports/catalog').set(auth(GESTORA));
    expect(r.status).toBe(200);
    expect(reportsCatalog.response.safeParse(r.body).success).toBe(true);
    expect(r.body.tiers.map((x: { label: string }) => x.label)).toEqual(['Basic', 'Advanced', 'Expert']);
    expect(r.body.layout_status).toBe('layouts_defined');
    expect(JSON.stringify(r.body)).not.toContain('AGUARDANDO MODELO');
    // REL-16: a nota que aparece na tela de escolha não cita o órgão.
    expect(JSON.stringify(r.body)).not.toContain('FHEMIG');
    const tmpa = r.body.indicators.find((i: { key: string }) => i.key === 'first_response_time');
    expect(tmpa.state).toBe('PENDING_DEFINITION');
    expect(tmpa.tiers).toEqual(['expert']);
    expect(tmpa.target_direction).toBe('LOWER_IS_BETTER');
    expect(tmpa.note).toMatch(/P-03/);
    const rating = r.body.indicators.find((i: { key: string }) => i.key === 'service_rating');
    expect(rating).toMatchObject({ state: 'ACTIVE', unit: 'score', tiers: ['basic', 'advanced', 'expert'] });
  });
});

describe('geração com dados reais', () => {
  it('BASIC sem seleção: só ACTIVE; chamados abertos = o número do Painel, com o mesmo filtro', async () => {
    const r = await gerar(GESTORA, { tier: 'basic' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(reportsGenerate.response.safeParse(r.body).success).toBe(true);
    const abertos = r.body.sections.find((x: { key: string }) => x.key === 'work_orders_opened');
    const painel = await http.get(`/v1/insights/control-panel?from=${DE}&to=${ATE}`).set(auth(GESTORA));
    expect(abertos.value).toBe(painel.body.kpis.opened.data.count);
    expect(abertos.value).toBe(4);
    const chaves = r.body.sections.map((x: { key: string }) => x.key);
    expect(chaves).not.toContain('sla_compliance'); // é do Advanced
    expect(chaves).not.toContain('mttr'); // PROVISIONAL: só se pedido
    r.body.sections.forEach((x: { state: string }) => expect(x.state).toBe('ACTIVE'));
  });

  it('BASIC: PENDING_DEFINITION nunca entra; fica listado em "pending", sem número', async () => {
    const r = await gerar(GESTORA, { tier: 'basic' });
    const pend = r.body.pending.map((x: { key: string }) => x.key);
    expect(pend).toEqual(expect.arrayContaining(['requests_fulfilled_ratio', 'training_ratio']));
    const chaves = r.body.sections.map((x: { key: string }) => x.key);
    expect(chaves).not.toContain('requests_fulfilled_ratio');
    expect(chaves).not.toContain('training_ratio');
    const pedido = await gerar(GESTORA, { tier: 'basic', indicators: ['training_ratio'] });
    expect(pedido.status).toBe(422);
    expect(pedido.body.message).toMatch(/aguardando definição/);
  });

  it('PROVISIONAL só com pedido explícito, e sai marcado', async () => {
    const r = await gerar(GESTORA, { tier: 'basic', indicators: ['mttr', 'compliance_preventive'] });
    expect(r.status).toBe(201);
    r.body.sections.forEach((x: { state: string }) => expect(x.state).toBe('PROVISIONAL'));
    const mttr = r.body.sections.find((x: { key: string }) => x.key === 'mttr');
    expect(mttr.unit).toBe('minutes');
    expect(mttr.note).toMatch(/P-01/);
  });

  it('ADVANCED herda o Basic seguro e acrescenta SLA, evolução, backlog, OS por situação e AxF', async () => {
    const r = await gerar(GESTORA, { tier: 'advanced' });
    const chaves = r.body.sections.map((x: { key: string }) => x.key);
    for (const k of [
      'work_orders_opened',
      'service_rating',
      'sla_compliance',
      'work_order_evolution',
      'backlog',
      'work_orders_by_status',
      'opened_vs_closed',
    ]) {
      expect(chaves, k).toContain(k);
    }
    expect(chaves).not.toContain('obsolescence');
    expect(r.body.pending.map((x: { key: string }) => x.key)).toContain('obsolescence');
  });

  it('AxF: numerador e denominador expostos; é o mesmo número do Painel (4 abertas, 0 encerradas)', async () => {
    const r = await gerar(GESTORA, { tier: 'advanced', indicators: ['opened_vs_closed'] });
    const axf = r.body.sections[0];
    expect(axf.key).toBe('opened_vs_closed');
    expect(axf.detail).toMatchObject({ numerator: 0, denominator: 4, opened: 4, closed: 0 });
    expect(axf.value).toBe(0);
    expect(axf.unit).toBe('percent');
  });

  it('disponibilidade do parque: a mesma base do Painel (baixados e descartados fora)', async () => {
    // Antes: o PDF dividia pelo total cadastrado e o Painel não — 2 em operação,
    // 1 em manutenção e 1 descomissionado davam 66,7 % numa tela e 50 % no PDF.
    await withTenant(
      t.db,
      buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'parque' }),
      async (s) => {
        const base = await provisionOrganizationBaseline(s);
        const categoria = base.families.get('support')!;
        for (const [name, status] of [
          ['Monitor 1', 'active'],
          ['Monitor 2', 'active'],
          ['Monitor 3', 'under_maintenance'],
        ] as const) {
          await createAsset(s, { name, customerId: hospitalA, assetCategoryId: categoria, status });
        }
        // Descomissionado: status e data andam juntos (0014).
        const baixado = await createAsset(s, {
          name: 'Monitor 4',
          customerId: hospitalA,
          assetCategoryId: categoria,
        });
        await s.query(
          `UPDATE aurora.assets SET status = 'decommissioned', decommissioned_at = now(),
                                  decommission_reason = 'fim da vida útil' WHERE id = $1`,
          [baixado]
        );
      }
    );
    const r = await gerar(GESTORA, { tier: 'basic', indicators: ['park_availability_snapshot'] });
    expect(r.status).toBe(201);
    const sec = r.body.sections.find((x: { key: string }) => x.key === 'park_availability_snapshot');
    expect(sec.state).toBe('PROVISIONAL');
    expect(sec.value).toBe(66.7);
    expect(sec.samples).toBe(3);
  });

  it('o setor de outro cliente (ou fora do escopo) é recusado', async () => {
    const [setorB] = await t.raw(
      `SELECT id FROM aurora.locations WHERE customer_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [hospitalB]
    );
    const misturado = await gerar(GESTORA, {
      tier: 'basic',
      indicators: ['work_orders_opened'],
      customer_id: hospitalA,
      sector_id: setorB!.id,
    });
    expect(misturado.status).toBe(422);
    const foraDoEscopo = await gerar(RESTRITA, {
      tier: 'basic',
      indicators: ['work_orders_opened'],
      sector_id: setorB!.id,
    });
    expect(foraDoEscopo.status).toBe(404);
  });

  it('avaliação da qualidade: sem avaliação, média nula e distribuição zerada', async () => {
    const r = await gerar(GESTORA, { tier: 'basic', indicators: ['service_rating'] });
    const sec = r.body.sections[0];
    expect(sec.value).toBeNull();
    expect(sec.samples).toBe(0);
    expect(sec.unit).toBe('score');
    expect(sec.detail.distribution).toEqual({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
  });

  it('EXPERT não herda o Basic: só o conjunto do IMR; os bloqueados saem do relatório', async () => {
    const r = await gerar(GESTORA, { tier: 'expert' });
    expect(r.status).toBe(201);
    const chaves = r.body.sections.map((x: { key: string }) => x.key);
    expect(chaves).toEqual(['service_rating']); // único ACTIVE do IMR; ACM é PROVISIONAL
    for (const k of ['mttr', 'mtbf', 'work_orders_opened', 'sla_compliance']) expect(chaves).not.toContain(k);
    const pend = r.body.pending.map((x: { key: string }) => x.key);
    expect(pend).toEqual(
      expect.arrayContaining([
        'first_response_time',
        'availability_global',
        'tmrg_internal',
        'critical_resolution_global',
        'quality_activities_on_time',
        'attendance',
        'imr_penalty',
        'requests_fulfilled_ratio',
        'training_ratio',
      ])
    );
    const glosa = await gerar(GESTORA, { tier: 'expert', indicators: ['imr_penalty'] });
    expect(glosa.status).toBe(422);
    const acm = await gerar(GESTORA, { tier: 'expert', indicators: ['compliance_preventive'] });
    expect(acm.status).toBe(201);
    expect(acm.body.sections[0].state).toBe('PROVISIONAL');
  });

  it('seleção de indicadores (na ordem do catálogo); indicador de outro modelo → 422', async () => {
    const ok = await gerar(GESTORA, { tier: 'basic', indicators: ['mttr', 'work_orders_completed'] });
    expect(ok.body.sections.map((x: { key: string }) => x.key)).toEqual(['work_orders_completed', 'mttr']);
    const fora = await gerar(GESTORA, { tier: 'basic', indicators: ['sla_compliance'] });
    expect(fora.status).toBe(422);
    const ghost = await gerar(GESTORA, { tier: 'advanced', indicators: ['nao_existe'] });
    expect(ghost.status).toBe(422);
  });

  it('todo indicador reportável de cada modelo tem cálculo ligado (catálogo ↔ relatório)', async () => {
    const cat = await http.get('/v1/reports/catalog').set(auth(GESTORA));
    for (const tier of ['basic', 'advanced', 'expert'] as const) {
      const chaves = cat.body.indicators
        .filter(
          (i: { tiers: string[]; state: string }) =>
            i.tiers.includes(tier) && i.state !== 'PENDING_DEFINITION'
        )
        .map((i: { key: string }) => i.key);
      const r = await gerar(GESTORA, { tier, indicators: chaves });
      expect(r.status, `${tier}: ${JSON.stringify(r.body)}`).toBe(201);
      expect(r.body.sections.map((x: { key: string }) => x.key)).toEqual(chaves);
    }
  });

  it('filtro de cliente; quem só vê o Hospital A conta só A; B fora do escopo → 404', async () => {
    const soA = await gerar(GESTORA, {
      tier: 'basic',
      indicators: ['work_orders_opened'],
      customer_id: hospitalA,
    });
    expect(soA.body.sections[0].value).toBe(3);
    const restrita = await gerar(RESTRITA, { tier: 'basic', indicators: ['work_orders_opened'] });
    expect(restrita.body.sections[0].value).toBe(3);
    const fora = await gerar(RESTRITA, { tier: 'basic', customer_id: hospitalB });
    expect(fora.status).toBe(404);
  });

  it('PDF Basic no padrão do Advanced (painel, sem faixa); solicitante sem indicador → 403; outra organização: zero', async () => {
    const pdf = await gerar(GESTORA, { tier: 'basic' }, true)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    const corpo = (pdf.body as Buffer).toString('latin1');
    expect(corpo.startsWith('%PDF')).toBe(true);
    expect(corpo).not.toContain('AGUARDANDO MODELO PDF OFICIAL');
    expect(corpo).not.toContain('provis\\363rio)'); // o rodapé antigo dizia "Relatório Basic — provisório"
    expect(corpo).toContain('(Relat\\363rio Basic)');
    expect(corpo).toContain('(Resumo do per\\355odo)');
    // Os pendentes do Basic aparecem listados, como texto, sem número.
    expect(corpo).toContain('Pendente de defini\\347\\343o');
    expect(pdf.headers['content-disposition']).toContain('relatorio-basic.pdf');
    expect((await gerar(SOLICITANTE, { tier: 'basic' })).status).toBe(403);
    const b = await gerar(ADMIN_B, { tier: 'basic', indicators: ['work_orders_opened'] });
    expect(b.body.sections[0].value).toBe(0);
  });

  const baixarPdf = (body: Record<string, unknown>) =>
    gerar(GESTORA, body, true)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
  const SETEMBRO = { from: '2026-09-01T03:00:00.000Z', to: '2026-10-01T02:59:59.999Z' };

  it('Advanced em PDF segue o modelo Completo: cabeçalho, competência, texto e assinaturas; sem a faixa de provisório', async () => {
    const pdf = await baixarPdf({
      tier: 'advanced',
      indicators: ['service_rating', 'opened_vs_closed'],
      ...SETEMBRO,
      customer_id: hospitalA,
      cost_center: 'HCSL020',
      city: 'Pouso Alegre',
      signatories: [{ name: 'Natália Santos', role: 'Engenheira Clínica' }],
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-disposition']).toContain('relatorio-advanced.pdf');
    // Os acentos vão para o PDF como escape octal (WinAnsi): \352 = ê, \341 = á.
    const corpo = (pdf.body as Buffer).toString('latin1');
    expect(corpo.startsWith('%PDF')).toBe(true);
    expect(corpo).toContain('A/C Srs. Diretores');
    expect(corpo).toContain('Hospital A');
    expect(corpo).toContain('Centro de Custo: HCSL020');
    expect(corpo).toContain('Compet\\352ncia: SETEMBRO / 2026');
    expect(corpo).toContain('Pouso Alegre, ');
    expect(corpo).toContain('Nat\\341lia Santos');
    expect(corpo).not.toContain('AGUARDANDO MODELO PDF OFICIAL');
  });

  it('Advanced em PDF: o escopo restrito continua valendo, e cabeçalho fora do contrato é 422', async () => {
    const fora = await gerar(RESTRITA, { tier: 'advanced', customer_id: hospitalB, ...SETEMBRO }, true);
    expect(fora.status).toBe(404);
    const invalido = await gerar(
      GESTORA,
      { tier: 'advanced', ...SETEMBRO, signatories: [{ name: 'x' }] },
      true
    );
    expect(invalido.status).toBe(422);
  });

  it('Expert em PDF é a casca do IMR: 16 itens, sem desconto nem glosa inventados', async () => {
    const pdf = await baixarPdf({ tier: 'expert', ...SETEMBRO, indicators: ['service_rating'] });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-disposition']).toContain('relatorio-expert.pdf');
    const corpo = (pdf.body as Buffer).toString('latin1');
    expect(corpo).toContain('INSTRUMENTO DE MEDI');
    expect(corpo).toContain('DESCONTO E GLOSA N');
    // A célula quebra "Aguardando / definição" em duas linhas: cada uma é um texto no PDF.
    expect(corpo).toContain('(defini\\347\\343o)');
    expect(corpo).toContain('Valor total do desconto a ser aplicado: n');
    expect(corpo).not.toMatch(/R\$ ?\d/);
  });

  it('série mensal: 12 meses terminando no mês do fim; a situação de agora não ganha série', async () => {
    const ctx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' });
    const r = await withTenant(t.db, ctx, (s) =>
      buildReportSeries(s, null, { tier: 'advanced', from: DE, to: ATE }, [
        'work_orders_opened',
        'park_availability_snapshot',
      ])
    );
    expect(r.months).toHaveLength(12);
    expect(r.series.work_orders_opened).toHaveLength(12);
    expect(r.series.work_orders_opened!.map((p) => p.month)).toEqual(r.months);
    expect(r.unavailable.park_availability_snapshot).toMatch(/situação do parque agora/);
    expect(r.series.park_availability_snapshot).toBeUndefined();
    const total = r.series.work_orders_opened!.reduce((a, p) => a + (p.value ?? 0), 0);
    const janela = await withTenant(t.db, ctx, (s) =>
      buildReport(s, null, { tier: 'advanced', from: DE, to: ATE, indicators: ['work_orders_opened'] })
    );
    expect(total).toBeGreaterThanOrEqual(janela.sections[0]!.value ?? 0);
  });
});

describe('Excel (REL-10)', () => {
  const baixarXlsx = (quem: string, body: Record<string, unknown>) =>
    http
      .post('/v1/reports/generate?format=xlsx')
      .set(auth(quem))
      .send({ from: DE, to: ATE, ...body })
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });

  it('planilha com Indicadores, Série mensal e Filtros; o número é o mesmo do JSON, tipado', async () => {
    const r = await baixarXlsx(GESTORA, { tier: 'basic', indicators: ['work_orders_opened'] });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(r.headers['content-disposition']).toBe('attachment; filename="relatorio-basic.xlsx"');
    const arquivos = lerZip(r.body as Buffer);
    for (const k of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
      expect(arquivos.has(k), k).toBe(true);
    }
    const ind = celulas(abaPorNome(arquivos, 'Indicadores'));
    expect(ind.get('A2')!.valor).toBe('work_orders_opened');
    expect(ind.get('D2')).toMatchObject({ tipo: 'n', valor: '4' }); // as 4 OS abertas do cenário
    // Os pendentes do Basic saem como TEXTO "Pendente de definição", nunca como número.
    const pendentes = [...ind.entries()].filter(
      ([ref, c]) => ref.startsWith('D') && c.valor === 'Pendente de definição'
    );
    expect(pendentes.length).toBeGreaterThanOrEqual(2);
    const serie = celulas(abaPorNome(arquivos, 'Série mensal'));
    expect(serie.get('A13')).toMatchObject({ tipo: 'n', estilo: 2 }); // 12 meses, data com estilo de data
    const filtros = celulas(abaPorNome(arquivos, 'Filtros'));
    expect(filtros.get('B2')).toMatchObject({ valor: 'Basic' });
    expect(filtros.get('B5')).toMatchObject({ valor: 'Todos os clientes do escopo' });
  });

  it('mesma permissão e mesmo escopo do JSON: 403 sem indicador, 404 fora do escopo, só o Hospital A', async () => {
    expect((await baixarXlsx(SOLICITANTE, { tier: 'basic' })).status).toBe(403);
    expect((await baixarXlsx(RESTRITA, { tier: 'basic', customer_id: hospitalB })).status).toBe(404);
    const restrita = await baixarXlsx(RESTRITA, { tier: 'advanced', indicators: ['work_orders_opened'] });
    expect(restrita.status).toBe(200);
    const ind = celulas(abaPorNome(lerZip(restrita.body as Buffer), 'Indicadores'));
    expect(ind.get('D2')).toMatchObject({ tipo: 'n', valor: '3' }); // só as 3 do Hospital A
    const outra = await baixarXlsx(ADMIN_B, { tier: 'basic', indicators: ['work_orders_opened'] });
    expect(celulas(abaPorNome(lerZip(outra.body as Buffer), 'Indicadores')).get('D2')!.valor).toBe('0');
  });

  it('Expert em Excel: sem série; formato desconhecido é 422', async () => {
    const r = await baixarXlsx(GESTORA, { tier: 'expert' });
    expect(r.status).toBe(200);
    const arquivos = lerZip(r.body as Buffer);
    expect(arquivos.get('xl/workbook.xml')!.toString('utf8')).not.toContain('Série mensal');
    const ind = celulas(abaPorNome(arquivos, 'Indicadores'));
    expect([...ind.values()].some((c) => c.valor === 'imr_penalty')).toBe(true);
    const ruim = await http
      .post('/v1/reports/generate?format=docx')
      .set(auth(GESTORA))
      .send({ from: DE, to: ATE, tier: 'basic' });
    expect(ruim.status).toBe(422);
  });
});

describe('nível de relatório contratado pelo cliente (REL-13)', () => {
  const gerar = (email: string, corpo: Record<string, unknown>) =>
    http
      .post('/v1/reports/generate')
      .set(auth(email))
      .send({ from: DE, to: ATE, ...corpo });
  const contratar = (tier: string | null) =>
    withTenant(t.db, buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'tier' }), (s) =>
      s.query(`UPDATE aurora.customers SET report_tier = $2 WHERE id = $1`, [hospitalA, tier])
    );

  it('o Hospital A com contrato Basic não sai em Advanced nem Expert — no JSON, no PDF e no Excel', async () => {
    await contratar('basic');
    try {
      const adv = await gerar(GESTORA, { tier: 'advanced', customer_id: hospitalA });
      expect(adv.status).toBe(403);
      expect(adv.body.message).toMatch(/Hospital A inclui o relatório Basic/);
      expect(adv.body.details).toMatchObject({ contracted_tier: 'basic', requested_tier: 'advanced' });
      for (const formato of ['pdf', 'xlsx']) {
        const r = await http
          .post(`/v1/reports/generate?format=${formato}`)
          .set(auth(GESTORA))
          .send({ from: DE, to: ATE, tier: 'expert', customer_id: hospitalA });
        expect(r.status, formato).toBe(403);
      }
      expect((await gerar(GESTORA, { tier: 'basic', customer_id: hospitalA })).status).toBe(201);
      // A carteira inteira (sem cliente, escopo de toda a organização) não é contrato de um cliente.
      expect((await gerar(GESTORA, { tier: 'expert' })).status).toBe(201);
    } finally {
      await contratar(null);
    }
  });

  it('quem só alcança o Hospital A não pula a trava deixando o cliente em branco; fora do escopo segue 404', async () => {
    await contratar('advanced');
    try {
      expect((await gerar(RESTRITA, { tier: 'expert' })).status).toBe(403);
      expect((await gerar(RESTRITA, { tier: 'advanced' })).status).toBe(201);
      // O Hospital B não está no escopo da Restrita: a trava não revela nada sobre ele.
      const fora = await gerar(RESTRITA, { tier: 'basic', customer_id: hospitalB });
      expect(fora.status).toBe(404);
    } finally {
      await contratar(null);
    }
  });
});
