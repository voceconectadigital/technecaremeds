/**
 * Téchne Care — a faixa da demonstração.
 *
 * Fina e no topo, sem cobrir nada: faz parte da coluna da página, e não flutua
 * por cima dela. Aparece em TODA tela interna, e não só na entrada — quem chega
 * por um link direto para a agenda precisa saber, ali, que nada do que fizer
 * será gravado. Discreta o bastante para não competir com a tela; presente o
 * bastante para ninguém acreditar que está num ambiente de verdade.
 */
export function FaixaDemonstracao() {
  return (
    <div
      role="note"
      data-testid="faixa-demonstracao"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-surface-sunken px-4 py-1 text-xs text-muted"
    >
      <span className="rounded-full border border-border px-2 py-px text-[10px] font-semibold tracking-wider">
        DEMONSTRAÇÃO
      </span>
      <span className="truncate">Ambiente de demonstração — dados fictícios e não persistentes.</span>
    </div>
  );
}
