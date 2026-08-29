/**
 * Aurora — harness de testes de banco (ADR-022).
 *
 * Sobe um PostgreSQL real (PGlite, em processo), aplica todas as migrations do
 * zero e devolve uma `Database` já configurada com o papel de aplicação.
 *
 * Testar contra Postgres real: defina AURORA_TEST_PG_URL. O mesmo conjunto de
 * testes roda nos dois, e só o teste de reuso de pool com múltiplas conexões
 * físicas exige o segundo.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgliteAdapter } from '../adapters';
import type { Database } from '../client';
import { migrate } from '../migrator';
import { syncPermissionCatalog } from '../rbac';

export interface TestDatabase {
  db: Database;
  /** Sem SET ROLE: usado por migrations e seeds, como em produção. */
  admin: Database;
  /**
   * Executa SQL como o usuário da conexão — só para arranjo de teste.
   *
   * ARMADILHA: PGlite tem uma ÚNICA conexão. Chamar `raw` de dentro de um
   * `withTenant` executa DENTRO daquela transação e sob `SET LOCAL ROLE
   * aurora_app`, ou seja, sujeito a RLS. Use `raw` apenas fora de transações
   * de tenant, no arranjo e nas asserções.
   */
  raw: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite();
  const superuser = pgliteAdapter(pg, null); // sem SET ROLE: aplica migrations como dono

  const result = await migrate(superuser);
  if (result.applied.length === 0) {
    throw new Error('nenhuma migration aplicada — verifique o diretório de migrations');
  }

  // o catálogo de permissões é espelho do código (§21)
  await syncPermissionCatalog(superuser);

  // a partir daqui, tudo passa pelo papel de aplicação
  const db = pgliteAdapter(pg, 'aurora_app');

  return {
    db,
    admin: superuser,
    raw: async (sql, params) => {
      const r = await pg.query<Record<string, unknown>>(sql, params);
      return r.rows;
    },
    close: async () => {
      await pg.close();
    },
  };
}

/** Cria uma organização e um usuário/membership, sem passar por RLS. */
export interface SeedOrgResult {
  organizationId: string;
  userId: string;
  membershipId: string;
}

export async function seedOrganization(
  t: TestDatabase,
  ids: { organizationId: string; userId: string; membershipId: string },
  opts: { slug: string; name: string; email: string; userName: string }
): Promise<SeedOrgResult> {
  await t.raw(`INSERT INTO aurora.organizations (id, slug, name) VALUES ($1, $2, $3)`, [
    ids.organizationId,
    opts.slug,
    opts.name,
  ]);
  await t.raw(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [
    ids.userId,
    opts.email,
    opts.userName,
  ]);
  await t.raw(
    `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
     VALUES ($1, $2, $3, 'active', 'staff', true)`,
    [ids.membershipId, ids.organizationId, ids.userId]
  );
  await t.raw(`INSERT INTO aurora.membership_scopes (membership_id, organization_id) VALUES ($1, $2)`, [
    ids.membershipId,
    ids.organizationId,
  ]);
  return ids;
}

/**
 * Acrescenta uma segunda pessoa a uma organização já semeada, opcionalmente com
 * escopo restrito a uma lista de locais.
 *
 * Existe porque `aurora.users` é tabela de plataforma e o papel da aplicação
 * não escreve nela — corretamente: criar usuário é ato de convite, não de
 * requisição comum. Um teste que precisasse disso e não tivesse este auxiliar
 * acabaria contornando o papel da aplicação para montar o cenário, e passaria a
 * testar um mundo que não existe em produção.
 */
export async function seedMember(
  t: TestDatabase,
  ids: { organizationId: string; userId: string; membershipId: string },
  opts: { email: string; userName: string; locationIds?: readonly string[] }
): Promise<void> {
  await t.raw(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [
    ids.userId,
    opts.email,
    opts.userName,
  ]);
  await t.raw(
    `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
     VALUES ($1, $2, $3, 'active', 'staff', false)`,
    [ids.membershipId, ids.organizationId, ids.userId]
  );
  const restrito = opts.locationIds && opts.locationIds.length > 0;
  await t.raw(
    `INSERT INTO aurora.membership_scopes (membership_id, organization_id, location_scope, location_ids)
     VALUES ($1, $2, $3::aurora.scope_mode, $4)`,
    [ids.membershipId, ids.organizationId, restrito ? 'listed' : 'all', opts.locationIds ?? []]
  );
}
