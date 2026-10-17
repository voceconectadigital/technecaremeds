/**
 * Aurora — armazenamento em memória (EPIC-014).
 *
 * NÃO É UM SIMULADOR DE IndexedDB NEM DE SQLite.
 *
 * Ele cumpre o contrato da porta e nada mais. Fingir as peculiaridades de um
 * dos dois — transações que expiram entre `await`s, erro de cota, tipos que o
 * SQLite não guarda — daria a falsa sensação de estar testando a plataforma. A
 * plataforma é testada na plataforma; aqui se testa a LÓGICA que vive acima da
 * porta, e ela precisa de um armazenamento rápido e previsível.
 *
 * A cópia na leitura e na gravação usa `copiaJson`, a mesma conversão que o
 * adaptador de SQLite faz. Sem isso, a suíte passaria guardando uma `Date` e o
 * aparelho devolveria texto.
 */
import { COLECOES, copiaJson, type ArmazenamentoOffline, type Colecao } from './porta';

export function armazenamentoEmMemoria(): ArmazenamentoOffline {
  const dados = new Map<string, Map<string, unknown>>();

  return {
    nome: 'memoria',
    colecao<T>(nome: string): Colecao<T> {
      // A MESMA recusa do IndexedDB para coleção fora da lista (17/10/2026). Sem
      // ela, a suíte aceitou `cronometros` antes de a coleção existir, e só o E2E
      // no navegador real acusou — "object store not found".
      if (!(COLECOES as readonly string[]).includes(nome)) {
        throw new Error(`coleção desconhecida: ${nome} (acrescente em COLECOES e suba VERSAO no IndexedDB)`);
      }
      if (!dados.has(nome)) dados.set(nome, new Map());
      const m = dados.get(nome)!;
      return {
        async ler(chave) {
          const v = m.get(chave);
          return v === undefined ? undefined : (copiaJson(v) as T);
        },
        async gravar(chave, valor) {
          m.set(chave, copiaJson(valor));
        },
        async apagar(chave) {
          m.delete(chave);
        },
        async todos() {
          return [...m.values()].map((v) => copiaJson(v) as T);
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
