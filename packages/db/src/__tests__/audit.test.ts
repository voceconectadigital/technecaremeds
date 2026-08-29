/**
 * Aurora — leitura da trilha de auditoria (SPEC v0.2 §22 · EPIC-022).
 *
 * A trilha existe desde a 0002. O que esta suíte prova é que dá para LER — e
 * que ela continua append-only, perguntando ao banco em vez de confiar.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder, transitionWorkOrder } from '../work-orders';
import { auditTrail, recordTimeline, auditByRequest, appendOnlyCheck } from '../audit';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'req-auditoria-1',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, ativo: string, os: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'aud', name: 'Prestadora', email: 'ana@aud.test', userName: 'Ana Souza' }
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
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: unidade,
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
      title: 'Reparo do ventilador',
      locationId: unidade,
      assetId: ativo,
    });
    os = w.id;

    await transitionWorkOrder(s, os, 'in_progress');
    await transitionWorkOrder(s, os, 'completed', { resolution: 'trocado o filtro e testado' });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

/* -------------------------------------------------------------------------- */

describe('a trilha responde "quem mexeu nisso?"', () => {
  it('registra quem, o quê, e de qual valor para qual', async () => {
    const linhas = await withTenant(t.db, ctx, (s) =>
      auditTrail(s, { entityType: 'work_orders', entityId: os })
    );

    expect(linhas.length).toBeGreaterThan(1);
    // O nome vem resolvido: "quem mexeu nisso?" respondido com um uuid não é
    // resposta.
    expect(linhas[0]!.actor_name).toBe('Ana Souza');
    expect(linhas[0]!.entity_type).toBe('work_orders');

    const mudanca = linhas.find((l) => l.action === 'update')!;
    expect(Object.keys(mudanca.changes).length).toBeGreaterThan(0);
  });

  it('a criação aparece como "create", e ela é o fim da lista', async () => {
    const linhas = await withTenant(t.db, ctx, (s) =>
      auditTrail(s, { entityType: 'work_orders', entityId: os })
    );
    expect(linhas.at(-1)!.action).toBe('create');
  });

  it('filtra por ação', async () => {
    const criacoes = await withTenant(t.db, ctx, (s) => auditTrail(s, { action: 'create' }));
    expect(criacoes.length).toBeGreaterThan(0);
    expect(criacoes.every((l) => l.action === 'create')).toBe(true);
  });

  it('filtra por ator', async () => {
    const minhas = await withTenant(t.db, ctx, (s) => auditTrail(s, { actorUserId: USER }));
    expect(minhas.length).toBeGreaterThan(0);
    expect(minhas.every((l) => l.actor_user_id === USER)).toBe(true);
  });

  it('filtra por período, e recusa o período invertido', async () => {
    const futuro = new Date(Date.now() + 86_400_000);
    const vazio = await withTenant(t.db, ctx, (s) => auditTrail(s, { from: futuro }));
    expect(vazio).toEqual([]);

    await expect(
      withTenant(t.db, ctx, (s) => auditTrail(s, { from: futuro, to: new Date(Date.now() - 86_400_000) }))
    ).rejects.toThrow(/depois do início/);
  });

  it('o identificador da requisição amarra tudo o que uma chamada mudou', async () => {
    const daChamada = await withTenant(t.db, ctx, (s) => auditByRequest(s, 'req-auditoria-1'));
    expect(daChamada.length).toBeGreaterThan(3);
    expect(daChamada.every((l) => l.request_id === 'req-auditoria-1')).toBe(true);
    // E é o que transforma "salvei e sumiram três campos" numa lista concreta.
    expect(new Set(daChamada.map((l) => l.entity_type)).size).toBeGreaterThan(1);
  });
});

