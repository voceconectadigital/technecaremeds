/**
 * Aurora — a casca do portal (SPEC v0.2 §19).
 *
 * MÓVEL PRIMEIRO, E LITERALMENTE.
 *
 * A navegação é uma BARRA INFERIOR, e não uma lateral. A SPEC §19 diz o
 * cenário: "a abertura de chamado precisa funcionar em 30 segundos, em pé, no
 * corredor". Em pé, com uma mão, o polegar alcança o rodapé da tela — e não o
 * canto superior esquerdo, que é onde uma barra lateral colocaria o menu.
 *
 * No desktop a mesma barra sobe para o topo: a decisão é sobre alcance do
 * polegar, e num monitor não há polegar.
 *
 * QUATRO DESTINOS, E NÃO NOVE.
 *
 * A SPEC lista nove telas; quatro delas são o trabalho diário (início,
 * chamados, equipamentos, abrir). Documentos, orçamentos, agenda e indicadores
 * são alcançados de dentro do início, onde a pendência que os torna
 * interessantes já aparece. Nove ícones num rodapé de celular dá 43px por
 * ícone — abaixo do que um dedo acerta.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { CirclePlus, FileText, Home, Wrench } from 'lucide-react';
import { cn } from '@aurora/ui';

interface Destino {
  para: string;
  rotulo: string;
  icone: typeof Home;
  /** O botão de abrir chamado ganha cor mesmo inativo: é a ação principal. */
  destaque?: boolean;
}

const DESTINOS: readonly Destino[] = [
  { para: '/', rotulo: 'Início', icone: Home },
  { para: '/chamados', rotulo: 'Chamados', icone: FileText },
  { para: '/abrir', rotulo: 'Abrir', icone: CirclePlus, destaque: true },
  { para: '/equipamentos', rotulo: 'Equipamentos', icone: Wrench },
];

export interface CascaProps {
  titulo: string;
  subtitulo?: string;
  acoes?: ReactNode;
  children: ReactNode;
}

export function Casca({ titulo, subtitulo, acoes, children }: CascaProps) {
  const caminho = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      {/*
        `min-h-dvh` e não `min-h-screen`: no celular, `vh` inclui a barra de
        endereço que aparece e some, e o rodapé fica meio escondido metade do
        tempo.
      */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-text focus:shadow-sheet"
      >
        Pular para o conteúdo
      </a>

      <section
        aria-labelledby="titulo-do-portal"
        className="flex flex-col gap-2 border-b border-border bg-surface px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="min-w-0">
          <h1 id="titulo-do-portal" className="truncate text-xl font-semibold text-text">
            {titulo}
          </h1>
          {subtitulo && <p className="mt-0.5 text-sm text-muted">{subtitulo}</p>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </section>

      <main
        id="conteudo"
        // `tabIndex={0}`: a região rola, e uma região que rola sem nada focável
        // dentro é uma região que só o mouse alcança.
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto p-4 pb-24 outline-none sm:pb-4"
      >
        {children}
      </main>

      {/*
        A BARRA FICA EMBAIXO no celular e em cima no desktop.

        `order` no flex faz isso sem duplicar a marcação — e a ordem do DOM
        continua sendo cabeçalho → conteúdo → navegação, que é a ordem que o
        leitor de tela lê e a que o teclado percorre.
      */}
      <nav
        aria-label="Navegação do portal"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface sm:static sm:order-first sm:border-t-0 sm:border-b"
      >
        {DESTINOS.map((d) => {
          const ativo = d.para === '/' ? caminho === '/' : caminho.startsWith(d.para);
          const Icone = d.icone;
          return (
            <Link
              key={d.para}
              to={d.para}
              aria-current={ativo ? 'page' : undefined}
              className={cn(
                // `min-h-14` no celular: 56px é confortável para o polegar, e
                // bem acima do mínimo de 24 da WCAG 2.2.
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs transition-colors sm:min-h-0 sm:flex-none sm:flex-row sm:gap-2 sm:px-4 sm:py-3 sm:text-sm',
                ativo
                  ? 'text-accent-text sm:bg-accent-soft'
                  : 'text-muted hover:bg-surface-hover hover:text-text'
              )}
            >
              <Icone
                aria-hidden="true"
                className={cn('size-5', d.destaque && !ativo && 'text-accent')}
              />
              {d.rotulo}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
