/**
 * Aurora — alternador entre o Painel de Controle e os indicadores detalhados.
 *
 * O painel é a visão de trinta segundos; os indicadores detalhados são a
 * mesma régua com a definição de cada número aberta. Dividem um item do menu
 * pelo mesmo motivo que Ordens e Planos dividem o deles.
 */
import { useRouterState } from '@tanstack/react-router';
import { AlternadorDeTelas } from '../../shell/alternador';

export function AlternadorDoPainel() {
  const caminho = useRouterState({ select: (s) => s.location.pathname });
  const emDetalhe = caminho.startsWith('/indicadores');
  return (
    <AlternadorDeTelas
      label="Painel e indicadores"
      itens={[
        { para: '/painel', rotulo: 'Painel de Controle', ativo: !emDetalhe },
        { para: '/indicadores', rotulo: 'Indicadores detalhados', ativo: emDetalhe },
      ]}
    />
  );
}
