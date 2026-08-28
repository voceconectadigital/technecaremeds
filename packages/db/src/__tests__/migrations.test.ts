/**
 * Aurora — reprodutibilidade do schema (EPIC-001).
 * "banco vazio -> migrations -> seeds -> testes" precisa funcionar sempre.
 */
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgliteAdapter } from '../adapters';
import { migrate, loadMigrations } from '../migrator';

describe('migrations (EPIC-001)', () => {
  it('aplica tudo do zero em banco vazio', async () => {
    const pg = new PGlite();
    const db = pgliteAdapter(pg, null);
    const r = await migrate(db);
    expect(r.applied.length).toBe(loadMigrations().length);
    expect(r.skipped).toEqual([]);
    await pg.close();
  });

  it('é idempotente — rodar de novo não reaplica nada', async () => {
    const pg = new PGlite();
    const db = pgliteAdapter(pg, null);
    await migrate(db);
    const second = await migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBe(loadMigrations().length);
    await pg.close();
  });

  it('detecta migration alterada depois de aplicada', async () => {
    const pg = new PGlite();
    const db = pgliteAdapter(pg, null);
    await migrate(db);
    await pg.query(`UPDATE aurora.schema_migrations SET checksum = 'adulterado' WHERE name = $1`, [
      loadMigrations()[0]!.name,
    ]);
    await expect(migrate(db)).rejects.toThrow(/alterada depois de aplicada/);
    await pg.close();
  });

  it('migrations são ordenadas e nomeadas de forma estável', () => {
    const names = loadMigrations().map((m) => m.name);
    expect(names).toEqual([...names].sort());
    names.forEach((n) => expect(n).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/));
  });

  it('registra o schema esperado', async () => {
    const pg = new PGlite();
    const db = pgliteAdapter(pg, null);
    await migrate(db);
    const { rows } = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='aurora' ORDER BY table_name`
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'audit_logs',
      'domain_events',
      'membership_scopes',
      'memberships',
      'organizations',
      'schema_migrations',
      'users',
    ]);
    await pg.close();
  });
});
