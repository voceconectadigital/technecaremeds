/**
 * Aurora — a composição da aplicação.
 *
 * A ordem dos provedores não é arbitrária:
 *
 *   tema → sessão → dados → cache → avisos → permissões → rotas
 *
 * "Dados" é o cliente da API — o de verdade, ou o da demonstração quando o
 * build tem `VITE_DEMO_MODE=true` (ver dados/provedor.tsx).
 *
 * Cada um depende do anterior. O cliente da API precisa da sessão para saber
 * qual credencial mandar; as permissões vêm de uma consulta, que precisa do
 * cache; e as rotas precisam de tudo isso montado antes de decidir para onde
 * mandar quem chegou.
 */
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { ToastProvider, TooltipProvider } from '@aurora/ui';
import {
  ApiError,
  CHAVE_ORG,
  CHAVE_TOKEN,
  PermissionsProvider,
  SessionProvider,
  ThemeProvider,
  useApiQuery,
} from '@aurora/app-kit';
import { meSession, type Session } from '@aurora/contracts';
import { router } from './routes/router';
import { ErrorBoundary } from './shell/error-boundary';
import { DataProvider } from './dados/provedor';
import { ehRotaPublica } from './features/apresentacao/rota';

/**
 * Sessão que o SERVIDOR não reconhece (expirada, revogada ou o token fictício
 * que o demo antigo deixou no mesmo domínio): descarta o que está guardado e
 * volta para a entrada. Sem isto a tela fica de pé, vazia, recebendo 401 em
 * tudo — a guarda de rota só olha se EXISTE token, não se ele vale.
 */
function descartarSessaoInvalida(erro: unknown) {
  if (!(erro instanceof ApiError) || erro.status !== 401) return;
  try {
    localStorage.removeItem(CHAVE_TOKEN);
    localStorage.removeItem(CHAVE_ORG);
  } catch {
    /* armazenamento bloqueado: não há o que limpar */
  }
  if (window.location.pathname !== '/entrar') window.location.assign('/entrar');
}

function criarQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: descartarSessaoInvalida }),
    defaultOptions: {
      queries: {
        /*
         * Não repetir quando o servidor já respondeu com uma NEGATIVA.
         *
         * 401, 403 e 404 não mudam de resposta por insistência: repetir três
         * vezes só atrasa a tela de erro em alguns segundos e enche o log.
         * Falha de rede, essa sim, merece uma segunda tentativa.
         */
        retry: (tentativas, erro) => {
          if (erro instanceof ApiError && erro.status < 500) return false;
          return tentativas < 2;
        },
        staleTime: 30_000,
        // A lista não é recarregada só porque a pessoa voltou para a aba: numa
        // tela de mil OS isso é uma consulta cara por alt-tab.
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function App({ children }: { children?: ReactNode }) {
  const queryClient = useMemo(criarQueryClient, []);

  return (
    <ThemeProvider>
      <SessionProvider>
        <DataProvider>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={400}>
              <ToastProvider>
                <ComPermissoes>
                  <ErrorBoundary onRetry={() => queryClient.clear()}>
                    {children ?? <RouterProvider router={router} />}
                  </ErrorBoundary>
                </ComPermissoes>
              </ToastProvider>
            </TooltipProvider>
          </QueryClientProvider>
        </DataProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

/**
 * As permissões, uma vez, para toda a árvore.
 *
 * Enquanto a sessão não chegou, a lista é vazia — e o menu aparece vazio por um
 * instante. É o comportamento certo: mostrar tudo e esconder depois faria itens
 * piscarem e sumirem, que é pior do que aparecerem um instante depois.
 */
function ComPermissoes({ children }: { children: ReactNode }) {
  /*
   * Numa rota PÚBLICA (a apresentação) a sessão não é perguntada: sem conta, a
   * resposta seria 401, e o 401 manda para `/entrar`. O endereço é lido do
   * histórico do roteador, então sair da rota pública volta a perguntar.
   */
  const caminho = useSyncExternalStore(
    (avisar) => router.history.subscribe(avisar),
    () => router.history.location.pathname
  );
  const { data } = useApiQuery(meSession, undefined, {
    staleTime: 5 * 60_000,
    retry: false,
    enabled: !ehRotaPublica(caminho),
  }) as { data: Session | undefined };
  return <PermissionsProvider permissions={data?.permissions ?? []}>{children}</PermissionsProvider>;
}
