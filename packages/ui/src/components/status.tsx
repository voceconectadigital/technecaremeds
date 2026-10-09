/**
 * Aurora — indicadores de estado (SPEC v0.2 §40 · WCAG 2.2 1.4.1).
 *
 * A REGRA QUE ESTE ARQUIVO EXISTE PARA CUMPRIR
 *
 * Nenhum estado é compreensível só pela cor. Cada indicador carrega TRÊS
 * canais: o tom, uma FORMA (o glifo do ponto muda por tom) e o TEXTO. Um em
 * cada doze homens não distingue vermelho de verde, e uma OS com SLA estourado
 * não pode depender disso. Também não pode depender de tela boa: o técnico
 * está no corredor do hospital, com o celular no brilho mínimo.
 *
 * Por isso `StatusChip` não aceita "só a cor": o rótulo é obrigatório.
 */
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'info';

const FUNDOS: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-muted border-transparent',
  accent: 'bg-accent-soft text-accent-text border-transparent',
  good: 'bg-good-soft text-good-text border-transparent',
  warn: 'bg-warn-soft text-warn-text border-transparent',
  bad: 'bg-bad-soft text-bad-text border-transparent',
  info: 'bg-info-soft text-info-text border-transparent',
};

const PONTOS: Record<Tone, string> = {
  neutral: 'bg-subtle',
  accent: 'bg-accent',
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
};

/**
 * A FORMA do ponto, que é o segundo canal.
 *
 * Círculo para o normal, losango para atenção, quadrado para o crítico. São
 * distinguíveis em preto e branco, em tela ruim e com daltonismo — que é o
 * ponto inteiro.
 */
const FORMAS: Record<Tone, string> = {
  neutral: 'rounded-full',
  accent: 'rounded-full',
  good: 'rounded-full',
  warn: 'rotate-45 rounded-[1px]',
  bad: 'rounded-[1px]',
  info: 'rounded-full',
};

export interface StatusChipProps {
  tone?: Tone;
  /** O texto do estado. Obrigatório: cor sozinha não é informação. */
  children: ReactNode;
  /** Esconde o ponto quando o próprio texto já basta (chip dentro de tabela). */
  withoutDot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  /** Explica o estado em uma frase — vira `title` e rótulo acessível. */
  hint?: string;
}

export function StatusChip({
  tone = 'neutral',
  children,
  withoutDot = false,
  size = 'md',
  className,
  hint,
}: StatusChipProps) {
  return (
    <span
      title={hint}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[6px] border font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-px text-2xs' : 'px-2 py-0.5 text-xs',
        FUNDOS[tone],
        className
      )}
    >
      {!withoutDot && (
        <span aria-hidden="true" className={cn('size-1.5 shrink-0', PONTOS[tone], FORMAS[tone])} />
      )}
      {children}
      {hint && <span className="aurora-sr-only">. {hint}</span>}
    </span>
  );
}

/**
 * Contador.
 *
 * Existe separado do chip porque o papel é outro: chip descreve UM registro,
 * contador resume MUITOS. `aria-label` completa o número solto — "12" sozinho
 * não diz doze do quê para quem não vê o contexto visual.
 */
export interface CountBadgeProps {
  count: number;
  /** O que está sendo contado, no singular. Ex.: "notificação não lida". */
  label: string;
  tone?: Tone;
  /** Acima disto mostra "99+": um contador de quatro dígitos quebra o layout. */
  max?: number;
  className?: string;
}

export function CountBadge({ count, label, tone = 'bad', max = 99, className }: CountBadgeProps) {
  if (count <= 0) return null;
  const texto = count > max ? `${max}+` : String(count);

  return (
    <span
      aria-label={`${count} ${label}${count === 1 ? '' : 's'}`}
      className={cn(
        'inline-flex min-w-[1.25rem] items-center justify-center rounded-pill px-1.5 py-0.5',
        'text-2xs leading-none font-semibold tabular-nums',
        tone === 'bad' ? 'bg-bad text-white' : 'bg-accent text-on-accent',
        className
      )}
    >
      <span aria-hidden="true">{texto}</span>
    </span>
  );
}

/**
 * Barra de progresso rotulada.
 *
 * O número vem junto SEMPRE. Uma barra sem número é uma estimativa visual, e
 * "quase estourando" e "estourou" parecem a mesma coisa quando o preenchimento
 * passa de 95%.
 */
export interface ProgressProps {
  value: number;
  max?: number;
  label: string;
  tone?: Tone;
  className?: string;
}

export function Progress({ value, max = 100, label, tone = 'accent', className }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-sunken"
      >
        <div
          className={cn('h-full rounded-pill transition-[width] duration-[190ms]', PONTOS[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted tabular-nums" data-numeric>
        {Math.round(pct)}%
      </span>
    </div>
  );
}
