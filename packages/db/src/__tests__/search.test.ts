/**
 * Aurora — busca global contra o banco (SPEC v0.2 §27 · EPIC-023).
 *
 * O caso que define o épico: o técnico com o equipamento na frente digita o
 * número da etiqueta e não sabe se aquilo é TAG, patrimônio ou série. Aqui ele
 * acha — e não precisa saber em qual lista procurar.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder } from '../work-orders';
import { createItem, createWarehouse } from '../inventory';
import { search } from '../search';
import { createTestDatabase, seedOrganization, seedMember, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'busca',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, uti: string, ventilador: string, numeroOs: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'busca', name: 'Prestadora', email: 'ana.souza@busca.test', userName: 'Ana Souza' }
  );

  await withTenant(t.db, ctx, async (s) => {
    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital Santa Clara', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede',
    });
    uti = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: lt.get('setor')!,
      name: 'UTI Adulto',
      code: 'UTI-A',
    });

    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ventilador = await createAsset(s, {
      name: 'Ventilador pulmonar Servo-i',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: uti,
      tag: 'VENT-01',
      assetNumber: '7737',
      serialNumber: 'SN-99881',
    });

    const natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    const w = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: 'Alarme intermitente no ventilador 7737',
      locationId: uti,
      assetId: ventilador,
    });
    numeroOs = w.number!;

    await createWarehouse(s, { name: 'Central', kind: 'central' });
    await createItem(s, { sku: 'FLT-7737', name: 'Filtro bacteriológico' });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

/* -------------------------------------------------------------------------- */

describe('achar sem saber em qual lista procurar', () => {
  it('o patrimônio acha o ativo, e ele vem PRIMEIRO', async () => {
    const r = await withTenant(t.db, ctx, (s) => search(s, '7737'));

    expect(r.hits.length).toBeGreaterThan(1);
    expect(r.hits[0]!.scope).toBe('asset');
    expect(r.hits[0]!.matchKind).toBe('identifier_exact');
    expect(r.hits[0]!.title).toMatch(/Servo-i/);

    // A OS que menciona 7737 no texto também aparece — mas depois.
    expect(r.hits.some((h) => h.scope === 'work_order')).toBe(true);
  });

  it('a TAG acha o mesmo ativo', async () => {
    const r = await withTenant(t.db, ctx, (s) => search(s, 'VENT-01'));
    expect(r.hits[0]!.id).toBe(ventilador);
    expect(r.hits[0]!.matchKind).toBe('identifier_exact');
  });

  it('a série acha o mesmo ativo', async () => {
    const r = await withTenant(t.db, ctx, (s) => search(s, 'SN-99881'));
    expect(r.hits[0]!.id).toBe(ventilador);
  });

  it('o número da OS acha a OS', async () => {
    const r = await withTenant(t.db, ctx, (s) => search(s, numeroOs));
    expect(r.hits[0]!.scope).toBe('work_order');
    expect(r.hits[0]!.matchKind).toBe('identifier_exact');
  });

  it('o nome parcial acha por texto', async () => {
    const r = await withTenant(t.db, ctx, (s) => search(s, 'servo'));
    expect(r.hits.some((h) => h.id === ventilador)).toBe(true);
  });

  it('acento não atrapalha', async () => {
    const r = await withTenant(t.db, ctx, (s) => search(s, 'bacteriológico'));
    expect(r.hits.some((h) => h.scope === 'inventory_item')).toBe(true);
  });

  it('o mesmo número em escopos diferentes traz os dois', async () => {
    const r = await withTenant(t.db, ctx, (s) => search(s, '7737'));
    const escopos = new Set(r.hits.map((h) => h.scope));
    // Ativo (patrimônio), OS (texto) e item de estoque (SKU FLT-7737).
    expect(escopos.size).toBeGreaterThanOrEqual(3);
  });
});

