/**
 * Aurora — campo de formulário (SPEC v0.2 §35, §40).
 *
 * O CAMPO É A UNIDADE, NÃO O `input`.
 *
 * Rótulo, dica, erro e controle andam juntos ou não andam. Espalhar isso pela
 * tela é como se produz o formulário em que o erro aparece no topo dizendo
 * "verifique os dados" — a reclamação que a auditoria do sistema de referência
 * registrou às centenas.
 *
 * O que este componente garante, e que ninguém precisa lembrar de fazer:
 *
 *   · o `label` aponta para o controle (`htmlFor`), então clicar no rótulo
 *     foca o campo e o leitor de tela anuncia os dois juntos;
 *   · a dica e o erro entram em `aria-describedby`, então são LIDOS — e não só
 *     mostrados para quem enxerga;
 *   · o erro marca `aria-invalid` e vive numa região `role="alert"`, então
 *     chega a quem já saiu do campo;
 *   · obrigatório é dito por texto ("obrigatório"), não só por asterisco.
 */
import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '../lib/cn';

interface CampoCtx {
  id: string;
  descriptionId: string;
  errorId: string;
  hasError: boolean;
  required: boolean;
}

const Ctx = createContext<CampoCtx | null>(null);

/** Liga o controle ao rótulo, à dica e ao erro do campo em que ele está. */
export function useFieldControl() {
  const ctx = useContext(Ctx);
  if (!ctx) return {};
  return {
    id: ctx.id,
    'aria-invalid': ctx.hasError || undefined,
    'aria-required': ctx.required || undefined,
    'aria-describedby':
      [ctx.hasError ? ctx.errorId : null, ctx.descriptionId].filter(Boolean).join(' ') || undefined,
  } as const;
}

export interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  /** Explica o que o campo espera. Vai para `aria-describedby`. */
  hint?: ReactNode;
  /** A mensagem de erro. Presente = campo inválido. */
  error?: string | null;
  required?: boolean;
  /** Esconde o rótulo visualmente, mantendo-o para o leitor de tela. */
  labelHidden?: boolean;
  className?: string;
}

export function Field({
  label,
  children,
  hint,
  error,
  required = false,
  labelHidden = false,
  className,
}: FieldProps) {
  const base = useId();
  const ctx: CampoCtx = {
    id: `${base}-control`,
    descriptionId: `${base}-hint`,
    errorId: `${base}-error`,
    hasError: Boolean(error),
    required,
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label
          htmlFor={ctx.id}
          className={cn('text-sm font-medium text-text', labelHidden && 'aurora-sr-only')}
        >
          {label}
          {required && (
            <>
              <span aria-hidden="true" className="ml-0.5 text-bad">
                *
              </span>
              {/* Asterisco sozinho é convenção que nem todo mundo conhece. */}
              <span className="aurora-sr-only"> (obrigatório)</span>
            </>
          )}
        </label>

        {children}

        {hint && (
          <p id={ctx.descriptionId} className="text-xs text-muted">
            {hint}
          </p>
        )}

        {/*
         * `role="alert"` e não só texto vermelho: quem já saiu do campo, ou
         * quem não vê a tela, precisa ser AVISADO — não descobrir depois de
         * apertar salvar pela terceira vez.
         */}
        {error && (
          <p id={ctx.errorId} role="alert" className="flex items-start gap-1.5 text-xs text-bad-text">
            <span aria-hidden="true" className="mt-0.5 inline-block size-2 shrink-0 rounded-[1px] bg-bad" />
            {error}
          </p>
        )}
      </div>
    </Ctx.Provider>
  );
}

/* -------------------------------------------------------------------------- */

const CONTROLE_BASE =
  'w-full rounded-control border bg-surface px-3 text-base text-text placeholder:text-subtle ' +
  'transition-colors duration-[130ms] ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-subtle ' +
  'aria-[invalid=true]:border-bad aria-[invalid=true]:bg-bad-soft/30';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export function Input({ className, ...rest }: InputProps) {
  const campo = useFieldControl();
  return (
    <input {...campo} {...rest} className={cn(CONTROLE_BASE, 'h-[34px] border-border-strong', className)} />
  );
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}

export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  const campo = useFieldControl();
  return (
    <textarea
      {...campo}
      {...rest}
      rows={rows}
      className={cn(CONTROLE_BASE, 'resize-y py-2 border-border-strong', className)}
    />
  );
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
}

/**
 * Seleção nativa, de propósito.
 *
 * O `select` do sistema operacional é melhor no celular do que qualquer lista
 * que a gente desenhe: teclado certo, rolagem certa, acessibilidade de graça.
 * Uma lista customizada entra quando houver o que ela precise fazer e o nativo
 * não faça — busca dentro de mil ativos, por exemplo —, não antes.
 */
export function Select({ className, children, ...rest }: SelectProps) {
  const campo = useFieldControl();
  return (
    <select
      {...campo}
      {...rest}
      className={cn(CONTROLE_BASE, 'h-[34px] cursor-pointer border-border-strong pr-8', className)}
    >
      {children}
    </select>
  );
}
