/**
 * Aurora — a composição do portal do cliente.
 *
 * A MESMA BASE DA APLICAÇÃO INTERNA, e telas próprias.
 *
 * Tema, sessão, cliente da API e cache vêm de `@aurora/app-kit`: são o mesmo
 * problema nas duas aplicações, e a versão copiada é a que diverge primeiro no
 * caso raro. O que NÃO é compartilhado são as telas, as rotas e o vocabulário
 * — é exatamente aí que o portal precisa ser outra coisa.
 *
 * NÃO HÁ `PermissionsProvider` AQUI.
 *
 * A aplicação interna esconde itens de menu conforme a permissão. O portal não
 * tem o que esconder: as nove telas da SPEC §19 são as mesmas para todo usuário
 * de portal, e o que muda é o ESCOPO — que o servidor resolve pelo vínculo, e
 * que nenhuma decisão de interface pode ampliar.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { ToastProvider, TooltipProvider } from '@aurora/ui';
import { ApiError, ApiProvider, SessionProvider, ThemeProvider } from '@aurora/app-kit';
import { router } from './rotas';

function criarQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Negativa do servidor não muda por insistência; falha de rede, sim.
        retry: (tentativas, erro) => {
          if (erro instanceof ApiError && erro.status < 500) return false;
          return tentativas < 2;
        },
        /*
         * `staleTime` MAIOR do que na aplicação interna.
         *
         * O portal é lido no celular, muitas vezes em rede de hospital. Quem
         * abre para ver o próprio chamado não precisa de dado de dois segundos
         * atrás — precisa que a tela apareça.
         */
        staleTime: 60_000,
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
        <ApiProvider>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={400}>
              <ToastProvider>{children ?? <RouterProvider router={router} />}</ToastProvider>
            </TooltipProvider>
          </QueryClientProvider>
        </ApiProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
