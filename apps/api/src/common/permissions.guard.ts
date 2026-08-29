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
export const DYNAMIC_PERMISSIONS_KEY = 'aurora:permissions-dynamic';

/** Declara as permissões exigidas por uma rota. Todas são obrigatórias. */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Declara que a permissão REAL desta rota é decidida dentro do handler.
 *
 * Existe para um punhado de rotas em que a permissão depende do que está sendo
 * pedido: a transição depende da aresta do grafo, a linha do tempo depende da
 * entidade. Nessas, o `@RequirePermissions` da rota é o piso — não a regra.
 *
 * Não afrouxa nada: é anotação. O que ela faz é tornar a exceção VISÍVEL. A
 * conferência de contratos acusa "escrita guardada por permissão de leitura" em
 * toda rota que altera dado exigindo só `algo.read`, e sem esta declaração as
 * quatro rotas legítimas apareceriam no meio dos defeitos de verdade — que é
 * como um alerta útil vira ruído que todo mundo ignora.
 *
 * O motivo vai para o OpenAPI, para quem lê o documento não concluir que a
 * transição de OS é livre para qualquer um que possa ler OS.
 */
export const PermissionsCheckedInHandler = (reason: string) => SetMetadata(DYNAMIC_PERMISSIONS_KEY, reason);

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
