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

/**
 * A trava que impede DOIS PROCESSOS de migrarem o mesmo banco ao mesmo tempo.
 *
 * O CENÁRIO NÃO É HIPOTÉTICO. Duas instâncias da API subindo juntas num deploy
 * gradual, ou a API e o worker subindo lado a lado, chegam aqui no mesmo
 * instante. Sem trava, as duas leem `schema_migrations` vazia, as duas decidem
 * aplicar a 0000, e a que perde a corrida morre com "relation already exists" —
 * um deploy vermelho por uma condição de corrida que só aparece quando há mais
 * de um processo, que é justamente o ambiente em que ela custa mais caro de
 * diagnosticar.
 *
 * A trava é de TRANSAÇÃO (`_xact_`), e não de sessão: ela morre no COMMIT,
 * junto com a transação que a tomou. Uma trava de sessão precisaria ser
 * liberada à mão na mesma conexão física que a tomou — e num pool, a conexão
 * que executasse o `unlock` não é necessariamente a mesma. Trava de sessão
 * esquecida num pool trava o próximo deploy, e ninguém descobre por quê.
 *
 * O número é arbitrário e fixo. Só precisa não colidir com outra trava de
 * aconselhamento deste banco; as demais deste sistema vivem no espaço de duas
 * chaves (`pg_advisory_xact_lock(a, b)`), que é disjunto deste.
 */
const TRAVA_DE_MIGRACAO = '8270113004912002';

async function travar(tx: SqlClient): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock($1)', [TRAVA_DE_MIGRACAO]);
}

export async function migrate(db: Database, dir?: string): Promise<MigrateResult> {
  const migrations = loadMigrations(dir);
  const result: MigrateResult = { applied: [], skipped: [] };

  await db.transaction(async (tx) => {
    /*
     * Até o `CREATE ... IF NOT EXISTS` precisa da trava.
     *
     * `IF NOT EXISTS` não é atômico contra outra sessão fazendo o mesmo: as
     * duas conferem, as duas não encontram, e a segunda falha com violação de
     * unicidade em `pg_namespace`. É comportamento documentado do PostgreSQL, e
     * acerta exatamente o primeiro comando do primeiro deploy — o momento de
     * menor tolerância a um erro obscuro.
     */
    await travar(tx);
    await tx.query(REGISTRY);
  });

  const rows = await db.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM aurora.schema_migrations'
  );
  const already = new Map(rows.map((r) => [r.name, r.checksum]));

  const conferirChecksum = (nome: string, aplicado: string, atual: string): void => {
    if (aplicado !== atual) {
      throw new Error(
        `Migration "${nome}" foi alterada depois de aplicada.\n` +
          `  esperado: ${aplicado}\n  atual:    ${atual}\n` +
          `Migrations aplicadas são imutáveis — crie uma nova em vez de editar esta.`
      );
    }
  };

  for (const m of migrations) {
    const seen = already.get(m.name);
    if (seen) {
      conferirChecksum(m.name, seen, m.checksum);
      result.skipped.push(m.name);
      continue;
    }

    const aplicou = await db.transaction(async (tx: SqlClient) => {
      await travar(tx);

      /*
       * A RECONFERÊNCIA É DENTRO DA TRAVA, e é ela que faz a trava valer.
       *
       * A leitura lá em cima aconteceu antes de qualquer trava. Quem perdeu a
       * corrida chega aqui com uma lista desatualizada: para ele a migration
       * ainda está pendente, mas o vencedor já a aplicou e já fez COMMIT.
       * Perguntar de novo, agora com exclusividade, é o que transforma "aplicar
       * duas vezes" em "aplicar uma e pular a outra".
       */
      const [ja] = await tx.query<{ checksum: string }>(
        'SELECT checksum FROM aurora.schema_migrations WHERE name = $1',
        [m.name]
      );
      if (ja) {
        conferirChecksum(m.name, ja.checksum, m.checksum);
        return false;
      }

      await tx.query(m.sql);
      await tx.query('INSERT INTO aurora.schema_migrations (name, checksum) VALUES ($1, $2)', [
        m.name,
        m.checksum,
      ]);
      return true;
    });

    (aplicou ? result.applied : result.skipped).push(m.name);
  }

  return result;
}
