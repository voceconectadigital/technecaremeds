/**
 * Aurora — onde os bytes ficam, em cada plataforma (EPIC-014).
 *
 * Três implementações da mesma porta. A suíte de conformidade roda contra todas
 * as que existem no ambiente em que ela roda — e a de memória existe em todos.
 */
import type { AdaptadorDeArquivos, ReferenciaDeArquivo } from './porta';

/* -------------------------------------------------------------------------- */
/* memória — a suíte                                                           */
/* -------------------------------------------------------------------------- */

export function arquivosEmMemoria(limiteEmBytes = 64 * 1024 * 1024): AdaptadorDeArquivos {
  const dados = new Map<string, Uint8Array>();
  const usado = () => [...dados.values()].reduce((t, b) => t + b.byteLength, 0);

  return {
    nome: 'memoria',
    async guardar(ref, bytes) {
      /*
       * O LIMITE EXISTE DE PROPÓSITO, mesmo em memória.
       *
       * "Dispositivo sem espaço para as fotos" é caso de borda declarado na
       * SPEC, e um adaptador de teste sem limite tornaria esse caminho
       * impossível de exercitar sem um aparelho cheio na mão.
       */
      if (usado() - (dados.get(ref)?.byteLength ?? 0) + bytes.byteLength > limiteEmBytes) {
        throw new Error('não há espaço no aparelho para guardar esta foto');
      }
      dados.set(ref, bytes.slice());
    },
    async fatia(ref, inicio, fim) {
      const b = dados.get(ref);
      if (!b) throw new Error(`arquivo ${ref} não está no aparelho`);
      return b.slice(inicio, Math.min(fim, b.byteLength));
    },
    async tamanho(ref) {
      return dados.get(ref)?.byteLength;
    },
    async apagar(ref) {
      dados.delete(ref);
    },
    async espacoLivre() {
      return Math.max(0, limiteEmBytes - usado());
    },
  };
}

/* -------------------------------------------------------------------------- */
/* navegador — Cache Storage                                                   */
/* -------------------------------------------------------------------------- */

const CACHE_DE_ANEXOS = 'aurora-campo-anexos-v1';
const RAIZ = 'https://anexo.aurora.local/';

/**
 * No navegador, os bytes ficam no CACHE STORAGE, e não no IndexedDB.
 *
 * Três razões, nesta ordem:
 *
 *  1. o Cache Storage é feito para corpo de resposta — ou seja, para binário
 *     grande. Guardar dez megabytes de foto no IndexedDB junto com os
 *     registros mistura dois perfis de uso muito diferentes no mesmo banco, e
 *     é o banco que a fila precisa que seja rápido;
 *  2. o `Blob` que ele devolve é preguiçoso: `slice` de um pedaço não carrega
 *     o arquivo inteiro para a memória, que é exatamente o que o envio
 *     retomável precisa;
 *  3. apagar é uma operação só, e não uma transação — a limpeza depois do envio
 *     não disputa com a fila.
 *
 * A alternativa moderna é o sistema de arquivos privado da origem (OPFS). Ele é
 * melhor para arquivo muito grande e ainda não está em todo navegador que este
 * produto precisa atender; a porta permite trocar sem tocar em nada acima.
 */
