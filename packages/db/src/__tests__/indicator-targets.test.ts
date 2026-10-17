/**
 * Aurora — metas dos indicadores contra o banco (migration 0069).
 *
 * O que esta suíte protege: isolamento entre organizações (RLS adversarial),
 * recorte por cliente do vínculo na leitura e na escrita, vigência sem
 * sobreposição, arquivamento em vez de apagar, e coerência com o catálogo.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildContext, newId, PERMISSION_KEYS, resolveTarget } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer } from '../directory';
import { createContract } from '../contracts';
import {
  archiveIndicatorTarget,
  createIndicatorTarget,
  listIndicatorTargets,
  loadVisibleTargets,
  updateIndicatorTarget,
} from '../indicator-targets';
import type { MembershipScope } from '../painel';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG_A = newId(),
  USER_A = newId(),
  MEM_A = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();

const ctxA = buildContext({
  organizationId: ORG_A,
  actorId: USER_A,
  membershipId: MEM_A,
  requestId: 'it-a',
  permissions: PERMISSION_KEYS,
});
const ctxB = buildContext({
  organizationId: ORG_B,
  actorId: USER_B,
  membershipId: MEM_B,
  requestId: 'it-b',
  permissions: PERMISSION_KEYS,
});

const TUDO: MembershipScope = { customerIds: null, locationPaths: null };

let t: TestDatabase;
let a1: string, a2: string, b1: string;
let contratoA1: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: USER_A, membershipId: MEM_A },
    { slug: 'it-a', name: 'A', email: 'a@it.test', userName: 'A' }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    { slug: 'it-b', name: 'B', email: 'b@it.test', userName: 'B' }
  );
  await withTenant(t.db, ctxA, async (s) => {
    a1 = await createCustomer(s, { name: 'Hospital A1' });
    a2 = await createCustomer(s, { name: 'Hospital A2' });
    contratoA1 = await createContract(s, { customerId: a1, kind: 'full_service', startsOn: '2026-01-01' });
  });
  await withTenant(t.db, ctxB, async (s) => {
    b1 = await createCustomer(s, { name: 'Hospital B1' });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

const base = {
  indicatorKey: 'sla_compliance',
  direction: 'HIGHER_IS_BETTER' as const,
  validFrom: '2026-01-01',
};

describe('cadastro e leitura', () => {
  it('meta por organização, por cliente e por contrato; o catálogo dá a unidade', async () => {
    const [org, cli, ctr] = await withTenant(t.db, ctxA, async (s) => [
      await createIndicatorTarget(s, TUDO, { ...base, value: 90 }),
      await createIndicatorTarget(s, TUDO, { ...base, customerId: a1, value: 95 }),
      await createIndicatorTarget(s, TUDO, { ...base, customerId: a1, contractId: contratoA1, value: 98 }),
    ]);
    expect([org!.scope, cli!.scope, ctr!.scope]).toEqual(['organization', 'customer', 'contract']);
    expect(org!.unit).toBe('percent');
    expect(ctr!.contractId).toBe(contratoA1);
    expect(org!.timeline).toBe('active');

    const todas = await withTenant(t.db, ctxA, (s) => loadVisibleTargets(s, TUDO, ['sla_compliance']));
    const dia = '2026-09-30';
    const pick = (customerId?: string, contractId?: string) =>
      resolveTarget(todas, { indicatorKey: 'sla_compliance', customerId, contractId, on: dia })?.target.value;
    expect(pick()).toBe(90);
    expect(pick(a1)).toBe(95);
    expect(pick(a1, contratoA1)).toBe(98);
    expect(pick(a2)).toBe(90);
  });

  it('vigência futura e expirada aparecem com a linha do tempo certa', async () => {
    await withTenant(t.db, ctxA, async (s) => {
      await createIndicatorTarget(s, TUDO, {
        indicatorKey: 'mttr',
        direction: 'LOWER_IS_BETTER',
        validFrom: '2020-01-01',
        validTo: '2020-12-31',
        value: 4000,
      });
      await createIndicatorTarget(s, TUDO, {
        indicatorKey: 'mttr',
        direction: 'LOWER_IS_BETTER',
        validFrom: '2099-01-01',
        value: 3000,
      });
    });
    const lista = await withTenant(t.db, ctxA, (s) =>
      listIndicatorTargets(s, TUDO, { indicatorKey: 'mttr' })
    );
    expect(lista.map((x) => x.timeline).sort()).toEqual(['expired', 'future']);
  });

  it('duas vigências do MESMO escopo não se sobrepõem (409), mas escopos diferentes convivem', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createIndicatorTarget(s, TUDO, { ...base, validFrom: '2026-06-01', value: 91 })
      )
    ).rejects.toThrow(/sobreposta/);
    // outro cliente, mesma vigência: pode
    await withTenant(t.db, ctxA, (s) =>
      createIndicatorTarget(s, TUDO, { ...base, customerId: a2, value: 92 })
    );
  });

  it('alterar a vigência para cima de outra meta também é recusado', async () => {
    const nova = await withTenant(t.db, ctxA, (s) =>
      createIndicatorTarget(s, TUDO, {
        indicatorKey: 'backlog',
        direction: 'LOWER_IS_BETTER',
        validFrom: '2026-01-01',
        validTo: '2026-03-31',
        value: 20,
      })
    );
    await withTenant(t.db, ctxA, (s) =>
      createIndicatorTarget(s, TUDO, {
        indicatorKey: 'backlog',
        direction: 'LOWER_IS_BETTER',
        validFrom: '2026-04-01',
        value: 15,
      })
    );
    await expect(
      withTenant(t.db, ctxA, (s) => updateIndicatorTarget(s, TUDO, nova.id, { validTo: null }))
    ).rejects.toThrow(/sobreposta/);
  });

  it('arquivar não apaga: some da leitura, a linha continua para a trilha; o espaço da vigência volta', async () => {
    const m = await withTenant(t.db, ctxA, (s) =>
      createIndicatorTarget(s, TUDO, {
        indicatorKey: 'service_rating',
        direction: 'HIGHER_IS_BETTER',
        validFrom: '2026-01-01',
        value: 4.5,
      })
    );
    await withTenant(t.db, ctxA, (s) => archiveIndicatorTarget(s, TUDO, m.id));
    expect(
      await withTenant(t.db, ctxA, (s) => listIndicatorTargets(s, TUDO, { indicatorKey: 'service_rating' }))
    ).toHaveLength(0);
    const [linha] = await t.raw(`SELECT deleted_at FROM aurora.indicator_targets WHERE id = $1`, [m.id]);
    expect(linha!.deleted_at).not.toBeNull();
    // a vigência liberada aceita nova meta
    await withTenant(t.db, ctxA, (s) =>
      createIndicatorTarget(s, TUDO, {
        indicatorKey: 'service_rating',
        direction: 'HIGHER_IS_BETTER',
        validFrom: '2026-01-01',
        value: 4.7,
      })
    );
  });

  it('o catálogo manda: indicador informativo, sentido contrário e unidade errada → 422', async () => {
    const criar = (i: Parameters<typeof createIndicatorTarget>[2]) =>
      withTenant(t.db, ctxA, (s) => createIndicatorTarget(s, TUDO, i));
    await expect(criar({ ...base, indicatorKey: 'work_orders_opened', value: 10 })).rejects.toThrow(
      /informativo/
    );
    await expect(criar({ ...base, direction: 'LOWER_IS_BETTER', value: 90 })).rejects.toThrow(/sentido/);
    await expect(criar({ ...base, unit: 'minutes', value: 90 })).rejects.toThrow(/unidade/);
    await expect(criar({ ...base, indicatorKey: 'nao_existe', value: 1 })).rejects.toThrow(/desconhecido/);
    await expect(criar({ ...base, value: -1 })).rejects.toThrow();
    await expect(
      criar({ ...base, validFrom: '2026-05-01', validTo: '2026-04-01', value: 1 })
    ).rejects.toThrow(/vigência/);
  });

  it('o contrato da meta é do cliente da meta (gatilho, mesmo escrevendo direto na tabela)', async () => {
    await expect(
      t.raw(
        `INSERT INTO aurora.indicator_targets
           (id, organization_id, indicator_key, customer_id, contract_id, valid_from, target_value, unit, direction)
         VALUES ($1, $2, 'sla_compliance', $3, $4, '2030-01-01', 90, 'percent', 'HIGHER_IS_BETTER')`,
        [newId(), ORG_A, a2, contratoA1]
      )
    ).rejects.toThrow(/contrato da meta/);
  });
});

describe('escopo do vínculo', () => {
  it('quem vê só o cliente A1 lê a meta da organização e a de A1, e não a de A2', async () => {
    const escopo: MembershipScope = { customerIds: [a1], locationPaths: null };
    const lista = await withTenant(t.db, ctxA, (s) => listIndicatorTargets(s, escopo));
    const clientes = new Set(lista.map((x) => x.customerId));
    expect(clientes.has(null)).toBe(true);
    expect(clientes.has(a1)).toBe(true);
    expect(clientes.has(a2)).toBe(false);
    const carregadas = await withTenant(t.db, ctxA, (s) => loadVisibleTargets(s, escopo));
    expect(carregadas.some((x) => x.customerId === a2)).toBe(false);
  });

  it('quem vê só A1 não grava a meta da organização inteira nem a de A2; a de A1 pode', async () => {
    const escopo: MembershipScope = { customerIds: [a1], locationPaths: null };
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createIndicatorTarget(s, escopo, {
          ...base,
          indicatorKey: 'backlog',
          direction: 'LOWER_IS_BETTER',
          value: 5,
        })
      )
    ).rejects.toThrow(/Ação não permitida/);
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createIndicatorTarget(s, escopo, {
          indicatorKey: 'backlog',
          direction: 'LOWER_IS_BETTER',
          customerId: a2,
          validFrom: '2026-01-01',
          value: 5,
        })
      )
    ).rejects.toThrow(/não encontrado/);
    const ok = await withTenant(t.db, ctxA, (s) =>
      createIndicatorTarget(s, escopo, {
        indicatorKey: 'backlog',
        direction: 'LOWER_IS_BETTER',
        customerId: a1,
        validFrom: '2026-01-01',
        value: 5,
      })
    );
    expect(ok.customerId).toBe(a1);
  });

  it('editar/arquivar meta de cliente fora do escopo é 404', async () => {
    const dela = await withTenant(
      t.db,
      ctxA,
      async (s) => (await listIndicatorTargets(s, TUDO, { customerId: a2 }))[0]!
    );
    const escopo: MembershipScope = { customerIds: [a1], locationPaths: null };
    await expect(
      withTenant(t.db, ctxA, (s) => updateIndicatorTarget(s, escopo, dela.id, { value: 1 }))
    ).rejects.toThrow(/não encontrado/);
    await expect(withTenant(t.db, ctxA, (s) => archiveIndicatorTarget(s, escopo, dela.id))).rejects.toThrow(
      /não encontrado/
    );
  });
});

describe('RLS adversarial — a organização B não alcança a A', () => {
  it('B não lê nenhuma meta de A, nem pela função nem por SQL direto', async () => {
    expect(await withTenant(t.db, ctxB, (s) => listIndicatorTargets(s, TUDO))).toHaveLength(0);
    expect(await withTenant(t.db, ctxB, (s) => loadVisibleTargets(s, TUDO))).toHaveLength(0);
    const direto = await withTenant(t.db, ctxB, (s) =>
      s.query(`SELECT id FROM aurora.indicator_targets WHERE organization_id = $1`, [ORG_A])
    );
    expect(direto).toHaveLength(0);
  });

  it('B não altera nem arquiva a meta de A (id conhecido)', async () => {
    const alvo = await withTenant(t.db, ctxA, async (s) => (await listIndicatorTargets(s, TUDO))[0]!);
    await expect(
      withTenant(t.db, ctxB, (s) => updateIndicatorTarget(s, TUDO, alvo.id, { value: 1 }))
    ).rejects.toThrow(/não encontrado/);
    await expect(withTenant(t.db, ctxB, (s) => archiveIndicatorTarget(s, TUDO, alvo.id))).rejects.toThrow(
      /não encontrado/
    );
    const upd = await withTenant(t.db, ctxB, (s) =>
      s.query(`UPDATE aurora.indicator_targets SET target_value = 1 WHERE id = $1 RETURNING id`, [alvo.id])
    );
    expect(upd).toHaveLength(0);
    const [intacta] = await t.raw(
      `SELECT target_value::text AS v FROM aurora.indicator_targets WHERE id = $1`,
      [alvo.id]
    );
    expect(Number(intacta!.v)).toBe(alvo.value);
  });

  it('B não grava linha em nome de A (WITH CHECK) nem aponta para cliente de A (FK composta)', async () => {
    await expect(
      withTenant(t.db, ctxB, (s) =>
        s.query(
          `INSERT INTO aurora.indicator_targets
             (id, organization_id, indicator_key, valid_from, target_value, unit, direction)
           VALUES ($1, $2, 'sla_compliance', '2031-01-01', 90, 'percent', 'HIGHER_IS_BETTER')`,
          [newId(), ORG_A]
        )
      )
    ).rejects.toThrow();
    await expect(
      withTenant(t.db, ctxB, (s) => createIndicatorTarget(s, TUDO, { ...base, customerId: a1, value: 90 }))
    ).rejects.toThrow();
    // e o cliente de B existe só em B
    const b = await withTenant(t.db, ctxB, (s) =>
      createIndicatorTarget(s, TUDO, { ...base, customerId: b1, value: 80 })
    );
    expect(b.customerId).toBe(b1);
    const emA = await withTenant(t.db, ctxA, (s) => listIndicatorTargets(s, TUDO, { customerId: b1 }));
    expect(emA).toHaveLength(0);
  });

  it('a meta de B não entra na resolução de A', async () => {
    const deA = await withTenant(t.db, ctxA, (s) => loadVisibleTargets(s, TUDO, ['sla_compliance']));
    expect(deA.every((x) => x.customerId !== b1)).toBe(true);
  });

  it('o papel da aplicação não apaga linha (só arquiva) e a tabela tem FORCE RLS', async () => {
    const alvo = await withTenant(t.db, ctxA, async (s) => (await listIndicatorTargets(s, TUDO))[0]!);
    await expect(
      withTenant(t.db, ctxA, (s) => s.query(`DELETE FROM aurora.indicator_targets WHERE id = $1`, [alvo.id]))
    ).rejects.toThrow();
    const [rls] = await t.raw(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'aurora.indicator_targets'::regclass`
    );
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('a trilha de auditoria registra a criação da meta', async () => {
    const linhas = await t.raw(
      `SELECT count(*)::int AS n FROM aurora.audit_logs WHERE entity_type = 'indicator_targets' AND organization_id = $1`,
      [ORG_A]
    );
    expect(Number(linhas[0]!.n)).toBeGreaterThan(0);
  });
});
