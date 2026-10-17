/**
 * Aurora — descer o dia e subir o trabalho (EPIC-014 · SPEC §20).
 *
 * O que estes casos perseguem é a ORDEM e a IDEMPOTÊNCIA da gravação local.
 * São dois lugares em que um erro não aparece como falha: aparece como um dado
 * plausível e errado no aparelho de alguém que está no subsolo.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { armazenamentoEmMemoria, type ArmazenamentoOffline } from '../armazenamento';
import { FilaDeSaida, type ComandoNaFila, type PendenciaDeAtencao } from '../fila';
import { ErroDeSessaoExpirada, Sincronizacao, mensagemParaATela, type PacoteDoDia } from '../sincronizacao';

function pacote(over: Partial<PacoteDoDia> = {}): PacoteDoDia {
  return {
    synced_at: '2026-08-29T08:00:00.000Z',
    incremental: false,
    work_orders: [{ id: 'os-1' }, { id: 'os-2' }],
    assets: [{ id: 'at-1' }],
    locations: [{ id: 'lo-1' }],
    checklist_templates: [{ id: 'ck-1' }],
    catalogs: [{ id: 'ca-1' }],
    statuses: [{ id: 'st-1' }],
    transitions: [
      { from_key: 'open', to_key: 'in_progress' },
      { from_key: 'in_progress', to_key: 'completed' },
    ],
    wait_reasons: [{ id: 'mo-1' }],
    stock: [{ item_id: 'it-1', warehouse_id: 'wh-1' }],
    counts: {},
    ...over,
  };
}

let base: ArmazenamentoOffline;
let fila: FilaDeSaida;
let enviados: ComandoNaFila[];

beforeEach(() => {
  base = armazenamentoEmMemoria();
  enviados = [];
  fila = new FilaDeSaida(base.colecao<ComandoNaFila>('fila'), base.colecao<PendenciaDeAtencao>('atencao'), {
    enviar: async (c) => {
      enviados.push(c);
      return { status: 200, corpo: {} };
    },
    agora: () => new Date('2026-08-29T08:00:00.000Z'),
    novoId: () => `op-${enviados.length + 1}`,
  });
});

function sincronizacao(baixar: (desde: string | null) => Promise<PacoteDoDia>) {
  return new Sincronizacao(base, fila, {
    baixarPacote: baixar,
    agora: () => new Date('2026-08-29T08:00:00.000Z'),
  });
}

describe('SYNC-001 · sobe antes de descer', () => {
  it('a fila é escoada ANTES de o pacote chegar', async () => {
    /*
     * Se o pacote descesse primeiro, ele sobrescreveria a base local com o
     * estado do servidor — que ainda não sabe do trabalho que está na fila. O
     * técnico veria a OS voltar para "em execução" depois de ter concluído, e
     * concluiria de novo.
     */
    const ordem: string[] = [];
    await fila.enfileirar({
      agregado: 'work_order:os-1',
      metodo: 'POST',
      caminho: '/v1/x',
      corpo: {},
      rotulo: 'Concluir',
    });

    const s = new Sincronizacao(base, fila, {
      baixarPacote: async () => {
        ordem.push('desceu');
        return pacote();
      },
      agora: () => new Date('2026-08-29T08:00:00.000Z'),
    });

    const filaOriginal = fila.escoar.bind(fila);
    fila.escoar = async () => {
      ordem.push('subiu');
      return filaOriginal();
    };

    const r = await s.rodar();
    expect(ordem).toEqual(['subiu', 'desceu']);
    expect(r.enviados).toBe(1);
  });

  it('falhar ao descer não apaga o que subiu', async () => {
    /*
     * O número precisa aparecer na tela. Um "falhou" seco depois de a fila ter
     * esvaziado faria o técnico sincronizar de novo por desconfiança — e a
     * segunda vez não teria nada para mandar, confirmando a desconfiança.
     */
    await fila.enfileirar({
      agregado: 'work_order:os-1',
      metodo: 'POST',
      caminho: '/v1/x',
      corpo: {},
      rotulo: 'Concluir',
    });

    const s = sincronizacao(async () => {
      throw new TypeError('Failed to fetch');
    });

    const r = await s.rodar();
    expect(r.enviados).toBe(1);
    expect(r.falha).toContain('Failed to fetch');
    expect(r.baixados).toEqual({});
  });
});

