/**
 * Aurora — middleware que anexa o contexto resolvido à requisição (§37, camada 2).
 *
 * Middleware **funcional**, criado por closure. Deliberado: a DI da aplicação é
 * explícita por token e não depende de `emitDecoratorMetadata`, então uma classe
 * de middleware com injeção por tipo seria construída sem dependências pelo
 * Nest e falharia em runtime. A closure torna a dependência impossível de
 * esquecer.
 */
import type { RequestContext } from '@aurora/domain';
import type { ContextResolver, IncomingRequest } from './context.resolver';
import type { StructuredLogger } from './logger';

export interface AuroraRequest extends IncomingRequest {
  auroraContext?: RequestContext;
  auroraRequestId?: string;
  method?: string;
  url?: string;
  /** Express: caminho completo antes de qualquer remontagem de rota. */
  originalUrl?: string;
}

type Next = (err?: unknown) => void;

/**
 * Rotas que não passam pela resolução de contexto:
 *  · health — precisa responder quando tudo mais falhou
 *  · me/*   — responde ANTES de existir organização no contexto; é a rota que
 *             o seletor de organização usa. Faz a própria verificação de
 *             credencial.
 *  · q/*    — resolução pública de QR Code (§07). Não tem sessão por desenho;
 *             a consulta vai por função SECURITY DEFINER de argumento fixo, e
 *             a rota devolve a mesma resposta para token inexistente e para
 *             organização que não permite acesso anônimo.
 */
const PUBLIC_PATH = /(^|\/)(health|me|q)(\/|$)/;

export function createContextMiddleware(resolver: ContextResolver, logger: StructuredLogger) {
  return async function contextMiddleware(req: AuroraRequest, _res: unknown, next: Next): Promise<void> {
    // originalUrl é o único que sobrevive à remontagem de rota do Express
    const path = (req.originalUrl ?? req.url ?? req.path ?? '').split('?')[0] ?? '';
    if (PUBLIC_PATH.test(path)) {
      req.auroraRequestId = req.header('x-request-id') ?? 'health';
      return next();
    }
    try {
      const ctx = await resolver.resolve(req);
      req.auroraContext = ctx;
      req.auroraRequestId = ctx.requestId;
      logger.debug('contexto resolvido', {
        request_id: ctx.requestId,
        organization_id: ctx.organizationId,
        actor_id: ctx.actorId,
      });
      next();
    } catch (e) {
      req.auroraRequestId = req.header('x-request-id') ?? 'unresolved';
      next(e);
    }
  };
}
