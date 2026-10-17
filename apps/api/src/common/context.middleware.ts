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
 * Rotas que NÃO passam pela resolução de contexto.
 *
 * A lista é de caminhos EXATOS, e não de prefixos. A versão anterior isentava
 * `me/*` inteiro, com a justificativa que vale só para `me/organizations` — e
 * quando `me/session` nasceu, herdou a isenção por acidente e passou a
 * responder 500: ela PRECISA do contexto, porque o que ela devolve é
 * justamente o contexto resolvido.
 *
 * Prefixo é conveniente e vaza. Caminho exato obriga a decidir de novo a cada
 * rota nova, que é exatamente o que se quer numa lista de isenção.
 *
 *  · health/*        — precisa responder quando tudo mais falhou;
 *  · auth/config     — a tela de login pergunta COMO se entra antes de existir
 *                      qualquer credencial;
 *  · auth/login      — é onde a credencial nasce. Isenta de CONTEXTO, e não de
 *                      verificação: confere senha, limita tentativas por origem
 *                      e por conta;
 *  · auth/logout     — precisa funcionar para quem tem token e perdeu o vínculo.
 *                      Quem foi suspenso no meio da sessão também tem de
 *                      conseguir sair, e sair exige o token em mãos;
 *  · me/organizations — responde ANTES de existir organização no contexto; é a
 *                       rota que o seletor usa, e faz a própria verificação de
 *                       credencial;
 *  · q/*             — resolução pública de QR Code (§07). Não tem sessão por
 *                       desenho: a consulta vai por função SECURITY DEFINER de
 *                       argumento fixo, e a rota devolve a MESMA resposta para
 *                       token inexistente e para organização que não permite
 *                       acesso anônimo.
 *
 * ANCORADO NO INÍCIO (pente-fino 17/10/2026). A versão anterior casava o
 * segmento em QUALQUER posição: `/v1/assets/health` ou `/v1/x/q/y` pulavam a
 * resolução de contexto. Hoje isso falha fechado adiante (401/400), mas era uma
 * armadilha para a próxima rota com um segmento desses no meio. `q/:token` fica
 * fora do prefixo `v1` (bootstrap.ts).
 */
export const PUBLIC_PATH = /^\/(v1\/)?(health(\/|$)|auth\/(config|login|logout)$|me\/organizations$)|^\/q\//;

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