describe('SYNC-002 · a base local fica igual ao pacote', () => {
  it('cada coleção é gravada com a sua chave', async () => {
    const s = sincronizacao(async () => pacote());
    const r = await s.rodar();

    expect(r.baixados).toEqual({
      ordens: 2,
      ativos: 1,
      locais: 1,
      checklists: 1,
      catalogos: 1,
      situacoes: 1,
      transicoes: 2,
      motivos: 1,
      estoque: 1,
    });

    expect(await base.colecao('ordens').todos()).toHaveLength(2);
  });

  it('transição e saldo têm chave COMPOSTA, e não se sobrescrevem', async () => {
    /*
     * Nenhum dos dois tem identificador próprio. Com uma chave só, cada
     * sincronização deixaria o aparelho com UMA transição — e uma tela offline
     * sem grafo oferece todos os botões, que é a origem de metade dos conflitos
     * de um dia.
     */
    const s = sincronizacao(async () => pacote());
    await s.rodar();

    expect(await base.colecao('transicoes').todos()).toHaveLength(2);
    expect(await base.colecao<{ from_key: string }>('transicoes').ler('open->in_progress')).toEqual({
      from_key: 'open',
      to_key: 'in_progress',
    });
    expect(await base.colecao('estoque').ler('it-1@wh-1')).toBeDefined();
  });

  it('sincronizar duas vezes não duplica nada', async () => {
    const s = sincronizacao(async () => pacote());
    await s.rodar();
    await s.rodar();
    expect(await base.colecao('ordens').todos()).toHaveLength(2);
    expect(await base.colecao('transicoes').todos()).toHaveLength(2);
  });
});

describe('SYNC-003 · o incremental sobrepõe, o completo substitui', () => {
  it('o pacote incremental NÃO apaga o que não mudou', async () => {
    /*
     * Limpar sempre apagaria, no incremental, tudo que não mudou — que é quase
     * tudo. O técnico ficaria com uma OS na tela porque foi a única alterada
     * desde a manhã, e concluiria que perdeu o dia.
     */
    await sincronizacao(async () => pacote()).rodar();
    expect(await base.colecao('ordens').todos()).toHaveLength(2);

    await sincronizacao(async () => pacote({ incremental: true, work_orders: [{ id: 'os-3' }] })).rodar();

    const ordens = await base.colecao<{ id: string }>('ordens').todos();
    expect(ordens.map((o) => o.id).sort()).toEqual(['os-1', 'os-2', 'os-3']);
  });

  it('o pacote completo substitui: a OS que saiu do escopo some do aparelho', async () => {
    await sincronizacao(async () => pacote()).rodar();
    await sincronizacao(async () => pacote({ work_orders: [{ id: 'os-2' }] })).rodar();

    const ordens = await base.colecao<{ id: string }>('ordens').todos();
    expect(ordens.map((o) => o.id)).toEqual(['os-2']);
  });
});

describe('SYNC-004 · a marca do dia', () => {
  it('é o instante do SERVIDOR, e volta como `since` na chamada seguinte', async () => {
    /*
     * A SPEC lista "relógio do dispositivo errado" entre os casos de borda. Um
     * celular adiantado pediria "o que mudou desde 2027" e iria a campo com o
     * pacote vazio, achando que está em dia.
     */
    const pedidos: (string | null)[] = [];
    const s = sincronizacao(async (desde) => {
      pedidos.push(desde);
      return pacote({ synced_at: '2026-08-29T09:15:00.000Z' });
    });

    await s.rodar();
    await s.rodar();

    expect(pedidos).toEqual([null, '2026-08-29T09:15:00.000Z']);
  });

  it('não é gravada quando o download falha', async () => {
    /*
     * Gravá-la antes faria uma falha no meio deixar o aparelho achando que
     * baixou o dia inteiro — e a sincronização incremental seguinte pularia
     * justamente o que faltou.
     *
     * O pior caso desta ordem é baixar de novo o que já estava. O pior caso da
     * outra é um dia com buracos, e ninguém sabendo.
     */
    const s = sincronizacao(async () => {
      throw new Error('caiu no meio');
    });
    await s.rodar();
    expect(await s.ultimaMarca()).toBeNull();
  });
});

