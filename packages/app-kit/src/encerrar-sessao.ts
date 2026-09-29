/**
 * Aurora — sair de verdade (SPEC v0.2 §36).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE ARQUIVO CORRIGE UM DEFEITO QUE NÃO DAVA SINTOMA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * "Sair" limpava o `localStorage` e mandava para a tela de entrada. Do lado de
 * dentro parecia certo: a tela volta para o login, e a pessoa não consegue mais
 * navegar.
 *
 * Mas o token continuava VÁLIDO NO SERVIDOR até expirar. Quem tivesse copiado
 * aquele token — de um log, de uma extensão, de um computador compartilhado —
 * continuava entrando com ele depois de a pessoa ter saído. "Sair" não é
 * esconder a chave; é invalidá-la.
 *
 * Com o provedor local isso não existia porque não havia sessão nenhuma para
 * invalidar: o token ERA o e-mail. O defeito nasceu junto com a sessão de
 * verdade, e é o tipo que só aparece quando alguém procura.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A LIMPEZA LOCAL ACONTECE DE QUALQUER FORMA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Se a chamada falhar — rede caída, servidor fora, sessão já expirada —, a
 * sessão local é apagada igual. O contrário seria pior: alguém num computador
 * emprestado, sem rede, clica em "Sair", recebe um erro e a sessão continua
 * aberta na tela. O risco de deixar um token vivo no servidor por algumas horas
 * é menor que o de deixar a tela logada na frente de outra pessoa.
 *
 * A rota é idempotente e devolve 200 mesmo sem token, então não há caso em que
 * sair duas vezes vire erro.
 */
import { useCallback } from 'react';
import { authLogout } from '@aurora/contracts';
import { useApi } from './api';
import { useSession } from './session';

/**
 * Devolve a função de sair. Ela sempre resolve — nunca lança.
 *
 * Quem chama navega para a tela de entrada depois de `await`: navegar antes
 * desmontaria o componente no meio da chamada, e em React 18 isso cancela o
 * `fetch` — o que traria de volta exatamente o defeito que este arquivo corrige.
 */
export function useEncerrarSessao(): () => Promise<void> {
  const api = useApi();
  const { signOut } = useSession();

  return useCallback(async () => {
    try {
      await api.call(authLogout, {});
    } catch {
      /* Ver o comentário acima: a limpeza local não depende do servidor. */
    }
    signOut();
  }, [api, signOut]);
}
