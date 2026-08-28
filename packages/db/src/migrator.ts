/**
 * Aurora — migrator (SPEC v0.2, EPIC-001).
 *
 * Requisito do projeto: "o histórico do banco precisa ser reproduzível do zero".
 * Toda migration é um arquivo .sql versionado, aplicado em ordem lexicográfica,
 * dentro de uma transação, e registrado com o hash do conteúdo.
 *
 * O hash existe para detectar edição de migration já aplicada — o erro mais
 * caro de todos, porque o banco de um ambiente deixa de ser reproduzível nos
 * outros silenciosamente.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database, SqlClient } from './client';

export interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

const REGISTRY = `
  CREATE SCHEMA IF NOT EXISTS aurora;
  CREATE TABLE IF NOT EXISTS aurora.schema_migrations (
    name        text PRIMARY KEY,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
  );
`;

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(db: Database, dir?: string): Promise<MigrateResult> {
  const migrations = loadMigrations(dir);
  const result: MigrateResult = { applied: [], skipped: [] };

  await db.transaction(async (tx) => {
    await tx.query(REGISTRY);
  });

  const rows = await db.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM aurora.schema_migrations'
  );
  const already = new Map(rows.map((r) => [r.name, r.checksum]));

  for (const m of migrations) {
    const seen = already.get(m.name);
    if (seen) {
      if (seen !== m.checksum) {
        throw new Error(
          `Migration "${m.name}" foi alterada depois de aplicada.\n` +
            `  esperado: ${seen}\n  atual:    ${m.checksum}\n` +
            `Migrations aplicadas são imutáveis — crie uma nova em vez de editar esta.`
        );
      }
      result.skipped.push(m.name);
      continue;
    }
    await db.transaction(async (tx: SqlClient) => {
      await tx.query(m.sql);
      await tx.query('INSERT INTO aurora.schema_migrations (name, checksum) VALUES ($1, $2)', [
        m.name,
        m.checksum,
      ]);
    });
    result.applied.push(m.name);
  }

  return result;
}
