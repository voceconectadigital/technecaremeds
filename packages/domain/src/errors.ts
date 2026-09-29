/**
 * Aurora — taxonomia de erros de domínio (SPEC v0.2 §30).
 *
 * O domínio nunca lança erro de infraestrutura. A API traduz estes tipos para
 * respostas RFC 9457 com `code`, `message`, `details` e `request_id`, e nunca
 * expõe stack trace ao cliente.
 *
 * Nota deliberada sobre `NotFoundError`: registro fora do escopo do usuário
 * retorna 404, nunca 403 (§37) — não confirmamos a existência de dado que a
 * pessoa não pode ver.
 */

export type ErrorCode =
  | 'validation_failed'
  | 'not_found'
  | 'forbidden'
  | 'unauthenticated'
  | 'conflict'
  | 'precondition_failed'
  | 'invalid_transition'
  | 'tenant_context_missing'
  | 'rate_limited'
  | 'internal';

export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = Object.freeze({ ...details });
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): { code: ErrorCode; message: string; details: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: { ...this.details } };
  }
}

export class ValidationError extends DomainError {
  readonly code = 'validation_failed' as const;
  readonly httpStatus = 422;
}

/** Também usado quando o registro existe mas está fora do escopo (§37). */
export class NotFoundError extends DomainError {
  readonly code = 'not_found' as const;
  readonly httpStatus = 404;

  constructor(entity: string, id?: string) {
    super(`${entity} não encontrado`, id ? { entity, id } : { entity });
  }
}

export class ForbiddenError extends DomainError {
  readonly code = 'forbidden' as const;
  readonly httpStatus = 403;

  constructor(permission: string) {
    super(`Ação não permitida: requer a permissão "${permission}"`, { permission });
  }
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'unauthenticated' as const;
  readonly httpStatus = 401;

  constructor(message = 'Autenticação necessária') {
    super(message);
  }
}

export class ConflictError extends DomainError {
  readonly code = 'conflict' as const;
  readonly httpStatus = 409;
}

export class PreconditionFailedError extends DomainError {
  readonly code = 'precondition_failed' as const;
  readonly httpStatus = 412;
}

/**
 * Transição não declarada no grafo de estados (§10).
 * A mensagem nomeia as transições possíveis — erro que ensina (§35).
 */
export class InvalidTransitionError extends DomainError {
  readonly code = 'invalid_transition' as const;
  readonly httpStatus = 409;

  constructor(from: string, to: string, allowed: readonly string[]) {
    super(
      allowed.length > 0
        ? `Não é possível ir de "${from}" para "${to}". A partir de "${from}" as transições possíveis são: ${allowed.join(', ')}.`
        : `Não é possível ir de "${from}" para "${to}". "${from}" é um estado terminal.`,
      { from, to, allowed: [...allowed] }
    );
  }
}

/**
 * Tentativas demais, e o cliente precisa saber quando voltar.
 *
 * NASCEU DE UM DEFEITO MEDIDO: o limitador do login recusava com
 * `ValidationError`, que é 422. O contrato da rota declarava `rate_limited`, que
 * é 429 — então o documento OpenAPI prometia um código que a API nunca
 * devolvia. Para quem integra, a diferença é grande: 422 quer dizer "o que você
 * mandou está errado, corrija e tente" e 429 quer dizer "o que você mandou está
 * certo, espere" — um cliente que trata 422 como erro de entrada jamais tentaria
 * de novo, e um que ignora 429 tentaria para sempre.
 *
 * `retry_after_seconds` vai nos detalhes porque um 429 sem prazo empurra todo
 * cliente para a mesma estratégia: tentar de novo já.
 */
export class RateLimitedError extends DomainError {
  readonly code = 'rate_limited' as const;
  readonly httpStatus = 429;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message, retryAfterSeconds ? { retry_after_seconds: retryAfterSeconds } : {});
  }
}

/**
 * Nenhuma operação tenant-scoped pode ocorrer sem contexto.
 * Se este erro aparecer, há um caminho de código que escapou da unidade de
 * trabalho — é defeito, não condição esperada.
 */
export class TenantContextMissingError extends DomainError {
  readonly code = 'tenant_context_missing' as const;
  readonly httpStatus = 500;

  constructor(operation: string) {
    super(`Operação "${operation}" exige contexto de organização e nenhum foi definido`, { operation });
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