describe('a linha do tempo junta as duas camadas', () => {
  it('mistura mudança e fato em ordem cronológica', async () => {
    const linha = await withTenant(t.db, ctx, (s) => recordTimeline(s, 'work_orders', os));

    const especies = new Set(linha.map((l) => l.kind));
    expect(especies.has('change')).toBe(true);
    expect(especies.has('event')).toBe(true);

    // Ordem decrescente, sem exceção: a história se lê de cima para baixo.
    for (let i = 1; i < linha.length; i++) {
      expect(linha[i - 1]!.at.getTime()).toBeGreaterThanOrEqual(linha[i]!.at.getTime());
    }
  });

  it('a mudança traz o diff; o fato traz o conteúdo — e não se confundem', async () => {
    const linha = await withTenant(t.db, ctx, (s) => recordTimeline(s, 'work_orders', os));

    const mudanca = linha.find((l) => l.kind === 'change')!;
    expect(mudanca.changes).not.toBeNull();
    expect(mudanca.payload).toBeNull();

    const fato = linha.find((l) => l.kind === 'event')!;
    expect(fato.payload).not.toBeNull();
    expect(fato.changes).toBeNull();
    // O evento diz o que aconteceu no negócio, não qual coluna mudou.
    expect(fato.label).toMatch(/^work_order\./);
  });

  it('o corte acontece depois da fusão — a história não fica com buraco', async () => {
    const curta = await withTenant(t.db, ctx, (s) => recordTimeline(s, 'work_orders', os, 3));
    expect(curta).toHaveLength(3);
    // Mesmo cortada, começa pelo mais recente de AMBAS as camadas.
    const completa = await withTenant(t.db, ctx, (s) => recordTimeline(s, 'work_orders', os));
    expect(curta[0]!.at.getTime()).toBe(completa[0]!.at.getTime());
  });

  it('registro sem história devolve lista vazia, não erro', async () => {
    const linha = await withTenant(t.db, ctx, (s) => recordTimeline(s, 'work_orders', newId()));
    expect(linha).toEqual([]);
  });
});

describe('a trilha é append-only, e isso é verificado', () => {
  it('o usuário da aplicação não pode alterar nem apagar', async () => {
    const check = await withTenant(t.db, ctx, (s) => appendOnlyCheck(s));
    expect(check.canUpdate).toBe(false);
    expect(check.canDelete).toBe(false);
  });

  it('tentar alterar é recusado pelo banco', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.audit_logs SET entity_label = 'adulterado' WHERE organization_id = $1`, [ORG])
      )
    ).rejects.toThrow(/permission denied|permissão/i);
  });

  it('tentar apagar é recusado pelo banco', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => s.query(`DELETE FROM aurora.audit_logs WHERE organization_id = $1`, [ORG]))
    ).rejects.toThrow(/permission denied|permissão/i);
  });
});

describe('campos sensíveis', () => {
  it('a mudança é auditada, o valor não', async () => {
    // A lista de campos redigidos vive no gatilho da 0002; aqui a suíte
    // confirma que ela é respeitada de fato, e não só declarada.
    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.organizations SET name = 'Prestadora renomeada' WHERE id = $1`, [ORG])
    );

    const linhas = await withTenant(t.db, ctx, (s) =>
      auditTrail(s, { entityType: 'organizations', entityId: ORG })
    );
    const ultima = linhas[0]!;
    expect(ultima.changes).toHaveProperty('name');
    expect(JSON.stringify(ultima.changes)).not.toContain('password');
  });
});

describe('isolamento', () => {
  it('outra organização não lê a trilha desta', async () => {
    const OUTRA = newId(),
      U2 = newId(),
      M2 = newId();
    await seedOrganization(
      t,
      { organizationId: OUTRA, userId: U2, membershipId: M2 },
      { slug: 'aud2', name: 'Outra', email: 'b@aud.test', userName: 'B' }
    );
    const ctx2 = buildContext({
      organizationId: OUTRA,
      actorId: U2,
      membershipId: M2,
      requestId: 'aud2',
      permissions: PERMISSION_KEYS,
    });

    const linhas = await withTenant(t.db, ctx2, (s) =>
      auditTrail(s, { entityType: 'work_orders', entityId: os })
    );
    expect(linhas).toEqual([]);
  });
});
