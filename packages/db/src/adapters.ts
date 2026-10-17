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
import type { Database, SqlClient, LimitesDeTransacao } from './client';

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
  /** `release(true)` descarta a conexão em vez de devolvê-la ao pool (node-postgres). */
  release(destruir?: boolean): void;
}

/**
 * Opções de pool comuns à API e ao worker (pente-fino 17/10/2026).
 *
 * `connectionTimeoutMillis`: o padrão do node-postgres é ZERO — esperar para
 * sempre. Com o pool esgotado, a requisição ficava pendurada em vez de falhar, e
 * a API parecia viva enquanto ninguém conseguia usar. `idleTimeoutMillis` devolve
 * ao banco a conexão ociosa antes que um NAT ou o pooler a cortem por fora.
 *
 * `statement_timeout` NÃO entra aqui de propósito: ele iria como parâmetro de
 * inicialização, e o pooler em modo transação do Supabase recusa parâmetros de
 * inicialização. Fica como decisão de infraestrutura, junto com o destino.
 */
export const OPCOES_DE_POOL = { connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 } as const;

interface PoolComEventos {
  on(evento: 'error', ouvinte: (e: Error) => void): unknown;
}

/**
 * Instala o ouvinte de `error` do pool.
 *
 * O node-postgres EMITE `error` quando uma conexão OCIOSA cai — reinício do
 * pooler, corte de NAT, `pg_terminate_backend`. Sem ouvinte, o Node transforma o
 * evento em exceção não tratada e o processo inteiro morre: a API derrubava todas
 * as requisições em andamento, o worker morria no meio do trabalho. A conexão
 * perdida já foi descartada pelo pool; registrar e seguir é o certo.
 */
export function protegerPool<P extends PoolComEventos>(pool: P, aoErro: (e: Error) => void): P {
  pool.on('error', aoErro);
  return pool;
}

/** Adaptador para node-postgres com pool. */
export function pgPoolAdapter(
  pool: PoolLike,
  appRole: string | null = 'aurora_app',
  limites?: LimitesDeTransacao
): Database {
  return {
    appRole,
    ...(limites ? { limites } : {}),
    async query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      const r = await pool.query<T>(sql, params ? [...params] : undefined);
      return r.rows;
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      let quebrada = false;
      try {
        await client.query('BEGIN');
        const out = await fn({
          query: async <T2 = Record<string, unknown>>(sql: string, params?: readonly unknown[]) =>
            (await client.query<T2>(sql, params ? [...params] : undefined)).rows,
        });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        // Se o próprio ROLLBACK falhar (conexão caída), o erro que interessa
        // continua sendo o original — e a conexão não volta ao pool.
        try {
          await client.query('ROLLBACK');
        } catch {
          quebrada = true;
        }
        throw e;
      } finally {
        // devolve a conexão ao pool — é exatamente aqui que um contexto de
        // sessão vazaria para o próximo tenant se não fosse transaction-local
        client.release(quebrada);
      }
    },
    async close() {
      await pool.end();
    },
  };
}
