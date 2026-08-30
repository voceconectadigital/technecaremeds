/**
 * Aurora — armazenamento de objetos em memória.
 *
 * Existe para os testes, e é honesto sobre isso: nada sobrevive ao processo.
 * O valor dele é que a suíte de envio retomável exercita o MESMO caminho que a
 * produção — mesma porta, mesma escrita posicional, mesmas bordas —, sem tocar
 * em disco nem em serviço externo.
 */
import type { ArmazenamentoDeObjetos } from './porta';

export function armazenamentoEmMemoria(): ArmazenamentoDeObjetos {
  const objetos = new Map<string, Uint8Array>();

  return {
    async escrever(chave, deslocamento, bytes) {
      const atual = objetos.get(chave) ?? new Uint8Array(0);
      const necessario = deslocamento + bytes.byteLength;
      const destino = necessario > atual.byteLength ? new Uint8Array(necessario) : atual.slice();
      destino.set(atual.subarray(0, Math.min(atual.byteLength, necessario)), 0);
      destino.set(bytes, deslocamento);
      objetos.set(chave, destino);
    },
    async tamanho(chave) {
      return objetos.get(chave)?.byteLength;
    },
    async ler(chave) {
      return objetos.get(chave);
    },
    async apagar(chave) {
      objetos.delete(chave);
    },
  };
}
