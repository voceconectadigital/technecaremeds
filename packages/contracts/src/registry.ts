/**
 * Aurora — o registro de operações da API (SPEC v0.2 §36).
 *
 * POR QUE ESTE PACOTE EXISTE
 *
 * Sem ele, cada campo de cada rota é escrito três vezes: na validação do
 * controller, na documentação, e no cliente do frontend. Três cópias da mesma
 * decisão divergem — e divergem primeiro no campo opcional, que é onde ninguém
 * olha. O sintoma clássico é o frontend mandar `customerId` numa rota que
 * espera `customer_id` e descobrir isso em produção.
 *
 * Aqui a decisão é escrita UMA vez, em Zod:
 *
 *   · o controller valida com o mesmo esquema;
 *   · o OpenAPI é gerado a partir dele;
 *   · o cliente tipado do frontend deriva os tipos dele.
 *
 * O QUE ESTE REGISTRO NÃO FAZ
 *
 * Não declara caminho nem método por conta própria — quem declara é o
 * decorador do NestJS, e o gerador de OpenAPI lê o roteador de VERDADE. Se
 * alguém mudar `@Post('quotes')` para `@Post('proposals')` e esquecer daqui, o
 * gerador acusa a divergência em vez de publicar um documento bonito e falso.
 */
import { z } from 'zod/v4';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface OperationDefinition {
  /**
   * Identificador estável da operação, em `dominio.acao`.
   *
   * Estável é a palavra que importa: é ele que nomeia o método no cliente
   * gerado. Renomear um `operationId` quebra todo consumidor — trate como
   * quebra de contrato, não como ajuste de estilo.
   */
  operationId: string;
  method: HttpMethod;
  /** Caminho como o NestJS o conhece, sem o prefixo `/v1`. */
  path: string;
  summary: string;
  description?: string;
  /** Permissões exigidas; conferidas contra o que o guard realmente declara. */
  permissions?: readonly string[];
  /** Rota pública, sem credencial (saúde, QR). */
  public?: boolean;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  response: z.ZodTypeAny;
  /** Código HTTP de sucesso. O padrão do NestJS é 201 no POST. */
  status?: number;
  /** Erros de negócio previstos, além dos universais (401, 403, 422, 500). */
  errors?: readonly ProblemCode[];
  /**
   * Tipo de mídia da resposta quando ela NÃO é JSON (ex.: `application/pdf`).
   * O corpo é binário; `response` fica só como descrição.
   */
  produces?: string;
}

/** Códigos de erro do RFC 9457 usados pela Aurora (§35). */
export const PROBLEM_CODES = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'validation_failed',
  'rate_limited',
  'internal_error',
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

/**
 * Problema, no formato do RFC 9457 com os acréscimos da §35.
 *
 * `request_id` não é enfeite: é o que permite a uma pessoa no suporte achar a
 * linha exata do log a partir do que ela vê na tela.
 */
export const ProblemDetails = z.object({
  code: z.enum(PROBLEM_CODES),
  message: z.string(),
  request_id: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;

const registro = new Map<string, OperationDefinition>();

/** Declara uma operação. Falha alto no `operationId` repetido. */
export function defineOperation<T extends OperationDefinition>(def: T): T {
  if (registro.has(def.operationId)) {
    throw new Error(
      `operationId duplicado: ${def.operationId} — o identificador nomeia o método do cliente gerado e precisa ser único`
    );
  }
  registro.set(def.operationId, def);
  return def;
}

export function allOperations(): OperationDefinition[] {
  return [...registro.values()].sort((a, b) => a.operationId.localeCompare(b.operationId));
}

export function findOperation(operationId: string): OperationDefinition | undefined {
  return registro.get(operationId);
}

/** Localiza pela rota real, que é como o gerador cruza com o roteador. */
export function operationForRoute(method: string, path: string): OperationDefinition | undefined {
  const m = method.toUpperCase();
  return [...registro.values()].find((o) => o.method === m && normalizePath(o.path) === normalizePath(path));
}

/**
 * Normaliza o caminho para comparação.
 *
 * O NestJS aceita restrição de formato no parâmetro — `:id([0-9a-fA-F-]{36})`
 * — e ela some do roteador do Express de formas diferentes conforme a versão.
 * Comparar `:id` com `:id` evita que uma decisão de segurança (restringir o
 * formato do parâmetro) apareça como divergência de contrato.
 */
export function normalizePath(path: string): string {
  return (
    '/' +
    path
      .replace(/\(.*?\)/g, '')
      .split('/')
      .filter(Boolean)
      .join('/')
  );
}
