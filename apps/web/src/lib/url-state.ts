/**
 * Aurora — estado de tela que mora na URL (SPEC v0.2 §34).
 *
 * POR QUE A URL, E NÃO O ESTADO DO COMPONENTE
 *
 * Um filtro que vive só na memória do componente:
 *
 *   · some no recarregamento — e quem trabalha oito horas recarrega;
 *   · não pode ser mandado para um colega ("olha essas seis OS aqui");
 *   · não volta com o botão de voltar do navegador, que é o gesto mais usado
 *     de toda a web;
 *   · e, o pior, deixa a pessoa achando que o sistema perdeu registros quando
 *     na verdade há um filtro ativo que ela não vê.
 *
 * Por isso todo filtro desta aplicação aparece no endereço. É também o que
 * torna possível a exigência da §34 de que cada filtro seja removível
 * individualmente: remover é apagar UM parâmetro.
 */
import { useCallback } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';

export function useUrlState<T extends string>(chave: string, padrao: T): [T, (valor: T) => void] {
  const navigate = useNavigate();
  const busca = useSearch({ strict: false }) as Record<string, unknown>;

  const atual = (typeof busca[chave] === 'string' ? (busca[chave] as T) : padrao) ?? padrao;

  const definir = useCallback(
    (valor: T) => {
      const atualizar = (anterior: Record<string, unknown>) => {
        const proximo = { ...anterior };
        // O valor padrão SAI da URL em vez de virar `?situacao=todas`: um
        // endereço cheio de parâmetros redundantes é ilegível e não se
        // compartilha.
        if (valor === padrao) delete proximo[chave];
        else proximo[chave] = valor;
        return proximo;
      };

      /*
       * O tipo de `search` no TanStack depende da rota em que a chamada
       * acontece, e este utilitário é genérico por construção — serve a
       * qualquer tela. A conversão fica isolada nesta linha, com o motivo
       * escrito, em vez de espalhar `any` pelas chamadas.
       */
      void navigate({
        search: atualizar as unknown as Parameters<typeof navigate>[0]['search'],
        replace: true,
      });
    },
    [navigate, chave, padrao]
  );

  return [atual, definir];
}
