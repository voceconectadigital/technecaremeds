/**
 * Aurora — o envio retomável das fotos (EPIC-014 · SPEC §20).
 *
 * O QUE CADA CASO AQUI PERSEGUE é a mesma coisa que a fila de comandos
 * persegue, aplicada a bytes: nada some, nada duplica, e uma interrupção custa
 * a fatia que estava no ar — e não o arquivo inteiro.
 *
 * A rede é injetada e o relógio também. Um teste de retomada não pode depender
 * de a máquina estar lenta.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { armazenamentoEmMemoria, type Colecao } from '../../armazenamento';
import { arquivosEmMemoria } from '../adaptadores';
import { TAMANHO_DA_FATIA, type AdaptadorDeArquivos, type AnexoPendente } from '../porta';
import { enviarAnexosPendentes, estadoDosAnexos, type RespostaDaFatia } from '../envio';

let anexos: Colecao<AnexoPendente>;
let arquivos: AdaptadorDeArquivos;

const AGORA = () => new Date('2026-08-29T10:00:00.000Z');

beforeEach(() => {
  anexos = armazenamentoEmMemoria().colecao<AnexoPendente>('anexos');
  arquivos = arquivosEmMemoria();
});

/** Uma foto de `n` fatias e meia, para a última nunca ser exata. */
function bytesDeFoto(fatias: number): Uint8Array {
  const total = Math.round(TAMANHO_DA_FATIA * (fatias + 0.5));
  const b = new Uint8Array(total);
  for (let i = 0; i < total; i++) b[i] = i % 251;
  return b;
}

async function anexoPronto(id: string, dados: Uint8Array): Promise<AnexoPendente> {
  const a: AnexoPendente = {
    id,
    agregado: 'work_order:os-1',
    workOrderId: 'os-1',
    finalidade: 'after',
    nomeDoArquivo: `${id}.jpg`,
    tipo: 'image/jpeg',
    bytes: dados.byteLength,
    sha256: 'hash-de-teste',
    estado: 'registrado',
    enviados: 0,
    tentativas: 0,
    ultimoErro: null,
    chaveNoServidor: `org/os-1/${id}.jpg`,
    referenciaLocal: id,
    criadoEm: '2026-08-29T09:00:00.000Z',
  };
  await arquivos.guardar(a.referenciaLocal, dados, a.tipo);
  await anexos.gravar(a.id, a);
  return a;
}

/** Um servidor que aceita, conta, e falha quando o teste mandar. */
function servidor() {
  const recebido = new Map<string, number>();
  let falharApos: number | null = null;
  let statusDeFalha = 500;

  return {
    recebido,
    falharDepoisDe(fatias: number, status = 500) {
      falharApos = fatias;
      statusDeFalha = status;
    },
    parar() {
      falharApos = null;
    },
    fatias: 0,
    async enviarFatia({
      anexo,
      offset,
      pedaco,
    }: {
      anexo: AnexoPendente;
      offset: number;
      pedaco: Uint8Array;
      ultima: boolean;
    }): Promise<RespostaDaFatia> {
      if (falharApos !== null && this.fatias >= falharApos) {
        return { status: statusDeFalha };
      }
      this.fatias++;
      const ja = recebido.get(anexo.id) ?? 0;
      /*
       * O SERVIDOR RECUSA FATIA FORA DE ORDEM, como um servidor de verdade
       * recusaria: aceitar qualquer deslocamento deixaria o teste passar com
       * um cliente que perdeu a conta.
       */
      if (offset !== ja) return { status: 409, recebidos: ja };
      recebido.set(anexo.id, ja + pedaco.byteLength);
      return { status: 200, recebidos: ja + pedaco.byteLength };
    },
  };
}

describe('ANEXO-001 · o caminho feliz', () => {
  it('a foto sobe em fatias e some do aparelho quando o servidor confirma', async () => {
    const dados = bytesDeFoto(3);
    const a = await anexoPronto('foto-1', dados);
    const s = servidor();

    const r = await enviarAnexosPendentes(anexos, arquivos, {
      enviarFatia: (e) => s.enviarFatia(e),
      agora: AGORA,
    });

    expect(r.enviados).toBe(1);
    expect(s.recebido.get('foto-1')).toBe(dados.byteLength);
    expect((await anexos.ler(a.id))!.estado).toBe('enviado');

    /*
     * OS BYTES SÓ SAEM DEPOIS DA CONFIRMAÇÃO — a mesma regra da fila de
     * comandos. Apagar antes liberaria espaço mais cedo e transformaria uma
     * confirmação perdida em foto perdida.
     */
    expect(await arquivos.tamanho(a.referenciaLocal)).toBeUndefined();
  });

  it('uma foto menor que a fatia sobe numa vez só', async () => {
    await anexoPronto('pequena', new Uint8Array(1024));
    const s = servidor();
    const r = await enviarAnexosPendentes(anexos, arquivos, {
      enviarFatia: (e) => s.enviarFatia(e),
      agora: AGORA,
    });
    expect(r.enviados).toBe(1);
    expect(s.fatias).toBe(1);
  });
});

