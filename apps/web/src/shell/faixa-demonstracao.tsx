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
    // Dentro de um marco `complementary`: solta, a faixa era o único
    // conteúdo da página fora de qualquer região (axe `region`).
    <aside aria-label="Aviso de demonstração" className="shrink-0">
      <div
        role="note"
        data-testid="faixa-demonstracao"
        className="flex items-center justify-center gap-2 border-b border-border bg-surface-sunken px-4 py-1 text-xs text-muted"
      >
        <span className="rounded-[5px] border border-border px-1.5 py-px text-2xs font-semibold tracking-label">
          DEMONSTRAÇÃO
        </span>
        <span className="truncate">Ambiente de demonstração — dados fictícios e não persistentes.</span>
      </div>
    </aside>
  );
}
