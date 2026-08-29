/**
 * Aurora — paleta de comandos (SPEC v0.2 §34 · EPIC-025).
 *
 * POR QUE ISTO É IMPORTANTE, E NÃO UM ENFEITE
 *
 * A auditoria do sistema de referência registrou o custo de não ter busca
 * global: para achar "patrimônio 7737" era preciso saber em qual lista
 * procurar. O técnico com o equipamento na frente sabe o número da etiqueta e
 * NÃO sabe se aquilo é TAG, patrimônio ou série — e não deveria precisar saber.
 *
 * A paleta é a resposta: um lugar só, que aceita o que a pessoa tem na mão.
 *
 * O QUE ELA GARANTE
 *
 *   · combobox de verdade (`role="combobox"` + `aria-activedescendant`), então
 *     o leitor de tela anuncia o resultado destacado enquanto a seta desce;
 *   · o foco volta para onde estava ao fechar;
 *   · a espera é anunciada uma vez, não a cada tecla;
 *   · resultado vazio é uma FRASE, não uma lista vazia.
 */
import { Dialog as RadixDialog } from 'radix-ui';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Spinner } from './spinner';

export interface CommandItem {
  id: string;
  label: string;
  /** Onde isso vive — "Ordem de serviço", "Ativo", "Ir para". */
  group: string;
  /** Segunda linha: número, cliente, local. É o que desempata homônimos. */
  detail?: string;
  icon?: ReactNode;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** O que digitaram. Controlado por fora para permitir busca no servidor. */
  query: string;
  onQueryChange: (q: string) => void;
  items: CommandItem[];
  loading?: boolean;
  placeholder?: string;
  /** Mostrado quando não há nada digitado — atalhos, recentes. */
  emptyQueryHint?: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  items,
  loading = false,
  placeholder = 'Buscar OS, ativo, solicitação, pessoa…',
  emptyQueryHint = 'Digite um número de patrimônio, TAG, série ou parte de um nome.',
}: CommandPaletteProps) {
  const [destacado, setDestacado] = useState(0);
  const listaId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // Nova busca começa do topo: manter o índice antigo destacaria um resultado
  // que a pessoa nunca viu.
  useEffect(() => setDestacado(0), [query, items.length]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, CommandItem[]>();
    for (const item of items) {
      const lista = mapa.get(item.group) ?? [];
      lista.push(item);
      mapa.set(item.group, lista);
    }
    return [...mapa.entries()];
  }, [items]);

  const planos = useMemo(() => grupos.flatMap(([, lista]) => lista), [grupos]);
  const atual = planos[destacado];

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDestacado((d) => (planos.length ? (d + 1) % planos.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDestacado((d) => (planos.length ? (d - 1 + planos.length) % planos.length : 0));
    } else if (e.key === 'Enter' && atual) {
      e.preventDefault();
      atual.onSelect();
      onOpenChange(false);
    }
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-50"
          style={{ backgroundColor: 'rgb(13 18 17 / 0.45)' }}
        />
        <RadixDialog.Content
          onOpenAutoFocus={(e) => {
            // O foco vai para o campo, e não para o primeiro botão: quem abre
            // a paleta quer digitar.
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className={cn(
            'fixed top-[12vh] left-1/2 z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 flex-col',
            'overflow-hidden rounded-sheet border border-border bg-surface shadow-sheet'
          )}
        >
          <RadixDialog.Title className="aurora-sr-only">Busca e comandos</RadixDialog.Title>
          <RadixDialog.Description className="aurora-sr-only">
            Digite para buscar ordens de serviço, ativos, solicitações e pessoas. Use as setas para navegar e
            Enter para abrir.
          </RadixDialog.Description>

          <div className="flex items-center gap-3 border-b border-border-subtle px-4">
            <Search aria-hidden="true" className="size-4 shrink-0 text-subtle" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls={listaId}
              aria-activedescendant={atual ? `${listaId}-${atual.id}` : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder={placeholder}
              className="h-12 flex-1 bg-transparent text-md text-text outline-none placeholder:text-subtle"
            />
            {loading && <Spinner size="sm" className="text-subtle" />}
          </div>

          <div
            id={listaId}
            role="listbox"
            aria-label="Resultados"
            className="min-h-0 flex-1 overflow-y-auto p-2"
          >
            {/* Anúncio único da contagem: um por tecla digitada seria ruído. */}
            <span role="status" className="aurora-sr-only">
              {loading
                ? 'Buscando…'
                : query
                  ? `${items.length} resultado${items.length === 1 ? '' : 's'}`
                  : ''}
            </span>

            {!query && <p className="px-3 py-6 text-center text-sm text-muted">{emptyQueryHint}</p>}

            {query && !loading && items.length === 0 && (
              <div className="px-3 py-6 text-center">
                <p className="text-base font-medium text-text">Nada encontrado para “{query}”.</p>
                <p className="mt-1 text-sm text-muted">
                  A busca cobre número, TAG, patrimônio, série, título e cliente — dentro do que você tem
                  permissão para ver.
                </p>
              </div>
            )}

            {grupos.map(([grupo, lista]) => (
              <div key={grupo} className="mb-1">
                <p className="px-3 py-1.5 text-2xs font-semibold tracking-[0.06em] text-subtle uppercase">
                  {grupo}
                </p>
                {lista.map((item) => {
                  const ativo = atual?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      id={`${listaId}-${item.id}`}
                      role="option"
                      aria-selected={ativo}
                      onMouseEnter={() => setDestacado(planos.indexOf(item))}
                      onClick={() => {
                        item.onSelect();
                        onOpenChange(false);
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-control px-3 py-2',
                        ativo && 'bg-surface-hover'
                      )}
                    >
                      {item.icon && (
                        <span aria-hidden="true" className="shrink-0 text-subtle">
                          {item.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base text-text">{item.label}</span>
                        {item.detail && (
                          <span className="block truncate text-xs text-muted">{item.detail}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
