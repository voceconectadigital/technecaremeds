/**
 * Aurora — adaptadores de banco.
 *
 * PGlite  → testes automatizados (ADR-022). PostgreSQL real, em processo.
 * node-pg → runtime e testes contra Postgres real quando AURORA_TEST_PG_URL
 *           estiver definido.
 *
 * O PGlite é deliberadamente o padrão de teste porque expõe o pior caso de
 * vazamento de contexto: como há uma única conexão persistente, qualquer
 * variável que sobrevivesse ao COMMIT apareceria imediatamente na próxima
 * transação. Um pool com N conexões esconderia o problema atrás da sorte.
 */
import type { Database, SqlClient } from './client';

interface PGliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

/** Adaptador para PGlite (uma única conexão, sem pool). */
export function pgliteAdapter(pg: PGliteLike, appRole: string | null = 'aurora_app'): Database {
  let inTransaction = false;

  const query = async <T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<T[]> => {
    // PGlite não aceita parâmetros em statements múltiplos; usa exec nesse caso
    if (!params || params.length === 0) {
      if (/;\s*\S/.test(sql.replace(/--[^\n]*\n/g, ''))) {
        await pg.exec(sql);
        return [];
      }
    }
    const r = await pg.query<T>(sql, params ? [...params] : undefined);
    return r.rows;
  };

  return {
    appRole,
    query,
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      if (inTransaction) throw new Error('transação aninhada não suportada pelo adaptador PGlite');
      inTransaction = true;
      await pg.query('BEGIN');
      try {
        const out = await fn({ query });
        await pg.query('COMMIT');
        return out;
      } catch (e) {
        await pg.query('ROLLBACK');
        throw e;
      } finally {
        inTransaction = false;
      }
    },
    async close() {
      await pg.close();
    },
  };
}

interface PoolLike {
  connect(): Promise<PoolClientLike>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}
interface PoolClientLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
}

/** Adaptador para node-postgres com pool. */
export function pgPoolAdapter(pool: PoolLike, appRole: string | null = 'aurora_app'): Database {
  return {
    appRole,
    async query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      const r = await pool.query<T>(sql, params ? [...params] : undefined);
      return r.rows;
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({
          query: async <T2 = Record<string, unknown>>(sql: string, params?: readonly unknown[]) =>
            (await client.query<T2>(sql, params ? [...params] : undefined)).rows,
        });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        // devolve a conexão ao pool — é exatamente aqui que um contexto de
        // sessão vazaria para o próximo tenant se não fosse transaction-local
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
