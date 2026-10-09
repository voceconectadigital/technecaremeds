/**
 * Aurora — as peças de composição de página (SPEC v0.2 §34, §40).
 *
 * O que estava faltando não eram componentes novos de conteúdo: era a
 * GRAMÁTICA que os arruma na tela. Sem ela, cada tela inventa o próprio
 * espaçamento entre blocos, a própria barra de filtros e o próprio jeito de
 * separar seções — e o produto parece montado por pessoas diferentes, que é
 * exatamente a impressão que se quer evitar.
 */
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/* -------------------------------------------------------------------------- */

export interface SectionProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Ações à direita do título: filtro, "ver tudo", menu. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}

/**
 * Uma seção da página, com título que pesa.
 *
 * O título de seção é `text-xl` (24px) — quase o dobro do corpo. É o que
 * permite varrer uma página longa saltando de bloco em bloco sem ler. Quando
 * título e corpo têm tamanhos vizinhos, a página vira um muro de texto
 * uniforme e a pessoa lê tudo ou nada.
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  headingLevel = 2,
}: SectionProps) {
  const H = `h${headingLevel}` as 'h2' | 'h3';
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {(title || actions) && (
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {title && <H className="truncate text-xl font-bold tracking-display text-text">{title}</H>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export interface ToolbarProps {
  /** Busca, normalmente. Ocupa o espaço que sobra. */
  search?: ReactNode;
  /** Chips de filtro, seletores. */
  filters?: ReactNode;
  /** Botões de ação à direita. */
  actions?: ReactNode;
  /** Dentro de um painel (Card): sem moldura própria, com divisória embaixo. */
  embedded?: boolean;
  className?: string;
}

/**
 * A barra de ferramentas de uma lista.
 *
 * Um lugar só para busca, filtro e ação — e sempre na mesma ordem, porque a
 * memória muscular de quem usa oito horas por dia vale mais que a variação.
 *
 * Ela é uma SUPERFÍCIE, e não um punhado de controles soltos sobre o fundo:
 * agrupar visualmente é o que faz a pessoa entender que aqueles controles
 * governam a lista logo abaixo, e não a página inteira.
 */
export function Toolbar({ search, filters, actions, embedded = false, className }: ToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 lg:flex-row lg:items-center',
        embedded
          ? 'border-b border-border-subtle px-3 py-2.5'
          : 'rounded-card border border-card-border bg-surface p-2.5 shadow-card',
        className
      )}
    >
      {search && <div className="min-w-0 lg:max-w-sm lg:flex-1">{search}</div>}
      {filters && <div className="flex min-w-0 flex-wrap items-center gap-2">{filters}</div>}
      {actions && <div className="flex shrink-0 items-center gap-2 lg:ml-auto">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export interface FilterChipProps {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  /** Contagem à direita do rótulo. `undefined` não desenha nada. */
  count?: number;
  /**
   * Segmento de um grupo exclusivo (período, vista): sem borda própria, dentro
   * de um `SegmentGroup`. O ativo vira a "tecla levantada" — superfície,
   * sombra de contato e peso —, que é como o olho reconhece seleção única.
   */
  segment?: boolean;
  className?: string;
}

/**
 * Filtro como chip, e o estado ativo NÃO é só a cor.
 *
 * O chip ativo muda de fundo, de peso e ganha borda de destaque. Três canais,
 * pela mesma razão de sempre: filtro aplicado que a pessoa não percebe produz
 * o chamado "o sistema perdeu meus registros".
 */
export function FilterChip({
  active = false,
  onClick,
  children,
  count,
  segment = false,
  className,
}: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded-control border px-3 text-sm transition-colors',
        segment
          ? active
            ? 'border-border bg-surface font-semibold text-text shadow-card'
            : 'border-transparent font-medium text-muted hover:text-text'
          : active
            ? 'border-accent/50 bg-accent-soft font-semibold text-accent-text'
            : 'border-border bg-surface font-medium text-muted hover:border-border-strong hover:text-text',
        className
      )}
    >
      {children}
      {count !== undefined && (
        <span
          data-numeric
          className={cn(
            'rounded-pill px-1.5 text-2xs font-semibold tabular-nums',
            active ? 'bg-accent text-on-accent' : 'bg-surface-sunken text-muted'
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** O trilho de um grupo de segmentos — período, vista, modo. */
export function SegmentGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-[10px] border border-border-subtle bg-surface-sunken p-0.5',
        className
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export interface StatStripItem {
  label: string;
  value: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
  hint?: string;
}

export interface StatStripProps {
  items: StatStripItem[];
  className?: string;
}

const TOM_DO_VALOR = {
  neutral: 'text-text',
  good: 'text-good-text',
  warn: 'text-warn-text',
  bad: 'text-bad-text',
  accent: 'text-accent-text',
} as const;

/**
 * A faixa de números do topo de uma lista.
 *
 * É a versão compacta do `Metric`: quando a tela já é sobre um assunto, seis
 * cartões grandes repetindo esse assunto roubam a tela do conteúdo. A faixa
 * dá os mesmos números numa linha, e o conteúdo começa logo abaixo.
 */
export function StatStrip({ items, className }: StatStripProps) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 divide-border-subtle overflow-hidden rounded-card border border-card-border bg-surface shadow-card sm:grid-cols-4 sm:divide-x',
        className
      )}
    >
      {items.map((s) => (
        <div key={s.label} className="flex flex-col gap-0.5 px-4 py-3" title={s.hint}>
          <dt className="truncate text-xs font-medium text-muted">{s.label}</dt>
          <dd
            data-numeric
            className={cn(
              'text-2xl font-bold tabular-nums tracking-display',
              TOM_DO_VALOR[s.tone ?? 'neutral']
            )}
          >
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */

export interface FieldPairProps {
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * Rótulo em cima, valor embaixo — o par que compõe toda ficha.
 *
 * Existe para que dez fichas diferentes não tenham dez tratamentos de rótulo.
 * O rótulo é pequeno, em caixa alta e discreto; o valor é o conteúdo. Quando
 * os dois têm o mesmo peso, a ficha vira uma lista de palavras.
 */
export function FieldPair({ label, children, className }: FieldPairProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="text-2xs font-medium tracking-label text-subtle uppercase">{label}</span>
      <span className="truncate text-base text-text">{children}</span>
    </div>
  );
}