describe('ANEXO-002 · retomar custa a fatia, e não o arquivo', () => {
  it('a interrupção no meio guarda o progresso, e a rodada seguinte continua de onde parou', async () => {
    /*
     * É O PONTO DO ÉPICO PARA FOTOS.
     *
     * Gravar o progresso só no fim faria uma interrupção aos noventa por cento
     * recomeçar do zero — numa foto de oito megabytes em rede de hospital, a
     * diferença entre chegar e não chegar.
     */
    const dados = bytesDeFoto(5);
    const a = await anexoPronto('foto-longa', dados);
    const s = servidor();

    s.falharDepoisDe(2);
    const primeira = await enviarAnexosPendentes(anexos, arquivos, {
      enviarFatia: (e) => s.enviarFatia(e),
      agora: AGORA,
    });

    expect(primeira.enviados).toBe(0);
    expect(primeira.falharam).toBe(1);

    const meio = (await anexos.ler(a.id))!;
    expect(meio.estado).toBe('falhou');
    // Duas fatias inteiras guardadas, e nada perdido.
    expect(meio.enviados).toBe(TAMANHO_DA_FATIA * 2);
    expect(await arquivos.tamanho(a.referenciaLocal)).toBe(dados.byteLength);

    s.parar();
    const segunda = await enviarAnexosPendentes(anexos, arquivos, {
      enviarFatia: (e) => s.enviarFatia(e),
      agora: AGORA,
    });

    expect(segunda.enviados).toBe(1);
    expect(s.recebido.get('foto-longa')).toBe(dados.byteLength);
    // E o que SUBIU na segunda rodada foi só o que faltava.
    expect(segunda.bytesSubidos).toBe(dados.byteLength - TAMANHO_DA_FATIA * 2);
  });

  it('a queda de rede no meio não perde o que já subiu', async () => {
    const dados = bytesDeFoto(4);
    const a = await anexoPronto('foto-rede', dados);
    let fatias = 0;

    const r = await enviarAnexosPendentes(anexos, arquivos, {
      agora: AGORA,
      async enviarFatia({ offset, pedaco }) {
        if (fatias >= 2) throw new TypeError('Failed to fetch');
        fatias++;
        return { status: 200, recebidos: offset + pedaco.byteLength };
      },
    });

    expect(r.falharam).toBe(1);
    const depois = (await anexos.ler(a.id))!;
    expect(depois.enviados).toBe(TAMANHO_DA_FATIA * 2);
    expect(depois.ultimoErro).toContain('Failed to fetch');
  });
});

describe('ANEXO-003 · quem manda no progresso é o servidor', () => {
  it('a contagem do servidor prevalece sobre a do cliente', async () => {
    /*
     * Somar a fatia localmente parece equivalente e não é: se uma fatia chegou
     * duas vezes — retentativa depois de um tempo-limite que na verdade tinha
     * chegado —, a conta do cliente passaria do tamanho do arquivo e o envio
     * nunca terminaria.
     */
    const dados = bytesDeFoto(2);
    const a = await anexoPronto('foto-conta', dados);

    const r = await enviarAnexosPendentes(anexos, arquivos, {
      agora: AGORA,
      // O servidor diz ter TUDO já na primeira fatia — é o caso da confirmação
      // perdida, em que ele recebeu antes e o cliente não soube.
      async enviarFatia() {
        return { status: 200, recebidos: dados.byteLength };
      },
    });

    expect(r.enviados).toBe(1);
    expect((await anexos.ler(a.id))!.enviados).toBe(dados.byteLength);
  });

  it('409 quer dizer "já tenho inteiro", e a foto é dada por enviada', async () => {
    /*
     * Acontece quando o envio anterior chegou e a confirmação se perdeu — o
     * caso mais comum de rede ruim. Insistir deixaria a foto presa para sempre.
     */
    const a = await anexoPronto('foto-409', bytesDeFoto(2));
    const r = await enviarAnexosPendentes(anexos, arquivos, {
      agora: AGORA,
      async enviarFatia() {
        return { status: 409 };
      },
    });

    expect(r.enviados).toBe(1);
    expect((await anexos.ler(a.id))!.estado).toBe('enviado');
  });
});