describe('prefixos contextuais', () => {
  it('"#" restringe a OS e solicitações', async () => {
    const r = await withTenant(t.db, ctx, (s) => search(s, '#7737'));
    expect(r.scopes).toEqual(['work_order', 'service_request']);
    expect(r.hits.every((h) => h.scope === 'work_order' || h.scope === 'service_request')).toBe(true);
  });

  it('"@" restringe a pessoas', async () => {
    const r = await withTenant(t.db, ctx, (s) => search(s, '@ana'));
    expect(r.hits[0]!.scope).toBe('person');
    expect(r.hits[0]!.title).toBe('Ana Souza');
  });

  it('">" devolve comandos e nenhum registro', async () => {
    const r = await withTenant(t.db, ctx, (s) => search(s, '>agenda'));
    expect(r.commandMode).toBe(true);
    expect(r.hits).toEqual([]);
    expect(r.commands.map((c) => c.key)).toContain('go_schedule');
  });

  it('a busca comum também sugere comandos, sem virar paleta', async () => {
    const r = await withTenant(t.db, ctx, (s) => search(s, 'agenda'));
    expect(r.commandMode).toBe(false);
    expect(r.commands.map((c) => c.key)).toContain('go_schedule');
  });
});

describe('termo curto demais', () => {
  it('é recusado antes de qualquer consulta', async () => {
    await expect(withTenant(t.db, ctx, (s) => search(s, 'a'))).rejects.toThrow(/ao menos 2 caracteres/);
  });
});

describe('escopo e permissão valem no índice', () => {
  it('sem permissão de leitura, o escopo não é consultado — o resultado não existe', async () => {
    const semAtivos = buildContext({
      organizationId: ORG,
      actorId: USER,
      membershipId: MEM,
      requestId: 'sem-ativos',
      // Tudo menos `asset.read`.
      permissions: PERMISSION_KEYS.filter((k) => k !== 'asset.read'),
    });

    const r = await withTenant(t.db, semAtivos, (s) => search(s, '7737'));
    expect(r.hits.some((h) => h.scope === 'asset')).toBe(false);
    // As OS continuam vindo: o corte é por escopo, não por termo.
    expect(r.hits.some((h) => h.scope === 'work_order')).toBe(true);
  });

  it('o vínculo sem escopo de cliente não enxerga o ativo daquele cliente', async () => {
    const OUTRO_USER = newId(),
      OUTRO_MEM = newId();
    await seedMember(
      t,
      { organizationId: ORG, userId: OUTRO_USER, membershipId: OUTRO_MEM },
      { email: 'sem.escopo@busca.test', userName: 'Sem escopo', locationIds: [newId()] }
    );

    const restrito = buildContext({
      organizationId: ORG,
      actorId: OUTRO_USER,
      membershipId: OUTRO_MEM,
      requestId: 'restrito',
      permissions: PERMISSION_KEYS,
    });

    const r = await withTenant(t.db, restrito, (s) => search(s, '7737'));
    // O escopo é por local, e este vínculo só enxerga um local que não existe
    // no acervo: nem o ativo nem a OS daquele setor existem para ele.
    expect(r.hits.some((h) => h.scope === 'asset')).toBe(false);
    expect(r.hits.some((h) => h.scope === 'work_order')).toBe(false);
  });
});

describe('isolamento', () => {
  it('outra organização não acha nada', async () => {
    const OUTRA = newId(),
      U2 = newId(),
      M2 = newId();
    await seedOrganization(
      t,
      { organizationId: OUTRA, userId: U2, membershipId: M2 },
      { slug: 'busca2', name: 'Outra', email: 'b@busca.test', userName: 'B' }
    );
    const ctx2 = buildContext({
      organizationId: OUTRA,
      actorId: U2,
      membershipId: M2,
      requestId: 'busca2',
      permissions: PERMISSION_KEYS,
    });

    const r = await withTenant(t.db, ctx2, (s) => search(s, '7737'));
    expect(r.hits).toEqual([]);
  });
});
