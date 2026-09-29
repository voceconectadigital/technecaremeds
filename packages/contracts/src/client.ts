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

/**
 * Diz se quem respondeu mandou uma página em vez de dados.
 *
 * `null` quando não dá para afirmar: um servidor que não declara o tipo do
 * conteúdo não deve ser acusado por omissão.
 */
function ehHtml(resposta: Response): string | null {
  const tipo = resposta.headers.get('content-type');
  if (!tipo) return null;
  const t = tipo.toLowerCase();
  return t.startsWith('text/html') || t.startsWith('application/xhtml') ? tipo : null;
}

/**
 * O DEFEITO DE IMPLANTAÇÃO QUE MAIS CUSTA TEMPO, E POR QUE ELE TEM NOME AQUI.
 *
 * Quando a interface é publicada e a API não, o endereço `/v1/...` continua
 * existindo — mas quem atende é o servidor de arquivos, não a Aurora. Ele
 * responde `405` a um POST, `404` a um método que não conhece, ou devolve o
 * `index.html` com `200` para qualquer caminho.
 *
 * A mensagem que sobrava disso era "resposta 405 sem detalhe de problema": um
 * número, na tela de entrada, para alguém que digitou a senha certa. O número
 * está correto e não serve para nada — não diz que o problema é de implantação,
 * não diz qual endereço foi chamado, e deixa a pessoa tentando a senha de novo,
 * que é a única coisa que com certeza não resolve.
 *
 * O código continua sendo `internal_error` de propósito: `PROBLEM_CODES` é uma
 * lista fechada, compartilhada com o servidor e com a especificação OpenAPI —
 * inventar um código só para esta situação faria o cliente falar uma língua que
 * o contrato não declara. E `internal_error` é a verdade: a falha é nossa, não
 * de quem está tentando entrar.
 */
function problemaDeApiAusente(resposta: Response, tipo: string | null): ProblemDetails {
  return {
    code: 'internal_error',
    message:
      'a API não respondeu neste endereço — quem atendeu foi o servidor de arquivos. ' +
      'A interface está publicada e o serviço da API não. Não é erro de senha.',
    request_id: resposta.headers.get('x-request-id') ?? 'sem-api',
    details: {
      motivo: 'api_ausente',
      status: resposta.status,
      ...(tipo ? { content_type: tipo } : {}),
    },
  };
}

/**
 * Reconhece, pelo status, a mesma ausência de API num erro sem corpo JSON.
 *
 * Só estes três: `405` (servidor de arquivos recusando POST), `404` (caminho
 * que a API teria) e `501`. `502` e `503` NÃO entram — ali existe API, e ela
 * está fora do ar ou atrás de um proxy que caiu. São problemas diferentes, e
 * confundi-los manda quem está de plantão procurar no lugar errado.
 */
function semApiNoEndereco(resposta: Response): ProblemDetails | null {
  const tipo = ehHtml(resposta);
  if (tipo) return problemaDeApiAusente(resposta, tipo);
  return resposta.status === 404 || resposta.status === 405 || resposta.status === 501
    ? problemaDeApiAusente(resposta, null)
    : null;
}

/** Carimba o endereço chamado — sem ele, "a API não respondeu" não é acionável. */
function comEndereco(problema: ProblemDetails, endereco: string): ProblemDetails {
  return { ...problema, details: { ...problema.details, endereco } };
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

      const endereco = enderecar(op, a);

      if (!resposta.ok) {
        // O servidor manda problem details; se não mandar — proxy no meio,
        // rede caindo — ainda assim quem chamou recebe a mesma forma de erro.
        let problema: ProblemDetails;
        try {
          problema = (await resposta.json()) as ProblemDetails;
          if (typeof problema?.code !== 'string') throw new Error('sem código');
        } catch {
          problema =
            semApiNoEndereco(resposta) ??
            ({
              code: resposta.status >= 500 ? 'internal_error' : 'validation_failed',
              message: `resposta ${resposta.status} sem detalhe de problema`,
              request_id: resposta.headers.get('x-request-id') ?? 'desconhecido',
            } satisfies ProblemDetails);
          problema = comEndereco(problema, endereco);
        }
        throw new ApiError(resposta.status, problema);
      }

      if (resposta.status === 204) return undefined as never;

      /*
       * `200` NÃO PROVA QUE QUEM RESPONDEU FOI A API.
       *
       * Uma aplicação de página única hospedada em servidor estático devolve o
       * próprio `index.html` para todo caminho desconhecido — inclusive
       * `/v1/...`. Sem esta checagem, `resposta.json()` estoura num
       * `SyntaxError` sobre o caractere `<`, e a tela mostra isso a quem só
       * queria entrar.
       */
      const html = ehHtml(resposta);
      if (html) {
        throw new ApiError(resposta.status, comEndereco(problemaDeApiAusente(resposta, html), endereco));
      }

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
