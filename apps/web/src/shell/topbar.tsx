/**
 * Aurora — barra superior (SPEC v0.2 §34, §40).
 *
 * Desde o redesign v2 (09/10/2026) ela mora DENTRO do canvas de conteúdo, no
 * mesmo plano da página: busca à esquerda, tema e notificações à direita. A
 * conta da pessoa desceu para a base da barra lateral (`ContaNaNavegacao`) —
 * no celular, onde a barra lateral é gaveta, o avatar continua aqui.
 */
import { useNavigate } from '@tanstack/react-router';
import { Bell, Building2, Check, ChevronsUpDown, LogOut, Palette, Search, User } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, Button, CountBadge, Menu, cn, type MenuItem as MenuItemUi } from '@aurora/ui';
import { meOrganizations } from '@aurora/contracts';
import { ESTILOS, useApiQuery, useSessionQuery, useTheme, useEncerrarSessao } from '@aurora/app-kit';
import { GlobalSearch } from './global-search';

export interface TopbarProps {
  onOpenMenu: () => void;
  menuButton: ReactNode;
}

/** Os itens do menu da conta — os mesmos na barra lateral e no celular. */
function useItensDaConta(): (MenuItemUi | 'separator')[] {
  const encerrarSessao = useEncerrarSessao();
  const navigate = useNavigate();
  const { data: organizacoes } = useApiQuery(meOrganizations, undefined, { staleTime: 5 * 60_000 }) as {
    data: { items: { organization_id: string; name: string }[] } | undefined;
  };
  const varias = (organizacoes?.items.length ?? 0) > 1;

  const itens: (MenuItemUi | 'separator')[] = [
    {
      label: 'Meu perfil',
      icon: <User className="size-4" />,
      onSelect: () => void navigate({ to: '/perfil' }),
    },
  ];
  if (varias) {
    itens.push('separator', {
      label: 'Trocar de organização',
      icon: <Building2 className="size-4" />,
      // Explícita, nunca implícita por URL (§05): a troca leva a uma tela de
      // escolha, e não acontece como efeito colateral de um link.
      onSelect: () => void navigate({ to: '/organizacoes' }),
    });
  }
  itens.push('separator', {
    label: 'Sair',
    icon: <LogOut className="size-4" />,
    destructive: true,
    // Encerra NO SERVIDOR e depois navega. Ver `encerrar-sessao.ts`: limpar só
    // o armazenamento local deixaria o token válido até expirar.
    onSelect: () => void encerrarSessao().then(() => navigate({ to: '/entrar' })),
  });
  return itens;
}

/**
 * A conta na base da barra lateral: avatar, nome e organização num bloco só,
 * que abre o menu. É o "quem sou eu e onde estou" que a referência de SaaS
 * enterprise põe no rodapé da navegação.
 */
export function ContaNaNavegacao({ organizacao }: { organizacao: string }) {
  const { data: sessao } = useSessionQuery();
  const itens = useItensDaConta();
  const nome = sessao?.user.name || sessao?.user.email || 'Usuário';
  return (
    <Menu
      label="Conta e preferências"
      align="start"
      items={itens}
      trigger={
        <button
          type="button"
          aria-label={`Conta de ${sessao?.user.name ?? 'usuário'}`}
          className="flex w-full items-center gap-3 rounded-[12px] bg-nav-raised px-2.5 py-2 text-left transition-colors hover:bg-nav-hover"
        >
          <Avatar name={nome} size="md" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-semibold text-nav-text-active">{nome}</span>
            <span className="mt-0.5 block truncate text-xs text-nav-label">{organizacao}</span>
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-nav-label" />
        </button>
      }
    />
  );
}

