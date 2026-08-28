import { describe, it, expect } from 'vitest';
import { buildContext, systemContext, hasPermission, hasAllPermissions, FULL_SCOPE } from '../context';

describe('RequestContext (§05, §37)', () => {
  const base = { organizationId: 'org-1', requestId: 'req-1' };

  it('exige organizationId — nunca aceita contexto sem tenant', () => {
    expect(() => buildContext({ ...base, organizationId: '' })).toThrow(TypeError);
  });

  it('exige requestId para correlação', () => {
    expect(() => buildContext({ ...base, requestId: '' })).toThrow(TypeError);
  });

  it('é imutável — nenhum serviço reescreve o tenant no meio do caminho', () => {
    const ctx = buildContext(base);
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(() => {
      (ctx as unknown as { organizationId: string }).organizationId = 'outro';
    }).toThrow();
  });

  it('aplica padrões conservadores', () => {
    const ctx = buildContext(base);
    expect(ctx.actorKind).toBe('system');
    expect(ctx.actorId).toBeNull();
    expect(ctx.permissions.size).toBe(0);
    expect(ctx.scope).toEqual(FULL_SCOPE);
  });

  it('avalia permissões', () => {
    const ctx = buildContext({ ...base, permissions: ['work_order.read', 'work_order.create'] });
    expect(hasPermission(ctx, 'work_order.read')).toBe(true);
    expect(hasPermission(ctx, 'work_order.delete')).toBe(false);
    expect(hasAllPermissions(ctx, ['work_order.read', 'work_order.create'])).toBe(true);
    expect(hasAllPermissions(ctx, ['work_order.read', 'work_order.delete'])).toBe(false);
  });

  it('contexto de sistema carrega organização explícita', () => {
    const ctx = systemContext('org-9', 'job-1');
    expect(ctx.organizationId).toBe('org-9');
    expect(ctx.actorKind).toBe('system');
    expect(ctx.source).toBe('job');
  });
});
