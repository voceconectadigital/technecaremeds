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

/*
 * A VERSÃO SOBE QUANDO UMA COLEÇÃO NOVA ENTRA.
 *
 * O IndexedDB só cria `objectStore` durante o `upgradeneeded`, e ele só dispara
 * quando o número muda. Sem subir, um aparelho que já tem a base aberta na
 * versão anterior continuaria sem a coleção nova — e a gravação falharia com
 * "NotFoundError" num aplicativo que estava funcionando ontem.
 *
 * 2: entrou `rascunhos`, para o que o técnico digitou sobreviver ao aplicativo
 *    ser derrubado pelo sistema no meio de uma OS.
 */
const VERSAO = 2;

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
      /*
       * ESCRITA PEDE DURABILIDADE ESTRITA. O padrão do Chromium é "relaxada":
       * a transação se diz completa antes de o disco confirmar, e uma bateria
       * que acaba logo depois do toque leva o comando junto. Navegador que não
       * conhece a opção a ignora.
       */
      const tx =
        modo === 'readwrite'
          ? db.transaction(colecao, modo, { durability: 'strict' })
          : db.transaction(colecao, modo);
      const pedido = fn(tx.objectStore(colecao));
      const escrita = modo === 'readwrite';
      /*
       * A LEITURA RESOLVE NO PEDIDO; A ESCRITA, SÓ NO FIM DA TRANSAÇÃO.
       *
       * O `onsuccess` do pedido quer dizer "a operação foi aceita na
       * transação", e não "está no disco". A transação ainda pode ABORTAR ao
       * consolidar — e é exatamente aí que chega a cota estourada, o caso de
       * borda que a SPEC lista como "dispositivo sem espaço para as fotos". A
       * primeira versão resolvia no `onsuccess`: a promessa dizia "guardado",
       * a fila seguia, a transação abortava depois — e o comando nunca tinha
       * existido. Ouvir `onabort` depois de resolver não adiantava: uma
       * promessa resolvida não volta atrás.
       *
       * Agora a gravação só resolve em `oncomplete`, quando o navegador
       * confirma a consolidação; `onerror`/`onabort` recusam, e quem chamou
       * fica sabendo que NÃO guardou.
       */
      pedido.onsuccess = () => {
        if (!escrita) resolver(pedido.result as T);
      };
      pedido.onerror = () => recusar(pedido.error ?? new Error('IndexedDB recusou a operação'));
      tx.oncomplete = () => {
        if (escrita) resolver(pedido.result as T);
      };
      tx.onerror = () => recusar(tx.error ?? pedido.error ?? new Error('IndexedDB abortou a transação'));
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
