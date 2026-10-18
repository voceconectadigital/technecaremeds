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
import { useRouterState } from '@tanstack/react-router';
import { platformMe } from '@aurora/contracts';
import { useApiQuery } from '@aurora/app-kit';
import { AlternadorDeTelas } from '../../shell/alternador';

export function AlternadorDeConfiguracoes() {
  const caminho = useRouterState({ select: (s) => s.location.pathname });
  const emAutomacoes = caminho.startsWith('/configuracoes/automacoes');
  const emNegocios = caminho.startsWith('/configuracoes/negocios');
  const emMetas = caminho.startsWith('/configuracoes/metas');
  const emOrganizacao = caminho.startsWith('/configuracoes/organizacao');
  // "Novo negócio" só aparece para o admin global de plataforma (Fase 11).
  const { data: eu } = useApiQuery(platformMe) as { data: { platform_admin: boolean } | undefined };

  return (
    <AlternadorDeTelas
      label="Configurações"
      itens={[
        {
          para: '/usuarios',
          rotulo: 'Usuários',
          ativo: !emAutomacoes && !emNegocios && !emMetas && !emOrganizacao,
        },
        { para: '/configuracoes/metas', rotulo: 'Metas', ativo: emMetas },
        { para: '/configuracoes/automacoes', rotulo: 'Automações', ativo: emAutomacoes },
        // Regras da organização inteira, como o parecer na conclusão da OS (PF-41).
        { para: '/configuracoes/organizacao', rotulo: 'Organização', ativo: emOrganizacao },
        ...(eu?.platform_admin
          ? [{ para: '/configuracoes/negocios', rotulo: 'Novo negócio', ativo: emNegocios }]
          : []),
      ]}
    />
  );
}
