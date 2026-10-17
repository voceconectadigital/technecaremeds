/**
 * Aurora — uma execução de cada vez, sem perder o pedido do meio (EPIC-014).
 *
 * A SINCRONIZAÇÃO É PEDIDA POR TODO MUNDO: cada toque que enfileira, o relógio
 * de dez segundos, o aviso de rede voltando, o botão "Sincronizar agora". Sem
 * guarda, três pedidos juntos viravam três escoamentos em paralelo — o mesmo
 * comando ia três vezes ao servidor e a mesma fatia de foto subia em dobro.
 *
 * Mas descartar o pedido que chega no meio também é errado: o toque das 15h02
 * enfileirou um comando DEPOIS de a passada das 15h01 ter lido a fila, e ele
 * ficaria esperando o relógio. Então quem chega no meio marca "de novo", e a
 * passada em curso roda mais uma vez ao terminar. Vários pedidos no meio viram
 * UMA repetição, e não uma fila de repetições.
 */
export function umaPorVez<T>(fn: () => Promise<T>): () => Promise<T> {
  let atual: Promise<T> | null = null;
  let deNovo = false;

  async function rodar(): Promise<T> {
    try {
      let r = await fn();
      while (deNovo) {
        deNovo = false;
        r = await fn();
      }
      return r;
    } finally {
      atual = null;
      deNovo = false;
    }
  }

  return () => {
    if (atual) {
      deNovo = true;
      return atual;
    }
    atual = rodar();
    return atual;
  };
}
