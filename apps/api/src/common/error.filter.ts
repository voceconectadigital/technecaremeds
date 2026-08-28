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

@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<{ status(c: number): { json(b: unknown): void } }>();
    const req = http.getRequest<{ auroraRequestId?: string; method?: string; url?: string }>();
    const requestId = req?.auroraRequestId ?? 'unknown';

    const problem = this.toProblem(exception, requestId);

    // 5xx é defeito nosso: registra com o erro inteiro, do lado do servidor
    if (problem.status >= 500) {
      this.logger.error('requisição falhou', {
        request_id: requestId,
        method: req?.method,
        url: req?.url,
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else {
      this.logger.warn('requisição recusada', {
        request_id: requestId,
        method: req?.method,
        url: req?.url,
        code: problem.code,
        status: problem.status,
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
