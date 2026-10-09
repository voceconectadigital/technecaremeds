/**
 * Aurora — barra lateral (SPEC v0.2 §34, §40).
 *
 * Ciente de permissão: um item só aparece quando leva a algum lugar. Ver §21 e
 * o comentário de `lib/permissions.tsx` — esconder é conveniência, quem nega é
 * o servidor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O REDESENHO ENTERPRISE DE 09/10/2026
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A barra era a principal responsável pela aparência de "admin genérico":
 * logo pequena espremida num canto, nome da organização com três linhas de
 * rótulo em caixa alta, item ativo com degradê e brilho.
 *
 *  1. NO ESTILO TÉCHNE ELA É AZUL-MARINHO (papéis `nav-*` em tokens.css). A
 *     moldura escura e o conteúdo claro são o que faz a tela ler como produto.
 *     Nos outros estilos os mesmos papéis apontam para a superfície rebaixada.
 *
 *  2. O ITEM ATIVO tem três canais, sem pílula: fundo translúcido, peso e o
 *     marcador verde da marca à esquerda — o único lugar fixo em que o verde
 *     aparece, e como FORMA (o contraste dele é de forma, não de texto).
 *
 *  3. A ORGANIZAÇÃO desceu para o rodapé, num bloco único com a etiqueta de
 *     ambiente fora do nome. Quem atende quatro hospitais vê onde está sem
 *     disputar espaço com a navegação.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cn, Logo, Tooltip } from '@aurora/ui';
import { usePermissions, useSessionQuery, MARCA } from '@aurora/app-kit';
import { MAIN_NAV, NAV_GRUPOS, SETTINGS_NAV, type NavItem } from './navigation';

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

  return (
    <nav
      aria-label="Navegação principal"
      className="aurora-nav relative flex h-full w-[var(--aurora-nav-width)] shrink-0 flex-col border-r border-nav-border bg-nav"
    >
      {/* ---------------------------------------------------------- marca */}
      <div className="flex items-center gap-2 px-5 pt-5 pb-4">
        <Logo
          src={MARCA.logoHorizontal}
          srcEscuro={MARCA.logoHorizontalEscuro}
          nome={MARCA.produto}
          largura={148}
        />
        {header}
      </div>

      {/* ------------------------------------------------------ navegação */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pt-2 pb-4">
        {NAV_GRUPOS.map((grupo) => {
          const doGrupo = visiveis.filter((i) => i.grupo === grupo);
          if (doGrupo.length === 0) return null;
          return (
            <div key={grupo}>
              <p className="px-3 pb-1.5 text-2xs font-semibold tracking-[0.08em] text-nav-label uppercase">
                {grupo}
              </p>
              <ul className="flex flex-col gap-px">
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
      <div className="flex flex-col gap-2 border-t border-nav-border px-3 pt-3 pb-4">
        {mostrarConfig && (
          <ul>
            <ItemDeMenu
              item={SETTINGS_NAV}
              ativo={ehAtivo(caminho, SETTINGS_NAV.to)}
              onNavigate={onNavigate}
            />
          </ul>
        )}
        <Organizacao
          nome={sessao?.organization.name ?? null}
          rotulo={sessao?.organization.asset_label ?? null}
        />
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
            'group relative flex h-9 items-center gap-3 rounded-control px-3 text-base transition-colors duration-150',
            ativo
              ? 'bg-nav-active font-semibold text-nav-text-active'
              : 'font-medium text-nav-text hover:bg-nav-hover hover:text-nav-text-active'
          )}
        >
          {ativo && (
            <span
              aria-hidden="true"
              className="absolute inset-y-2 -left-3 w-[3px] rounded-r-pill bg-nav-marker"
            />
          )}
          <Icone
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn(
              'size-[18px] shrink-0 transition-colors',
              ativo ? 'text-nav-text-active' : 'text-nav-label group-hover:text-nav-text-active'
            )}
          />
          <span className="truncate">{item.label}</span>
        </Link>
      </Tooltip>
    </li>
  );
}

/**
 * A organização em que a pessoa está, com o ambiente FORA do nome.
 *
 * A massa de homologação prefixa toda organização com "[HOMOLOGAÇÃO]", e isso
 * é correto no banco. Na tela, colado ao nome, faz o ambiente parecer parte da
 * razão social; aqui ele vira etiqueta própria, e em produção não sobra nada.
 *
 * O rótulo do que a organização mantém ("Equipamento", "Frota") é configurável
 * (ADR-006) e aparece como contexto, em frase, e não como mais um rótulo em
 * caixa alta.
 */
function Organizacao({ nome, rotulo }: { nome: string | null; rotulo: string | null }) {
  const marcado = nome ? /^\[([^\]]+)\]\s*/.exec(nome) : null;
  const ambiente = marcado?.[1] ?? null;
  const limpo = nome ? (marcado ? nome.slice(marcado[0].length) : nome) : MARCA.produto;
  const iniciais = limpo
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

  return (
    <div className="flex items-center gap-3 rounded-control px-3 py-2">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-control bg-nav-active text-xs font-bold text-nav-text-active"
      >
        {iniciais || '•'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-nav-text-active" title={limpo}>
          {limpo}
        </p>
        <p className="flex items-center gap-1.5 truncate text-xs text-nav-label">
          <span className="size-1.5 shrink-0 rounded-full bg-good" aria-hidden="true" />
          {rotulo ? `Operação ao vivo · ${rotulo}` : 'Operação ao vivo'}
        </p>
      </div>
      {ambiente && (
        <span className="shrink-0 rounded-[6px] bg-warn-soft px-1.5 py-0.5 text-2xs font-semibold tracking-label text-warn-text uppercase">
          {ambiente}
        </span>
      )}
    </div>
  );
}
