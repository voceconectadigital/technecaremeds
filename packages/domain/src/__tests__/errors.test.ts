import { describe, it, expect } from 'vitest';
import {
  InvalidTransitionError,
  NotFoundError,
  ForbiddenError,
  isDomainError,
  TenantContextMissingError,
} from '../errors';

describe('erros de domínio (§30, §35)', () => {
  it('mensagem de transição inválida nomeia as opções possíveis', () => {
    const e = new InvalidTransitionError('in_progress', 'closed', [
      'waiting',
      'paused',
      'completed',
      'cancelled',
    ]);
    expect(e.message).toContain('in_progress');
    expect(e.message).toContain('waiting, paused, completed, cancelled');
    expect(e.httpStatus).toBe(409);
    expect(e.details.allowed).toEqual(['waiting', 'paused', 'completed', 'cancelled']);
  });

  it('explica estado terminal quando não há saída', () => {
    const e = new InvalidTransitionError('cancelled', 'open', []);
    expect(e.message).toContain('terminal');
  });

  it('registro fora de escopo é 404, nunca 403', () => {
    expect(new NotFoundError('Ordem de serviço', 'abc').httpStatus).toBe(404);
  });

  it('permissão ausente é 403 e nomeia a permissão', () => {
    const e = new ForbiddenError('work_order.close');
    expect(e.httpStatus).toBe(403);
    expect(e.message).toContain('work_order.close');
  });

  it('ausência de contexto de tenant é defeito interno, não 4xx', () => {
    expect(new TenantContextMissingError('listWorkOrders').httpStatus).toBe(500);
  });

  it('serializa sem vazar stack', () => {
    const json = new NotFoundError('Ativo').toJSON();
    expect(Object.keys(json).sort()).toEqual(['code', 'details', 'message']);
    expect(isDomainError(new NotFoundError('Ativo'))).toBe(true);
    expect(isDomainError(new Error('x'))).toBe(false);
  });
});
