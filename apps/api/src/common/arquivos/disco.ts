/**
 * Aurora — armazenamento de objetos em disco.
 *
 * É o que a homologação do cliente usa. Não depende de conta, de serviço pago
 * nem de rede: um diretório, e arquivos dentro dele.
 *
 * A CHAVE VEM DO SERVIDOR, E MESMO ASSIM É CONFERIDA.
 *
 * `buildStorageKey` já monta a chave sem nenhuma entrada do cliente, então a
 * travessia de diretório não teria por onde entrar. A conferência aqui existe
 * assim mesmo, porque esta função é a última antes de um caminho virar escrita
 * em disco — e uma barreira que depende de todo chamador anterior estar certo
 * não é barreira. Uma chave com `..`, com barra invertida ou absoluta é
 * recusada, e o custo de recusar é uma comparação de texto.
 */
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { ArmazenamentoDeObjetos } from './porta';

/** `..`, barra invertida ou caminho absoluto. Qualquer um recusa a chave. */
const CHAVE_PERIGOSA = /(^\/)|(\.\.)|(\\)/;

function caminhoSeguro(raiz: string, chave: string): string {
  if (!chave || CHAVE_PERIGOSA.test(chave)) {
    throw new Error(`chave de armazenamento inválida: ${chave}`);
  }
  const alvo = resolve(join(raiz, chave));
  const dentro = resolve(raiz) + sep;
  // A segunda barreira: mesmo que a primeira deixasse passar algo, o caminho
  // final precisa estar DENTRO da raiz, e isso é uma verdade do sistema de
  // arquivos, não do formato do texto.
  if (!alvo.startsWith(dentro)) {
    throw new Error(`chave de armazenamento inválida: ${chave}`);
  }
  return alvo;
}

export function armazenamentoEmDisco(raiz: string): ArmazenamentoDeObjetos {
  return {
    async escrever(chave, deslocamento, bytes) {
      const alvo = caminhoSeguro(raiz, chave);
      await mkdir(dirname(alvo), { recursive: true });
      /*
       * `a+` não serve: no POSIX ele IGNORA a posição na escrita e sempre
       * acrescenta ao fim, o que transformaria a reentrega de uma fatia em
       * duplicação silenciosa. `r+` escreve na posição pedida, e por isso o
       * arquivo precisa existir — daí a abertura em dois passos.
       */
      let arquivo;
      try {
        arquivo = await open(alvo, 'r+');
      } catch {
        arquivo = await open(alvo, 'w+');
      }
      try {
        await arquivo.write(bytes, 0, bytes.byteLength, deslocamento);
      } finally {
        await arquivo.close();
      }
    },
    async tamanho(chave) {
      try {
        return (await stat(caminhoSeguro(raiz, chave))).size;
      } catch {
        return undefined;
      }
    },
    async ler(chave) {
      try {
        return new Uint8Array(await readFile(caminhoSeguro(raiz, chave)));
      } catch {
        return undefined;
      }
    },
    async apagar(chave) {
      await rm(caminhoSeguro(raiz, chave), { force: true });
    },
  };
}

/** O resumo criptográfico do que está guardado — para conferir o que chegou. */
export function sha256De(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
