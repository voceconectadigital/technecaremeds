/**
 * Aurora — as rotas do aplicativo de campo.
 *
 * QUATRO ROTAS, E NENHUMA CARREGADA SOB DEMANDA.
 *
 * A aplicação interna divide o código por rota, e faz sentido lá: são dezesseis
 * telas e quem abre "Indicadores" não precisa baixar "Estoque". Aqui seria o
 * contrário do que o produto exige — uma rota carregada sob demanda é uma rota
 * que não abre no subsolo, e o subsolo é onde este aplicativo trabalha.
 *
 * O casco inteiro entra no primeiro carregamento, de propósito. Ele é pequeno
 * porque as telas são quatro.
 */
import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { lerSessaoGuardada } from '@aurora/app-kit';
import { Casca } from './casca';
import { HojePage } from './telas/hoje';
import { OrdemPage } from './telas/ordem';
import { AtencaoPage } from './telas/atencao';
import { EntrarPage } from './telas/entrar';

const raiz = createRootRoute({ component: Outlet });

/**
 * Guarda de entrada.
 *
 * NÃO é segurança — é conveniência. Quem nega de verdade é o servidor, em toda
 * requisição. Aqui ele só evita que a pessoa fique olhando uma tela vazia.
 */
function exigirSessao() {
  const { token } = lerSessaoGuardada();
  if (!token) throw redirect({ to: '/entrar' });
}

const comCasca = createRoute({
  getParentRoute: () => raiz,
  id: 'casca',
  component: Casca,
  beforeLoad: exigirSessao,
});

export const routeTree = raiz.addChildren([
  createRoute({ getParentRoute: () => raiz, path: '/entrar', component: EntrarPage }),
  comCasca.addChildren([
    createRoute({ getParentRoute: () => comCasca, path: '/', component: HojePage }),
    createRoute({ getParentRoute: () => comCasca, path: '/ordens/$id', component: OrdemPage }),
    createRoute({ getParentRoute: () => comCasca, path: '/atencao', component: AtencaoPage }),
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
