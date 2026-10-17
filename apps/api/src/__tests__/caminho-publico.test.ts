/**
 * Aurora — a lista de caminhos sem contexto casa só no início do caminho.
 */
import { describe, it, expect } from 'vitest';
import { PUBLIC_PATH } from '../common/context.middleware';

describe('PUBLIC_PATH', () => {
  it('libera exatamente as rotas públicas', () => {
    for (const p of [
      '/v1/health',
      '/v1/health/version',
      '/health',
      '/v1/auth/config',
      '/v1/auth/login',
      '/v1/auth/logout',
      '/v1/me/organizations',
      '/q/abc123',
    ]) {
      expect(PUBLIC_PATH.test(p), p).toBe(true);
    }
  });

  it('não libera segmento público no meio do caminho', () => {
    for (const p of [
      '/v1/assets/health',
      '/v1/work-orders/x/health',
      '/v1/x/q/y',
      '/v1/q/abc',
      '/v1/assets/auth/login',
      '/v1/users/me/organizations',
      '/v1/auth/login/extra',
    ]) {
      expect(PUBLIC_PATH.test(p), p).toBe(false);
    }
  });
});
