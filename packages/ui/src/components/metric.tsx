/**
 * Aurora — o número, e o que ele significa (SPEC v0.2 §25, §40).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE UM COMPONENTE SÓ PARA ISSO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Um indicador tem quatro partes, e a maioria das interfaces desenha uma: o
 * número. As outras três são o que o tornam útil:
 *
 *   · o RÓTULO, que diz do que se trata;
 *   · a COMPARAÇÃO, que diz se aquilo é bom — 12 OS abertas é muito ou pouco?
 *     Sem referência, é só um dígito;
 *   · a COBERTURA, que diz sobre o que o número foi calculado. "Cumprimento de
 *     SLA 94%" calculado sobre 3 das 40 ordens é uma frase perigosa.
 *
 * A §25 é explícita: "todo número viaja com a sua definição". Este componente
 * é o lugar onde isso deixa de ser texto de especificação e vira pixel.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NULO NÃO É ZERO, E A TELA PRECISA MOSTRAR A DIFERENÇA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Um mês sem corretiva concluída devolve MTTR nulo, e não zero: zero afirmaria
 * uma excelência que não aconteceu. Aqui `value={null}` desenha um traço e a
 * razão ao lado — nunca um "0" que alguém vai levar para uma reunião.
 */
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import type { Tone } from './status';

export interface MetricTrend {
  /** Variação relativa ao período anterior, em pontos percentuais ou unidades. */
  value: number;
  /** Como ler a variação: subir é bom (backlog caindo) ou ruim? */
  goodDirection: 'up' | 'down';
  /** "vs. mês anterior" */
  label?: string;
}

export interface MetricProps {
  label: string;
  /** `null` quando não há amostra. Vira traço, e não zero. */
  value: string | number | null;
  /** Unidade colada ao número: "h", "%", "dias". */
  unit?: string;
  /** Por que o valor é nulo, ou o que o número quer dizer. */
  hint?: string;
  trend?: MetricTrend;
  icon?: ReactNode;
  tone?: Tone;
  /** Cobertura: "calculado sobre 78% dos ativos". */
  coverage?: string;
  /** Torna o cartão inteiro clicável — recebe o elemento de link. */
  action?: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}

const ACENTO_DE_TOM: Record<Tone, string> = {
  neutral: 'text-text',
  accent: 'text-accent-text',
  good: 'text-good-text',
  warn: 'text-warn-text',
  bad: 'text-bad-text',
  info: 'text-info-text',
};

const ICONE_DE_TOM: Record<Tone, string> = {
  neutral: 'bg-surface-hover text-muted',
  accent: 'bg-accent-soft text-accent-text',
  good: 'bg-good-soft text-good-text',
  warn: 'bg-warn-soft text-warn-text',
  bad: 'bg-bad-soft text-bad-text',
  info: 'bg-info-soft text-info-text',
};

/* Brilho de canto no tom: no futurístico vira a "luz de painel" do indicador. */
const BRILHO_DE_TOM: Record<Tone, string> = {
  neutral: 'transparent',
  accent: 'var(--aurora-accent-soft)',
  good: 'var(--aurora-good-soft)',
  warn: 'var(--aurora-warn-soft)',
  bad: 'var(--aurora-bad-soft)',
  info: 'var(--aurora-info-soft)',
};

const BARRA_DE_TOM: Record<Tone, string> = {
  neutral: 'bg-border-strong',
  accent: 'bg-accent',
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
};

