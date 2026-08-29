/**
 * Aurora — superfícies e estados de conteúdo (SPEC v0.2 §34, §35).
 *
 * Três coisas que toda tela precisa e que quase nunca são desenhadas com
 * cuidado: o cartão, o vazio e a espera.
 *
 * O VAZIO É UMA TELA, NÃO UM ACIDENTE. "Nenhum resultado" sem mais nada deixa
 * a pessoa sem saber se o filtro está errado, se a permissão falta ou se o
 * sistema quebrou. Aqui o vazio diz o que houve, por quê, e o que fazer agora.
 *
 * A ESPERA TEM A FORMA DO CONTEÚDO. O esqueleto ocupa o mesmo espaço que a
 * lista vai ocupar, então a página não pula quando os dados chegam — e quem
 * está lendo não perde a linha.
 */
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Cartão que se destaca do fundo. Use para o que flutua, não para tudo. */
  raised?: boolean;
  as?: 'div' | 'section' | 'article' | 'li';
}

export function Card({ children, className, raised = false, as: Tag = 'div' }: CardProps) {
  return (
    <Tag
      className={cn(
        'rounded-card border border-border bg-surface',
        // A separação normal é a BORDA. Sombra fica para o que flutua de
        // verdade — interface densa se afoga em sombra.
        raised && 'shadow-raised',
        className
      )}
    >
      {children}
    </Tag>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Ações do cabeçalho — botões, menu. */
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({ title, description, actions, className }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border-subtle px-4 py-3',
        className
      )}
    >
      <div className="min-w-0">
        <h3 className="truncate text-md font-semibold text-text">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  /** O que aconteceu, na linguagem de quem lê. */
  title: string;
  /** Por que aconteceu, e o que muda o resultado. */
  description?: string;
  icon?: ReactNode;
  /** O caminho de saída: criar, limpar filtro, pedir permissão. */
  action?: ReactNode;
  className?: string;
  /**
   * Vazio que é RESULTADO DE FILTRO, e não ausência de dado.
   *
   * A diferença importa: "você ainda não tem ordens de serviço" e "nenhuma OS
   * corresponde a estes filtros" pedem ações opostas, e confundir as duas faz
   * a pessoa criar registro duplicado.
   */
  filtered?: boolean;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  filtered = false,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {icon && (
        <div
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-card bg-surface-sunken text-subtle"
        >
          {icon}
        </div>
      )}
      <div className="max-w-sm">
        <p className="text-md font-medium text-text">{title}</p>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        {filtered && !description && (
          <p className="mt-1 text-sm text-muted">Nenhum registro corresponde aos filtros aplicados.</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export interface SkeletonProps {
  className?: string;
}

/**
 * Bloco de espera.
 *
 * `aria-hidden` de propósito: quem usa leitor de tela não deve ouvir "caixa
 * cinza, caixa cinza, caixa cinza". Quem anuncia a espera é a região viva ao
 * redor, uma vez.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={cn('animate-pulse rounded-control bg-surface-sunken', className)} />
  );
}

export interface SkeletonListProps {
  rows?: number;
  className?: string;
  /** O que está carregando, para o anúncio. Ex.: "ordens de serviço". */
  label: string;
}

export function SkeletonList({ rows = 5, className, label }: SkeletonListProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Um anúncio, educado, em vez de um por linha. */}
      <span role="status" className="aurora-sr-only">
        Carregando {label}…
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
