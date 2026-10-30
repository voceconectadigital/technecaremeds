/**
 * Relatório patrimonial (REL-11, WhatsApp 19/10/2026: "opção de ativos, em manutenção e
 * obsoletos").
 *
 * O que se prova: as três situações saem da situação CADASTRADA (e o obsoleto traz o laudo OBC
 * quando a baixa veio dele); valor e depreciação são os da ficha (a mesma função de linha reta);
 * sem a permissão financeira, nenhum valor é lido nem somado; o escopo do vínculo vale, e cliente
 * fora dele é 404.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS, straightLineDepreciation } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createAssetCategory, createAsset } from '../assets';
import { provisionFactoryRoles } from '../rbac';
import { provisionWorkOrderStates } from '../work-orders';
import { createObsolescenceReport } from '../obsolescencia';
import { buildAssetReport } from '../relatorio-patrimonial';
import { createTestDatabase, seedMember, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId(),
  MEM_A = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'patrimonial',
  permissions: PERMISSION_KEYS,
});
const AGORA = new Date('2026-10-29T15:00:00Z');

let t: TestDatabase;
let hospitalA: string, hospitalB: string, laudoNumero: string, laudoId: string, antigo: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'pat', name: 'Prestadora', email: 'coord@pat.test', userName: 'Coordenadora' }
  );
  await withTenant(t.db, ctx, async (s) => {
    await provisionFactoryRoles(s);
    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    hospitalA = await createCustomer(s, { name: 'Hospital A' });
    hospitalB = await createCustomer(s, { name: 'Hospital B' });
    const sedeA = await createLocation(s, {
      customerId: hospitalA,
      locationTypeId: lt.get('unidade')!,
      name: 'A',
    });
    const cat = await createAssetCategory(s, { name: 'Monitor' });
    const base = { customerId: hospitalA, assetCategoryId: cat, locationId: sedeA };
    await createAsset(s, {
      ...base,
      name: 'Monitor 01',
      tag: 'MON-01',
      acquiredAt: '2021-10-29',
      usefulLifeYears: 10,
      purchaseValue: 10_000,
    });
    await createAsset(s, { ...base, name: 'Bomba 01', status: 'under_maintenance', purchaseValue: 5_000 });
    await createAsset(s, { ...base, name: 'Ventilador reserva', status: 'standby' });
    antigo = await createAsset(s, {
      ...base,
      name: 'Monitor antigo',
      acquiredAt: '2014-01-10',
      usefulLifeYears: 5,
      purchaseValue: 2_000,
    });
    await createAsset(s, {
      customerId: hospitalB,
      assetCategoryId: cat,
      name: 'Monitor B',
      purchaseValue: 7_000,
      acquiredAt: '2025-01-01',
      usefulLifeYears: 8,
    });
    const laudo = await createObsolescenceReport(
      s,
      antigo,
      'Equipamento sem peças de reposição no fabricante e fora do suporte técnico.'
    );
    laudoNumero = laudo.number!;
    laudoId = laudo.id;
  });
  // A baixa pelo laudo validado, sem atravessar o fluxo da OS (que não é o assunto aqui).
  await t.admin.transaction(async (tx) => {
    await tx.query(`SET LOCAL session_replication_role = replica`);
    await tx.query(`UPDATE aurora.work_orders SET status_category = 'done' WHERE id = $1`, [laudoId]);
    await tx.query(
      `UPDATE aurora.assets SET status = 'decommissioned', decommissioned_at = now(),
                decommission_reason = 'baixado pelo laudo de obsolescência' WHERE id = $1`,
      [antigo]
    );
  });
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: MEM_A },
    { email: 'restrita@pat.test', userName: 'Restrita', customerIds: [hospitalA] }
  );
}, 120_000);

afterAll(async () => {
  await t?.close();
});

const gerar = (membership: string, b: Parameters<typeof buildAssetReport>[2], financials = true) =>
  withTenant(t.db, ctx, (s) => buildAssetReport(s, membership, b, { financials, now: AGORA }));

describe('situações', () => {
  it('todos: contagem por situação, derivada da situação cadastrada', async () => {
    const r = await gerar(MEM, {});
    expect(r.counts).toEqual({ active: 3, maintenance: 1, obsolete: 1, total: 5 });
    expect(r.by_status).toMatchObject({ active: 2, standby: 1, under_maintenance: 1, decommissioned: 1 });
    expect(r.filters).toEqual({ customer: null, situation: 'all' });
  });

  it('em manutenção: só a situação cadastrada "em manutenção"', async () => {
    const r = await gerar(MEM, { situation: 'maintenance' });
    expect(r.items.map((a) => a.name)).toEqual(['Bomba 01']);
  });

  it('obsoletos: baixados e descartados, com o número do laudo OBC', async () => {
    const r = await gerar(MEM, { situation: 'obsolete' });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      name: 'Monitor antigo',
      status: 'decommissioned',
      situation: 'obsolete',
      obsolescence_report: laudoNumero,
    });
    expect(laudoNumero).toMatch(/^OBC-/);
  });

  it('ativos: em operação, reserva e emprestados', async () => {
    const r = await gerar(MEM, { situation: 'active' });
    expect(r.items.map((a) => a.name).sort()).toEqual(['Monitor 01', 'Monitor B', 'Ventilador reserva']);
  });
});

describe('valores', () => {
  it('depreciação e valor contábil são os da ficha; totais somam só quem tem valor', async () => {
    const r = await gerar(MEM, {});
    const monitor = r.items.find((a) => a.name === 'Monitor 01')!;
    const esperado = straightLineDepreciation({
      acquiredAt: '2021-10-29',
      usefulLifeYears: 10,
      purchaseValue: 10_000,
      now: AGORA,
    })!;
    expect(monitor.purchase_value).toBe(10_000);
    expect(monitor.book_value).toBe(esperado.bookValue);
    expect(monitor.percent_depreciated).toBe(esperado.percentDepreciated);
    const antigo = r.items.find((a) => a.name === 'Monitor antigo')!;
    expect(antigo.book_value).toBe(0); // vida útil vencida: totalmente depreciado
    const bomba = r.items.find((a) => a.name === 'Bomba 01')!;
    expect(bomba.book_value).toBeNull(); // sem data nem vida útil: sem depreciação
    expect(r.assets_without_value).toBe(1); // o ventilador de reserva
    const monitorB = r.items.find((a) => a.name === 'Monitor B')!;
    expect(r.totals).toEqual([
      {
        currency: 'BRL',
        assets_with_value: 4,
        purchase_value: 24_000,
        book_value: Math.round((esperado.bookValue! + 0 + monitorB.book_value!) * 100) / 100,
        assets_without_depreciation: 1,
      },
    ]);
  });

  it('sem a permissão financeira: nenhum valor lido nem somado; o percentual continua', async () => {
    const r = await gerar(MEM, {}, false);
    expect(r.financials_visible).toBe(false);
    expect(r.totals).toEqual([]);
    expect(r.assets_without_value).toBeNull();
    for (const a of r.items) {
      expect(a.purchase_value).toBeNull();
      expect(a.residual_value).toBeNull();
      expect(a.book_value).toBeNull();
      expect(a.accumulated_depreciation).toBeNull();
      expect(a.acquisition_invoice).toBeNull();
      expect(a.currency).toBeNull();
    }
    expect(r.items.find((a) => a.name === 'Monitor 01')!.percent_depreciated).toBeGreaterThan(0);
  });
});

describe('escopo', () => {
  it('filtro de cliente', async () => {
    const r = await gerar(MEM, { customer_id: hospitalB });
    expect(r.items.map((a) => a.name)).toEqual(['Monitor B']);
    expect(r.filters.customer).toBe('Hospital B');
  });

  it('o vínculo restrito ao Hospital A só vê A; pedir B é 404', async () => {
    const r = await gerar(MEM_A, {});
    expect(r.counts.total).toBe(4);
    expect(r.items.every((a) => a.customer_name === 'Hospital A')).toBe(true);
    await expect(gerar(MEM_A, { customer_id: hospitalB })).rejects.toThrow(/cliente/);
  });
});
