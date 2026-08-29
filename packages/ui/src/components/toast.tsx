/**
 * Aurora — avisos efêmeros (SPEC v0.2 §35 · WCAG 2.2 2.2.1).
 *
 * O QUE UM AVISO PODE E NÃO PODE SER
 *
 * Pode confirmar o que acabou de acontecer: "OS 1042 atribuída a Rafael".
 * NÃO pode ser o único lugar onde um erro aparece — ele some, e o erro que
 * some é o erro que ninguém corrige. Falha de formulário fica no campo; falha
 * de operação fica na tela da operação.
 *
 * Três garantias:
 *
 *   · o aviso de ERRO não desaparece sozinho. A WCAG 2.2 (2.2.1) exige poder
 *     desligar ou estender qualquer limite de tempo, e um erro que evapora em
 *     cinco segundos é intolerável para quem lê devagar;
 *   · a região é `aria-live`, então o leitor de tela anuncia sem tirar o foco
 *     de onde a pessoa está;
 *   · fechar é sempre possível, com botão nomeado.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import type { Tone } from './status';

export interface ToastInput {
  title: string;
  /** Detalhe opcional — o número da OS, o nome de quem recebeu. */
  description?: string;
  tone?: Tone;
  /** Uma ação de saída: desfazer, ver o registro. */
  action?: { label: string; onClick: () => void };
}

interface Toast extends ToastInput {
  id: number;
}

interface ToastApi {
  show(input: ToastInput): void;
  /** Atalho para o caso mais comum: deu certo. */
  success(title: string, description?: string): void;
  /** Erro NÃO some sozinho. */
  error(title: string, description?: string): void;
  dismiss(id: number): void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useToast exige <ToastProvider> acima na árvore');
  return api;
}

const DURACAO_PADRAO = 5000;

export interface ToastProviderProps {
  children: ReactNode;
  /**
   * Quanto tempo um aviso de sucesso fica na tela.
   *
   * Injetável porque o teste precisa observar o DESAPARECIMENTO, e esperar
   * cinco segundos de verdade em cada teste é como uma suíte passa de segundos
   * para minutos. Relógio falso resolveria e traz o seu próprio problema: um
   * teste que esquece de restaurar o relógio trava todos os seguintes.
   */
  autoDismissMs?: number;
}

export function ToastProvider({ children, autoDismissMs = DURACAO_PADRAO }: ToastProviderProps) {
  const [avisos, setAvisos] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setAvisos((a) => a.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setAvisos((a) => [...a, { ...input, id }]);

      // Erro fica. Todo o resto sai sozinho.
      if (input.tone !== 'bad') {
        setTimeout(() => dismiss(id), autoDismissMs);
      }
    },
    [dismiss, autoDismissMs]
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) => show({ title, description, tone: 'good' }),
      error: (title, description) => show({ title, description, tone: 'bad' }),
      dismiss,
    }),
    [show, dismiss]
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <ToastViewport avisos={avisos} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

const TONS: Record<Tone, string> = {
  neutral: 'border-border',
  accent: 'border-accent',
  good: 'border-good',
  warn: 'border-warn',
  bad: 'border-bad',
  info: 'border-info',
};

function ToastViewport({ avisos, onDismiss }: { avisos: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      // `polite` para não interromper o que a pessoa está fazendo. Erro que
      // precisa interromper não é aviso efêmero — é diálogo.
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-0 bottom-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4"
    >
      {avisos.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-card border-l-4 bg-surface p-3 shadow-overlay',
            'border-y border-r border-y-border border-r-border',
            TONS[t.tone ?? 'neutral']
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium text-text">{t.title}</p>
            {t.description && <p className="mt-0.5 text-sm text-muted">{t.description}</p>}
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  onDismiss(t.id);
                }}
                className="mt-1.5 text-sm font-medium text-accent-text underline underline-offset-2"
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label={`Fechar aviso: ${t.title}`}
            onClick={() => onDismiss(t.id)}
            className="shrink-0 rounded-control p-1 text-subtle transition-colors hover:bg-surface-hover hover:text-text"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
