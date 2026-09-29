/**
 * Aurora — barra lateral (SPEC v0.2 §34, §40).
 *
 * Ciente de permissão: um item só aparece quando leva a algum lugar. Ver §21 e
 * o comentário de `lib/permissions.tsx` — esconder é conveniência, quem nega é
 * o servidor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O REDESENHO DE 29/09/2026, E O QUE ELE CORRIGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A versão anterior era uma coluna branca com oito links cinza. Funcionava e
 * não pertencia a lugar nenhum — podia ser o menu de qualquer sistema interno
 * escrito em qualquer década.
 *
 * Três mudanças, e nenhuma é decorativa:
 *
 *  1. A barra fica SOBRE fundo rebaixado, e não sobre branco. O conteúdo passa
 *     a ser a superfície mais clara da tela, que é onde o olho deve ir. Uma
 *     navegação com o mesmo peso visual do conteúdo compete com ele.
 *
 *  2. O item ativo ganha uma BARRA à esquerda além do fundo. Fundo sozinho, em
 *     tom suave, some em tela ruim e com brilho baixo — que é a condição de
 *     quem usa isto num corredor de hospital.
 *
 *  3. A identidade da organização vira um BLOCO, com marca e nome, em vez de
 *     uma linha de texto. Quem atende quatro hospitais precisa saber em qual
 *     está antes de agir, e "antes de agir" quer dizer sem procurar.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cn, Tooltip } from '@aurora/ui';
import { usePermissions, useSessionQuery, MARCA } from '@aurora/app-kit';
import { MAIN_NAV, SETTINGS_NAV, type NavItem } from './navigation';

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
      className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface-subtle"
    >
      {/* ------------------------------------------------------- identidade */}
      <div className="flex items-center gap-3 px-4 py-4">
        <Marca />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-text" title={sessao?.organization.name}>
            {sessao?.organization.name ?? MARCA.produto}
          </p>
          {/*
           * O rótulo do que a organização mantém ("Equipamento", "Ativo",
           * "Frota") é configurável por organização (ADR-006), e mostrá-lo aqui
           * é de graça: a pessoa vê, sem perguntar, que o sistema fala a
           * língua dela.
           */}
          <p className="truncate text-2xs tracking-label text-subtle uppercase">
            {sessao?.organization.asset_label ?? MARCA.produto}
          </p>
        </div>
        {header}
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
        {visiveis.map((item) => (
          <ItemDeMenu key={item.to} item={item} ativo={ehAtivo(caminho, item.to)} onNavigate={onNavigate} />
        ))}
      </ul>

      {mostrarConfig && (
        <ul className="border-t border-border-subtle px-3 py-3">
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
            'relative flex items-center gap-3 rounded-control py-2.5 pr-3 pl-4 text-base transition-colors',
            ativo
              ? 'bg-surface font-semibold text-accent-text shadow-card'
              : 'font-medium text-muted hover:bg-surface hover:text-text'
          )}
        >
          {/* O terceiro canal do estado ativo: uma barra que existe mesmo em
              tela lavada, onde o fundo suave desaparece. */}
          {ativo && (
            <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-pill bg-accent" />
          )}
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
      className="flex size-9 shrink-0 items-center justify-center rounded-card bg-accent text-on-accent shadow-card"
    >
      {/*
       * O símbolo: um arco nascendo — a aurora. Traço só, sem preenchimento,
       * porque a marca aparece pequena e forma cheia vira borrão nesse tamanho.
       */}
      <svg viewBox="0 0 24 24" fill="none" className="size-5">
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
