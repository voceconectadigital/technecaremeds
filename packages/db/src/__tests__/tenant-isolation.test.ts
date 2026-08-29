/**
 * Aurora — suíte de isolamento multitenant (SPEC v0.2 §37, EPIC-001).
 *
 * Esta é a suíte mais importante do repositório. Nenhum recurso tenant-scoped
 * é considerado pronto sem passar por ela.
 *
 * Cobre as propriedades exigidas explicitamente:
 *   · A lê A → ok · A lê B → bloqueado · B lê B → ok · B lê A → bloqueado
 *   · escrita cross-tenant bloqueada (WITH CHECK)
 *   · reuso de conexão não vaza contexto
 *   · consulta sem contexto falha fechada (zero linhas, nunca todas)
 *   · o papel da API não é owner, não tem BYPASSRLS, não é superuser
 *   · FORCE ROW LEVEL SECURITY ativo em 100% das tabelas tenant-scoped
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext } from '@aurora/domain';
import { withTenant, withPlatformSession } from '../client';
import { assertAppRoleIsSafe, inspectCurrentRole, UnsafeDatabaseRoleError } from '../guards';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG_A = newId();
const ORG_B = newId();
const USER_A = newId();
const USER_B = newId();
const MEM_A = newId();
const MEM_B = newId();

const ctxA = buildContext({
  organizationId: ORG_A,
  actorId: USER_A,
  actorKind: 'user',
  requestId: 'req-a',
  source: 'api',
});
const ctxB = buildContext({
  organizationId: ORG_B,
  actorId: USER_B,
  actorKind: 'user',
  requestId: 'req-b',
  source: 'api',
});

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: USER_A, membershipId: MEM_A },
    {
      slug: 'org-a',
      name: 'Organização A',
      email: 'a@aurora.test',
      userName: 'Ana',
    }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    {
      slug: 'org-b',
      name: 'Organização B',
      email: 'b@aurora.test',
      userName: 'Bruno',
    }
  );
}, 60_000);

afterAll(async () => {
  await t?.close();
});

describe('configuração de segurança do banco', () => {
  it('aurora_app não é superuser e não tem BYPASSRLS', async () => {
    const [role] = await t.raw(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'aurora_app'`
    );
    expect(role, 'papel aurora_app não existe').toBeDefined();
    expect(role!.rolsuper, 'aurora_app é SUPERUSER').toBe(false);
    expect(role!.rolbypassrls, 'aurora_app tem BYPASSRLS').toBe(false);
    expect(role!.rolcreatedb).toBe(false);
    expect(role!.rolcreaterole).toBe(false);
  });

  it('aurora_app não é dono de nenhuma tabela do schema', async () => {
    const owned = await t.raw(
      `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_roles r ON r.oid = c.relowner
       WHERE n.nspname = 'aurora' AND c.relkind = 'r' AND r.rolname = 'aurora_app'`
    );
    expect(owned.map((r) => r.relname)).toEqual([]);
  });

  it('todas as tabelas tenant-scoped têm ENABLE e FORCE row level security', async () => {
    const tables = await t.raw(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'aurora' AND c.relkind = 'r'
         AND c.relname IN ('organizations','users','memberships','membership_scopes','audit_logs','domain_events')`
    );
    expect(tables.length).toBe(6);
    for (const tbl of tables) {
      expect(tbl.relrowsecurity, `${tbl.relname} sem ENABLE RLS`).toBe(true);
      expect(tbl.relforcerowsecurity, `${tbl.relname} sem FORCE RLS`).toBe(true);
    }
  });

  it('a API não recebeu permissão de escrita na trilha de auditoria', async () => {
    const grants = await t.raw(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_schema='aurora' AND table_name='audit_logs' AND grantee='aurora_app'`
    );
    const types = grants.map((g) => g.privilege_type).sort();
    expect(types).toEqual(['SELECT']);
  });
});

describe('isolamento entre organizações', () => {
  it('A enxerga a própria organização', async () => {
    const rows = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string; slug: string }>('SELECT id, slug FROM aurora.organizations')
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slug).toBe('org-a');
  });

  it('A não enxerga a organização de B nem consultando o id diretamente', async () => {
    const rows = await withTenant(t.db, ctxA, (s) =>
      s.query('SELECT id FROM aurora.organizations WHERE id = $1', [ORG_B])
    );
    expect(rows).toEqual([]);
  });

  it('B enxerga a própria e não a de A', async () => {
    const own = await withTenant(t.db, ctxB, (s) =>
      s.query<{ slug: string }>('SELECT slug FROM aurora.organizations')
    );
    expect(own.map((r) => r.slug)).toEqual(['org-b']);

    const other = await withTenant(t.db, ctxB, (s) =>
      s.query('SELECT id FROM aurora.organizations WHERE id = $1', [ORG_A])
    );
    expect(other).toEqual([]);
  });

  it('memberships e escopos respeitam o tenant', async () => {
    const a = await withTenant(t.db, ctxA, (s) => s.query('SELECT id FROM aurora.memberships'));
    const b = await withTenant(t.db, ctxB, (s) => s.query('SELECT id FROM aurora.memberships'));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect((a[0] as { id: string }).id).not.toBe((b[0] as { id: string }).id);

    const scopesA = await withTenant(t.db, ctxA, (s) =>
      s.query('SELECT membership_id FROM aurora.membership_scopes')
    );
    expect(scopesA).toHaveLength(1);
  });

  it('usuários só são visíveis através de membership na organização corrente', async () => {
    const a = await withTenant(t.db, ctxA, (s) =>
      s.query<{ email: string }>('SELECT email FROM aurora.users')
    );
    expect(a.map((r) => r.email)).toEqual(['a@aurora.test']);

    const b = await withTenant(t.db, ctxB, (s) =>
      s.query<{ email: string }>('SELECT email FROM aurora.users')
    );
    expect(b.map((r) => r.email)).toEqual(['b@aurora.test']);
  });

  it('escrita cross-tenant é bloqueada pelo WITH CHECK', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(
          `INSERT INTO aurora.memberships (id, organization_id, user_id, status)
           VALUES ($1, $2, $3, 'active')`,
          [newId(), ORG_B, USER_B]
        )
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it('UPDATE não consegue mover uma linha para outro tenant', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) => s.query('UPDATE aurora.memberships SET organization_id = $1', [ORG_B]))
    ).rejects.toThrow(/row-level security/i);
  });

  it('DELETE de A não alcança linha de B', async () => {
    await withTenant(t.db, ctxA, (s) =>
      s.query('DELETE FROM aurora.memberships WHERE organization_id = $1', [ORG_B])
    );
    const remaining = await t.raw(
      'SELECT count(*)::int AS c FROM aurora.memberships WHERE organization_id = $1',
      [ORG_B]
    );
    expect(remaining[0]!.c).toBe(1);
  });
});

describe('contexto transaction-local e reuso de conexão', () => {
  it('não sobra contexto após o COMMIT — a mesma conexão volta limpa', async () => {
    await withTenant(t.db, ctxA, async (s) => {
      const [row] = await s.query<{ org: string | null }>(
        `SELECT current_setting('aurora.organization_id', true) AS org`
      );
      expect(row!.org).toBe(ORG_A);
    });

    // mesma conexão física (PGlite é conexão única), fora de transação
    const [after] = await t.db.query<{ org: string | null }>(
      `SELECT nullif(current_setting('aurora.organization_id', true), '') AS org`
    );
    expect(after!.org, 'contexto do tenant A sobreviveu ao COMMIT').toBeNull();
  });

  it('A → devolve conexão → B: zero contexto de A', async () => {
    await withTenant(t.db, ctxA, (s) => s.query('SELECT 1'));

    const seenByB = await withTenant(t.db, ctxB, async (s) => {
      const [ctxRow] = await s.query<{ org: string }>(
        `SELECT current_setting('aurora.organization_id', true) AS org`
      );
      expect(ctxRow!.org, 'contexto de A vazou para a transação de B').toBe(ORG_B);
      return s.query<{ slug: string }>('SELECT slug FROM aurora.organizations');
    });

    expect(seenByB.map((r) => r.slug)).toEqual(['org-b']);
  });

  it('rollback também limpa o contexto', async () => {
    await expect(
      withTenant(t.db, ctxA, async (s) => {
        await s.query('SELECT 1');
        throw new Error('falha proposital');
      })
    ).rejects.toThrow('falha proposital');

    const [after] = await t.db.query<{ org: string | null }>(
      `SELECT nullif(current_setting('aurora.organization_id', true), '') AS org`
    );
    expect(after!.org).toBeNull();
  });
});

describe('falha fechada', () => {
  it('consulta sem contexto de tenant retorna zero linhas, nunca todas', async () => {
    const rows = await t.db.transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE aurora_app');
      return tx.query('SELECT id FROM aurora.organizations');
    });
    expect(rows, 'sem contexto o banco devolveu linhas — falha ABERTA').toEqual([]);
  });

  it('insert sem contexto é rejeitado', async () => {
    await expect(
      t.db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE aurora_app');
        return tx.query(`INSERT INTO aurora.organizations (id, slug, name) VALUES ($1, 'x', 'X')`, [newId()]);
      })
    ).rejects.toThrow(/row-level security/i);
  });

  it('withTenant recusa contexto sem organização', async () => {
    await expect(withTenant(t.db, { organizationId: '' } as never, async () => undefined)).rejects.toThrow(
      /contexto de organização/i
    );
  });
});

describe('guardas de boot (§37)', () => {
  it('identifica o papel corrente', async () => {
    const priv = await inspectCurrentRole(t.db);
    expect(priv.role).toBeTruthy();
  });

  it('recusa papel que ignora RLS, e permite liberação explícita em dev', async () => {
    // no harness a conexão é superusuário fora de transação: caso adversarial ideal
    await expect(assertAppRoleIsSafe(t.db, false)).rejects.toThrow(UnsafeDatabaseRoleError);
    await expect(assertAppRoleIsSafe(t.db, true)).resolves.toBeTruthy();
  });
});

describe('resolução de identidade — o único caminho cross-tenant (migration 0004)', () => {
  it('REGRESSÃO: funciona sob o papel real da aplicação, não só como superusuário', async () => {
    // Este teste existe porque a versão anterior fazia a consulta direta em
    // aurora.memberships. Como superusuário ignora RLS, os testes passavam e
    // TODO login teria falhado em produção com "falha fechada".
    const rows = await withPlatformSession(t.db, (c) =>
      c.query<{ organization_id: string }>('SELECT * FROM aurora.find_memberships_for_email($1)', [
        'a@aurora.test',
      ])
    );
    expect(rows, 'identidade não resolveu sob aurora_app').toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(ORG_A);
  });

  it('a função só devolve dados do e-mail consultado', async () => {
    const rows = await withPlatformSession(t.db, (c) =>
      c.query('SELECT * FROM aurora.find_memberships_for_email($1)', ['b@aurora.test'])
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { organization_id: string }).organization_id).toBe(ORG_B);
  });

  it('e-mail inexistente devolve vazio, sem erro que revele existência', async () => {
    const rows = await withPlatformSession(t.db, (c) =>
      c.query('SELECT * FROM aurora.find_memberships_for_email($1)', ['ninguem@lugar.test'])
    );
    expect(rows).toEqual([]);
  });

  it('a leitura direta das tabelas continua bloqueada sob o papel da aplicação', async () => {
    // a função é a ÚNICA porta: consulta crua segue negada
    const rows = await withPlatformSession(t.db, (c) => c.query('SELECT id FROM aurora.memberships'));
    expect(rows, 'leitura crua cross-tenant deixou de ser bloqueada').toEqual([]);
  });

  it('aurora_app não é membro de aurora_identity — não pode assumir o papel', async () => {
    // SET ROLE valida a associação do *session user*, e no harness ele é
    // superusuário: um teste de "SET ROLE deve falhar" passaria por acidente do
    // ambiente. A propriedade verificável e independente de ambiente é o grafo
    // de associação de papéis.
    const members = await t.raw(
      `SELECT r.rolname AS member
         FROM pg_auth_members am
         JOIN pg_roles g ON g.oid = am.roleid
         JOIN pg_roles r ON r.oid = am.member
        WHERE g.rolname = 'aurora_identity'`
    );
    expect(members.map((m) => m.member)).not.toContain('aurora_app');
  });

  it('aurora_identity só tem SELECT — não escreve em lugar nenhum', async () => {
    const grants = await t.raw(
      `SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema='aurora' AND grantee='aurora_identity' ORDER BY privilege_type`
    );
    expect(grants.map((g) => g.privilege_type)).toEqual(['SELECT']);
  });
});