export function Topbar({ menuButton }: TopbarProps) {
  const { data: sessao } = useSessionQuery();
  const { estilo, definir } = useTheme();
  const [buscaAberta, setBuscaAberta] = useState(false);
  const itensDaConta = useItensDaConta();

  /*
   * Ctrl/Cmd+K abre a busca de qualquer lugar. Ignorado enquanto o foco está
   * num campo de texto: quem escreve a descrição de uma OS e digita "k" não
   * quer que a tela troque.
   */
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return;
      const alvo = e.target as HTMLElement | null;
      const editando = alvo?.tagName === 'INPUT' || alvo?.tagName === 'TEXTAREA' || alvo?.isContentEditable;
      if (editando) return;
      e.preventDefault();
      setBuscaAberta(true);
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, []);

  // Tema à vista, e não escondido no perfil: trocar o estilo é parte da
  // apresentação do produto. A escolha fica guardada neste navegador.
  const itensDeTema: MenuItemUi[] = ESTILOS.map((e) => ({
    label: `${e.nome} — ${e.descricao}`,
    icon: e.id === estilo ? <Check className="size-4" /> : <span className="size-4" aria-hidden="true" />,
    onSelect: () => definir(e.id),
  }));

  return (
    <header className="relative z-[var(--aurora-z-sticky)] flex h-16 shrink-0 items-center gap-3 border-b border-border-subtle bg-bg/80 px-3 backdrop-blur-md md:px-8">
      {menuButton}

      {/* A busca é um BOTÃO: campo na barra ocupa espaço permanente para uma
          ação ocasional, e o botão ensina o atalho. */}
      <button
        type="button"
        onClick={() => setBuscaAberta(true)}
        className={cn(
          'flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-control bg-surface px-3.5 text-left shadow-card',
          'text-sm text-subtle transition-shadow hover:text-muted hover:shadow-raised',
          'md:max-w-lg'
        )}
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex-1 truncate">Buscar OS, ativo, solicitação…</span>
        <kbd className="hidden rounded-[6px] bg-surface-sunken px-1.5 py-0.5 font-sans text-2xs font-semibold text-subtle md:inline">
          Ctrl K
        </kbd>
      </button>

      <div className="flex shrink-0 items-center justify-end gap-1 md:flex-1">
        <Menu
          label="Tema visual"
          align="end"
          items={itensDeTema}
          trigger={
            <Button
              variant="ghost"
              size="sm"
              icon={<Palette className="size-4" />}
              aria-label="Trocar tema visual"
            >
              <span className="hidden xl:inline">{ESTILOS.find((e) => e.id === estilo)?.nome}</span>
            </Button>
          }
        />

        <NotificationsButton />

        {/* No celular a barra lateral é gaveta: a conta fica aqui. */}
        <div className="md:hidden">
          <Menu
            label="Conta e preferências"
            align="end"
            items={itensDaConta}
            trigger={
              <button
                type="button"
                aria-label={`Conta de ${sessao?.user.name ?? 'usuário'}`}
                className="rounded-pill transition-opacity hover:opacity-80"
              >
                <Avatar name={sessao?.user.name || sessao?.user.email || '?'} size="md" />
              </button>
            }
          />
        </div>
      </div>

      <GlobalSearch open={buscaAberta} onOpenChange={setBuscaAberta} />
    </header>
  );
}

function NotificationsButton() {
  const navigate = useNavigate();
  // A contagem virá da rota de notificações quando ela tiver contrato; até lá
  // o sino existe e leva à tela, sem inventar um número.
  const naoLidas = 0;

  return (
    <button
      type="button"
      onClick={() => void navigate({ to: '/notificacoes' })}
      aria-label={naoLidas > 0 ? `Notificações: ${naoLidas} não lidas` : 'Notificações: nenhuma não lida'}
      className="relative grid size-9 place-items-center rounded-control text-muted transition-colors hover:bg-surface-sunken hover:text-text"
    >
      <Bell aria-hidden="true" className="size-[18px]" />
      {naoLidas > 0 && (
        <span className="absolute -top-0.5 -right-0.5">
          <CountBadge count={naoLidas} label="notificação não lida" />
        </span>
      )}
    </button>
  );
}
