/**
 * Aurora — botão (SPEC v0.2 §34, §40).
 *
 * TRÊS DECISÕES QUE NÃO SÃO ÓBVIAS
 *
 * 1. `type="button"` por padrão. O padrão do HTML é `submit`, e um botão
 *    "Cancelar" dentro de um formulário envia o formulário. É o bug mais
 *    comum de formulário em React, e ele custa dados do usuário.
 *
 * 2. Carregando não vira `disabled`. Um botão desabilitado some da ordem de
 *    tabulação e o leitor de tela deixa de anunciá-lo — a pessoa que apertou
 *    "Salvar" perde o foco e não descobre o que aconteceu. Aqui ele fica
 *    focável, com `aria-busy`, e o clique é ignorado.
 *
 * 3. Ícone sozinho EXIGE rótulo. Um botão com só um desenho dentro é um botão
 *    mudo para quem usa leitor de tela. O tipo obriga `aria-label`; esquecer
 *    é erro de compilação, não descoberta em auditoria.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'brand' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTES: Record<ButtonVariant, string> = {
  /*
   * PRIMÁRIO É O AZUL DA MARCA, e ele chega aqui por `bg-accent` — não por um
   * hex escrito nesta linha. Trocar a marca reaponta um token e este arquivo
   * não muda.
   */
  primary: 'bg-accent text-on-accent hover:bg-accent-hover active:brightness-95 border border-transparent',
  secondary:
    'bg-surface text-text border border-border-strong hover:border-accent hover:bg-accent-soft hover:text-accent-text active:bg-surface-active',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-surface-hover hover:text-text',
  /*
   * ACENTO DE MARCA — o verde-limão, e SÓ onde a ação é da identidade e não da
   * operação: um convite de marca, um destaque institucional pontual.
   *
   * O TEXTO É GRAFITE, e não branco. O verde tem luminância alta demais:
   * branco sobre ele dá 2,3:1, que é ilegível. Grafite sobre o verde dá mais
   * de 7:1. É a mesma razão por que o verde puro não escreve — aqui ele é
   * fundo, e quem escreve é a tinta escura.
   */
  brand:
    'bg-brand-accent text-[var(--aurora-neutral-900)] border border-transparent hover:bg-brand-accent-hover active:brightness-95',
  // Vermelho só onde a ação é destrutiva de verdade. Um botão vermelho em
  // "Salvar" ensina a pessoa a ignorar vermelho.
  danger: 'bg-bad text-white border border-transparent hover:brightness-110 active:brightness-95',
  link: 'bg-transparent text-accent-text border border-transparent underline underline-offset-2 hover:text-accent p-0 h-auto',
};

const TAMANHOS: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-[34px] px-3.5 text-base gap-2',
  // No toque, 44px — o mínimo da WCAG 2.2 (2.5.8). O técnico está de luva.
  lg: 'h-11 px-5 text-md gap-2',
};

interface Base extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Mostra o giro e ignora o clique, sem tirar o botão da tabulação. */
  loading?: boolean;
  /** Desenho à esquerda do rótulo. Decorativo: o rótulo é que informa. */
  icon?: ReactNode;
  /** Desenho à direita — seta de menu, indicador de externo. */
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
}

/** Com texto: o texto é o nome acessível. */
interface ComRotulo extends Base {
  children: ReactNode;
  'aria-label'?: string;
}

/** Sem texto: `aria-label` passa a ser obrigatório. */
interface SemRotulo extends Base {
  children?: undefined;
  'aria-label': string;
}

export type ButtonProps = ComRotulo | SemRotulo;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    trailingIcon,
    fullWidth = false,
    className,
    children,
    disabled,
    onClick,
    type = 'button',
    ...rest
  },
  ref
) {
  const soIcone = children === undefined;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={(e) => {
        // Ignorar em vez de desabilitar: o botão continua focável e anunciado.
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cn(
        'inline-flex items-center justify-center rounded-control font-medium whitespace-nowrap',
        'transition-colors duration-[130ms] ease-out',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTES[variant],
        variant !== 'link' && TAMANHOS[size],
        soIcone &&
          variant !== 'link' &&
          (size === 'sm' ? 'w-7 px-0' : size === 'lg' ? 'w-11 px-0' : 'w-[34px] px-0'),
        fullWidth && 'w-full',
        className
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size={size === 'lg' ? 'md' : 'sm'} />
      ) : (
        icon && (
          <span aria-hidden="true" className="shrink-0">
            {icon}
          </span>
        )
      )}
      {children}
      {trailingIcon && !loading && (
        <span aria-hidden="true" className="shrink-0">
          {trailingIcon}
        </span>
      )}
    </button>
  );
});
