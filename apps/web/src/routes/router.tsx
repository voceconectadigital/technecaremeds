/**
 * Aurora — as rotas (SPEC v0.2 §34, §40).
 *
 * ROTAS EM CÓDIGO, e não geradas por arquivo. O gerador do TanStack cria um
 * arquivo versionado que alguém edita à mão e ninguém regenera; aqui a árvore
 * é uma expressão, o `tsc` a confere inteira, e não há passo de build entre
 * escrever a rota e usá-la.
 *
 * A URL NÃO CARREGA A ORGANIZAÇÃO. Não existe `/org/:id/ordens/1042`: o
 * endereço de uma OS é o mesmo para qualquer organização, e o que ele mostra
 * depende do vínculo de quem abre. É o que impede o acidente de mandar um link
 * para um colega de outra empresa e ele ver meia tela carregar antes do 403.
 */
import type { ReactElement } from 'react';
import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { EntrarPage } from './entrar';
import { OrganizacoesPage } from './organizacoes';
import { HojePage } from './hoje';
import { SolicitacoesPage } from '../features/solicitacoes/lista';
import { SolicitacaoPage } from '../features/solicitacoes/ficha';
import { NovaSolicitacaoPage } from '../features/solicitacoes/nova';
import { OrdensPage } from '../features/ordens/lista';
import { OrdemPage } from '../features/ordens/ficha';
import { AgendaPage } from '../features/agenda/pagina';
import { MembrosPage } from '../features/configuracoes/membros';
import { EmConstrucao } from './em-construcao';
import { AtivosPage } from '../features/ativos/lista';
import { AtivoPage } from '../features/ativos/ficha';
import { EstoquePage } from '../features/estoque/lista';
import { OrcamentosPage } from '../features/comercial/orcamentos';
import { OrcamentoPage } from '../features/comercial/orcamento';
import { ContratosPage, ContratoPage } from '../features/comercial/contratos';
import { PlanosPage, PlanoPage } from '../features/planos/lista';
import { IndicadoresPage } from '../features/indicadores/painel';
import { NotificacoesPage } from '../features/notificacoes/caixa';
import { DocumentosPage } from '../features/documentos/lista';
import { AutomacoesPage } from '../features/automacoes/lista';
import { lerSessaoGuardada } from '../lib/session-guard';

const raiz = createRootRoute({ component: Outlet });

/**
 * Guarda de entrada.
 *
 * NÃO é segurança — é conveniência: leva quem não tem credencial para a tela
 * de entrada em vez de mostrar um esqueleto que vai falhar com 401. Quem
 * ignorar isto e chamar a API direto continua recebendo 401 do servidor.
 */
function exigirSessao() {
  const { token, organizationId } = lerSessaoGuardada();
  if (!token) throw redirect({ to: '/entrar' });
  if (!organizationId) throw redirect({ to: '/organizacoes' });
}

const entrar = createRoute({ getParentRoute: () => raiz, path: '/entrar', component: EntrarPage });

const organizacoes = createRoute({
  getParentRoute: () => raiz,
  path: '/organizacoes',
  component: OrganizacoesPage,
  beforeLoad: () => {
    if (!lerSessaoGuardada().token) throw redirect({ to: '/entrar' });
  },
});

function rotaProtegida(path: string, component: () => ReactElement) {
  return createRoute({ getParentRoute: () => raiz, path, component, beforeLoad: exigirSessao });
}

export const routeTree = raiz.addChildren([
  entrar,
  organizacoes,

  rotaProtegida('/', HojePage),

  rotaProtegida('/solicitacoes', SolicitacoesPage),
  // Antes de `/solicitacoes/$id`: 'nova' casaria com o parâmetro, e a
  // conferência de rotas do `npm run openapi` cobre o lado do servidor —
  // aqui a ordem é a mesma regra.
  rotaProtegida('/solicitacoes/nova', NovaSolicitacaoPage),
  createRoute({
    getParentRoute: () => raiz,
    path: '/solicitacoes/$id',
    component: SolicitacaoPage,
    beforeLoad: exigirSessao,
  }),

  rotaProtegida('/ordens', OrdensPage),
  createRoute({
    getParentRoute: () => raiz,
    path: '/ordens/$id',
    component: OrdemPage,
    beforeLoad: exigirSessao,
  }),

  rotaProtegida('/agenda', AgendaPage),

  rotaProtegida('/planos', PlanosPage),
  createRoute({
    getParentRoute: () => raiz,
    path: '/planos/$id',
    component: PlanoPage,
    beforeLoad: exigirSessao,
  }),

  /*
   * As telas ainda não construídas dizem que não foram construídas.
   *
   * A alternativa seria esconder o item do menu até a tela existir — e aí o
   * produto pareceria menor do que é, já que a API já atende todas elas. Uma
   * tela honesta sobre o que falta é melhor do que um 404 e melhor do que um
   * menu que muda de tamanho a cada semana.
   */
  rotaProtegida('/ativos', AtivosPage),
  createRoute({
    getParentRoute: () => raiz,
    path: '/ativos/$id',
    component: AtivoPage,
    beforeLoad: exigirSessao,
  }),
  rotaProtegida('/estoque', EstoquePage),

  rotaProtegida('/documentos', DocumentosPage),
  rotaProtegida('/contratos', ContratosPage),
  createRoute({
    getParentRoute: () => raiz,
    path: '/contratos/$id',
    component: ContratoPage,
    beforeLoad: exigirSessao,
  }),

  rotaProtegida('/orcamentos', OrcamentosPage),
  createRoute({
    getParentRoute: () => raiz,
    path: '/orcamentos/$id',
    component: OrcamentoPage,
    beforeLoad: exigirSessao,
  }),
  rotaProtegida('/indicadores', IndicadoresPage),
  rotaProtegida('/notificacoes', NotificacoesPage),
  rotaProtegida('/perfil', () => (
    <EmConstrucao titulo="Meu perfil" descricao="Dados pessoais, fuso e preferências de aviso." />
  )),

  rotaProtegida('/configuracoes', MembrosPage),
  rotaProtegida('/configuracoes/automacoes', AutomacoesPage),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  // Rolagem restaurada ao voltar: perder o lugar numa lista de mil OS é uma
  // das formas mais rápidas de irritar quem trabalha nela o dia inteiro.
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