export function Metric({
  label,
  value,
  unit,
  hint,
  trend,
  icon,
  tone = 'neutral',
  coverage,
  action,
  size = 'md',
  className,
}: MetricProps) {
  const indisponivel = value === null || value === undefined || value === '';

  return (
    <div
      className={cn(
        'group relative flex flex-col gap-1 overflow-hidden rounded-card border border-border bg-surface p-4 shadow-card',
        'transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raised motion-reduce:transform-none',
        className
      )}
      style={{
        backgroundImage: `radial-gradient(140% 90% at 100% 0%, ${BRILHO_DE_TOM[tone]}, transparent 55%)`,
      }}
    >
      {/*
       * A FAIXA DE TOM fica na borda esquerda, e não no fundo do cartão.
       *
       * Fundo colorido em cartão de indicador faz seis cartões lado a lado
       * parecerem um semáforo quebrado, e o número — que é o conteúdo — perde
       * contraste. A faixa dá o mesmo sinal ocupando 3px.
       */}
      {tone !== 'neutral' && (
        <span
          aria-hidden="true"
          className={cn('absolute inset-x-0 top-0 h-[2px] opacity-90', BARRA_DE_TOM[tone])}
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-[0.12em] text-muted uppercase">{label}</p>
        {icon && (
          <span
            aria-hidden="true"
            className={cn('grid size-8 shrink-0 place-items-center rounded-control', ICONE_DE_TOM[tone])}
          >
            {icon}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span
          data-numeric
          data-display
          className={cn(
            'leading-none font-semibold tracking-display tabular-nums',
            size === 'lg' ? 'text-4xl' : 'text-3xl',
            indisponivel ? 'text-subtle' : ACENTO_DE_TOM[tone]
          )}
        >
          {indisponivel ? '—' : value}
        </span>
        {!indisponivel && unit && <span className="text-md font-medium text-muted">{unit}</span>}
        {trend && !indisponivel && <TrendPill trend={trend} />}
      </div>

      {hint && <p className="text-xs leading-normal text-muted">{hint}</p>}

      {coverage && (
        /*
         * A cobertura fica em `text-subtle` e pequena de propósito: ela não
         * compete com o número, mas está SEMPRE lá. Escondê-la atrás de um
         * ícone de ajuda é o que faz ninguém ler — e é exatamente a informação
         * que impede alguém de levar um número parcial para uma reunião.
         */
        <p className="mt-0.5 text-2xs text-subtle">{coverage}</p>
      )}

      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * A variação, com o sinal certo.
 *
 * "Subiu 12%" não diz nada sozinho: backlog subindo é ruim, preventiva em dia
 * subindo é bom. `goodDirection` é o que traduz o movimento em juízo, e por
 * isso é obrigatório — sem ele, a seta verde mentiria em metade dos casos.
 */
function TrendPill({ trend }: { trend: MetricTrend }) {
  const subiu = trend.value > 0;
  const parado = trend.value === 0;
  const bom = parado ? null : subiu === (trend.goodDirection === 'up');

  const tom = parado
    ? 'bg-surface-sunken text-muted'
    : bom
      ? 'bg-good-soft text-good-text'
      : 'bg-bad-soft text-bad-text';

  return (
    <span
      className={cn(
        'ml-1 inline-flex items-center gap-0.5 rounded-pill px-1.5 py-0.5 text-2xs font-medium',
        tom
      )}
      title={trend.label}
    >
      {/* A SETA é o segundo canal: quem não distingue as cores lê a direção. */}
      <span aria-hidden="true">{parado ? '→' : subiu ? '↑' : '↓'}</span>
      <span data-numeric>
        {subiu ? '+' : ''}
        {trend.value}
        {'%'}
      </span>
      <span className="aurora-sr-only">
        {parado ? 'sem variação' : bom ? 'variação favorável' : 'variação desfavorável'}
        {trend.label ? `, ${trend.label}` : ''}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */

export interface MetricGridProps {
  children: ReactNode;
  /** Quantas colunas no maior tamanho. O grid degrada sozinho abaixo disso. */
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}

/**
 * A grade de indicadores.
 *
 * Existe para que toda tela use os MESMOS pontos de quebra. Quando cada tela
 * escreve o seu `grid-cols-*`, duas telas vizinhas quebram em larguras
 * diferentes — e a pessoa que redimensiona a janela vê o produto se
 * desmontando de formas distintas em cada lugar.
 */
export function MetricGrid({ children, columns = 4, className }: MetricGridProps) {
  return (
    <div
      className={cn(
        'grid gap-3',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        columns === 4 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
        columns === 5 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
        className
      )}
    >
      {children}
    </div>
  );
}
