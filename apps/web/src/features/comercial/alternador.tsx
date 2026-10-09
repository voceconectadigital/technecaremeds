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
import { useRouterState } from '@tanstack/react-router';
import { AlternadorDeTelas } from '../../shell/alternador';

export function AlternadorComercial() {
  const caminho = useRouterState({ select: (s) => s.location.pathname });
  const emOrcamentos = caminho.startsWith('/orcamentos');

  return (
    <AlternadorDeTelas
      label="Contratos e orçamentos"
      itens={[
        { para: '/contratos', rotulo: 'Contratos', ativo: !emOrcamentos },
        { para: '/orcamentos', rotulo: 'Orçamentos', ativo: emOrcamentos },
      ]}
    />
  );
}
