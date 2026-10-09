/**
 * Aurora — o que flutua sobre o conteúdo: diálogo, menu, dica (SPEC §34, §40).
 *
 * POR QUE PRIMITIVAS PRONTAS, E NÃO NOSSAS
 *
 * Diálogo modal correto exige prender o foco, devolvê-lo ao fechar, tratar
 * Escape, marcar o resto da página como inerte e anunciar título e descrição.
 * Menu correto exige navegação por setas, digitação para pular, colisão com a
 * borda da janela e cancelamento por clique fora. Isso é MUITO código, é
 * exatamente onde a acessibilidade quebra em silêncio, e não é onde a Aurora
 * se diferencia. As primitivas do Radix cuidam do comportamento; nós cuidamos
 * da aparência — que é onde a Aurora se diferencia.
 */
import { Dialog as RadixDialog, DropdownMenu as RadixMenu, Tooltip as RadixTooltip } from 'radix-ui';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/* ------------------------------------------------------------------ diálogo */

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /**
   * Uma frase dizendo o que este diálogo faz.
   *
   * Obrigatória: um diálogo sem descrição é anunciado só pelo título, e
   * "Confirmar" sozinho não diz confirmar o quê.
   */
  description: string;
  children: ReactNode;
  /** Rodapé com as ações. A ação principal fica à direita. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Esconde a descrição visualmente, mantendo-a para o leitor de tela. */
  descriptionHidden?: boolean;
}

const LARGURAS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' } as const;

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  descriptionHidden = false,
}: DialogProps) {
  /*
   * DEVOLVER O FOCO A QUEM ABRIU.
   *
   * O Radix devolve o foco ao GATILHO — quando o diálogo é aberto pelo
   * `Dialog.Trigger` dele. Aqui a abertura é controlada por estado, porque o
   * mesmo diálogo é aberto de lugares diferentes: um botão da barra, um item
   * de menu, um atalho de teclado. Nesse arranjo não existe gatilho para o
   * Radix devolver, e o foco cai no `body`.
   *
   * Cair no body é perder o lugar: quem navega por teclado volta para o começo
   * da página e precisa tabular de novo até onde estava. Por isso guardamos
   * quem tinha o foco na abertura e devolvemos no fechamento.
   */
  const anterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      const ativo = document.activeElement;
      anterior.current = ativo instanceof HTMLElement ? ativo : null;
    }
  }, [open]);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-50 bg-neutral-950/40 backdrop-blur-[2px] data-[state=open]:animate-in"
          style={{ backgroundColor: 'rgb(16 24 40 / 0.5)' }}
        />
        <RadixDialog.Content
          onCloseAutoFocus={(e) => {
            const alvo = anterior.current;
            // Só se o elemento ainda existir: um item de menu que já foi
            // desmontado não recebe foco, e insistir joga tudo no body.
            if (alvo && alvo.isConnected) {
              e.preventDefault();
              alvo.focus();
            }
          }}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-sheet border border-border bg-surface shadow-sheet',
            LARGURAS[size]
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
            <div className="min-w-0">
              <RadixDialog.Title className="text-xl font-bold tracking-tight text-text">
                {title}
              </RadixDialog.Title>
              <RadixDialog.Description
                className={cn('mt-1 text-sm text-muted', descriptionHidden && 'aurora-sr-only')}
              >
                {description}
              </RadixDialog.Description>
            </div>
            <RadixDialog.Close
              aria-label="Fechar"
              className="shrink-0 rounded-control p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <X className="size-4" aria-hidden="true" />
            </RadixDialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>

          {footer && (
            <div className="flex items-center justify-end gap-2 rounded-b-sheet border-t border-border-subtle bg-surface-subtle px-6 py-3.5">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/* --------------------------------------------------------------------- menu */

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  /** Ação destrutiva: tom vermelho E a palavra dizendo o que será perdido. */
  destructive?: boolean;
  disabled?: boolean;
  /**
   * Por que está desabilitado.
   *
   * Item cinza sem explicação é a reclamação mais comum de qualquer sistema
   * interno: a pessoa fica tentando clicar e não descobre o que falta.
   */
  disabledReason?: string;
}

export interface MenuProps {
  trigger: ReactNode;
  items: (MenuItem | 'separator')[];
  align?: 'start' | 'end';
  /** Nome acessível do gatilho quando ele é só um ícone. */
  label?: string;
}

export function Menu({ trigger, items, align = 'end', label }: MenuProps) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild aria-label={label}>
        {trigger}
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-52 rounded-card border border-border bg-surface p-1.5 shadow-overlay"
        >
          {items.map((item, i) =>
            item === 'separator' ? (
              <RadixMenu.Separator key={i} className="my-1 h-px bg-border-subtle" />
            ) : (
              <RadixMenu.Item
                key={item.label}
                disabled={item.disabled}
                onSelect={item.onSelect}
                title={item.disabled ? item.disabledReason : undefined}
                className={cn(
                  'flex min-h-9 cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-sm font-medium outline-none',
                  'data-[highlighted]:bg-surface-hover',
                  item.destructive ? 'text-bad-text' : 'text-text',
                  item.disabled && 'cursor-not-allowed opacity-50'
                )}
              >
                {item.icon && (
                  <span aria-hidden="true" className="shrink-0 text-muted">
                    {item.icon}
                  </span>
                )}
                <span className="flex-1">{item.label}</span>
                {item.disabled && item.disabledReason && (
                  <span className="aurora-sr-only">. Indisponível: {item.disabledReason}</span>
                )}
              </RadixMenu.Item>
            )
          )}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

/* ---------------------------------------------------------------- dica */

export interface TooltipProps {
  children: ReactNode;
  content: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * Dica de apoio.
 *
 * NUNCA a única fonte de uma informação: dica não aparece no toque, e o
 * aplicativo de campo é todo toque. Se a informação for necessária, ela vai no
 * texto; a dica só acrescenta.
 */
export function Tooltip({ children, content, side = 'top' }: TooltipProps) {
  return (
    <RadixTooltip.Root delayDuration={400}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-control bg-neutral-900 px-2.5 py-1.5 text-xs text-white shadow-overlay"
          style={{ backgroundColor: 'var(--aurora-neutral-800)', color: 'var(--aurora-neutral-0)' }}
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export const TooltipProvider = RadixTooltip.Provider;
