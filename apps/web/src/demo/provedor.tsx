/**
 * Téchne Care — `DemoDataProvider`.
 *
 * O par do `ApiDataProvider` (dados/provedor.tsx): entrega à árvore um
 * `ApiClient` que responde com as capturas, e declara o ambiente como
 * demonstração — o que faz a moldura mostrar a faixa "dados fictícios e não
 * persistentes" e o título da aba dizer "Demonstração".
 *
 * Este arquivo só é carregado quando `VITE_DEMO_MODE=true` no build.
 */
import { useMemo, type ReactNode } from 'react';
import { ApiProvider, MARCA } from '@aurora/app-kit';
import { AmbienteCtx, type Ambiente } from '../dados/ambiente';
import { criarClienteDemo } from './cliente';

const DEMONSTRACAO: Ambiente = {
  demonstracao: true,
  tituloProduto: `${MARCA.produto} — Demonstração`,
};

export default function DemoDataProvider({ children }: { children: ReactNode }) {
  const cliente = useMemo(() => criarClienteDemo(), []);
  return (
    <AmbienteCtx.Provider value={DEMONSTRACAO}>
      <ApiProvider client={cliente}>{children}</ApiProvider>
    </AmbienteCtx.Provider>
  );
}
