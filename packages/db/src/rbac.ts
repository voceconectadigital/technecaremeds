/**
 * Aurora — RBAC na camada de dados (SPEC v0.2 §21, EPIC-002).
 *
 * Duas responsabilidades:
 *  1. Manter a tabela `permissions` em sincronia com o catálogo do código.
 *  2. Provisionar os papéis de fábrica de uma organização e resolver as
 *     permissões efetivas de um vínculo.
 */
import { PERMISSIONS, FACTORY_ROLES, permissionsOfRole, newId, type RoleDefinition } from '@aurora/domain';
import type { Database, SqlClient, TenantSession } from './client';
import { withPlatformSession } from './client';

/**
 * Espelha o catálogo de permissões do código no banco.
 * Idempotente. Roda em migration/seed com o banco administrativo.
 *
 * Chave existente no banco e ausente do código NÃO é removida automaticamente:
 * apagá-la derrubaria `role_permissions` por FK. A divergência é reportada para
 * decisão humana.
 */
export async function syncPermissionCatalog(
  adminDb: Database
): Promise<{ inserted: number; updated: number; orphaned: string[] }> {
  if (adminDb.appRole) {
    throw new Error('syncPermissionCatalog exige o banco administrativo (appRole = null)');
  }
  return adminDb.transaction(async (tx) => {
    let inserted = 0;
    let updated = 0;
    for (const p of PERMISSIONS) {
      const rows = await tx.query<{ inserted: boolean }>(
        `INSERT INTO aurora.permissions (key, resource, action, description, field_level)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO UPDATE
            SET description = EXCLUDED.description,
                field_level = EXCLUDED.field_level
         RETURNING (xmax = 0) AS inserted`,
        [p.key, p.resource, p.action, p.description, p.fieldLevel ?? false]
      );
      if (rows[0]?.inserted) inserted++;
      else updated++;
    }
    const known = PERMISSIONS.map((p) => p.key);
    const orphans = await tx.query<{ key: string }>(
      `SELECT key FROM aurora.permissions WHERE key <> ALL($1::text[]) ORDER BY key`,
      [known]
    );
    return { inserted, updated, orphaned: orphans.map((o) => o.key) };
  });
}

/**
 * Cria os papéis de fábrica de uma organização.
 *
 * Papel de fábrica é `is_system = true` e não é editável pela interface (§21).
 * Customizar é duplicar — o que preserva a capacidade de evoluir o padrão sem
 * sobrescrever o que o cliente ajustou.
 */
export async function provisionFactoryRoles(
  session: TenantSession,
  roles: readonly RoleDefinition[] = FACTORY_ROLES
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const role of roles) {
    const existing = await session.query<{ id: string }>(
      `SELECT id FROM aurora.roles WHERE key = $1 AND deleted_at IS NULL`,
      [role.key]
    );
    let roleId = existing[0]?.id;
    if (!roleId) {
      roleId = newId();
      await session.query(
        `INSERT INTO aurora.roles (id, organization_id, key, name, description, seat_type, is_system)
         VALUES ($1, $2, $3, $4, $5, $6::aurora.seat_type, true)`,
        [roleId, session.context.organizationId, role.key, role.name, role.description, role.seatType]
      );
    }
    const wanted = permissionsOfRole(role);
    await session.query(`DELETE FROM aurora.role_permissions WHERE role_id = $1`, [roleId]);
    for (const key of wanted) {
      await session.query(
        `INSERT INTO aurora.role_permissions (organization_id, role_id, permission_key)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [session.context.organizationId, roleId, key]
      );
    }
    ids.set(role.key, roleId);
  }
  return ids;
}

/** Atribui um papel a um vínculo. */
export async function assignRole(
  session: TenantSession,
  membershipId: string,
  roleId: string
): Promise<void> {
  await session.query(
    `INSERT INTO aurora.membership_roles (organization_id, membership_id, role_id)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [session.context.organizationId, membershipId, roleId]
  );
}

/**
 * Permissões efetivas de um vínculo, já com `deny` aplicado.
 * Usada no login, quando ainda não há contexto de tenant — por isso vai pela
 * função SECURITY DEFINER (migration 0006), como a resolução de identidade.
 */
export async function loadEffectivePermissions(db: Database, membershipId: string): Promise<string[]> {
  const rows = await withPlatformSession(db, (c: SqlClient) =>
    c.query<{ permission_key: string }>('SELECT * FROM aurora.effective_permissions($1)', [membershipId])
  );
  return rows.map((r) => r.permission_key);
}
