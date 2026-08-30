/**
 * Aurora — a composição do aplicativo de campo.
 *
 * NÃO HÁ `QueryClientProvider` AQUI, e a ausência é a decisão.
 *
 * O TanStack Query resolve "buscar do servidor, guardar em memória, revalidar".
 * Este aplicativo tem outro problema: os dados vêm da BASE LOCAL, que é
 * autoridade enquanto não houver rede, e a rede é uma exceção — não o caminho
 * comum. Empilhar um cache de rede sobre uma base local daria dois lugares onde
 * a mesma OS mora, e o dia em que eles discordassem seria o dia em que o
 * técnico veria a OS voltar ao estado anterior sem entender por quê.
 *
 * O `CampoProvider` é a fonte única: ele abre a base, monta a fila e a
 * sincronização, e é dele que as telas leem.
 */
import { type ReactNode } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { ToastProvider, TooltipProvider } from '@aurora/ui';
import { SessionProvider, ThemeProvider } from '@aurora/app-kit';
import { CampoProvider } from './campo';
import { router } from './rotas';
import type { BaseLocal } from './armazenamento';

export function App({ children, baseDeTeste }: { children?: ReactNode; baseDeTeste?: BaseLocal }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <CampoProvider baseDeTeste={baseDeTeste}>
          <TooltipProvider delayDuration={400}>
            <ToastProvider>{children ?? <RouterProvider router={router} />}</ToastProvider>
          </TooltipProvider>
        </CampoProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
