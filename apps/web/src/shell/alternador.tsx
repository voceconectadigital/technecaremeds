/**
 * O alternador entre duas telas-irmãs (Ordens ↔ Planos, Ativos ↔ Documentos…).
 *
 * Eram cinco cópias do mesmo bloco, cada uma com a própria classe — e foi
 * assim que uma virou aba sublinhada, outra pílula azul, outra botão. Agora é
 * um componente só, com a aparência de CONTROLE SEGMENTADO: é navegação entre
 * vistas do mesmo assunto, não um segundo menu.
 *
 * Continua sendo `<nav>` com links e `aria-current` — trocar de tela muda a
 * URL, e o leitor de tela anuncia "página atual" no segmento aceso.
 */
import { Link } from '@tanstack/react-router';
import { cn } from '@aurora/ui';

export interface ItemDoAlternador {
  para: string;
  rotulo: string;
  ativo: boolean;
}

export function AlternadorDeTelas({ label, itens }: { label: string; itens: ItemDoAlternador[] }) {
  return (
    <nav
      aria-label={label}
      className="inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 self-start rounded-[10px] border border-border-subtle bg-surface-sunken p-0.5"
    >
      {itens.map((x) => (
        <Link
          key={x.para}
          to={x.para}
          aria-current={x.ativo ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-8 items-center rounded-control border px-3 text-sm whitespace-nowrap transition-colors',
            x.ativo
              ? 'border-border bg-surface font-semibold text-text shadow-card'
              : 'border-transparent font-medium text-muted hover:text-text'
          )}
        >
          {x.rotulo}
        </Link>
      ))}
    </nav>
  );
}