export function arquivosNoCacheStorage(): AdaptadorDeArquivos {
  const url = (ref: ReferenciaDeArquivo) => RAIZ + encodeURIComponent(ref);

  return {
    nome: 'cache-storage',
    async guardar(ref, bytes, tipo) {
      const cache = await caches.open(CACHE_DE_ANEXOS);
      try {
        await cache.put(
          url(ref),
          new Response(bytes as unknown as BodyInit, {
            headers: { 'content-type': tipo, 'content-length': String(bytes.byteLength) },
          })
        );
      } catch (e) {
        /*
         * `QuotaExceededError` chega aqui, e é o caso de borda da SPEC. A
         * mensagem é traduzida para o que a pessoa pode fazer, porque
         * "QuotaExceededError" não diz nada a ninguém em campo.
         */
        throw new Error(
          'não há espaço no aparelho para guardar esta foto — envie as pendentes antes de capturar mais',
          { cause: e }
        );
      }
    },
    async fatia(ref, inicio, fim) {
      const cache = await caches.open(CACHE_DE_ANEXOS);
      const r = await cache.match(url(ref));
      if (!r) throw new Error(`arquivo ${ref} não está no aparelho`);
      const blob = await r.blob();
      return new Uint8Array(await blob.slice(inicio, Math.min(fim, blob.size)).arrayBuffer());
    },
    async tamanho(ref) {
      const cache = await caches.open(CACHE_DE_ANEXOS);
      const r = await cache.match(url(ref));
      if (!r) return undefined;
      const declarado = r.headers.get('content-length');
      if (declarado) return Number(declarado);
      return (await r.blob()).size;
    },
    async apagar(ref) {
      const cache = await caches.open(CACHE_DE_ANEXOS);
      await cache.delete(url(ref));
    },
    async espacoLivre() {
      /*
       * O navegador dá uma ESTIMATIVA, e às vezes não dá nada. `null` é
       * resposta legítima — chutar um número faria a tela prometer espaço que
       * pode não existir.
       */
      if (!navigator.storage?.estimate) return null;
      const { quota, usage } = await navigator.storage.estimate();
      if (quota === undefined || usage === undefined) return null;
      return Math.max(0, quota - usage);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* aparelho — sistema de arquivos via Capacitor                                */
/* -------------------------------------------------------------------------- */

/**
 * O mínimo que o plugin de sistema de arquivos precisa oferecer.
 *
 * A porta existe para o adaptador não importar o plugin: no navegador o pacote
 * do Capacitor não seria carregado, e importá-lo estaticamente entraria no
 * bundle do PWA sem nunca ser usado.
 *
 * Os nomes seguem o formato do plugin `@capacitor/filesystem` — texto em base64
 * para binário, caminho relativo a um diretório —, e a conversão fica no
 * adaptador, que é onde ela deve estar.
 */
export interface PluginDeArquivos {
  writeFile(o: { path: string; data: string; directory: string }): Promise<unknown>;
  readFile(o: { path: string; directory: string }): Promise<{ data: string | Blob }>;
  deleteFile(o: { path: string; directory: string }): Promise<unknown>;
  stat(o: { path: string; directory: string }): Promise<{ size: number }>;
}

/**
 * No aparelho, os bytes vão para o SISTEMA DE ARQUIVOS.
 *
 * É onde o Android e o iOS sabem cuidar de arquivo grande: o sistema pode
 * mover, comprimir e — quando o aparelho aperta — pedir espaço de volta, coisas
 * que ele não faz com o banco de dados do aplicativo.
 *
 * O diretório é `Data`: privado ao aplicativo e não visível na galeria. Uma foto
 * de laudo de equipamento hospitalar num álbum compartilhado seria vazamento de
 * dado de cliente pelo caminho mais banal possível.
 */
export function arquivosNoAparelho(plugin: PluginDeArquivos, diretorio = 'DATA'): AdaptadorDeArquivos {
  const caminho = (ref: ReferenciaDeArquivo) => `aurora/anexos/${ref}`;

  return {
    nome: 'filesystem',
    async guardar(ref, bytes) {
      await plugin.writeFile({ path: caminho(ref), data: paraBase64(bytes), directory: diretorio });
    },
    async fatia(ref, inicio, fim) {
      /*
       * O PLUGIN NÃO LÊ PEDAÇO, e por isso a fatia é feita aqui.
       *
       * É uma limitação real e está escrita: para as fotos deste produto —
       * poucos megabytes — ler e cortar é aceitável. Se um dia entrar vídeo,
       * este é o ponto que precisa mudar, e ele está isolado num lugar só.
       */
      const { data } = await plugin.readFile({ path: caminho(ref), directory: diretorio });
      const todos = typeof data === 'string' ? deBase64(data) : new Uint8Array(await data.arrayBuffer());
      return todos.slice(inicio, Math.min(fim, todos.byteLength));
    },
    async tamanho(ref) {
      try {
        const { size } = await plugin.stat({ path: caminho(ref), directory: diretorio });
        return size;
      } catch {
        // O plugin lança quando o arquivo não existe; a porta manda devolver
        // `undefined`. Traduzir aqui é o trabalho do adaptador.
        return undefined;
      }
    },
    async apagar(ref) {
      try {
        await plugin.deleteFile({ path: caminho(ref), directory: diretorio });
      } catch {
        /* apagar o que não existe não é erro — regra da porta */
      }
    },
    async espacoLivre() {
      /*
       * A VALIDAR: o `@capacitor/filesystem` não expõe espaço livre do
       * aparelho. Existe plugin de terceiros que expõe, e adotá-lo é decisão a
       * tomar com o cliente. Até lá, `null` — que a porta admite e a tela sabe
       * mostrar como "não dá para saber".
       */
      return null;
    },
  };
}

function paraBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function deBase64(texto: string): Uint8Array {
  const bruto = atob(texto);
  const out = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i++) out[i] = bruto.charCodeAt(i);
  return out;
}
