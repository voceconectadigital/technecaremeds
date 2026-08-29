/**
 * Aurora — indicador de espera.
 *
 * Decorativo por padrão (`aria-hidden`): quem anuncia a espera é o contexto —
 * o botão com `aria-busy`, a região com `aria-live`. Dois anúncios da mesma
 * coisa fazem o leitor de tela repetir, e repetição vira ruído que a pessoa
 * aprende a desligar.
 */
import { cn } from '../lib/cn';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Anuncia a espera. Use quando o giro for a ÚNICA indicação na tela. */
  label?: string;
}

const TAMANHOS = { sm: 'size-3.5', md: 'size-5', lg: 'size-8' } as const;

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      className={cn('inline-block shrink-0', TAMANHOS[size], className)}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-full animate-spin">
        {/* A trilha completa dá referência de progresso; sem ela o arco
            sozinho parece piscar em vez de girar. */}
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
