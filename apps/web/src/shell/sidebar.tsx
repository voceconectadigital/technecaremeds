/**
 * Aurora — barra lateral (SPEC v0.2 §34, §40).
 *
 * Ciente de permissão: um item só aparece quando leva a algum lugar. Ver §21 e
 * o comentário de `lib/permissions.tsx` — esconder é conveniência, quem nega é
 * o servidor.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cn, Tooltip } from '@aurora/ui';
import { usePermissions } from '../lib/permissions';
import { MAIN_NAV, SETTINGS_NAV, type NavItem } from './navigation';
import { useSessionQuery } from '../lib/use-session-query';

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
      className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface"
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Marca />
        <div className="min-w-0 flex-1">
          {/* O nome da organização fica AQUI, e não escondido num menu: quem
              atende duas empresas precisa saber em qual está antes de agir. */}
          <p className="truncate text-sm font-semibold text-text">{sessao?.organization.name ?? 'Aurora'}</p>
        </div>
        {header}
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {visiveis.map((item) => (
          <ItemDeMenu key={item.to} item={item} ativo={ehAtivo(caminho, item.to)} onNavigate={onNavigate} />
        ))}
      </ul>

      {mostrarConfig && (
        <ul className="border-t border-border-subtle p-2">
          <ItemDeMenu item={SETTINGS_NAV} ativo={ehAtivo(caminho, SETTINGS_NAV.to)} onNavigate={onNavigate} />
        </ul>
      )}
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
            'flex items-center gap-3 rounded-control px-3 py-2 text-base font-medium transition-colors',
            ativo ? 'bg-accent-soft text-accent-text' : 'text-muted hover:bg-surface-hover hover:text-text'
          )}
        >
          <Icone aria-hidden="true" className="size-[18px] shrink-0" />
          <span className="truncate">{item.label}</span>
        </Link>
      </Tooltip>
    </li>
  );
}

function Marca() {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-control bg-accent text-on-accent"
    >
      {/*
       * O símbolo: um arco nascendo — a aurora. Traço só, sem preenchimento,
       * porque a marca aparece em 28px e forma cheia vira borrão nesse tamanho.
       */}
      <svg viewBox="0 0 24 24" fill="none" className="size-4">
        <path d="M3 18a9 9 0 0 1 18 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path
          d="M7.5 18a4.5 4.5 0 0 1 9 0"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity="0.55"
        />
      </svg>
    </span>
  );
}
