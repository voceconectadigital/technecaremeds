/**
 * Aurora — o alternador entre contratos e orçamentos.
 *
 * O MENU TEM OITO ITENS, e essa decisão está escrita em `shell/navigation.ts`:
 * acima disso a barra deixa de ser navegação e vira lista para procurar — e
 * quem procura usa a busca, não o menu.
 *
 * Contrato e orçamento respondem a perguntas vizinhas — "o que foi acordado?" e
 * "o que foi orçado?" — e por isso dividem um item. O alternador fica no topo
 * das duas telas, e não escondido num menu: quem chega procurando orçamento
 * pelo caminho de contrato precisa VER que o outro existe.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@aurora/ui';

export function AlternadorComercial() {
  const caminho = useRouterState({ select: (s) => s.location.pathname });
  const emOrcamentos = caminho.startsWith('/orcamentos');

  return (
    <nav aria-label="Contratos e orçamentos" className="flex gap-1">
      {[
        { para: '/contratos', rotulo: 'Contratos', ativo: !emOrcamentos },
        { para: '/orcamentos', rotulo: 'Orçamentos', ativo: emOrcamentos },
      ].map((x) => (
        <Link
          key={x.para}
          to={x.para}
          aria-current={x.ativo ? 'page' : undefined}
          className={cn(
            'rounded-control px-3 py-1.5 text-sm transition-colors',
            x.ativo ? 'bg-accent-soft text-accent-text' : 'text-muted hover:bg-surface-hover hover:text-text'
          )}
        >
          {x.rotulo}
        </Link>
      ))}
    </nav>
  );
}
