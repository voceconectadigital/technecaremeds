/**
 * Aurora — pente-fino do campo: cronômetro com "parar" (PF-65) e fotos
 * carimbadas com a sessão (PF-66).
 *
 * O que cada caso persegue é o mesmo da fila de comandos: nada some, nada sai
 * com a credencial de outra pessoa, e a tela não oferece um botão que só
 * produziria recusa.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { armazenamentoEmMemoria, type ArmazenamentoOffline, type Colecao } from '../armazenamento';
import { arquivosEmMemoria } from '../arquivos/adaptadores';
import { type AdaptadorDeArquivos, type AnexoPendente } from '../arquivos/porta';
import { enviarAnexosPendentes, estadoDosAnexos } from '../arquivos/envio';
import { guardarEvidencia } from '../anexos';
import { cronometroAberto } from '../cronometro';
import { FilaDeSaida, type ComandoNaFila, type Identidade, type PendenciaDeAtencao } from '../fila';
import { Sincronizacao, type PacoteDoDia } from '../sincronizacao';

const ANA: Identidade = { organizacao: 'org-a', usuario: 'ana@campo.test' };
const BRUNO: Identidade = { organizacao: 'org-a', usuario: 'bruno@campo.test' };

function comando(seq: number, caminho: string, corpo: unknown, identidade?: Identidade): ComandoNaFila {
  return {
    id: `op-${seq}`,
    seq,
    agregado: 'work_order:os-1',
    metodo: 'POST',
    caminho,
    corpo,
    rotulo: caminho,
    criadoEm: '2026-10-17T09:00:00.000Z',
    tentativas: 0,
    proximaTentativaEm: '2026-10-17T09:00:00.000Z',
    ultimoErro: null,
    bloqueado: false,
    ...(identidade ? { identidade } : {}),
  };
}

describe('PF-65 · o cronômetro aberto, visto do aparelho', () => {
  it('sem fila e sem pacote, não há cronômetro', () => {
    expect(cronometroAberto([], [])).toBeNull();
  });

  it('o aberto que veio do servidor aparece, com a hora dele', () => {
    const c = cronometroAberto(
      [],
      [{ id: 'te-1', work_order_id: 'os-9', started_at: '2026-10-17T08:15:00.000Z' }]
    );
    expect(c).toEqual({ id: 'te-1', workOrderId: 'os-9', desde: '2026-10-17T08:15:00.000Z', naFila: false });
  });

  it('o "iniciar" na fila abre com o id e a hora do aparelho; o "parar" na fila fecha', () => {
    const iniciar = comando(1, '/work-orders/os-1/timer/start', {
      id: 'te-novo',
      started_at: '2026-10-17T09:12:00.000Z',
    });
    expect(cronometroAberto([iniciar], [])).toEqual({
      id: 'te-novo',
      workOrderId: 'os-1',
      desde: '2026-10-17T09:12:00.000Z',
      naFila: true,
    });

    const parar = comando(2, '/time-entries/te-novo/stop', { ended_at: '2026-10-17T10:00:00.000Z' });
    expect(cronometroAberto([parar, iniciar], [])).toBeNull();
  });

  it('o "parar" na fila fecha também o que o servidor ainda diz aberto', () => {
    const parar = comando(1, '/time-entries/te-1/stop', {});
    expect(
      cronometroAberto(
        [parar],
        [{ id: 'te-1', work_order_id: 'os-1', started_at: '2026-10-17T08:00:00.000Z' }]
      )
    ).toBeNull();
  });

  it('o "iniciar" de OUTRA sessão não é o cronômetro de quem está com o aparelho', () => {
    const doBruno = comando(1, '/work-orders/os-1/timer/start', { id: 'te-b' }, BRUNO);
    const daSessao = (c: ComandoNaFila) => c.identidade?.usuario !== BRUNO.usuario;
    expect(cronometroAberto([doBruno], [], daSessao)).toBeNull();
  });

  it('o "iniciar" de uma versão anterior (sem id) aparece, mas sem como parar ainda', () => {
    const antigo = comando(1, '/work-orders/os-1/timer/start', {});
    const c = cronometroAberto([antigo], []);
    expect(c?.id).toBeNull();
    expect(c?.desde).toBe('2026-10-17T09:00:00.000Z');
  });
});

describe('PF-65 · o pacote do dia substitui o cronômetro mesmo na descida incremental', () => {
  let base: ArmazenamentoOffline;
  let fila: FilaDeSaida;

  beforeEach(() => {
    base = armazenamentoEmMemoria();
    fila = new FilaDeSaida(base.colecao<ComandoNaFila>('fila'), base.colecao<PendenciaDeAtencao>('atencao'), {
      enviar: async () => ({ status: 200, corpo: {} }),
      agora: () => new Date('2026-10-17T09:00:00.000Z'),
      novoId: () => 'op-x',
    });
  });

  function pacote(over: Partial<PacoteDoDia>): PacoteDoDia {
    return {
      synced_at: '2026-10-17T09:00:00.000Z',
      incremental: true,
      work_orders: [],
      assets: [],
      locations: [],
      checklist_templates: [],
      catalogs: [],
      statuses: [],
      transitions: [],
      wait_reasons: [],
      stock: [],
      counts: {},
      ...over,
    };
  }

  it('parado na web, o cronômetro some do aparelho na próxima descida (incremental)', async () => {
    const cronometros = base.colecao<{ id: string }>('cronometros');
    await cronometros.gravar('te-1', { id: 'te-1' });

    const s = new Sincronizacao(base, fila, {
      baixarPacote: async () => pacote({ open_timers: [] }),
      agora: () => new Date('2026-10-17T09:00:00.000Z'),
    });
    await s.rodar();
    expect(await cronometros.todos()).toEqual([]);
  });

  it('servidor que não manda `open_timers` não apaga o que o aparelho sabe', async () => {
    const cronometros = base.colecao<{ id: string }>('cronometros');
    await cronometros.gravar('te-1', { id: 'te-1' });

    const s = new Sincronizacao(base, fila, {
      baixarPacote: async () => pacote({}),
      agora: () => new Date('2026-10-17T09:00:00.000Z'),
    });
    await s.rodar();
    expect(await cronometros.todos()).toHaveLength(1);
  });
});

describe('PF-66 · a foto é de quem a tirou', () => {
  let anexos: Colecao<AnexoPendente>;
  let arquivos: AdaptadorDeArquivos;

  beforeEach(() => {
    anexos = armazenamentoEmMemoria().colecao<AnexoPendente>('anexos');
    arquivos = arquivosEmMemoria();
  });

  async function pronto(id: string, identidade?: Identidade): Promise<AnexoPendente> {
    const dados = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const a: AnexoPendente = {
      id,
      agregado: 'work_order:os-1',
      workOrderId: 'os-1',
      finalidade: 'after',
      nomeDoArquivo: `${id}.jpg`,
      tipo: 'image/jpeg',
      bytes: dados.byteLength,
      sha256: 'hash',
      estado: 'registrado',
      enviados: 0,
      tentativas: 0,
      ultimoErro: null,
      chaveNoServidor: `org/os-1/${id}.jpg`,
      idNoServidor: `srv-${id}`,
      referenciaLocal: id,
      criadoEm: '2026-10-17T09:00:00.000Z',
      ...(identidade ? { identidade } : {}),
    };
    await arquivos.guardar(id, dados, a.tipo);
    await anexos.gravar(id, a);
    return a;
  }

  it('a captura carimba a foto com a sessão de quem capturou', async () => {
    const a = await guardarEvidencia({
      workOrderId: 'os-1',
      finalidade: 'before',
      arquivos,
      anexos,
      novoId: () => 'foto-1',
      agora: () => new Date('2026-10-17T09:00:00.000Z'),
      identidade: () => ANA,
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      tipo: 'image/jpeg',
      enfileirar: async () => 'foto-1',
    });
    expect(a.identidade).toEqual(ANA);
    expect((await anexos.ler('foto-1'))?.identidade).toEqual(ANA);
  });

  it('com Bruno logado, a foto de Ana NÃO sobe, não é apagada e é contada como de outra sessão', async () => {
    await pronto('da-ana', ANA);
    await pronto('do-bruno', BRUNO);
    const subiram: string[] = [];

    const r = await enviarAnexosPendentes(anexos, arquivos, {
      agora: () => new Date('2026-10-17T10:00:00.000Z'),
      identidade: () => BRUNO,
      async enviarFatia({ anexo, pedaco }) {
        subiram.push(anexo.id);
        return { status: 200, recebidos: pedaco.byteLength };
      },
    });

    expect(subiram).toEqual(['do-bruno']);
    expect(r.enviados).toBe(1);
    expect(r.deOutraSessao).toBe(1);
    const daAna = (await anexos.ler('da-ana'))!;
    expect(daAna.estado).toBe('registrado');
    expect(await arquivos.tamanho('da-ana')).toBeGreaterThan(0);

    const e = await estadoDosAnexos(anexos, BRUNO);
    expect(e.deOutraSessao).toBe(1);
    expect(e.pendentes).toBe(0);

    // Ana entra de novo: a foto dela sobe.
    const r2 = await enviarAnexosPendentes(anexos, arquivos, {
      agora: () => new Date('2026-10-17T11:00:00.000Z'),
      identidade: () => ANA,
      async enviarFatia({ pedaco }) {
        return { status: 200, recebidos: pedaco.byteLength };
      },
    });
    expect(r2.enviados).toBe(1);
    expect((await anexos.ler('da-ana'))!.estado).toBe('enviado');
  });

  it('foto gravada antes desta versão (sem carimbo) continua sendo da sessão atual', async () => {
    await pronto('antiga');
    const r = await enviarAnexosPendentes(anexos, arquivos, {
      agora: () => new Date('2026-10-17T10:00:00.000Z'),
      identidade: () => BRUNO,
      async enviarFatia({ pedaco }) {
        return { status: 200, recebidos: pedaco.byteLength };
      },
    });
    expect(r).toMatchObject({ enviados: 1, deOutraSessao: 0 });
  });

  it('outra organização, mesma pessoa: também é outra sessão', async () => {
    await pronto('org-b', { organizacao: 'org-b', usuario: ANA.usuario });
    const e = await estadoDosAnexos(anexos, ANA);
    expect(e.deOutraSessao).toBe(1);
  });
});
