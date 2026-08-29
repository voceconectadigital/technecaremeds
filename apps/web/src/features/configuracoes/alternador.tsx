/**
 * Aurora — o alternador de configurações.
 *
 * Pessoas e automações são as duas coisas que se configuram e que mudam o
 * comportamento do sistema para todo mundo. Automações não tinha porta
 * nenhuma: a rota existia e nada levava até ela — que é a mesma coisa que não
 * existir.
 *
 * Configurações fica FORA das oito do menu principal, no rodapé da barra, por
 * uma razão escrita em `shell/navigation.ts`: não é trabalho do dia, é o que
 * se mexe uma vez por mês, e misturá-la com as oito faz a pessoa passar por
 * ela oito horas por dia sem precisar.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@aurora/ui';

export function AlternadorDeConfiguracoes() {
  const caminho = useRouterState({ select: (s) => s.location.pathname });
  const emAutomacoes = caminho.startsWith('/configuracoes/automacoes');

  return (
    <nav aria-label="Configurações" className="flex gap-1">
      {[
        { para: '/configuracoes', rotulo: 'Pessoas', ativo: !emAutomacoes },
        { para: '/configuracoes/automacoes', rotulo: 'Automações', ativo: emAutomacoes },
      ].map((x) => (
        <Link
          key={x.para}
          to={x.para}
          aria-current={x.ativo ? 'page' : undefined}
          className={cn(
            'rounded-control px-3 py-1.5 text-sm transition-colors',
            x.ativo
              ? 'bg-accent-soft text-accent-text'
              : 'text-muted hover:bg-surface-hover hover:text-text'
          )}
        >
          {x.rotulo}
        </Link>
      ))}
    </nav>
  );
}
