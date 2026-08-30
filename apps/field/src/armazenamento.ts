/**
 * Aurora — a base local do aparelho (SPEC v0.2 §20 · EPIC-014).
 *
 * POR QUE UMA PORTA, E NÃO IndexedDB DIRETO
 *
 * O que precisa ser provado neste épico não é o IndexedDB: é a ORDEM da fila, a
 * retentativa, e a garantia de que nada é descartado em silêncio. Essas três
 * coisas são lógica, e lógica se prova com testes determinísticos.
 *
 * Amarrá-las ao IndexedDB obrigaria a suíte a subir um navegador — ou a
 * carregar um simulador de banco — para exercitar decisões que não têm nada de
 * navegador. O que sobraria seriam testes lentos que ninguém roda, num épico
 * cujo risco declarado é "perda silenciosa de trabalho".
 *
 * Então a fila fala com uma PORTA. O adaptador de memória serve à suíte; o de
 * IndexedDB serve ao aparelho e é exercitado no navegador de verdade, pelo
 * Playwright. É o mesmo arranjo que separa `Database` de `pgPoolAdapter` no
 * servidor, e pela mesma razão.
 */

/** Uma coleção de registros com chave de texto. */
export interface Colecao<T> {
  ler(chave: string): Promise<T | undefined>;
  gravar(chave: string, valor: T): Promise<void>;
  apagar(chave: string): Promise<void>;
  todos(): Promise<T[]>;
  limpar(): Promise<void>;
}

export interface BaseLocal {
  colecao<T>(nome: string): Colecao<T>;
  fechar(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* memória — para a suíte                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A base de memória NÃO é um simulador de IndexedDB.
 *
 * Ela cumpre o contrato da porta e nada mais. Fingir as peculiaridades do
 * IndexedDB — transações que expiram entre `await`s, erros de cota — daria a
 * falsa sensação de estar testando o navegador, e o navegador é testado no
 * navegador.
 */
export function baseEmMemoria(): BaseLocal {
  const dados = new Map<string, Map<string, unknown>>();

  return {
    colecao<T>(nome: string): Colecao<T> {
      if (!dados.has(nome)) dados.set(nome, new Map());
      const m = dados.get(nome)!;
      return {
        async ler(chave) {
          // Cópia na leitura: sem ela, quem lê recebe a MESMA referência que
          // está guardada e uma alteração no objeto lido mudaria o registro sem
          // passar por `gravar`. No IndexedDB isso é impossível — e um teste
          // que passa por causa dessa diferença esconde um defeito real.
          const v = m.get(chave);
          return v === undefined ? undefined : (structuredClone(v) as T);
        },
        async gravar(chave, valor) {
          m.set(chave, structuredClone(valor));
        },
        async apagar(chave) {
          m.delete(chave);
        },
        async todos() {
          return [...m.values()].map((v) => structuredClone(v) as T);
        },
        async limpar() {
          m.clear();
        },
      };
    },
    async fechar() {
      dados.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* IndexedDB — para o aparelho                                                 */
/* -------------------------------------------------------------------------- */

/**
 * As coleções são declaradas na abertura, e não sob demanda.
 *
 * O IndexedDB só permite criar `objectStore` durante o `upgradeneeded`. Criar
 * uma coleção depois exigiria subir a versão e reabrir o banco — no meio do
 * trabalho, com dados dentro. A lista fechada evita isso, e tem a virtude de
 * dizer, num lugar só, tudo que o aparelho guarda.
 */
export const COLECOES = [
  'ordens',
  'ativos',
  'locais',
  'checklists',
  'catalogos',
  'situacoes',
  'transicoes',
  'motivos',
  'estoque',
  /** A fila de saída. É a coleção que não pode perder um registro. */
  'fila',
  /** O que o servidor recusou, esperando decisão de gente. */
  'atencao',
  /** Marcas: último `synced_at`, identidade, versão do pacote. */
  'meta',
] as const;

const VERSAO = 1;

export async function baseIndexedDb(nome = 'aurora-campo'): Promise<BaseLocal> {
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
     * para sempre — sem nenhuma mensagem. Recusar é pior para a tela e melhor
     * para a pessoa: ela pelo menos sabe o que fazer.
     */
    pedido.onblocked = () =>
      recusar(new Error('Outra aba do Aurora está aberta. Feche as outras abas e recarregue.'));
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
    colecao<T>(nome2: string): Colecao<T> {
      return {
        ler: (chave) => transacao<T | undefined>(nome2, 'readonly', (l) => l.get(chave)),
        gravar: (chave, valor) =>
          transacao<void>(nome2, 'readwrite', (l) => l.put(valor as unknown as object, chave)),
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
