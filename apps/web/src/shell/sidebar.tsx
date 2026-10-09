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
      className="relative flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface-subtle/90 backdrop-blur-xl"
    >
      {/* ------------------------------------------------------- identidade */}
      {/*
       * A MARCA E A ORGANIZAÇÃO SÃO DUAS COISAS, e ficam separadas por uma
       * linha de propósito.
       *
       * Antes, o topo mostrava "[HOMOLOGAÇÃO] Prestadora Horizonte" ao lado de
       * um símbolo genérico — e o resultado era que o prefixo do ambiente
       * parecia parte do nome comercial. São informações de naturezas
       * diferentes: uma é de quem é o produto, a outra é de onde a pessoa está
       * trabalhando agora.
       */}
      <div className="flex items-start gap-2 px-4 pt-4 pb-3">
        <Marca />
        {header}
      </div>

      <div className="border-b border-border-subtle px-4 pb-3">
        <NomeDaOrganizacao nome={sessao?.organization.name ?? null} />
        {/*
         * O rótulo do que a organização mantém ("Equipamento", "Ativo",
         * "Frota") é configurável por organização (ADR-006), e mostrá-lo aqui
         * é de graça: a pessoa vê, sem perguntar, que o sistema fala a língua
         * dela.
         */}
        {sessao?.organization.asset_label && (
          <p className="mt-0.5 truncate text-2xs tracking-label text-subtle uppercase">
            {sessao.organization.asset_label}
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pt-3 pb-3">
        {NAV_GRUPOS.map((grupo) => {
          const doGrupo = visiveis.filter((i) => i.grupo === grupo);
          if (doGrupo.length === 0) return null;
          return (
            <div key={grupo}>
              <p className="px-4 pb-1.5 text-2xs font-semibold tracking-[0.14em] text-subtle uppercase">
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
            'group relative flex items-center gap-3 rounded-control py-2 pr-3 pl-4 text-base transition-all duration-200',
            ativo
              ? 'bg-[linear-gradient(90deg,var(--aurora-accent-soft),transparent_85%)] font-semibold text-text shadow-[inset_0_0_0_1px_var(--aurora-border-subtle)]'
              : 'font-medium text-muted hover:bg-surface-hover hover:text-text'
          )}
        >
          {/*
           * O MARCADOR É VERDE E O RESTO É AZUL — é aqui que as duas cores da
           * marca aparecem juntas, na mesma relação em que aparecem na logo.
           *
           * O fundo e o texto usam o azul, que é a cor de AÇÃO e se repete em
           * toda a interface; a barra usa o verde-limão, que é a cor de
           * IDENTIDADE e aparece pouco. Ela é pequena e é FORMA, não texto —
           * exatamente o uso para o qual o verde tem contraste (2,23:1
           * reprovaria como texto, e passa folgado como marcador).
           *
           * E ela continua sendo o terceiro canal do estado ativo: fundo suave
           * desaparece em tela lavada com brilho baixo, que é a condição de
           * quem usa isto num corredor de hospital.
           */}
          {ativo && (
            <span
              aria-hidden="true"
              className="absolute inset-y-1.5 left-0 w-[3px] rounded-pill bg-brand-accent shadow-[0_0_12px_var(--aurora-brand-accent)]"
            />
          )}
          <Icone
            aria-hidden="true"
            className={cn(
              'size-[18px] shrink-0 transition-colors',
              ativo ? 'text-accent-text' : 'text-subtle group-hover:text-accent-text'
            )}
          />
          <span className="truncate">{item.label}</span>
        </Link>
      </Tooltip>
    </li>
  );
}

/**
 * O nome da organização, com o ambiente destacado FORA dele.
 *
 * A massa de homologação prefixa toda organização com "[HOMOLOGAÇÃO]", e isso
 * é correto no banco — é o que impede alguém de confundir a massa de
 * demonstração com dado real. Na tela, porém, o prefixo colado ao nome faz o
 * ambiente parecer parte da razão social do cliente.
 *
 * Aqui ele é separado e vira etiqueta. Quando o prefixo não existir — em
 * produção, ou numa organização real — não sobra nada: a etiqueta só aparece
 * quando há o que etiquetar.
 */
function NomeDaOrganizacao({ nome }: { nome: string | null }) {
  if (!nome) return <p className="truncate text-sm font-semibold text-text">{MARCA.produto}</p>;

  const marcado = /^\[([^\]]+)\]\s*/.exec(nome);
  const ambiente = marcado?.[1] ?? null;
  const limpo = marcado ? nome.slice(marcado[0].length) : nome;

  return (
    <div className="flex flex-col gap-1">
      {ambiente && (
        <span className="w-fit rounded-pill bg-warn-soft px-2 py-0.5 text-2xs font-semibold tracking-label text-warn-text uppercase">
          {ambiente}
        </span>
      )}
      <p className="flex items-center gap-2 truncate text-sm font-semibold text-text" title={limpo}>
        <span className="relative flex size-2 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-40 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-good" />
        </span>
        <span className="truncate">{limpo}</span>
      </p>
      <p className="text-2xs tracking-[0.12em] text-subtle uppercase">Operação ao vivo</p>
    </div>
  );
}

/**
 * A logo da Téchne Care.
 *
 * ARQUIVO REAL, e não um desenho nosso. O símbolo anterior era um arco
 * inventado para o codinome interno; este é o asset que o cliente forneceu,
 * recortado do horizontal (ver `apps/web/public/marca`).
 *
 * A largura é limitada a 168px por uma razão medida: o original tem 272px, e
 * exibi-lo maior que isso o esticaria. Em tela de alta densidade ele é
 * reamostrado em cerca de 1,2× — suave, não serrilhado. **O vetor original
 * continua sendo necessário** para nitidez perfeita, e isso está registrado em
 * `apps/web/public/marca/LEIA-ME.md`.
 */
function Marca() {
  return (
    <Logo
      src={MARCA.logoHorizontal}
      srcEscuro={MARCA.logoHorizontalEscuro}
      nome={MARCA.produto}
      largura={168}
    />
  );
}
