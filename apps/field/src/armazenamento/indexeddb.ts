/**
 * Aurora — armazenamento no navegador: IndexedDB (EPIC-014).
 *
 * SEM DEXIE, E A AUSÊNCIA É UMA DECISÃO.
 *
 * O Dexie resolve o que dói no IndexedDB: consultas, índices compostos,
 * migrações de esquema, tipagem. Nada disso é usado aqui — a porta pede um
 * armazenamento de chave e valor com seis operações, e o IndexedDB cru entrega
 * isso em cem linhas.
 *
 * O que o Dexie custaria: uma dependência a mais na superfície do aplicativo
 * que precisa abrir sem rede, num pacote que já é o caminho crítico do primeiro
 * carregamento — e uma segunda camada entre o domínio e o mecanismo, quando a
 * primeira (a porta) já existe justamente para isso.
 *
 * A decisão é reversível sem tocar em nada acima: trocar este arquivo por um
 * `DexieArmazenamento` que passe a suíte de conformidade é uma substituição de
 * adaptador. É esse o ponto de ter porta.
 */
import { COLECOES, copiaJson, type ArmazenamentoOffline, type Colecao } from './porta';
import { MARCA } from '@aurora/app-kit';

const VERSAO = 1;

export async function armazenamentoIndexedDb(nome = 'aurora-campo'): Promise<ArmazenamentoOffline> {
  const db = await new Promise<IDBDatabase>((resolver, recusar) => {
    const pedido = indexedDB.open(nome, VERSAO);
    pedido.onupgradeneeded = () => {
      const d = pedido.result;
      for (const c of COLECOES) {
        if (!d.objectStoreNames.contains(c)) d.createObjectStore(c);
      }
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => recusar(pedido.error ?? new Error('IndexedDB recusou abrir'));
    /*
     * `onblocked` acontece quando outra aba tem o banco aberto numa versão
     * antiga. Sem tratar, a promessa nunca resolve e a tela fica carregando
     * para sempre, sem nenhuma mensagem. Recusar é pior para a tela e melhor
     * para a pessoa: ela pelo menos sabe o que fazer.
     */
    pedido.onblocked = () =>
      recusar(new Error(`Outra aba do ${MARCA.produto} está aberta. Feche as outras abas e recarregue.`));
  });

  function transacao<T>(
    colecao: string,
    modo: IDBTransactionMode,
    fn: (loja: IDBObjectStore) => IDBRequest
  ): Promise<T> {
    return new Promise<T>((resolver, recusar) => {
      const tx = db.transaction(colecao, modo);
      const pedido = fn(tx.objectStore(colecao));
      pedido.onsuccess = () => resolver(pedido.result as T);
      pedido.onerror = () => recusar(pedido.error ?? new Error('IndexedDB recusou a operação'));
      /*
       * O erro da TRANSAÇÃO também precisa ser ouvido, e não só o do pedido.
       *
       * Cota estourada — o caso de borda que a SPEC lista como "dispositivo sem
       * espaço para as fotos" — chega como `QuotaExceededError` na transação, e
       * não no pedido. Sem este ouvinte, a gravação falharia em silêncio: a
       * promessa resolveria com sucesso e a fila acharia que guardou.
       */
      tx.onerror = () => recusar(tx.error ?? new Error('IndexedDB abortou a transação'));
      tx.onabort = () => recusar(tx.error ?? new Error('IndexedDB abortou a transação'));
    });
  }

  return {
    nome: 'indexeddb',
    colecao<T>(nome2: string): Colecao<T> {
      return {
        ler: (chave) => transacao<T | undefined>(nome2, 'readonly', (l) => l.get(chave)),
        /*
         * `copiaJson` NA GRAVAÇÃO, e ela não é redundante.
         *
         * A regra 3 — o que sai é cópia — o IndexedDB dá de graça, por clonagem
         * estruturada. A regra 7 ele NÃO dá: a clonagem estruturada guarda uma
         * `Date` como `Date` e devolve uma `Date`, enquanto o SQLite guarda
         * texto. Sem esta linha, o mesmo código gravaria uma data e leria um
         * objeto no navegador e uma string no aplicativo da loja — e o defeito
         * apareceria como data formatada errado numa OS, em campo, sem nenhuma
         * pista de que a causa é o empacotamento.
         *
         * Foi a suíte de conformidade rodando no navegador de verdade que
         * mostrou isto: as três plataformas precisam PERDER as mesmas coisas.
         *
         * O custo é uma ida e volta por JSON a cada gravação. Para registros do
         * tamanho destes — uma OS, um comando de fila — é ruído; a alternativa é
         * duas plataformas que discordam em silêncio.
         */
        gravar: (chave, valor) =>
          transacao<void>(nome2, 'readwrite', (l) => l.put(copiaJson(valor) as unknown as object, chave)),
        apagar: (chave) => transacao<void>(nome2, 'readwrite', (l) => l.delete(chave)),
        todos: () => transacao<T[]>(nome2, 'readonly', (l) => l.getAll()),
        limpar: () => transacao<void>(nome2, 'readwrite', (l) => l.clear()),
      };
    },
    async fechar() {
      db.close();
    },
  };
}
