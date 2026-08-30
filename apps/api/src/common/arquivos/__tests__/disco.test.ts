/**
 * Aurora — o armazenamento em disco (SPEC §20 · EPIC-014).
 *
 * DUAS COISAS PRECISAM SER VERDADE AQUI, E SÓ DUAS.
 *
 *  1. A ESCRITA É POSICIONAL. Gravar a mesma fatia duas vezes escreve por cima
 *     de si mesma. Se este adaptador acrescentasse ao fim — que é o que `a+`
 *     faz no POSIX, ignorando a posição pedida —, a reentrega de uma fatia,
 *     que em rede de hospital é a regra, duplicaria bytes no meio do arquivo. O
 *     resumo criptográfico só acusaria isso no último byte, depois de o técnico
 *     já ter ido embora.
 *
 *  2. A CHAVE NÃO ESCAPA DA RAIZ. A chave é montada pelo servidor e não aceita
 *     entrada do cliente, então a travessia não teria por onde entrar. A
 *     conferência existe assim mesmo porque esta é a última função antes de um
 *     texto virar caminho em disco, e uma barreira que depende de todo chamador
 *     anterior estar certo não é barreira.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { armazenamentoEmDisco, sha256De } from '../disco';

const raizes: string[] = [];

async function raizTemporaria(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'aurora-arquivos-'));
  raizes.push(dir);
  return dir;
}

afterAll(async () => {
  for (const r of raizes) await rm(r, { recursive: true, force: true });
});

describe('DISCO-001 · a escrita é posicional', () => {
  it('a mesma fatia duas vezes não duplica bytes', async () => {
    const raiz = await raizTemporaria();
    const arq = armazenamentoEmDisco(raiz);
    const chave = 'org/work-orders/os-1/anexo.bin';

    await arq.escrever(chave, 0, new Uint8Array([1, 2, 3]));
    await arq.escrever(chave, 3, new Uint8Array([4, 5, 6]));
    // A reentrega: a confirmação se perdeu, e o aparelho mandou de novo.
    await arq.escrever(chave, 3, new Uint8Array([4, 5, 6]));

    expect(await arq.tamanho(chave)).toBe(6);
    expect([...(await arq.ler(chave))!]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('escrever no meio corrige aquele trecho, e só ele', async () => {
    const raiz = await raizTemporaria();
    const arq = armazenamentoEmDisco(raiz);
    const chave = 'org/a.bin';

    await arq.escrever(chave, 0, new Uint8Array([9, 9, 9, 9]));
    await arq.escrever(chave, 1, new Uint8Array([7]));

    expect([...(await arq.ler(chave))!]).toEqual([9, 7, 9, 9]);
  });

  it('o arquivo criado é o mesmo que o disco tem', async () => {
    const raiz = await raizTemporaria();
    const arq = armazenamentoEmDisco(raiz);
    const chave = 'org/b.bin';
    const bytes = new Uint8Array([10, 20, 30, 40, 50]);

    await arq.escrever(chave, 0, bytes);
    // Lido pelo sistema de arquivos, e não pela porta: a prova precisa vir de
    // fora do objeto que está sendo testado.
    expect([...new Uint8Array(await readFile(join(raiz, chave)))]).toEqual([...bytes]);
  });
});

describe('DISCO-002 · a chave não escapa da raiz', () => {
  const perigosas = ['../fora.bin', 'org/../../fora.bin', '/etc/passwd', 'org\\windows.bin', ''];

  for (const chave of perigosas) {
    it(`recusa ${JSON.stringify(chave)}`, async () => {
      const raiz = await raizTemporaria();
      const arq = armazenamentoEmDisco(raiz);
      await expect(arq.escrever(chave, 0, new Uint8Array([1]))).rejects.toThrow(/inválida/);
    });
  }
});

describe('DISCO-003 · o que não existe devolve nada, e não explode', () => {
  it('tamanho e leitura de chave inexistente', async () => {
    const raiz = await raizTemporaria();
    const arq = armazenamentoEmDisco(raiz);
    expect(await arq.tamanho('org/nao-existe.bin')).toBeUndefined();
    expect(await arq.ler('org/nao-existe.bin')).toBeUndefined();
    // Apagar o que não existe é uma operação bem-sucedida: o desfecho desejado
    // já é o estado atual, e falhar aqui obrigaria todo chamador a conferir
    // antes de limpar.
    await expect(arq.apagar('org/nao-existe.bin')).resolves.toBeUndefined();
  });
});

describe('DISCO-004 · o resumo é o do conteúdo', () => {
  it('confere com o sha-256 conhecido da cadeia vazia', () => {
    expect(sha256De(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});
