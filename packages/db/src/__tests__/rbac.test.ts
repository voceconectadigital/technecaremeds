/**
 * Aurora — RBAC no banco (SPEC v0.2 §21, EPIC-002).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS, FACTORY_ROLES, permissionsOfRole } from '@aurora/domain';
import { withTenant } from '../client';
import { provisionFactoryRoles, assignRole, loadEffectivePermissions, syncPermissionCatalog } from '../rbac';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG_A = newId(),
  USER_A = newId(),
  MEM_A = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();
const ctxA = buildContext({ organizationId: ORG_A, actorId: USER_A, requestId: 'rbac-a' });
const ctxB = buildContext({ organizationId: ORG_B, actorId: USER_B, requestId: 'rbac-b' });

let t: TestDatabase;
let rolesA: Map<string, string>;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: USER_A, membershipId: MEM_A },
    {
      slug: 'rbac-a',
      name: 'A',
      email: 'a@rbac.test',
      userName: 'A',
    }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    {
      slug: 'rbac-b',
      name: 'B',
      email: 'b@rbac.test',
      userName: 'B',
    }
  );
  rolesA = await withTenant(t.db, ctxA, (s) => provisionFactoryRoles(s));
  await withTenant(t.db, ctxB, (s) => provisionFactoryRoles(s));
}, 90_000);

afterAll(async () => {
  await t?.close();
});

describe('catálogo de permissões', () => {
  it('o banco espelha exatamente o catálogo do código', async () => {
    const rows = await t.raw('SELECT key FROM aurora.permissions ORDER BY key');
    expect(rows.map((r) => r.key)).toEqual([...PERMISSION_KEYS].sort());
  });

  it('sincronizar é idempotente e não deixa órfão', async () => {
    const r = await syncPermissionCatalog(t.admin);
    expect(r.inserted).toBe(0);
    expect(r.updated).toBe(PERMISSION_KEYS.length);
    expect(r.orphaned).toEqual([]);
  });

  it('recusa rodar sob o papel de aplicação', async () => {
    await expect(syncPermissionCatalog(t.db)).rejects.toThrow(/administrativo/);
  });
});

describe('papéis de fábrica', () => {
  it('provisiona todos os papéis na organização', async () => {
    const rows = await withTenant(t.db, ctxA, (s) =>
      s.query<{ key: string; is_system: boolean }>('SELECT key, is_system FROM aurora.roles ORDER BY key')
    );
    expect(rows).toHaveLength(FACTORY_ROLES.length);
    expect(rows.every((r) => r.is_system)).toBe(true);
  });

  it('as permissões gravadas batem com o catálogo do código', async () => {
    for (const role of FACTORY_ROLES) {
      const rows = await withTenant(t.db, ctxA, (s) =>
        s.query<{ permission_key: string }>(
          `SELECT rp.permission_key FROM aurora.role_permissions rp
             JOIN aurora.roles r ON r.id = rp.role_id
            WHERE r.key = $1 ORDER BY 1`,
          [role.key]
        )
      );
      expect(
        rows.map((r) => r.permission_key),
        `papel ${role.key}`
      ).toEqual(permissionsOfRole(role));
    }
  });

  it('é idempotente', async () => {
    const again = await withTenant(t.db, ctxA, (s) => provisionFactoryRoles(s));
    expect(again.get('owner')).toBe(rolesA.get('owner'));
    const [count] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ c: number }>('SELECT count(*)::int c FROM aurora.roles')
    );
    expect(count!.c).toBe(FACTORY_ROLES.length);
  });
});

describe('permissões efetivas', () => {
  it('vínculo sem papel não tem nenhuma permissão', async () => {
    expect(await loadEffectivePermissions(t.db, MEM_A)).toEqual([]);
  });

  it('papel concede o conjunto correspondente', async () => {
    await withTenant(t.db, ctxA, (s) => assignRole(s, MEM_A, rolesA.get('technician')!));
    const perms = await loadEffectivePermissions(t.db, MEM_A);
    expect(perms).toContain('work_order.execute');
    expect(perms).not.toContain('customer.create');
    expect(perms).not.toContain('work_order.read_costs');
  });

  it('papéis se somam', async () => {
    await withTenant(t.db, ctxA, (s) => assignRole(s, MEM_A, rolesA.get('storekeeper')!));
    const perms = await loadEffectivePermissions(t.db, MEM_A);
    expect(perms).toContain('work_order.execute');
    expect(perms).toContain('inventory.adjust');
  });

  it('deny vence a concessão do papel', async () => {
    await withTenant(t.db, ctxA, (s) =>
      s.query(
        `INSERT INTO aurora.membership_permission_overrides
           (organization_id, membership_id, permission_key, effect, reason)
         VALUES ($1, $2, 'inventory.adjust', 'deny', 'suspenso durante apuração')`,
        [ORG_A, MEM_A]
      )
    );
    const perms = await loadEffectivePermissions(t.db, MEM_A);
    expect(perms).not.toContain('inventory.adjust');
    expect(perms).toContain('inventory.move');
  });

  it('grant individual funciona sem papel', async () => {
    await withTenant(t.db, ctxA, (s) =>
      s.query(
        `INSERT INTO aurora.membership_permission_overrides
           (organization_id, membership_id, permission_key, effect, reason)
         VALUES ($1, $2, 'audit.read', 'grant', 'acesso temporário para auditoria externa')`,
        [ORG_A, MEM_A]
      )
    );
    expect(await loadEffectivePermissions(t.db, MEM_A)).toContain('audit.read');
  });

  it('override expirado não vale mais', async () => {
    await withTenant(t.db, ctxA, (s) =>
      s.query(
        `UPDATE aurora.membership_permission_overrides
            SET expires_at = now() - interval '1 hour'
          WHERE membership_id = $1 AND permission_key = 'audit.read'`,
        [MEM_A]
      )
    );
    expect(await loadEffectivePermissions(t.db, MEM_A)).not.toContain('audit.read');
  });

  it('exige justificativa na revogação', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(
          `INSERT INTO aurora.membership_permission_overrides
             (organization_id, membership_id, permission_key, effect, reason)
           VALUES ($1, $2, 'asset.delete', 'deny', 'x')`,
          [ORG_A, MEM_A]
        )
      )
    ).rejects.toThrow(/overrides_reason_present|check constraint/i);
  });

  it('efeito inválido é recusado pelo banco', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(
          `INSERT INTO aurora.membership_permission_overrides
             (organization_id, membership_id, permission_key, effect, reason)
           VALUES ($1, $2, 'asset.delete', 'talvez', 'motivo suficiente')`,
          [ORG_A, MEM_A]
        )
      )
    ).rejects.toThrow(/overrides_effect_valid|check constraint/i);
  });

  it('permissão fora do catálogo é recusada pela FK', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(
          `INSERT INTO aurora.role_permissions (organization_id, role_id, permission_key)
           VALUES ($1, $2, 'asset.teleport')`,
          [ORG_A, rolesA.get('technician')]
        )
      )
    ).rejects.toThrow(/foreign key|permissions/i);
  });
});

describe('isolamento do RBAC entre organizações', () => {
  it('A não enxerga papéis de B', async () => {
    const idsA = await withTenant(t.db, ctxA, (s) => s.query<{ id: string }>('SELECT id FROM aurora.roles'));
    const idsB = await withTenant(t.db, ctxB, (s) => s.query<{ id: string }>('SELECT id FROM aurora.roles'));
    const setA = new Set(idsA.map((r) => r.id));
    expect(idsB.every((r) => !setA.has(r.id))).toBe(true);
  });

  it('A não consegue atribuir papel de B ao próprio vínculo', async () => {
    const [roleB] = await withTenant(t.db, ctxB, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.roles WHERE key = 'owner'`)
    );
    await expect(withTenant(t.db, ctxA, (s) => assignRole(s, MEM_A, roleB!.id))).rejects.toThrow(
      /foreign key|row-level security/i
    );
  });

  it('A não consegue criar override para vínculo de B', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(
          `INSERT INTO aurora.membership_permission_overrides
             (organization_id, membership_id, permission_key, effect, reason)
           VALUES ($1, $2, 'audit.read', 'grant', 'tentativa cross-tenant')`,
          [ORG_B, MEM_B]
        )
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it('atribuições de papel não vazam entre organizações', async () => {
    const rows = await withTenant(t.db, ctxB, (s) =>
      s.query('SELECT membership_id FROM aurora.membership_roles')
    );
    expect(rows).toEqual([]);
  });
});