describe('ANEXO-004 · nada some em silêncio', () => {
  it('o anexo sem registro no servidor ESPERA, e não é tentado', async () => {
    // Sem a chave do servidor não há para onde mandar. Quem garante que o
    // registro chega é a fila de comandos, não este arquivo.
    const dados = bytesDeFoto(1);
    await arquivos.guardar('sem-chave', dados, 'image/jpeg');
    await anexos.gravar('sem-chave', {
      id: 'sem-chave',
      agregado: 'work_order:os-1',
      workOrderId: 'os-1',
      finalidade: 'before',
      nomeDoArquivo: 'x.jpg',
      tipo: 'image/jpeg',
      bytes: dados.byteLength,
      sha256: 'h',
      estado: 'capturado',
      enviados: 0,
      tentativas: 0,
      ultimoErro: null,
      chaveNoServidor: null,
      referenciaLocal: 'sem-chave',
      criadoEm: '2026-08-29T09:00:00.000Z',
    });

    const r = await enviarAnexosPendentes(anexos, arquivos, {
      agora: AGORA,
      async enviarFatia() {
        throw new Error('não devia ter tentado enviar');
      },
    });

    expect(r).toEqual({ enviados: 0, falharam: 0, bytesSubidos: 0 });
    expect((await anexos.ler('sem-chave'))!.estado).toBe('capturado');
  });

  it('os bytes sumidos do aparelho viram falha EXPLICADA, e o registro fica', async () => {
    /*
     * O sistema recuperou espaço, ou alguém limpou os dados do aplicativo.
     *
     * Apagar o registro em silêncio seria descartar trabalho: só a pessoa sabe
     * se dá para tirar outra foto, e ela precisa saber que aquela não existe
     * mais para poder decidir.
     */
    const a = await anexoPronto('foto-sumida', bytesDeFoto(1));
    await arquivos.apagar(a.referenciaLocal);

    const r = await enviarAnexosPendentes(anexos, arquivos, {
      agora: AGORA,
      async enviarFatia() {
        throw new Error('não devia ter tentado enviar');
      },
    });

    expect(r.falharam).toBe(1);
    const depois = (await anexos.ler(a.id))!;
    expect(depois).toBeDefined();
    expect(depois.estado).toBe('falhou');
    expect(depois.ultimoErro).toContain('não estão mais no aparelho');
  });

  it('o servidor recusando por vezes seguidas para a RODADA, e não o anexo', async () => {
    const a = await anexoPronto('foto-teimosa', bytesDeFoto(3));
    const r = await enviarAnexosPendentes(anexos, arquivos, {
      agora: AGORA,
      async enviarFatia() {
        return { status: 503 };
      },
    });

    expect(r.falharam).toBe(1);
    const depois = (await anexos.ler(a.id))!;
    // O anexo continua lá, com os bytes, pronto para a próxima rodada.
    expect(depois.estado).toBe('falhou');
    expect(await arquivos.tamanho(a.referenciaLocal)).toBeGreaterThan(0);
    expect(depois.tentativas).toBeGreaterThan(0);
  });
});

describe('ANEXO-005 · o que a tela mostra', () => {
  it('separa o que espera do que falhou, e sabe dizer o progresso', async () => {
    const d1 = bytesDeFoto(1);
    await anexoPronto('a', d1);
    const b = await anexoPronto('b', d1);
    await anexos.gravar(b.id, { ...b, estado: 'falhou', ultimoErro: 'sem espaço' });

    const e = await estadoDosAnexos(anexos);
    expect(e.pendentes).toBe(1);
    expect(e.falhados).toBe(1);
    expect(e.progresso).toBe(0);
    expect(e.bytesPendentes).toBe(d1.byteLength * 2);
  });

  it('sem nada pendente, o progresso é ausente — e não zero', async () => {
    /*
     * Zero por cento e "não há nada" são estados diferentes, e uma barra em
     * zero por cento parada é a forma mais eficaz de fazer alguém achar que o
     * aplicativo travou.
     */
    expect((await estadoDosAnexos(anexos)).progresso).toBeNull();
  });
});

describe('ANEXO-006 · o aparelho sem espaço', () => {
  it('guardar além do limite falha com uma frase que a pessoa entende', async () => {
    // Caso de borda declarado na SPEC. O que importa não é o erro existir, é a
    // mensagem dizer o que fazer.
    const pequeno = arquivosEmMemoria(1024);
    await expect(pequeno.guardar('grande', new Uint8Array(2048), 'image/jpeg')).rejects.toThrow(
      /não há espaço no aparelho/
    );
  });

  it('o adaptador sabe dizer quanto ainda cabe', async () => {
    const a = arquivosEmMemoria(1000);
    expect(await a.espacoLivre()).toBe(1000);
    await a.guardar('x', new Uint8Array(400), 'image/jpeg');
    expect(await a.espacoLivre()).toBe(600);
  });
});
