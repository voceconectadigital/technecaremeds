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
        // A sombra `card` é quase invisível de perto e faz todo o trabalho de
        // longe: é ela que dá ao conjunto a profundidade que uma tela de
        // retângulos de 1px não tem. `raised` continua existindo para o que
        // precisa se destacar DENTRE cartões — e aí a diferença volta a ser
        // perceptível, porque o piso subiu junto.
        'rounded-card border border-border bg-surface shadow-card',
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
  /**
   * O nível do cabeçalho na hierarquia da página.
   *
   * O padrão é 2: a tela tem um `<h1>` (o título, no marco de cabeçalho), e
   * um cartão logo abaixo dele é um `<h2>`. Era `<h3>` fixo, e o salto de 1
   * para 3 é violação de `heading-order` — para quem navega por cabeçalhos,
   * um nível pulado se lê como "há uma seção aqui que eu não estou ouvindo".
   *
   * Passe 3 quando o cartão já estiver DENTRO de uma seção com `<h2>` própria
   * — é o caso do painel de indicadores, que agrupa por Volume, Tempo e
   * Prevenção.
   */
  headingLevel?: 2 | 3 | 4;
}

export function CardHeader({ title, description, actions, className, headingLevel = 2 }: CardHeaderProps) {
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border-subtle px-4 py-3.5',
        className
      )}
    >
      <div className="min-w-0">
        {/* O TAMANHO é do estilo; o NÍVEL é da estrutura. Um cartão parece
            igual em qualquer nível, e é a árvore de cabeçalhos que muda. */}
        <H className="truncate text-lg font-semibold tracking-tight text-text">{title}</H>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
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
  /**
   * De onde os dados desta tela VÊM — a frase que tira a pessoa do impasse
   * "está vazio, e agora?". Ex.: "Uma OS nasce quando a triagem aceita uma
   * solicitação." Aparece destacada, abaixo da descrição.
   */
  origem?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  filtered = false,
  origem,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {icon && (
        <div
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-card border border-border bg-surface-subtle text-muted shadow-card"
        >
          {icon}
        </div>
      )}
      <div className="max-w-sm">
        <p className="text-base font-semibold text-text">{title}</p>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        {filtered && !description && (
          <p className="mt-1 text-sm text-muted">Nenhum registro corresponde aos filtros aplicados.</p>
        )}
        {origem && !filtered && (
          <p className="mt-3 rounded-control border border-border-subtle bg-surface-subtle px-3 py-2 text-left text-xs leading-relaxed text-muted">
            <span className="mr-1 font-semibold tracking-[0.1em] text-accent-text uppercase">
              De onde vem
            </span>
            {origem}
          </p>
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
