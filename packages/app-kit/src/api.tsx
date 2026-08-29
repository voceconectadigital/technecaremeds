/**
 * Aurora — a ponte com a API (SPEC v0.2 §36).
 *
 * NÃO EXISTE UM SÓ TIPO DE DTO ESCRITO AQUI.
 *
 * Todo formato vem de `@aurora/contracts`, que é o mesmo pacote que valida o
 * corpo no controller e gera o OpenAPI. Redeclarar um `interface WorkOrder` no
 * frontend criaria uma segunda descrição da mesma coisa, e a segunda erra
 * primeiro no campo opcional — que é onde ninguém olha.
 */
import {
  createApiClient,
  ApiError,
  type ApiClient,
  type OperationDefinition,
  type z,
} from '@aurora/contracts';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSession } from './session';

const Ctx = createContext<ApiClient | null>(null);

export interface ApiProviderProps {
  children: ReactNode;
  /** Endereço da API. Em desenvolvimento, o servidor local. */
  baseUrl?: string;
  /** Cliente pronto — os testes injetam o deles em vez de tocar a rede. */
  client?: ApiClient;
}

export function ApiProvider({ children, baseUrl, client }: ApiProviderProps) {
  const sessao = useSession();

  const cliente = useMemo(
    () =>
      client ??
      createApiClient({
        baseUrl: baseUrl ?? (import.meta.env?.VITE_API_URL as string | undefined) ?? '/v1',
        // Funções, e não valores: o token e a organização mudam durante a
        // sessão, e um valor capturado na criação do cliente envelhece.
        token: () => sessao.token,
        organizationId: () => sessao.organizationId,
      }),
    [client, baseUrl, sessao.token, sessao.organizationId]
  );

  return <Ctx.Provider value={cliente}>{children}</Ctx.Provider>;
}

export function useApi(): ApiClient {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApi exige <ApiProvider> acima na árvore');
  return c;
}

/* -------------------------------------------------------------------------- */

type Args = { params?: unknown; query?: unknown; body?: unknown };

/**
 * O tipo do que a operação devolve.
 *
 * Extraído do contrato, e não redeclarado. `useApiQuery(meSession)` já
 * devolve `Session`, e errar um campo é erro de compilação.
 */
type Resposta<O extends OperationDefinition> = z.infer<O['response']>;

/**
 * A chave de cache é (operação, argumentos).
 *
 * Derivada, e não escrita à mão em cada tela: chave escrita à mão é chave que
 * alguém erra, e o sintoma é uma tela que mostra os dados de outra.
 */
export function queryKeyFor(operation: OperationDefinition, args?: Args): unknown[] {
  return [operation.operationId, args?.params ?? null, args?.query ?? null];
}

export interface QueryOptions {
  enabled?: boolean;
  staleTime?: number;
  retry?: boolean | number;
  refetchInterval?: number | false;
}

/** Leitura tipada pelo contrato. */
export function useApiQuery<O extends OperationDefinition>(
  operation: O,
  args?: Args,
  options?: QueryOptions
): UseQueryResult<Resposta<O>, ApiError> {
  const api = useApi();
  return useQuery<Resposta<O>, ApiError>({
    queryKey: queryKeyFor(operation, args),
    queryFn: ({ signal }) =>
      api.call(operation, { ...(args ?? {}), signal } as never) as Promise<Resposta<O>>,
    ...options,
  });
}

/**
 * Escrita tipada, com invalidação declarada.
 *
 * `invalidates` recebe as operações que deixam de valer depois do comando —
 * atribuir uma OS invalida a lista e a ficha. Sem isso, a tela mostra o estado
 * antigo até alguém recarregar, e a pessoa refaz a ação achando que falhou.
 */
export function useApiMutation<O extends OperationDefinition>(
  operation: O,
  options?: {
    invalidates?: OperationDefinition[];
    onSuccess?: (data: Resposta<O>) => void;
    onError?: (error: ApiError) => void;
  }
): UseMutationResult<Resposta<O>, ApiError, Args | undefined> {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation<Resposta<O>, ApiError, Args | undefined>({
    mutationFn: (args) => api.call(operation, (args ?? {}) as never) as Promise<Resposta<O>>,
    onSuccess: (data) => {
      for (const op of options?.invalidates ?? []) {
        void qc.invalidateQueries({ queryKey: [op.operationId] });
      }
      options?.onSuccess?.(data);
    },
    onError: options?.onError,
  });
}

export { ApiError };
