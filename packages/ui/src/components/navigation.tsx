/**
 * Aurora — navegação: trilha, abas, avatar (SPEC v0.2 §34, §40).
 */
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';

/* ------------------------------------------------------------------ trilha */

export interface Crumb {
  label: string;
  /** Ausente = é a página atual, e ela não é um link. */
  href?: string;
}

export interface BreadcrumbsProps {
  items: Crumb[];
  /** Como renderizar um link — o roteador decide, o componente não. */
  renderLink?: (item: Crumb & { href: string }) => ReactNode;
  className?: string;
}

/**
 * A trilha responde "onde eu estou" — que numa árvore de cliente > unidade >
 * setor > equipamento não é uma pergunta trivial.
 *
 * O último item NÃO é link e carrega `aria-current="page"`: transformar a
 * página atual em link para si mesma confunde quem navega por teclado.
 */
export function Breadcrumbs({ items, renderLink, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Trilha de navegação" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-xs">
        {items.map((item, i) => {
          const ultimo = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-subtle" />}
              {ultimo || !item.href ? (
                <span
                  aria-current={ultimo ? 'page' : undefined}
                  className={cn('truncate', ultimo ? 'font-medium text-text' : 'text-muted')}
                >
                  {item.label}
                </span>
              ) : renderLink ? (
                renderLink({ ...item, href: item.href })
              ) : (
                <a
                  href={item.href}
                  className="truncate text-muted transition-colors hover:text-text hover:underline"
                >
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------------ avatar */

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const TAM_AVATAR = { sm: 'size-6 text-2xs', md: 'size-8 text-xs', lg: 'size-10 text-sm' } as const;

/**
 * Iniciais, com cor derivada do nome.
 *
 * A cor é DECORAÇÃO: ajuda a bater o olho e reconhecer quem é, e nunca carrega
 * significado. O nome completo vai no `title` e no rótulo acessível, porque
 * duas pessoas com as mesmas iniciais existem em toda equipe.
 */
export function Avatar({ name, size = 'md', className }: AvatarProps) {
  const iniciais = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 1)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

  // Soma dos códigos: estável entre sessões e entre máquinas, ao contrário de
  // qualquer coisa baseada em aleatório ou em ordem de renderização.
  const matiz = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <span
      title={name}
      aria-label={name}
      role="img"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-pill font-semibold',
        TAM_AVATAR[size],
        className
      )}
      style={{
        backgroundColor: `oklch(0.92 0.045 ${matiz})`,
        color: `oklch(0.38 0.09 ${matiz})`,
      }}
    >
      <span aria-hidden="true">{iniciais || '?'}</span>
    </span>
  );
}

/* -------------------------------------------------------------------- abas */

export interface TabItem {
  id: string;
  label: string;
  /** Contador ao lado do rótulo — quantas OS naquela situação, por exemplo. */
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  'aria-label': string;
  /**
   * Prefixo para ligar cada aba ao seu painel.
   *
   * Quando informado, a aba ganha `id="<prefixo>-aba-<id>"` e
   * `aria-controls="<prefixo>-painel-<id>"`, e o consumidor põe o
   * `role="tabpanel"` correspondente. Sem essa ligação o leitor de tela
   * anuncia "aba 2 de 5" e não sabe dizer o que ela abriu — a pessoa ouve o
   * nome da aba e depois tem de sair caçando o conteúdo pela página.
   *
   * É opcional porque nem toda fileira de abas troca um painel: as da fila de
   * triagem filtram uma lista que continua sendo a mesma lista.
   */
  idPrefix?: string;
}

/** Os identificadores que ligam uma aba ao seu painel. */
export function tabIds(prefixo: string, id: string) {
  return { aba: `${prefixo}-aba-${id}`, painel: `${prefixo}-painel-${id}` };
}

/**
 * Abas de verdade: `role="tablist"` com setas do teclado.
 *
 * Uma fileira de botões que troca conteúdo PARECE aba e não é: o leitor de
 * tela anuncia "botão" em vez de "aba 2 de 4", e as setas não fazem nada.
 */
export function Tabs({ items, value, onChange, className, idPrefix, ...rest }: TabsProps) {
  const indice = items.findIndex((t) => t.id === value);

  return (
    <div
      role="tablist"
      aria-label={rest['aria-label']}
      className={cn('flex items-center gap-1 border-b border-border', className)}
      onKeyDown={(e) => {
        const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        // Circular: da última volta para a primeira. Parar na ponta faz a
        // pessoa achar que o teclado travou.
        const proximo = items[(indice + delta + items.length) % items.length]!;
        onChange(proximo.id);
      }}
    >
      {items.map((t) => {
        const ativo = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={idPrefix ? tabIds(idPrefix, t.id).aba : undefined}
            aria-controls={idPrefix ? tabIds(idPrefix, t.id).painel : undefined}
            aria-selected={ativo}
            // Só a aba ativa fica na tabulação: TAB entra e sai do grupo, as
            // setas andam dentro dele. É o padrão que o teclado espera.
            tabIndex={ativo ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative -mb-px flex items-center gap-2 px-3 py-2 text-base font-medium transition-colors',
              'border-b-2',
              ativo
                ? 'border-accent text-text'
                : 'border-transparent text-muted hover:border-border-strong hover:text-text'
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={cn(
                  'rounded-pill px-1.5 py-0.5 text-2xs tabular-nums',
                  ativo ? 'bg-accent-soft text-accent-text' : 'bg-surface-sunken text-muted'
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
