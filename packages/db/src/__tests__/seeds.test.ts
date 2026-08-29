/**
 * Aurora — seeds determinísticos (EPIC-001).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildContext } from '@aurora/domain';
import { withTenant, withPlatformSession } from '../client';
import { seed, SEED_IDS } from '../seeds';
import { createTestDatabase, type TestDatabase } from '../testing/harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
  await seed(t.admin);
}, 60_000);
afterAll(async () => {
  await t?.close();
});

describe('seeds', () => {
  it('cria duas organizações — vazamento cross-tenant aparece em desenvolvimento', async () => {
    const rows = await t.raw('SELECT slug FROM aurora.organizations ORDER BY slug');
    expect(rows.map((r) => r.slug)).toEqual(['acme-clinica', 'norte-manutencao']);
  });

  it('é idempotente', async () => {
    const before = await t.raw('SELECT count(*)::int c FROM aurora.memberships');
    await seed(t.admin);
    const after = await t.raw('SELECT count(*)::int c FROM aurora.memberships');
    expect(after[0]!.c).toBe(before[0]!.c);
  });

  it('usa identificadores estáveis entre execuções', async () => {
    const rows = await t.raw('SELECT id FROM aurora.organizations WHERE slug = $1', ['acme-clinica']);
    expect(rows[0]!.id).toBe(SEED_IDS.orgAcme);
  });

  it('inclui um usuário em duas organizações (seletor de organização)', async () => {
    const rows = await withPlatformSession(t.db, (c) =>
      c.query('SELECT organization_slug FROM aurora.find_memberships_for_email($1)', [
        'consultor@parceiro.test',
      ])
    );
    expect(rows).toHaveLength(2);
  });

  it('respeita o isolamento: Acme não enxerga membros da Norte', async () => {
    const ctx = buildContext({ organizationId: SEED_IDS.orgAcme, requestId: 'seed-test' });
    const rows = await withTenant(t.db, ctx, (s) =>
      s.query<{ email: string }>(
        `SELECT u.email FROM aurora.memberships m JOIN aurora.users u ON u.id = m.user_id`
      )
    );
    const emails = rows.map((r) => r.email);
    expect(emails).toContain('ana.admin@acme.test');
    expect(emails).not.toContain('bruno@norte.test');
  });

  it('assento de portal não conta como staff', async () => {
    const ctx = buildContext({ organizationId: SEED_IDS.orgAcme, requestId: 'seed-test' });
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ c: number }>(`SELECT count(*)::int c FROM aurora.memberships WHERE seat_type = 'staff'`)
    );
    expect(row!.c).toBe(4); // admin, gestor, técnico, consultora — a enfermeira é portal
  });

  it('custo/hora só existe para staff (constraint do schema)', async () => {
    const rows = await t.raw(
      `SELECT seat_type::text, hourly_cost FROM aurora.memberships WHERE hourly_cost IS NOT NULL`
    );
    expect(rows.every((r) => r.seat_type === 'staff')).toBe(true);
  });
});

describe('proteção dos seeds', () => {
  it('recusa rodar sob o papel de aplicação', async () => {
    await expect(seed(t.db)).rejects.toThrow(/banco administrativo/);
  });
});
