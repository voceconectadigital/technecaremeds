/**
 * Aurora — o pool não derruba o processo, e a transação não esconde o erro.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { pgPoolAdapter, protegerPool, OPCOES_DE_POOL } from '../adapters';

describe('pool resiliente', () => {
  it('conexão ociosa caída vira registro, não exceção não tratada', () => {
    const pool = new EventEmitter();
    const registrar = vi.fn();
    protegerPool(pool as unknown as { on(e: 'error', f: (e: Error) => void): unknown }, registrar);
    // Sem ouvinte, `emit('error')` lança — e no processo real, mata a API.
    expect(() =>
      pool.emit('error', new Error('terminating connection due to administrator command'))
    ).not.toThrow();
    expect(registrar).toHaveBeenCalledOnce();
  });

  it('o pool espera conexão por tempo limitado (o padrão do node-postgres é esperar para sempre)', () => {
    expect(OPCOES_DE_POOL.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(OPCOES_DE_POOL.idleTimeoutMillis).toBeGreaterThan(0);
  });

  it('ROLLBACK que falha não esconde o erro original e descarta a conexão', async () => {
    const release = vi.fn();
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('Connection terminated');
        return { rows: [] };
      }),
      release,
    };
    const db = pgPoolAdapter(
      { connect: async () => client, query: async () => ({ rows: [] }), end: async () => undefined },
      null
    );
    await expect(
      db.transaction(async () => {
        throw new Error('erro de negócio original');
      })
    ).rejects.toThrow('erro de negócio original');
    expect(release).toHaveBeenCalledWith(true);
  });

  it('transação normal devolve a conexão ao pool', async () => {
    const release = vi.fn();
    const client = { query: vi.fn(async () => ({ rows: [] })), release };
    const db = pgPoolAdapter(
      { connect: async () => client, query: async () => ({ rows: [] }), end: async () => undefined },
      null
    );
    await db.transaction(async () => 1);
    expect(release).toHaveBeenCalledWith(false);
  });
});

describe('erros de dado do PostgreSQL', () => {
  it('data impossível vira 422 (ValidationError), não 500', async () => {
    const { translatePostgresError } = await import('../pg-errors');
    const { ValidationError } = await import('@aurora/domain');
    for (const code of ['22008', '22007']) {
      const e = translatePostgresError(
        Object.assign(new Error('date/time field value out of range'), { code })
      );
      expect(e).toBeInstanceOf(ValidationError);
    }
  });
});

describe('tempo-limite por transação de tenant (PF-75)', () => {
  it('vale dentro da transação e não vaza para a seguinte', async () => {
    const { createTestDatabase } = await import('../testing/harness');
    const { withTenant } = await import('../client');
    const { buildContext, newId } = await import('@aurora/domain');
    const t = await createTestDatabase();
    const comLimite = { ...t.db, limites: { consultaMs: 1234, ociosaNaTransacaoMs: 5678 } };
    const ctx = buildContext({ organizationId: newId(), requestId: 'limite' });
    const [dentro] = await withTenant(comLimite, ctx, (s) =>
      s.query<{ c: string; o: string }>(
        `SELECT current_setting('statement_timeout') c, current_setting('idle_in_transaction_session_timeout') o`
      )
    );
    expect(dentro).toEqual({ c: '1234ms', o: '5678ms' });
    // sem limite configurado: o padrão (0) — e nada sobrou da transação anterior
    const [depois] = await withTenant(t.db, ctx, (s) =>
      s.query<{ c: string }>(`SELECT current_setting('statement_timeout') c`)
    );
    expect(depois?.c).toBe('0');
    await t.close();
  });
});
