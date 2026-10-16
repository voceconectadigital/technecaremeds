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
import { lazy, Suspense } from 'react';
import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { EntrarPage } from './entrar';
import { OrganizacoesPage } from './organizacoes';
import { HojePage } from './hoje';
import { lerSessaoGuardada } from '@aurora/app-kit';
import { MODO_DEMO } from '../dados/ambiente';
import { EntrarDemoPage } from '../demo/entrar';
import { entrarNaDemonstracao, estaNaDemonstracao } from '../demo/sessao';

/* -------------------------------------------------------------------------- */

/*
 * CADA TELA VIRA UM PEDAÇO PRÓPRIO.
 *
 * O pacote era um arquivo só de 713 kB: abrir a tela de login baixava o painel
 * de indicadores, o quadro Kanban, a árvore do parque e as dezesseis telas que
 * a pessoa talvez nunca abra. Numa conexão de campo — que é onde este produto
 * vai rodar — isso é a diferença entre a tela aparecer e a pessoa desistir.
 *
 * TRÊS TELAS FICAM ANSIOSAS: entrar, escolher organização, e o Hoje. São as
 * três que TODA sessão abre, em sequência, e adiá-las trocaria um download
 * grande por três esperas encadeadas — pior, e não melhor.
 *
 * O ESQUELETO DA ESPERA NÃO É UM GIRADOR NO MEIO DA TELA. É a mesma moldura
 * que a tela terá: cabeçalho e um bloco de conteúdo. Um girador centralizado
 * faz o layout saltar quando o conteúdo chega, e o salto é o que faz a pessoa
 * clicar no lugar errado.
 */
function preguicosa(carregar: () => Promise<{ default: () => ReactElement }>) {
  const Tela = lazy(carregar);
  return function TelaPreguicosa() {
    return (
      <Suspense fallback={<EsqueletoDeTela />}>
        <Tela />
      </Suspense>
    );
  };
}

function EsqueletoDeTela() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4 p-4 md:p-6">
      {/* `aria-busy` é o que os testes de acessibilidade e de largura esperam
          para saber que a tela ainda não terminou — e é o que um leitor de
          tela anuncia como "ocupado" em vez de ler uma página vazia. */}
      <span className="sr-only">Carregando a tela</span>
      <div className="h-8 w-64 animate-pulse rounded-control bg-surface-sunken" />
      <div className="h-64 w-full animate-pulse rounded-card bg-surface-sunken" />
    </div>
  );
}

const ClientesPage = preguicosa(() =>
  import('../features/clientes/lista').then((m) => ({ default: m.ClientesPage }))
);
const SolicitacoesPage = preguicosa(() =>
  import('../features/solicitacoes/lista').then((m) => ({ default: m.SolicitacoesPage }))
);
const SolicitacaoPage = preguicosa(() =>
  import('../features/solicitacoes/ficha').then((m) => ({ default: m.SolicitacaoPage }))
);
const NovaSolicitacaoPage = preguicosa(() =>
  import('../features/solicitacoes/nova').then((m) => ({ default: m.NovaSolicitacaoPage }))
);
const OrdensPage = preguicosa(() =>
  import('../features/ordens/lista').then((m) => ({ default: m.OrdensPage }))
);
const OrdemPage = preguicosa(() =>
  import('../features/ordens/ficha').then((m) => ({ default: m.OrdemPage }))
);
const AgendaPage = preguicosa(() =>
  import('../features/agenda/pagina').then((m) => ({ default: m.AgendaPage }))
);
const MembrosPage = preguicosa(() =>
  import('../features/configuracoes/membros').then((m) => ({ default: m.MembrosPage }))
);
const AtivosPage = preguicosa(() =>
  import('../features/ativos/lista').then((m) => ({ default: m.AtivosPage }))
);
const AtivoPage = preguicosa(() =>
  import('../features/ativos/ficha').then((m) => ({ default: m.AtivoPage }))
);
const EstoquePage = preguicosa(() =>
  import('../features/estoque/lista').then((m) => ({ default: m.EstoquePage }))
);
const OrcamentosPage = preguicosa(() =>
  import('../features/comercial/orcamentos').then((m) => ({ default: m.OrcamentosPage }))
);
const OrcamentoPage = preguicosa(() =>
  import('../features/comercial/orcamento').then((m) => ({ default: m.OrcamentoPage }))
);
const ContratosPage = preguicosa(() =>
  import('../features/comercial/contratos').then((m) => ({ default: m.ContratosPage }))
);
const ContratoPage = preguicosa(() =>
  import('../features/comercial/contratos').then((m) => ({ default: m.ContratoPage }))
);
const PlanosPage = preguicosa(() =>
  import('../features/planos/modulo').then((m) => ({ default: m.PlanosModuloPage }))
);
const PlanoPage = preguicosa(() =>
  import('../features/planos/lista').then((m) => ({ default: m.PlanoPage }))
);
const IndicadoresPage = preguicosa(() =>
  import('../features/indicadores/painel').then((m) => ({ default: m.IndicadoresPage }))
);
const PainelPage = preguicosa(() =>
  import('../features/painel/painel').then((m) => ({ default: m.PainelPage }))
);
const ModoExibicaoPage = preguicosa(() =>
  import('../features/painel/tv').then((m) => ({ default: m.ModoExibicaoPage }))
);
const ClientePage = preguicosa(() =>
  import('../features/clientes/ficha').then((m) => ({ default: m.ClientePage }))
);
const NotificacoesPage = preguicosa(() =>
  import('../features/notificacoes/caixa').then((m) => ({ default: m.NotificacoesPage }))
);
const DocumentosPage = preguicosa(() =>
  import('../features/documentos/lista').then((m) => ({ default: m.DocumentosPage }))
);
const PerfilPage = preguicosa(() =>
  import('../features/perfil/pagina').then((m) => ({ default: m.PerfilPage }))
);
const AutomacoesPage = preguicosa(() =>
  import('../features/automacoes/lista').then((m) => ({ default: m.AutomacoesPage }))
);

