/**
 * Aurora — a gravação no IndexedDB só diz "guardado" depois de consolidar.
 *
 * NÃO É UM SIMULADOR DE IndexedDB, e por isso a conformidade continua rodando
 * no navegador de verdade (tela de diagnóstico do aparelho). O que este falso
 * encena é UMA sequência de eventos que o navegador produz e a suíte em Node
 * não alcança: o pedido dá `success`, e a TRANSAÇÃO aborta depois, ao
 * consolidar — é assim que chega a cota estourada.
 *
 * A primeira versão do adaptador resolvia no `success` do pedido. Com esta
 * sequência, a promessa dizia "guardado", a fila seguia em frente, e o comando
 * nunca tinha existido. O que se prova aqui é a reação do ADAPTADOR à
 * sequência, e não o IndexedDB.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { armazenamentoIndexedDb } from '../indexeddb';

type Desfecho = 'completa' | 'aborta';

interface Pedido {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

function indexedDbFalso(desfecho: () => Desfecho, opcoesVistas: unknown[]) {
  const dados = new Map<string, unknown>();
  const depois = (fn: () => void) => setTimeout(fn, 0);

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction(_colecao: string, modo: string, opcoes?: unknown) {
      opcoesVistas.push({ modo, opcoes });
      const tx = {
        error: null as unknown,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore() {
          const operar = (fazer: () => unknown, escrita: boolean): Pedido => {
            const pedido: Pedido = { result: undefined, error: null, onsuccess: null, onerror: null };
            depois(() => {
              pedido.result = fazer();
              pedido.onsuccess?.();
              depois(() => {
                if (escrita && desfecho() === 'aborta') {
                  tx.error = Object.assign(new Error('a cota do armazenamento acabou'), {
                    name: 'QuotaExceededError',
                  });
                  tx.onabort?.();
                } else {
                  tx.oncomplete?.();
                }
              });
            });
            return pedido;
          };
          return {
            put: (v: unknown, k: string) => operar(() => (dados.set(k, v), k), true),
            get: (k: string) => operar(() => dados.get(k), false),
            delete: (k: string) => operar(() => dados.delete(k), true),
            getAll: () => operar(() => [...dados.values()], false),
            clear: () => operar(() => dados.clear(), true),
          };
        },
      };
      return tx;
    },
  };

  return {
    open() {
      const pedido = {
        result: db,
        error: null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
        onblocked: null as (() => void) | null,
      };
      depois(() => pedido.onsuccess?.());
      return pedido;
    },
  };
}

const original = (globalThis as { indexedDB?: unknown }).indexedDB;
afterEach(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = original;
});

describe('IDB-001 · a escrita espera a consolidação', () => {
  it('cota estourada ao consolidar RECUSA a gravação, mesmo com o pedido em `success`', async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = indexedDbFalso(() => 'aborta', []);
    const base = await armazenamentoIndexedDb('teste');
    await expect(base.colecao('fila').gravar('op-1', { id: 'op-1' })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
  });

  it('a gravação consolidada resolve, e a leitura devolve o que foi guardado', async () => {
    const opcoes: unknown[] = [];
    (globalThis as { indexedDB?: unknown }).indexedDB = indexedDbFalso(() => 'completa', opcoes);
    const base = await armazenamentoIndexedDb('teste');
    await base.colecao('fila').gravar('op-1', { id: 'op-1' });
    expect(await base.colecao('fila').ler('op-1')).toEqual({ id: 'op-1' });
    // Escrita pede durabilidade estrita; leitura não precisa.
    expect(opcoes).toEqual([
      { modo: 'readwrite', opcoes: { durability: 'strict' } },
      { modo: 'readonly', opcoes: undefined },
    ]);
  });
});

describe('versão da base local', () => {
  it('coleção nova exige subir VERSAO (senão o aparelho com a base aberta não a recebe)', async () => {
    const { VERSAO, COLECOES_POR_VERSAO } = await import('../indexeddb');
    const { COLECOES } = await import('../porta');
    expect(COLECOES_POR_VERSAO[VERSAO], `registre COLECOES_POR_VERSAO[${VERSAO}]`).toBe(COLECOES.length);
  });
});
