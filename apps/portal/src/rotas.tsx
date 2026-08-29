/**
 * Aurora — as rotas do portal.
 *
 * OITO ROTAS, E NENHUM `/org/:id/`.
 *
 * O endereço de um chamado é o mesmo para qualquer cliente, e o que ele mostra
 * depende do vínculo de quem abre. É o que impede o acidente de mandar um link
 * para alguém de outro hospital e ele ver meia tela carregar antes da recusa —
 * e é também por isso que a recusa por escopo e a de "não existe" são
 * indistinguíveis.
 *
 * A ENTRADA É UM TOKEN, e não uma tela de login própria.
 *
 * O portal recebe a credencial do mesmo provedor de identidade da aplicação
 * interna. Uma segunda tela de login seria uma segunda superfície de
 * autenticação para auditar — e a SPEC §19 existe justamente para manter a
 * superfície do portal mínima.
 */
import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { lerSessaoGuardada } from '@aurora/app-kit';
import { InicioPage } from './telas/inicio';
import { ChamadosPage, ChamadoPage } from './telas/chamados';
import { AbrirPage } from './telas/abrir';
import { DocumentosPage, EquipamentosPage, OrcamentosPage } from './telas/equipamentos';
import { EntrarPage } from './telas/entrar';

const raiz = createRootRoute({ component: Outlet });

/**
 * Guarda de entrada.
 *
 * NÃO é segurança — é conveniência: leva quem não tem credencial para a tela
 * de entrada em vez de deixá-la olhar uma tela vazia. Quem nega de verdade é o
 * servidor, em toda requisição.
 */
function exigirSessao() {
  const { token } = lerSessaoGuardada();
  if (!token) throw redirect({ to: '/entrar' });
}

function rota(path: string, component: () => React.ReactElement) {
  return createRoute({ getParentRoute: () => raiz, path, component, beforeLoad: exigirSessao });
}

export const routeTree = raiz.addChildren([
  createRoute({ getParentRoute: () => raiz, path: '/entrar', component: EntrarPage }),

  rota('/', InicioPage),
  rota('/chamados', ChamadosPage),
  createRoute({
    getParentRoute: () => raiz,
    path: '/chamados/$id',
    component: ChamadoPage,
    beforeLoad: exigirSessao,
  }),
  rota('/abrir', AbrirPage),
  rota('/equipamentos', EquipamentosPage),
  rota('/documentos', DocumentosPage),
  rota('/orcamentos', OrcamentosPage),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
