/**
 * Aurora — a sessão resolvida pelo servidor.
 *
 * Uma consulta só, compartilhada por todo o esqueleto: barra lateral, barra
 * superior e menu de usuário perguntam a mesma coisa, e o React Query
 * desduplica pela chave. Sem isso, abrir uma tela dispararia três chamadas
 * idênticas.
 *
 * `staleTime` alto de propósito: permissão não muda a cada minuto, e revalidar
 * a cada foco de janela transformaria a sessão numa requisição por alt-tab. Uma
 * revogação de permissão vira 403 na próxima ação de qualquer forma — que é o
 * lugar certo de descobrir, porque é onde a pessoa está tentando agir.
 */
import { meSession, type Session } from '@aurora/contracts';
import { useApiQuery } from './api';

export function useSessionQuery() {
  return useApiQuery(meSession, undefined, {
    staleTime: 5 * 60_000,
    retry: false,
  }) as { data: Session | undefined; isLoading: boolean; isError: boolean; error: unknown };
}
