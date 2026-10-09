/**
 * Aurora — o alternador entre o trabalho que chega e o que se repete.
 *
 * Ordem de serviço e plano preventivo respondem a perguntas vizinhas: "o que
 * está em andamento?" e "o que vai virar trabalho sozinho?". Dividem o item de
 * menu pela mesma razão que contrato e orçamento dividem o deles — o menu tem
 * oito itens por decisão escrita em `shell/navigation.ts`, e acima disso a
 * barra deixa de ser navegação e vira lista para procurar.
 *
 * O alternador fica VISÍVEL no topo das duas telas, e não escondido num menu:
 * quem chega pelo caminho das ordens precisa descobrir que o plano existe.
 */
import { useRouterState } from '@tanstack/react-router';
import { AlternadorDeTelas } from '../../shell/alternador';

export function AlternadorDeTrabalho() {
  const caminho = useRouterState({ select: (s) => s.location.pathname });
  const emPlanos = caminho.startsWith('/planos');

  return (
    <AlternadorDeTelas
      label="Ordens e planos"
      itens={[
        { para: '/ordens', rotulo: 'Ordens de serviço', ativo: !emPlanos },
        { para: '/planos', rotulo: 'Planos de manutenção', ativo: emPlanos },
      ]}
    />
  );
}
