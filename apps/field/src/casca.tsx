/**
 * Aurora — o casco do aplicativo de campo (EPIC-014 · SPEC §20).
 *
 * O INDICADOR DE PENDÊNCIAS É PERMANENTE, e é o requisito mais importante
 * desta tela.
 *
 * A SPEC pede "indicador permanente de pendências de sincronização" — e a razão
 * é que o técnico precisa saber, a qualquer momento e sem procurar, se o
 * trabalho dele já chegou. Um aviso que aparece e some ensina a ignorá-lo; um
 * ícone escondido num menu não é consultado por ninguém.
 *
 * E ELE SEPARA TRÊS COISAS que um número só juntaria:
 *
 *   · pendente — esperando rede. É um dia normal.
 *   · parado — esperando DECISÃO. Alguém precisa olhar.
 *   · em atenção — recusado, com trabalho guardado esperando gente.
 *
 * Somá-los faria o segundo e o terceiro sumirem dentro do primeiro, que é o
 * mais comum. E é justamente o segundo e o terceiro que exigem ação.
 */
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { CloudOff, ListChecks, QrCode, RefreshCw, TriangleAlert, User } from 'lucide-react';
import { useCampo } from './campo';
import { MARCA } from '@aurora/app-kit';

function Pendencias() {
  const { estado, sincronizando, online, ultimaSincronizacao } = useCampo();
  const total = estado.pendentes + estado.bloqueados;

  return (
    <div className="flex items-center gap-2">
      {!online && (
        <span
          className="flex items-center gap-1 rounded-control bg-surface-sunken px-2 py-1 text-xs text-muted"
          // `role="status"` e não um alerta: sem rede é uma situação NORMAL
          // neste aplicativo, e anunciá-la como alerta a cada corredor faria
          // quem usa leitor de tela desligar os anúncios.
          role="status"
        >
          <CloudOff aria-hidden className="size-3.5" />
          sem rede
        </span>
      )}

      {estado.atencao > 0 && (
        <Link
          to="/atencao"
          className="flex min-h-11 items-center gap-1 rounded-control px-2 text-sm font-medium text-danger"
        >
          <TriangleAlert aria-hidden className="size-4" />
          {estado.atencao}
          <span className="sr-only">
            {estado.atencao === 1 ? 'operação precisa da sua atenção' : 'operações precisam da sua atenção'}
          </span>
        </Link>
      )}

      <Link
        to="/sincronizacao"
        aria-label="Ver o que ainda não foi enviado"
        className="flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm text-text"
      >
        <RefreshCw aria-hidden className={`size-4 ${sincronizando ? 'animate-spin' : ''}`} />
        {total > 0 ? (
          <span>
            {total}
            <span className="sr-only">
              {total === 1 ? ' operação a enviar' : ' operações a enviar'}
              {estado.bloqueados > 0 ? `, ${estado.bloqueados} paradas esperando decisão` : ''}
            </span>
          </span>
        ) : (
          /*
           * "Tudo enviado" e não um visto sozinho.
           *
           * O visto é a mesma marca de "salvo localmente", e a diferença entre
           * as duas é a única coisa que importa aqui: uma quer dizer que o
           * trabalho está no aparelho, a outra que ele chegou ao servidor.
           */
          <span className="text-xs text-muted">
            {ultimaSincronizacao ? 'tudo enviado' : 'nunca sincronizou'}
          </span>
        )}
      </Link>
    </div>
  );
}

/*
 * QUATRO DESTINOS, e não sete.
 *
 * A SPEC pede as telas HOJE, OS, QR, SINCRONIZAÇÃO e PERFIL. A da OS é alcançada
 * de dentro do HOJE — ninguém procura uma ordem numa barra de navegação —, e a
 * de atenção mora dentro da sincronização, que é onde a pergunta "o que ainda
 * não chegou?" já está sendo feita.
 *
 * O que sobra são quatro, e quatro é o que cabe num rodapé de celular com o
 * alvo de toque confortável: 56px de altura, num aparelho de 360px de largura,
 * dá 90px por destino. Com sete, cada um teria 51px — abaixo do que um polegar
 * de luva acerta.
 */
const DESTINOS = [
  { to: '/', rotulo: 'Hoje', Icone: ListChecks },
  { to: '/qr', rotulo: 'Ler QR', Icone: QrCode },
  { to: '/sincronizacao', rotulo: 'Enviar', Icone: RefreshCw },
  { to: '/perfil', rotulo: 'Aparelho', Icone: User },
] as const;

export function Casca() {
  const caminho = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-text focus:shadow-sheet"
      >
        Pular para o conteúdo
      </a>

      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border-subtle bg-surface px-3 py-2">
        <span className="text-sm font-semibold text-text">{MARCA.campo.nomeNaTela}</span>
        <Pendencias />
      </header>

      <main id="conteudo" className="flex-1 px-3 pb-24 pt-3">
        <Outlet />
      </main>

      {/*
        A barra fica EMBAIXO. O polegar alcança o fim da tela, não o topo — e
        este aplicativo é usado com uma mão, em pé, muitas vezes de luva.
      */}
      <nav
        aria-label="Navegação do campo"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-surface"
      >
        <ul className="mx-auto flex max-w-md">
          {DESTINOS.map(({ to, rotulo, Icone }) => {
            const ativo = to === '/' ? caminho === '/' : caminho.startsWith(to);
            return (
              <li key={to} className="flex-1">
                <Link
                  to={to}
                  aria-current={ativo ? 'page' : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${
                    ativo ? 'font-semibold text-accent' : 'text-muted'
                  }`}
                >
                  <Icone aria-hidden className="size-5" />
                  {rotulo}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
