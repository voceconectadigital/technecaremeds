/**
 * Aurora — barra lateral (SPEC v0.2 §34, §40).
 *
 * Ciente de permissão: um item só aparece quando leva a algum lugar. Ver §21 e
 * o comentário de `lib/permissions.tsx` — esconder é conveniência, quem nega é
 * o servidor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REDESIGN v2 (09/10/2026)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A barra deixou de ser uma coluna com borda ao lado do conteúdo: ela É a
 * moldura da aplicação (papéis `nav-*`; azul-marinho no estilo Téchne), e o
 * conteúdo flutua dentro dela num canvas claro de cantos arredondados
 * (`app-shell.tsx`). O item ativo vira uma superfície clara sobre o marinho —
 * evidente sem pílula colorida —, os grupos têm rótulo discreto e respiro, e
 * a base resolve "quem sou eu, onde estou" num bloco de conta com menu.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cn, Logo, Tooltip } from '@aurora/ui';
import { usePermissions, useSessionQuery, MARCA } from '@aurora/app-kit';
import { MAIN_NAV, NAV_GRUPOS, SETTINGS_NAV, type NavItem } from './navigation';
import { ContaNaNavegacao } from './topbar';

export interface SidebarProps {
  /** Chamado ao navegar — a gaveta do celular se fecha sozinha. */
  onNavigate?: () => void;
  /** Botão de fechar, só na gaveta. */
  header?: ReactNode;
}

export function Sidebar({ onNavigate, header }: SidebarProps) {
  const { data: sessao } = useSessionQuery();
  const { canAny } = usePermissions();
  const caminho = useRouterState({ select: (s) => s.location.pathname });

  const visiveis = MAIN_NAV.filter((i) => i.permissions.length === 0 || canAny(...i.permissions));
  const mostrarConfig = canAny(...SETTINGS_NAV.permissions);

  // O prefixo de ambiente da massa de homologação ("[HOMOLOGAÇÃO] …") vira
  // etiqueta, e não parte da razão social.
  const nomeOrg = sessao?.organization.name ?? MARCA.produto;
  const marcado = /^\[([^\]]+)\]\s*/.exec(nomeOrg);
  const ambiente = marcado?.[1] ?? null;
  const organizacao = marcado ? nomeOrg.slice(marcado[0].length) : nomeOrg;

  return (
    <nav
      aria-label="Navegação principal"
      className="aurora-nav relative flex h-full w-[var(--aurora-nav-width)] shrink-0 flex-col bg-nav"
    >
      {/* ---------------------------------------------------------- marca */}
      <div className="flex items-center gap-2 px-6 pt-6 pb-6">
        <Logo
          src={MARCA.logoHorizontal}
          srcEscuro={MARCA.logoHorizontalEscuro}
          nome={MARCA.produto}
          largura={140}
        />
        {header}
      </div>

      {/* ------------------------------------------------------ navegação */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
        {NAV_GRUPOS.map((grupo) => {
          const doGrupo = visiveis.filter((i) => i.grupo === grupo);
          if (doGrupo.length === 0) return null;
          return (
            <div key={grupo}>
              <p className="px-3 pb-2 text-[11px] font-semibold tracking-[0.1em] text-nav-label uppercase">
                {grupo}
              </p>
              <ul className="flex flex-col gap-0.5">
                {doGrupo.map((item) => (
                  <ItemDeMenu
                    key={item.to}
                    item={item}
                    ativo={ehAtivo(caminho, item.to) || (item.tambem ?? []).some((t) => ehAtivo(caminho, t))}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* --------------------------------------------------------- rodapé */}
      <div className="flex flex-col gap-3 px-4 pt-2 pb-5">
        {mostrarConfig && (
          <ul>
            <ItemDeMenu
              item={SETTINGS_NAV}
              ativo={ehAtivo(caminho, SETTINGS_NAV.to)}
              onNavigate={onNavigate}
            />
          </ul>
        )}
        {ambiente && (
          <span className="mx-3 w-fit rounded-[6px] bg-warn-soft px-1.5 py-0.5 text-2xs font-semibold tracking-label text-warn-text uppercase">
            {ambiente}
          </span>
        )}
        <ContaNaNavegacao organizacao={organizacao} />
      </div>
    </nav>
  );
}

/**
 * "Ativo" é prefixo, não igualdade — exceto na raiz.
 *
 * Dentro de `/ordens/1042` o item "Ordens de serviço" continua marcado; sem
 * isso, entrar numa ficha faz o menu inteiro apagar e a pessoa perde a
 * referência de onde está.
 */
function ehAtivo(caminho: string, destino: string): boolean {
  if (destino === '/') return caminho === '/';
  return caminho === destino || caminho.startsWith(destino + '/');
}

function ItemDeMenu({ item, ativo, onNavigate }: { item: NavItem; ativo: boolean; onNavigate?: () => void }) {
  const Icone = item.icon;
  return (
    <li>
      <Tooltip content={item.hint} side="right">
        <Link
          to={item.to}
          onClick={onNavigate}
          // Marca a página atual para o leitor de tela. O destaque visual
          // sozinho não chega a quem não vê a tela.
          aria-current={ativo ? 'page' : undefined}
          className={cn(
            'group relative flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14px] transition-colors duration-150',
            ativo
              ? 'bg-nav-active font-semibold text-nav-active-text shadow-[0_1px_2px_rgb(0_0_0/0.18)]'
              : 'font-medium text-nav-text hover:bg-nav-hover hover:text-nav-text-active'
          )}
        >
          <Icone
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn(
              'size-[18px] shrink-0 transition-colors',
              ativo ? 'text-nav-active-icon' : 'text-nav-label group-hover:text-nav-text-active'
            )}
          />
          <span className="truncate">{item.label}</span>
          {/* O verde da marca, como forma: um ponto no item em que a pessoa está. */}
          {ativo && (
            <span aria-hidden="true" className="ml-auto size-1.5 shrink-0 rounded-full bg-nav-marker" />
          )}
        </Link>
      </Tooltip>
    </li>
  );
}
