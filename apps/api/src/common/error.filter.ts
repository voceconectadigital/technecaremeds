/**
 * Aurora — resposta de erro padronizada (SPEC v0.2 §30).
 *
 * Formato RFC 9457 (problem details) com `code`, `message`, `details` e
 * `request_id`. Nunca expõe stack trace nem mensagem de banco ao cliente.
 */
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { isDomainError } from '@aurora/domain';
import type { StructuredLogger } from './logger';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
  request_id: string;
}

const DIAGNOSTICO_DE_BANCO = ['sqlstate', 'table', 'pg_message'] as const;

/** Tira (e devolve) os campos de diagnóstico de banco dos detalhes do erro. */
export function retirarDiagnosticoDeBanco(details: Record<string, unknown>): Record<string, unknown> {
  const retirado: Record<string, unknown> = {};
  for (const chave of DIAGNOSTICO_DE_BANCO) {
    if (chave in details) {
      retirado[chave] = details[chave];
      delete details[chave];
    }
  }
  return retirado;
}

@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<{ status(c: number): { json(b: unknown): void } }>();
    const req = http.getRequest<{ auroraRequestId?: string; method?: string; url?: string }>();
    const requestId = req?.auroraRequestId ?? 'unknown';

    const problem = this.toProblem(exception, requestId);
    // Diagnóstico de banco fica no LOG, nunca na resposta (auditoria 23/11/2026, SEG-06):
    // nome de tabela, SQLSTATE e a mensagem crua do PostgreSQL ajudam a mapear o esquema.
    const diagnostico = retirarDiagnosticoDeBanco(problem.details);
    // Sem a consulta: termos de busca e o token do QR não vão para o log (SEG-08).
    const caminho = (req?.url ?? '').split('?')[0]!.replace(/^\/q\/[^/]+/, '/q/:token');

    // 5xx é defeito nosso: registra com o erro inteiro, do lado do servidor
    if (problem.status >= 500) {
      this.logger.error('requisição falhou', {
        request_id: requestId,
        method: req?.method,
        url: caminho,
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else {
      this.logger.warn('requisição recusada', {
        request_id: requestId,
        method: req?.method,
        url: caminho,
        code: problem.code,
        status: problem.status,
        ...diagnostico,
      });
    }

    res.status(problem.status).json(problem);
  }

  private toProblem(exception: unknown, requestId: string): ProblemDetails {
    if (isDomainError(exception)) {
      return {
        type: `https://aurora.local/errors/${exception.code}`,
        title: exception.name,
        status: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        details: { ...exception.details },
        request_id: requestId,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      return {
        type: `https://aurora.local/errors/http_${status}`,
        title: exception.name,
        status,
        code: status === 404 ? 'not_found' : 'http_error',
        message: typeof body === 'string' ? body : exception.message,
        details: {},
        request_id: requestId,
      };
    }

    const http = erroHttpDoExpress(exception);
    if (http) return problemaHttp(http.status, http.type, requestId);

    // desconhecido: o cliente recebe o mínimo, o servidor registra tudo
    return {
      type: 'https://aurora.local/errors/internal',
      title: 'InternalServerError',
      status: 500,
      code: 'internal',
      message: 'Erro interno. Informe o identificador da requisição ao suporte.',
      details: {},
      request_id: requestId,
    };
  }
}

/**
 * Erro 4xx do próprio Express/body-parser (`http-errors` com `expose: true`): corpo grande demais
 * (413), codificação não aceita (415), JSON malformado (400). É erro do CLIENTE, não defeito nosso —
 * antes caía no 500 genérico (auditoria 23/11/2026, SEG-01).
 */
function erroHttpDoExpress(e: unknown): { status: number; type: string } | null {
  if (typeof e !== 'object' || e === null) return null;
  const x = e as { expose?: unknown; status?: unknown; statusCode?: unknown; type?: unknown };
  const status =
    typeof x.status === 'number' ? x.status : typeof x.statusCode === 'number' ? x.statusCode : NaN;
  if (x.expose !== true || !(status >= 400 && status < 500)) return null;
  return { status, type: typeof x.type === 'string' ? x.type : 'http_error' };
}

const MENSAGEM_HTTP: Record<number, [string, string]> = {
  400: ['bad_request', 'Requisição malformada.'],
  413: ['payload_too_large', 'O corpo da requisição passa do tamanho aceito por esta rota.'],
  415: ['unsupported_media_type', 'Codificação ou tipo de conteúdo não aceito.'],
};

function problemaHttp(status: number, type: string, requestId: string): ProblemDetails {
  const [code, message] = MENSAGEM_HTTP[status] ?? ['http_error', 'Requisição recusada.'];
  return {
    type: `https://aurora.local/errors/http_${status}`,
    title: 'HttpError',
    status,
    code,
    message,
    details: { reason: type },
    request_id: requestId,
  };
}
