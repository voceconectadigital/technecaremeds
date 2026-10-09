/**
 * Aurora — alternador entre o Painel de Controle e os indicadores detalhados.
 *
 * O painel é a visão de trinta segundos; os indicadores detalhados são a
 * mesma régua com a definição de cada número aberta. Dividem um item do menu
 * pelo mesmo motivo que Ordens e Planos dividem o deles.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@aurora/ui';

export function AlternadorDoPainel() {
  const caminho = useRouterState({ select: (s) => s.location.pathname });
  const emDetalhe = caminho.startsWith('/indicadores');
  return (
    <nav aria-label="Painel e indicadores" className="flex gap-1">
      {[
        { para: '/painel', rotulo: 'Painel de Controle', ativo: !emDetalhe },
        { para: '/indicadores', rotulo: 'Indicadores detalhados', ativo: emDetalhe },
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
