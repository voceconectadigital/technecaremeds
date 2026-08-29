/**
 * Aurora — barra superior: busca, avisos, organização e conta (SPEC §34, §40).
 */
import { useNavigate } from '@tanstack/react-router';
import { Bell, Building2, LogOut, Moon, Search, Sun, User } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, Button, CountBadge, Menu, cn, type MenuItem as MenuItemUi } from '@aurora/ui';
import { meOrganizations } from '@aurora/contracts';
import { useApiQuery, useSession, useSessionQuery, useTheme } from '@aurora/app-kit';
import { GlobalSearch } from './global-search';

export interface TopbarProps {
  onOpenMenu: () => void;
  menuButton: ReactNode;
}

export function Topbar({ menuButton }: TopbarProps) {
  const { data: sessao } = useSessionQuery();
  const sessaoLocal = useSession();
  const navigate = useNavigate();
  const { tema, alternar } = useTheme();
  const [buscaAberta, setBuscaAberta] = useState(false);

  /*
   * Ctrl/Cmd+K abre a busca de qualquer lugar.
   *
   * Ignorado enquanto o foco está num campo de texto: quem está escrevendo a
   * descrição de uma OS e digita "k" não quer que a tela troque.
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

  const { data: organizacoes } = useApiQuery(meOrganizations, undefined, { staleTime: 5 * 60_000 }) as {
    data: { items: { organization_id: string; name: string }[] } | undefined;
  };
  const varias = (organizacoes?.items.length ?? 0) > 1;

  const itensDaConta: (MenuItemUi | 'separator')[] = [
    {
      label: 'Meu perfil',
      icon: <User className="size-4" />,
      onSelect: () => void navigate({ to: '/perfil' }),
    },
    {
      label: tema === 'dark' ? 'Tema claro' : 'Tema escuro',
      icon: tema === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />,
      onSelect: alternar,
    },
  ];

  if (varias) {
    itensDaConta.push('separator', {
      label: 'Trocar de organização',
      icon: <Building2 className="size-4" />,
      // Explícita, nunca implícita por URL (§05): a troca leva a uma tela de
      // escolha, e não acontece como efeito colateral de um link.
      onSelect: () => void navigate({ to: '/organizacoes' }),
    });
  }

  itensDaConta.push('separator', {
    label: 'Sair',
    icon: <LogOut className="size-4" />,
    destructive: true,
    onSelect: () => {
      sessaoLocal.signOut();
      void navigate({ to: '/entrar' });
    },
  });

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:px-4">
      {menuButton}

      {/*
       * A busca é um BOTÃO, e não um campo na barra.
       *
       * Campo na barra ocupa espaço permanente para uma ação ocasional, e no
       * celular empurra tudo. O botão diz o atalho, que é como a pessoa
       * aprende a não usar o mouse.
       */}
      <button
        type="button"
        onClick={() => setBuscaAberta(true)}
        className={cn(
          'flex h-8 flex-1 items-center gap-2 rounded-control border border-border px-2.5 text-left',
          'text-sm text-subtle transition-colors hover:border-border-strong hover:text-muted',
          'md:max-w-md'
        )}
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex-1 truncate">Buscar OS, ativo, solicitação…</span>
        <kbd className="hidden rounded border border-border px-1.5 py-0.5 font-sans text-2xs text-subtle md:inline">
          Ctrl K
        </kbd>
      </button>

      <div className="flex flex-1 items-center justify-end gap-1">
        {varias && (
          <Button
            variant="ghost"
            size="sm"
            className="hidden lg:inline-flex"
            icon={<Building2 className="size-4" />}
            onClick={() => void navigate({ to: '/organizacoes' })}
          >
            {sessao?.organization.name ?? '—'}
          </Button>
        )}

        <NotificationsButton />

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

      <GlobalSearch open={buscaAberta} onOpenChange={setBuscaAberta} />
    </header>
  );
}

/**
 * O sino.
 *
 * O contador é o número de NÃO LIDAS, e o rótulo diz isso por extenso: um "3"
 * solto ao lado de um sino não informa três do quê para quem usa leitor de
 * tela.
 */
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
      className="relative rounded-control p-2 text-muted transition-colors hover:bg-surface-hover hover:text-text"
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
