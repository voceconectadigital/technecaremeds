/**
 * Aurora — verificação de permissão na borda HTTP (SPEC v0.2 §21).
 *
 * Duas garantias que a SPEC exige e que este arquivo entrega:
 *  · sem a permissão, a rota responde 403 — inclusive via API, não só na
 *    interface (§40, AC3 do padrão de critérios)
 *  · a mensagem nomeia a permissão que falta — erro que ensina (§35)
 *
 * Autorização completa = permissão E escopo. Este guard cobre a permissão; o
 * escopo é aplicado nas consultas, dentro de `withTenant`.
 */
import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ForbiddenError, UnauthenticatedError, hasAllPermissions } from '@aurora/domain';
import type { AuroraRequest } from './context.middleware';

export const PERMISSIONS_KEY = 'aurora:permissions';

/** Declara as permissões exigidas por uma rota. Todas são obrigatórias. */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuroraRequest>();
    const ctx = req.auroraContext;
    if (!ctx) throw new UnauthenticatedError('Contexto não resolvido');

    if (!hasAllPermissions(ctx, required)) {
      const missing = required.filter((p) => !ctx.permissions.has(p));
      throw new ForbiddenError(missing.join(', '));
    }
    return true;
  }
}