const raiz = createRootRoute({ component: Outlet });

/**
 * Guarda de entrada.
 *
 * NÃO é segurança — é conveniência: leva quem não tem credencial para a tela
 * de entrada em vez de mostrar um esqueleto que vai falhar com 401. Quem
 * ignorar isto e chamar a API direto continua recebendo 401 do servidor.
 */
function exigirSessao({ location }: { location: { pathname: string } }) {
  /*
   * Na demonstração, um link direto para uma tela interna ABRE a tela: é o
   * link que se manda ao cliente ("veja a agenda"), e passar por uma tela de
   * entrada sem conta não protegeria nada. Só a raiz, sem passagem anterior,
   * mostra a entrada — que é onde a demonstração se apresenta como tal.
   */
  if (MODO_DEMO && !estaNaDemonstracao()) {
    if (location.pathname === '/') throw redirect({ to: '/entrar' });
    entrarNaDemonstracao();
    return;
  }
  const { token, organizationId } = lerSessaoGuardada();
  if (!token) throw redirect({ to: '/entrar' });
  if (!organizationId) throw redirect({ to: '/organizacoes' });
}

// A demonstração troca o formulário de senha por um botão: não há conta para
// conferir, e um campo de senha que aceita qualquer coisa ensinaria o contrário.
const entrar = createRoute({
  getParentRoute: () => raiz,
  path: '/entrar',
  component: MODO_DEMO ? EntrarDemoPage : EntrarPage,
});

/*
 * `/login` existe como APELIDO de `/entrar`.
 *
 * A aplicação fala português e a rota canônica é `/entrar`. Mas `/login` é o
 * endereço que todo mundo digita e o que aparece em qualquer instrução escrita
 * às pressas — deixá-lo dar 404 faria a pessoa concluir que o sistema está fora
 * do ar. Redireciona, e não duplica a tela: duas rotas com a mesma tela seriam
 * duas telas na primeira vez que alguém mexesse numa delas.
 */
const login = createRoute({
  getParentRoute: () => raiz,
  path: '/login',
  beforeLoad: () => {
    throw redirect({ to: '/entrar' });
  },
  component: EntrarPage,
});

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
  login,
  organizacoes,

  rotaProtegida('/', HojePage),

  rotaProtegida('/clientes', ClientesPage),
  createRoute({
    getParentRoute: () => raiz,
    path: '/clientes/$id',
    component: ClientePage,
    beforeLoad: exigirSessao,
  }),

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
  rotaProtegida('/painel', PainelPage),
  // Fora da moldura (sem barra lateral): é a tela da televisão.
  rotaProtegida('/painel/tv', ModoExibicaoPage),
  rotaProtegida('/notificacoes', NotificacoesPage),
  rotaProtegida('/perfil', PerfilPage),

  rotaProtegida('/usuarios', MembrosPage),
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
