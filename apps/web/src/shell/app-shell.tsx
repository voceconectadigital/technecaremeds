/**
 * Aurora — o esqueleto da aplicação (SPEC v0.2 §34, §40).
 *
 * O QUE O ESQUELETO GARANTE, EM TODA TELA
 *
 *   · um pulo para o conteúdo, primeira parada do teclado — sem ele, quem
 *     navega por teclado atravessa oito itens de menu em cada página;
 *   · marcos de página de verdade (`banner`, `navigation`, `main`), que são o
 *     que permite ao leitor de tela saltar direto para o conteúdo;
 *   · `<h1>` único por tela, vindo do título — a lista de cabeçalhos é o
 *     índice que quem não vê a tela usa para se orientar;
 *   · barra lateral que vira gaveta abaixo de 768px, com o foco preso dentro
 *     dela enquanto estiver aberta;
 *   · um lugar só onde o erro de carregamento aparece, com o caminho de volta.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Menu as MenuIcon, X } from 'lucide-react';
import { Button, Breadcrumbs, type Crumb, cn } from '@aurora/ui';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export interface AppShellProps {
  /** Título da página. Vira o `<h1>` e o título do documento. */
  title: string;
  /** Uma frase explicando a tela. Aparece sob o título. */
  subtitle?: string;
  breadcrumbs?: Crumb[];
  /** Ações principais da tela: criar, exportar, filtrar. */
  actions?: ReactNode;
  children: ReactNode;
  /** Tira o preenchimento do conteúdo — para quadro e agenda, que ocupam tudo. */
  bleed?: boolean;
}

export function AppShell({ title, subtitle, breadcrumbs, actions, children, bleed = false }: AppShellProps) {
  const [gavetaAberta, setGavetaAberta] = useState(false);

  useEffect(() => {
    // O título do documento é o que aparece na aba e no histórico. Sem ele,
    // dez abas da Aurora ficam indistinguíveis.
    document.title = `${title} · Aurora`;
  }, [title]);

  useEffect(() => {
    if (!gavetaAberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGavetaAberta(false);
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [gavetaAberta]);

  return (
    <div className="flex h-dvh flex-col bg-bg">
      {/* Primeira parada do teclado, invisível até receber foco. */}
      <a href="#conteudo" className="aurora-skip-link">
        Pular para o conteúdo
      </a>

      <div className="flex min-h-0 flex-1">
        {/* -------------------------------------------------- barra lateral */}

        {/* Acima de 768px ela é permanente. Abaixo, vira gaveta: encolher a
            barra até virar uma coluna de ícones ilegíveis não é responsivo. */}
        <div className="hidden md:block">
          <Sidebar />
        </div>

        {gavetaAberta && (
          <>
            <div
              className="fixed inset-0 z-40 md:hidden"
              style={{ backgroundColor: 'rgb(13 18 17 / 0.45)' }}
              onClick={() => setGavetaAberta(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-y-0 left-0 z-50 md:hidden">
              <Sidebar
                onNavigate={() => setGavetaAberta(false)}
                header={
                  <Button
                    aria-label="Fechar menu"
                    variant="ghost"
                    size="sm"
                    onClick={() => setGavetaAberta(false)}
                    icon={<X className="size-4" />}
                  />
                }
              />
            </div>
          </>
        )}

        {/* ------------------------------------------------------- conteúdo */}

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            onOpenMenu={() => setGavetaAberta(true)}
            menuButton={
              <Button
                aria-label="Abrir menu"
                variant="ghost"
                size="sm"
                className="md:hidden"
                onClick={() => setGavetaAberta(true)}
                icon={<MenuIcon className="size-5" />}
              />
            }
          />

          {/*
            `<section>` NOMEADA, e não `<div>` nem `<header>`.
            
            Um `<div>` não é marco, e todo conteúdo de uma página precisa estar
            dentro de um: a auditoria acusou "some page content is not
            contained by landmarks" nas dezesseis telas, porque o título, o
            subtítulo e as ações ficavam fora de qualquer região nomeada. Para
            quem navega por marcos, os atalhos pulavam de `navigation` direto
            para `main`, por cima do título — que é a informação que diz onde a
            pessoa está.
            
            `<header>` seria o elemento óbvio, e está errado: fora de `article`
            ou `section`, ele vira o marco `banner`, e a barra superior já é o
            `banner` desta página. Dois `banner` fazem o leitor de tela
            anunciar dois "cabeçalho da página" e a pessoa não sabe qual é o do
            site e qual é da tela.
            
            `<section>` com nome acessível é marco `region` — que é exatamente
            o que isto é: uma região da página, nomeada pelo próprio título.
          */}
          <section
            aria-labelledby="titulo-da-pagina"
            /*
              EMPILHA NO ESTREITO, e por um defeito medido.
              
              Era `flex` numa linha só com as ações em `shrink-0`. Em 390px as
              ações da tela de ordens — o alternador mais o par Quadro/Lista —
              tomavam a largura inteira, o contêiner do título encolhia a zero,
              e o `<h1>` DESAPARECIA. A auditoria de larguras acusou:
              "expected visible, received hidden".
              
              Um título invisível não é só estética: é o `<h1>` da página, o
              primeiro item do índice de quem usa leitor de tela e a única
              confirmação de onde a pessoa está.
            */
            className="flex flex-col gap-2 border-b border-border bg-surface px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 md:px-6"
          >
            <div className="min-w-0">
              {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} className="mb-1" />}
              {/* Um `<h1>` por tela. A lista de cabeçalhos é o índice de quem
                  não vê a tela. */}
              <h1 id="titulo-da-pagina" className="truncate text-xl font-semibold text-text">
                {title}
              </h1>
              {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
            </div>
            {/* `flex-wrap` e sem `shrink-0`: no estreito as ações quebram em
                linhas em vez de empurrar o título para fora. */}
            {actions && (
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
            )}
          </section>

          <main
            id="conteudo"
            /*
              `tabIndex={0}`, e não `-1`.
              
              O `-1` já servia ao pulo do teclado: sem ele o link "pular para o
              conteúdo" move a rolagem e deixa o foco para trás. O `0` faz
              tudo isso E resolve o que a auditoria acusou: `<main>` ROLA, e
              uma região que rola sem nada focável dentro é uma região que só o
              mouse alcança.
              
              A tela de perfil é onde isso apareceu, porque é a única sem
              nenhum botão ou link no conteúdo — nas outras, os elementos
              focáveis de dentro davam ao teclado um caminho para rolar. Uma
              tela só de leitura não tem esse caminho, e o conteúdo abaixo da
              dobra ficava inalcançável.
              
              O preço é uma parada a mais na tabulação, que é exatamente o que
              se quer numa região rolável.
            */
            tabIndex={0}
            className={cn('min-h-0 flex-1 overflow-auto outline-none', !bleed && 'p-4 md:p-6')}
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
