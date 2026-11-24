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
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { Eye, EyeOff } from 'lucide-react';
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
          className={cn('text-sm font-semibold text-text', labelHidden && 'aurora-sr-only')}
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
  'w-full rounded-control border bg-surface px-3 text-base text-text placeholder:text-subtle shadow-card ' +
  'transition-[border-color,box-shadow] duration-[130ms] hover:border-[color:var(--aurora-neutral-400)] ' +
  'focus:border-accent focus:shadow-[0_0_0_3px_var(--aurora-accent-soft)] ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-subtle ' +
  'aria-[invalid=true]:border-bad aria-[invalid=true]:bg-bad-soft/30';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export function Input({ className, ...rest }: InputProps) {
  const campo = useFieldControl();
  return <input {...campo} {...rest} className={cn(CONTROLE_BASE, 'h-10 border-border-strong', className)} />;
}

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  ref?: Ref<HTMLInputElement>;
}

/**
 * Campo de senha com o olho para mostrar e esconder o que foi digitado.
 *
 * Quem digita a senha no celular, de luva ou com pressa, erra sem ver — e só
 * descobre depois de o servidor recusar. O olho deixa conferir antes.
 *
 * O que ele garante:
 *
 *   · o botão é `type="button"`: clicar no olho NUNCA envia o formulário;
 *   · o rótulo do botão diz o que o clique fará ("Mostrar senha" / "Ocultar
 *     senha") e `aria-pressed` diz o estado, então o leitor de tela anuncia os
 *     dois;
 *   · o foco fica no campo, com o cursor onde estava: a pessoa confere e
 *     continua digitando sem voltar a clicar no campo;
 *   · `name`, `id`, `autoComplete` e o resto chegam ao `input` como vieram —
 *     é deles que o gerenciador de senhas do navegador depende;
 *   · o olho nativo do Edge sai de cena, para não haver dois olhos no campo.
 */
export function PasswordInput({ className, disabled, ref, id, ...rest }: PasswordInputProps) {
  const campo = useFieldControl();
  const reserva = useId();
  const idDoCampo = id ?? campo.id ?? reserva;
  const [visivel, setVisivel] = useState(false);
  const campoRef = useRef<HTMLInputElement | null>(null);
  /** A seleção de antes do clique, para devolver o cursor ao mesmo lugar. */
  const selecao = useRef<{ inicio: number | null; fim: number | null } | null>(null);

  const ligar = useCallback(
    (el: HTMLInputElement | null) => {
      campoRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref]
  );

  // Trocar o `type` pode zerar o cursor em alguns navegadores; aqui ele volta.
  useLayoutEffect(() => {
    const el = campoRef.current;
    const antes = selecao.current;
    if (!el || !antes) return;
    selecao.current = null;
    el.focus();
    if (antes.inicio !== null && antes.fim !== null) el.setSelectionRange(antes.inicio, antes.fim);
  }, [visivel]);

  function alternar() {
    const el = campoRef.current;
    selecao.current = { inicio: el?.selectionStart ?? null, fim: el?.selectionEnd ?? null };
    setVisivel((v) => !v);
  }

  return (
    <div className="relative">
      <input
        {...campo}
        {...rest}
        id={idDoCampo}
        ref={ligar}
        type={visivel ? 'text' : 'password'}
        disabled={disabled}
        className={cn(
          CONTROLE_BASE,
          'h-10 border-border-strong pr-11 [&::-ms-clear]:hidden [&::-ms-reveal]:hidden',
          className
        )}
      />
      <button
        type="button"
        aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        aria-pressed={visivel}
        aria-controls={idDoCampo}
        disabled={disabled}
        // Sem isto o clique tiraria o foco do campo antes de devolvê-lo.
        onMouseDown={(e) => e.preventDefault()}
        onClick={alternar}
        className={cn(
          'absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control text-muted',
          'transition-colors duration-[130ms] hover:text-text',
          'disabled:cursor-not-allowed disabled:text-subtle disabled:hover:text-subtle'
        )}
      >
        {visivel ? (
          <EyeOff aria-hidden="true" className="size-[18px]" />
        ) : (
          <Eye aria-hidden="true" className="size-[18px]" />
        )}
      </button>
    </div>
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
      className={cn(
        CONTROLE_BASE,
        'aurora-select h-10 cursor-pointer appearance-none border-border-strong pr-9',
        className
      )}
    >
      {children}
    </select>
  );
}
