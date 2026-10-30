/**
 * Aurora — relatório PATRIMONIAL pela HTTP (REL-11, WhatsApp 19/10/2026).
 *
 *   · permissão: sem `insight.read` → 403; o valor do bem só com `asset.read_financials` (a regra
 *     da ficha), inclusive no PDF e no Excel;
 *   · escopo: quem só vê o Hospital A conta só A, e pedir B é 404;
 *   · filtro de situação (ativos, em manutenção, obsoletos) e as três saídas (JSON, PDF, Excel).
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
  createAsset,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { reportsAssets } from '@aurora/contracts';
import { createApp } from '../bootstrap';
import { abaPorNome, celulas, lerZip } from './apoio/ler-xlsx';

const ORG = newId();
const GESTORA = 'gestora@pat.test'; // manager: tem asset.read_financials
const COORD = 'coord@pat.test'; // coordinator: vê ativos e indicadores, sem financeiro
const RESTRITA = 'restrita@pat.test'; // manager só do Hospital A
const SOLICITANTE = 'sol@pat.test'; // requester: sem insight.read
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospitalA: string, hospitalB: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, { slug: 'pat', name: 'Prestadora', email: GESTORA, userName: 'Gestora' });
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
        name: 'Sede A',
      });
      const cat = base.families.get('support')!;
      await createAsset(s, {
        name: 'Monitor 01',
        customerId: hospitalA,
        assetCategoryId: cat,
        locationId: sedeA,
        acquiredAt: '2024-01-01',
        usefulLifeYears: 10,
        purchaseValue: 12_345.67,
        acquisitionInvoice: 'NF 1001',
      });
      await createAsset(s, {
        name: 'Bomba 01',
        customerId: hospitalA,
        assetCategoryId: cat,
        locationId: sedeA,
        status: 'under_maintenance',
        purchaseValue: 5_000,
      });
      await createAsset(s, {
        name: 'Monitor B',
        customerId: hospitalB,
        assetCategoryId: cat,
        purchaseValue: 7_000,
      });
    }
  );
  const membros: [string, string, string, string[] | undefined][] = [
    [COORD, 'Coord', 'coordinator', undefined],
    [RESTRITA, 'Restrita', 'manager', [hospitalA]],
    [SOLICITANTE, 'Sol', 'requester', [hospitalA]],
  ];
  const vinculos: [string, string][] = [];
  for (const [email, nome, papel, clientes] of membros) {
    const mem = newId();
    await seedMember(
      t,
      { organizationId: ORG, userId: newId(), membershipId: mem },
      {
        email,
        userName: nome,
        ...(clientes ? { customerIds: clientes } : {}),
        ...(papel === 'requester' ? { seatType: 'portal' as const } : {}),
      }
    );
    vinculos.push([mem, papel]);
  }
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      for (const [mem, papel] of vinculos) await assignRole(s, mem, base.roles.get(papel)!);
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

const gerar = (quem: string, body: Record<string, unknown> = {}, formato?: 'pdf' | 'xlsx') => {
  const r = http
    .post(`/v1/reports/assets${formato ? `?format=${formato}` : ''}`)
    .set(auth(quem))
    .send(body);
  return formato
    ? r.buffer(true).parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      })
    : r;
};

describe('JSON', () => {
  it('todos os bens do escopo, com contagem por situação e totais (quem tem permissão financeira)', async () => {
    const r = await gerar(GESTORA);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(reportsAssets.response.safeParse(r.body).success).toBe(true);
    expect(r.body.counts).toEqual({ active: 2, maintenance: 1, obsolete: 0, total: 3 });
    expect(r.body.financials_visible).toBe(true);
    expect(r.body.totals[0]).toMatchObject({
      currency: 'BRL',
      purchase_value: 24_345.67,
      assets_with_value: 3,
    });
    const monitor = r.body.items.find((a: { name: string }) => a.name === 'Monitor 01');
    expect(monitor).toMatchObject({ purchase_value: 12_345.67, acquisition_invoice: 'NF 1001' });
    expect(monitor.book_value).toBeLessThan(12_345.67);
  });

  it('filtro de situação: em manutenção', async () => {
    const r = await gerar(GESTORA, { situation: 'maintenance' });
    expect(r.body.items.map((a: { name: string }) => a.name)).toEqual(['Bomba 01']);
    expect(r.body.filters.situation).toBe('maintenance');
    expect((await gerar(GESTORA, { situation: 'quebrados' })).status).toBe(422);
  });

  it('sem asset.read_financials: nenhum valor, nenhum total; o resto do relatório continua', async () => {
    const r = await gerar(COORD);
    expect(r.status).toBe(201);
    expect(r.body.financials_visible).toBe(false);
    expect(r.body.totals).toEqual([]);
    expect(JSON.stringify(r.body)).not.toContain('12345.67');
    expect(JSON.stringify(r.body)).not.toContain('NF 1001');
    expect(r.body.counts.total).toBe(3);
  });

  it('escopo: o vínculo do Hospital A só vê A; pedir B é 404', async () => {
    const r = await gerar(RESTRITA);
    expect(r.body.counts.total).toBe(2);
    expect(r.body.items.every((a: { customer_name: string }) => a.customer_name === 'Hospital A')).toBe(true);
    expect((await gerar(RESTRITA, { customer_id: hospitalB })).status).toBe(404);
    const soB = await gerar(GESTORA, { customer_id: hospitalB });
    expect(soB.body.items.map((a: { name: string }) => a.name)).toEqual(['Monitor B']);
  });

  it('sem insight.read → 403', async () => {
    expect((await gerar(SOLICITANTE)).status).toBe(403);
    expect((await gerar(SOLICITANTE, {}, 'xlsx')).status).toBe(403);
  });
});

describe('PDF e Excel', () => {
  it('PDF com o painel e a tabela; valor em R$ só com a permissão financeira', async () => {
    const r = await gerar(GESTORA, {}, 'pdf');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/pdf/);
    expect(r.headers['content-disposition']).toContain('relatorio-patrimonial.pdf');
    const corpo = (r.body as Buffer).toString('latin1');
    expect(corpo).toContain('(Relat\\363rio Patrimonial)');
    expect(corpo).toContain('Monitor 01');
    // Na célula da tabela, o espaço do "R$ " vira espaço comum; no cartão, fica o \240 (WinAnsi).
    expect(corpo).toMatch(/R\$(\\240| )12\.345,67/);
    const sem = ((await gerar(COORD, {}, 'pdf')).body as Buffer).toString('latin1');
    expect(sem).toContain('Monitor 01');
    expect(sem).not.toMatch(/12\.345,67/);
    expect(sem).toContain('Exige a permiss\\343o financeira');
  });

  it('Excel: valor como número com formato de moeda, data como data; escopo respeitado', async () => {
    const r = await gerar(GESTORA, { situation: 'active' }, 'xlsx');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(r.headers['content-disposition']).toBe('attachment; filename="relatorio-patrimonial.xlsx"');
    const arquivos = lerZip(r.body as Buffer);
    const pat = celulas(abaPorNome(arquivos, 'Patrimônio'));
    const linhaMonitor = [...pat.entries()].find(([, c]) => c.valor === 'Monitor 01')![0].replace(/^A/, '');
    expect(pat.get(`L${linhaMonitor}`)).toMatchObject({ tipo: 'n', estilo: 2 }); // data de aquisição
    expect(pat.get(`T${linhaMonitor}`)).toMatchObject({ tipo: 'n', valor: '12345.67', estilo: 6 }); // valor
    const filtros = celulas(abaPorNome(arquivos, 'Filtros'));
    expect(filtros.get('B4')!.valor).toBe('Ativos');

    const restrita = lerZip((await gerar(RESTRITA, {}, 'xlsx')).body as Buffer);
    const nomes = [...celulas(abaPorNome(restrita, 'Patrimônio')).entries()]
      .filter(([ref]) => /^A\d+$/.test(ref) && ref !== 'A1')
      .map(([, c]) => c.valor);
    expect(nomes.sort()).toEqual(['Bomba 01', 'Monitor 01']);

    const sem = lerZip((await gerar(COORD, {}, 'xlsx')).body as Buffer);
    const xml = abaPorNome(sem, 'Patrimônio');
    expect(xml).not.toContain('12345.67');
    expect(xml).not.toContain('Valor de aquisição');
  });
});