describe('SYNC-005 · sessão vencida', () => {
  it('401 ao pedir o dia vira "entre de novo", e não "sem rede" nem erro cru', async () => {
    const s = sincronizacao(async () => {
      throw new ErroDeSessaoExpirada();
    });
    const r = await s.rodar();
    expect(r.sessaoExpirada).toBe(true);
    expect(r.semRede).toBe(false);
    expect(r.falha).toContain('Entre de novo');
  });

  it('401 na fila: os comandos ficam, nada vai para a atenção, e o dia nem é pedido', async () => {
    const naFila = new FilaDeSaida(
      base.colecao<ComandoNaFila>('fila'),
      base.colecao<PendenciaDeAtencao>('atencao'),
      {
        enviar: async () => ({ status: 401, corpo: null }),
        agora: () => new Date('2026-08-29T08:00:00.000Z'),
        novoId: () => 'op-401',
      }
    );
    await naFila.enfileirar({
      agregado: 'work_order:os-1',
      metodo: 'POST',
      caminho: '/x',
      corpo: {},
      rotulo: 'Concluir',
    });

    let pediu = false;
    const s = new Sincronizacao(base, naFila, {
      baixarPacote: async () => {
        pediu = true;
        return pacote();
      },
      agora: () => new Date('2026-08-29T08:00:00.000Z'),
    });
    const r = await s.rodar();

    expect(r.sessaoExpirada).toBe(true);
    expect(pediu).toBe(false);
    expect(await naFila.listar()).toHaveLength(1);
    expect(await naFila.listarAtencao()).toEqual([]);
  });
});

describe('SYNC-006 · o dia baixado é de uma sessão', () => {
  it('trocar de pessoa limpa o que foi baixado e pede o dia COMPLETO — sem tocar na fila', async () => {
    let quem: { organizacao: string; usuario: string } = { organizacao: 'org-a', usuario: 'ana@x.com' };
    const pedidos: (string | null)[] = [];
    const s = new Sincronizacao(base, fila, {
      baixarPacote: async (desde) => {
        pedidos.push(desde);
        return pacote({ synced_at: '2026-08-29T09:00:00.000Z' });
      },
      agora: () => new Date('2026-08-29T08:00:00.000Z'),
      identidade: () => quem,
    });
    await s.rodar();
    expect(await base.colecao('ordens').todos()).toHaveLength(2);

    // Um comando de Ana fica na fila (sem rede para ele).
    await base.colecao<ComandoNaFila>('fila').gravar('op-ana', {
      id: 'op-ana',
      seq: 1,
      agregado: 'work_order:os-1',
      metodo: 'POST',
      caminho: '/x',
      corpo: {},
      rotulo: 'Concluir',
      criadoEm: '2026-08-29T08:00:00.000Z',
      tentativas: 0,
      proximaTentativaEm: '2099-01-01T00:00:00.000Z',
      ultimoErro: null,
      bloqueado: false,
      identidade: { organizacao: 'org-a', usuario: 'ana@x.com' },
    });

    quem = { organizacao: 'org-a', usuario: 'bruno@x.com' };
    const falhando = new Sincronizacao(base, fila, {
      baixarPacote: async () => {
        throw new TypeError('Failed to fetch');
      },
      agora: () => new Date('2026-08-29T08:00:00.000Z'),
      identidade: () => quem,
    });
    await falhando.rodar();

    // Bruno, mesmo sem rede, não vê as OS de Ana — e a marca dela sumiu.
    expect(await base.colecao('ordens').todos()).toEqual([]);
    expect(await falhando.ultimaMarca()).toBeNull();
    // O trabalho de Ana continua guardado.
    expect((await fila.listar()).map((c) => c.id)).toEqual(['op-ana']);

    await s.rodar();
    expect(pedidos).toEqual([null, null]);
  });

  it('a mesma pessoa de novo NÃO perde o incremental', async () => {
    const pedidos: (string | null)[] = [];
    const s = new Sincronizacao(base, fila, {
      baixarPacote: async (desde) => {
        pedidos.push(desde);
        return pacote({ synced_at: '2026-08-29T09:00:00.000Z' });
      },
      agora: () => new Date('2026-08-29T08:00:00.000Z'),
      identidade: () => ({ organizacao: 'org-a', usuario: 'ana@x.com' }),
    });
    await s.rodar();
    await s.rodar();
    expect(pedidos).toEqual([null, '2026-08-29T09:00:00.000Z']);
  });
});

describe('SYNC-007 · a tela fala português', () => {
  it('"Failed to fetch" vira uma frase que o técnico entende', () => {
    expect(mensagemParaATela('Failed to fetch')).toMatch(/Sem conexão/);
    expect(mensagemParaATela('o servidor respondeu 503')).toMatch(/código 503/);
    expect(mensagemParaATela(null)).toBeNull();
  });
});
