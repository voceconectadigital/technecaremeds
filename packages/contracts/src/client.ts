/**
 * Aurora — cliente tipado da API.
 *
 * NÃO É CÓDIGO GERADO, E ISSO É DE PROPÓSITO
 *
 * Um gerador produziria um arquivo enorme, versionado, que alguém edita à mão
 * numa sexta-feira e ninguém regenera. Aqui os tipos saem do próprio contrato,
 * por inferência: `call(membersInvite, { body })` já sabe o formato do corpo e
 * o da resposta, e errar o nome de um campo é erro de compilação — não uma
 * surpresa no navegador.
 *
 * O efeito prático é o que a §36 pede: o frontend NÃO redeclara DTO. Se o
 * contrato mudar, o `tsc` aponta cada chamada afetada.
 *
 * O QUE ELE VALIDA, E O QUE NÃO
 *
 * A resposta é conferida contra o esquema em desenvolvimento e em teste. Em
 * produção, não: a conferência custa caro numa lista de dez mil linhas, e
 * derrubar a tela do usuário porque o backend acrescentou um campo é trocar um
 * problema pequeno por um grande. O lugar de pegar essa divergência é o teste
 * de contrato, antes de subir.
 */
import type { OperationDefinition } from './registry';
import type { z } from './primitives';
import type { ProblemDetails } from './registry';

/** Erro que carrega o problema inteiro, no formato do RFC 9457. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails
  ) {
    super(problem.message);
    this.name = 'ApiError';
  }

  /** `true` quando o motivo é falta de permissão, e não erro de preenchimento. */
  get isPermission(): boolean {
    return this.problem.code === 'forbidden';
  }

  /** A permissão que falta, quando o servidor a nomeia (§35). */
  get missingPermission(): string | undefined {
    const p = this.problem.details?.permission;
    return typeof p === 'string' ? p : undefined;
  }

  /** O campo do formulário a destacar, quando a falha é de validação. */
  get field(): string | undefined {
    const f = this.problem.details?.field;
    return typeof f === 'string' ? f : undefined;
  }
}

type Infer<T> = T extends z.ZodTypeAny ? z.infer<T> : never;

/** O que a chamada precisa receber — só o que a operação declara. */
type CallArgs<O extends OperationDefinition> = (O['params'] extends z.ZodTypeAny
  ? { params: Infer<O['params']> }
  : { params?: undefined }) &
  (O['query'] extends z.ZodTypeAny ? { query: Infer<O['query']> } : { query?: undefined }) &
  (O['body'] extends z.ZodTypeAny ? { body: Infer<O['body']> } : { body?: undefined }) & {
    signal?: AbortSignal;
  };

export interface ClientOptions {
  /** Sem barra ao final. Ex.: `https://api.aurora.app`. */
  baseUrl: string;
  /**
   * Credencial do portador. Função, e não texto: o token expira, e um valor
   * capturado na criação do cliente é um valor que envelhece em silêncio.
   */
  token?: () => string | null | undefined;
  /**
   * Organização escolhida, para quem tem vínculo em mais de uma.
   *
   * Vai no cabeçalho `x-aurora-organization` e é apenas uma ESCOLHA entre as
   * organizações que a pessoa já tem — nunca uma autorização. O servidor
   * confere o vínculo; mandar o identificador de outra recebe 403.
   */
  organizationId?: () => string | null | undefined;
  fetch?: typeof globalThis.fetch;
  /** Confere a resposta contra o esquema. Padrão: fora de produção. */
  validateResponses?: boolean;
}

function preencher(path: string, params: Record<string, unknown> | undefined): string {
  return path.replace(/:([A-Za-z0-9_]+)(\([^)]*\))?/g, (_, nome: string) => {
    const valor = params?.[nome];
    if (valor === undefined || valor === null) {
      throw new Error(`parâmetro de caminho ausente: ${nome}`);
    }
    return encodeURIComponent(String(valor));
  });
}

function consulta(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [chave, valor] of Object.entries(query)) {
    if (valor === undefined || valor === null) continue;
    // Lista vira parâmetro repetido, que é o que o Express entende sem ajuda.
    if (Array.isArray(valor)) valor.forEach((v) => p.append(chave, String(v)));
    else p.append(chave, String(valor));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface ApiClient {
  call<O extends OperationDefinition>(operation: O, args?: CallArgs<O>): Promise<Infer<O['response']>>;
  /** O endereço que uma chamada usaria — para depuração e para chaves de cache. */
  urlFor<O extends OperationDefinition>(operation: O, args?: CallArgs<O>): string;
}

export function createApiClient(options: ClientOptions): ApiClient {
  const buscar = options.fetch ?? globalThis.fetch;
  if (!buscar) throw new Error('nenhuma implementação de fetch disponível');

  const validar =
    options.validateResponses ?? (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');

  const enderecar = (op: OperationDefinition, args?: Record<string, unknown>) =>
    options.baseUrl +
    preencher(op.path, args?.params as Record<string, unknown> | undefined) +
    consulta(args?.query as Record<string, unknown> | undefined);

  return {
    urlFor: <O extends OperationDefinition>(op: O, args?: CallArgs<O>) =>
      enderecar(op, args as Record<string, unknown> | undefined),

    async call<O extends OperationDefinition>(op: O, args?: CallArgs<O>): Promise<Infer<O['response']>> {
      const a = args as Record<string, unknown> | undefined;
      const headers: Record<string, string> = { accept: 'application/json' };

      const token = options.token?.();
      if (token) headers.authorization = `Bearer ${token}`;

      const org = options.organizationId?.();
      if (org) headers['x-aurora-organization'] = org;

      const corpo = a?.body;
      if (corpo !== undefined) headers['content-type'] = 'application/json';

      const resposta = await buscar(enderecar(op, a), {
        method: op.method,
        headers,
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
        ...(a?.signal ? { signal: a.signal as AbortSignal } : {}),
      });

      if (!resposta.ok) {
        // O servidor manda problem details; se não mandar — proxy no meio,
        // rede caindo — ainda assim quem chamou recebe a mesma forma de erro.
        let problema: ProblemDetails;
        try {
          problema = (await resposta.json()) as ProblemDetails;
          if (typeof problema?.code !== 'string') throw new Error('sem código');
        } catch {
          problema = {
            code: resposta.status >= 500 ? 'internal_error' : 'validation_failed',
            message: `resposta ${resposta.status} sem detalhe de problema`,
            request_id: resposta.headers.get('x-request-id') ?? 'desconhecido',
          };
        }
        throw new ApiError(resposta.status, problema);
      }

      if (resposta.status === 204) return undefined as never;

      const dados = (await resposta.json()) as Infer<O['response']>;
      if (!validar) return dados;

      const conferido = op.response.safeParse(dados);
      if (!conferido.success) {
        throw new Error(
          `resposta de ${op.operationId} não corresponde ao contrato: ${conferido.error.message}`
        );
      }
      return conferido.data as Infer<O['response']>;
    },
  };
}
