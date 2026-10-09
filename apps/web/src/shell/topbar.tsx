/**
 * Aurora — barra superior: busca, avisos, organização e conta (SPEC §34, §40).
 */
import { useNavigate } from '@tanstack/react-router';
import { Bell, Building2, Check, LogOut, Palette, Search, User } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, Button, CountBadge, Menu, cn, type MenuItem as MenuItemUi } from '@aurora/ui';
import { meOrganizations } from '@aurora/contracts';
import { ESTILOS, useApiQuery, useSessionQuery, useTheme, useEncerrarSessao } from '@aurora/app-kit';
import { GlobalSearch } from './global-search';

export interface TopbarProps {
  onOpenMenu: () => void;
  menuButton: ReactNode;
}

export function Topbar({ menuButton }: TopbarProps) {
  const { data: sessao } = useSessionQuery();
  const encerrarSessao = useEncerrarSessao();
  const navigate = useNavigate();
  const { estilo, definir } = useTheme();
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
  ];

  /*
   * Tema à vista, e não escondido no perfil: trocar o estilo é parte da
   * apresentação do produto. A escolha fica guardada neste navegador.
   */
  const itensDeTema: MenuItemUi[] = ESTILOS.map((e) => ({
    label: `${e.nome} — ${e.descricao}`,
    icon: e.id === estilo ? <Check className="size-4" /> : <span className="size-4" aria-hidden="true" />,
    onSelect: () => definir(e.id),
  }));

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
      // Encerra NO SERVIDOR e depois navega. Ver `encerrar-sessao.ts`:
      // limpar só o armazenamento local deixaria o token válido até expirar.
      void encerrarSessao().then(() => navigate({ to: '/entrar' }));
    },
  });

  return (
    <header className="relative z-[var(--aurora-z-sticky)] flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 md:px-6">
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
          'flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-control border border-border bg-surface-subtle px-3 text-left',
          'text-sm text-subtle transition-colors hover:border-border-strong hover:bg-surface hover:text-muted',
          'md:max-w-md'
        )}
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex-1 truncate">Buscar OS, ativo, solicitação…</span>
        <kbd className="hidden rounded-[5px] border border-border bg-surface px-1.5 py-0.5 font-sans text-2xs font-medium text-subtle md:inline">
          Ctrl K
        </kbd>
      </button>

      <div className="flex shrink-0 items-center justify-end gap-1 md:flex-1">
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

        <Menu
          label="Conta e preferências"
          align="end"
          items={itensDaConta}
          trigger={
            <button
              type="button"
              aria-label={`Conta de ${sessao?.user.name ?? 'usuário'}`}
              className="flex items-center gap-2.5 rounded-control py-1 pr-2 pl-1 transition-colors hover:bg-surface-hover md:ml-1 md:border-l md:border-border md:pl-3"
            >
              <Avatar name={sessao?.user.name || sessao?.user.email || '?'} size="md" />
              {/* O nome à vista a partir de 1280px: quem divide o computador
                  da sala técnica confere de quem é a sessão sem abrir menu. */}
              {sessao?.user.name && (
                <span className="hidden max-w-40 truncate text-sm font-semibold text-text xl:inline">
                  {sessao.user.name}
                </span>
              )}
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
      className="relative grid size-9 place-items-center rounded-control text-muted transition-colors hover:bg-surface-hover hover:text-text"
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
