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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { ToastProvider, TooltipProvider } from '@aurora/ui';
import {
  ApiError,
  PermissionsProvider,
  SessionProvider,
  ThemeProvider,
  useSessionQuery,
} from '@aurora/app-kit';
import { router } from './routes/router';
import { ErrorBoundary } from './shell/error-boundary';
import { DataProvider } from './dados/provedor';

function criarQueryClient() {
  return new QueryClient({
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
  const { data } = useSessionQuery();
  return <PermissionsProvider permissions={data?.permissions ?? []}>{children}</PermissionsProvider>;
}
