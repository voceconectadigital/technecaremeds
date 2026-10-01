/**
 * Téchne Care — de onde vêm os dados.
 *
 *   if VITE_DEMO_MODE === 'true'  → DemoDataProvider
 *   else                          → ApiDataProvider
 *
 * As duas pontas entregam a MESMA coisa à árvore: um `ApiClient` do
 * `@aurora/app-kit`. As telas chamam `useApiQuery(operação)` sem saber qual das
 * duas está embaixo — e é por isso que não existe um `if (demo)` espalhado
 * pelas telas.
 *
 * A demonstração é carregada SOB DEMANDA (`lazy`). Como `MODO_DEMO` é uma
 * constante de compilação, o build conectado nem sequer emite o pedaço da
 * demonstração: as respostas gravadas não existem no pacote de produção.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { ApiProvider, MARCA } from '@aurora/app-kit';
import { AmbienteCtx, MODO_DEMO, type Ambiente } from './ambiente';

const CONECTADO: Ambiente = { demonstracao: false, tituloProduto: MARCA.produto };

/** O produto: dados da API em `VITE_API_URL` (ou `/v1`). */
export function ApiDataProvider({ children }: { children: ReactNode }) {
  return (
    <AmbienteCtx.Provider value={CONECTADO}>
      <ApiProvider>{children}</ApiProvider>
    </AmbienteCtx.Provider>
  );
}

const DemoDataProvider = MODO_DEMO ? lazy(() => import('../demo/provedor')) : null;

export function DataProvider({ children }: { children: ReactNode }) {
  if (DemoDataProvider) {
    return (
      // Sem esqueleto: o pedaço da demonstração chega em milissegundos, e um
      // esqueleto piscando antes da tela de entrada só chamaria atenção.
      <Suspense fallback={null}>
        <DemoDataProvider>{children}</DemoDataProvider>
      </Suspense>
    );
  }
  return <ApiDataProvider>{children}</ApiDataProvider>;
}
