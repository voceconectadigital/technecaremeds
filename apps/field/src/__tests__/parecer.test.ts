/**
 * Aurora — o parecer do equipamento no aparelho (PF-41).
 *
 * Adversarial: a regra é provada pelo lado que recusa (exigência ligada, sem
 * parecer em lugar nenhum) e pelos lados que passam (parecer escolhido, já
 * gravado, já na fila; exigência desligada; destino que não é conclusão). E a
 * exigência é guardada pela sincronização, sem vazar entre sessões.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { armazenamentoEmMemoria, type ArmazenamentoOffline } from '../armazenamento';
import { FilaDeSaida, type ComandoNaFila, type Identidade, type PendenciaDeAtencao } from '../fila';
import { Sincronizacao, type PacoteDoDia } from '../sincronizacao';
import { ehParecer, lerConfiguracao, parecerNaFila, planoDeConclusao } from '../parecer';

function comando(seq: number, agregado: string, caminho: string, corpo: unknown): ComandoNaFila {
  return {
    id: `op-${seq}`,
    seq,
    agregado,
    metodo: caminho.endsWith('/service-report') ? 'PATCH' : 'POST',
    caminho,
    corpo,
    rotulo: caminho,
    criadoEm: '2026-10-17T09:00:00.000Z',
    tentativas: 0,
    proximaTentativaEm: '2026-10-17T09:00:00.000Z',
    ultimoErro: null,
    bloqueado: false,
  };
}

describe('PF-41 · planoDeConclusao', () => {
  it('exigência ligada, concluir sem parecer em lugar nenhum: recusado no aparelho', () => {
    const p = planoDeConclusao({
      categoriaDestino: 'review',
      exige: true,
      escolhido: null,
      jaRegistrado: null,
    });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.erro).toMatch(/LIBERADO ou PARADO/);
  });

  it('exigência ligada, parecer escolhido na tela: passa e o parecer vai antes, como comando', () => {
    expect(
      planoDeConclusao({ categoriaDestino: 'review', exige: true, escolhido: 'stopped', jaRegistrado: null })
    ).toEqual({ ok: true, enviarParecer: 'stopped' });
  });

  it('exigência ligada, parecer já gravado (ou na fila): passa sem reenviar', () => {
    expect(
      planoDeConclusao({ categoriaDestino: 'review', exige: true, escolhido: null, jaRegistrado: 'released' })
    ).toEqual({ ok: true, enviarParecer: null });
  });

  it('escolher na tela vence o gravado: a pessoa mudou de ideia diante do equipamento', () => {
    expect(
      planoDeConclusao({
        categoriaDestino: 'review',
        exige: true,
        escolhido: 'stopped',
        jaRegistrado: 'released',
      })
    ).toEqual({ ok: true, enviarParecer: 'stopped' });
  });

  it('exigência desligada: concluir sem parecer passa; com parecer escolhido, ele vai junto', () => {
    expect(
      planoDeConclusao({ categoriaDestino: 'review', exige: false, escolhido: null, jaRegistrado: null })
    ).toEqual({ ok: true, enviarParecer: null });
    expect(
      planoDeConclusao({
        categoriaDestino: 'review',
        exige: false,
        escolhido: 'released',
        jaRegistrado: null,
      })
    ).toEqual({ ok: true, enviarParecer: 'released' });
  });

  it('destino que não é conclusão (iniciar, pausar, categoria desconhecida): o parecer não entra', () => {
    for (const categoria of ['in_progress', 'waiting', undefined, null]) {
      expect(
        planoDeConclusao({
          categoriaDestino: categoria,
          exige: true,
          escolhido: 'released',
          jaRegistrado: null,
        })
      ).toEqual({ ok: true, enviarParecer: null });
    }
  });
});

describe('PF-41 · parecer na fila e valores aceitos', () => {
  it('só LIBERADO e PARADO, com as chaves do servidor', () => {
    expect(ehParecer('released')).toBe(true);
    expect(ehParecer('stopped')).toBe(true);
    for (const v of ['', 'LIBERADO', 'ok', null, undefined, 1]) expect(ehParecer(v)).toBe(false);
  });

  it('acha o ÚLTIMO parecer enfileirado DESTA OS, e ignora o de outra OS e o relatório sem parecer', () => {
    const fila = [
      comando(1, 'work_order:os-1', '/work-orders/os-1/service-report', { operational_result: 'released' }),
      comando(2, 'work_order:os-2', '/work-orders/os-2/service-report', { operational_result: 'stopped' }),
      comando(3, 'work_order:os-1', '/work-orders/os-1/service-report', { service_description: 'texto' }),
      comando(4, 'work_order:os-1', '/work-orders/os-1/transitions', { to: 'completed' }),
    ];
    expect(parecerNaFila(fila, 'os-1')).toBe('released');
    expect(parecerNaFila(fila, 'os-2')).toBe('stopped');
    expect(parecerNaFila(fila, 'os-3')).toBeNull();
    fila.push(
      comando(5, 'work_order:os-1', '/work-orders/os-1/service-report', { operational_result: 'stopped' })
    );
    expect(parecerNaFila(fila, 'os-1')).toBe('stopped');
    // Valor inválido na fila não conta como informado.
    expect(
      parecerNaFila(
        [comando(1, 'work_order:os-9', '/work-orders/os-9/service-report', { operational_result: 'x' })],
        'os-9'
      )
    ).toBeNull();
  });
});

describe('PF-41 · a exigência desce no pacote e fica no aparelho', () => {
  let base: ArmazenamentoOffline;
  let fila: FilaDeSaida;
  let quem: Identidade;

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

  const sincronizar = (p: PacoteDoDia) =>
    new Sincronizacao(base, fila, {
      baixarPacote: async () => p,
      agora: () => new Date('2026-10-17T09:00:00.000Z'),
      identidade: () => quem,
    }).rodar();

  beforeEach(() => {
    base = armazenamentoEmMemoria();
    quem = { organizacao: 'org-a', usuario: 'ana@campo.test' };
    fila = new FilaDeSaida(base.colecao<ComandoNaFila>('fila'), base.colecao<PendenciaDeAtencao>('atencao'), {
      enviar: async () => ({ status: 200, corpo: {} }),
      agora: () => new Date('2026-10-17T09:00:00.000Z'),
      novoId: () => 'op-x',
    });
  });

  it('aparelho que nunca recebeu a regra: desligada, como o padrão do servidor', async () => {
    expect(await lerConfiguracao(base)).toEqual({ require_operational_result: false });
  });

  it('ligada no pacote (inclusive incremental), fica guardada; desligada depois, volta a falso', async () => {
    await sincronizar(pacote({ settings: { require_operational_result: true } }));
    expect((await lerConfiguracao(base)).require_operational_result).toBe(true);
    await sincronizar(pacote({ settings: { require_operational_result: false } }));
    expect((await lerConfiguracao(base)).require_operational_result).toBe(false);
  });

  it('servidor anterior, que não manda `settings`, não apaga o que o aparelho sabe', async () => {
    await sincronizar(pacote({ settings: { require_operational_result: true } }));
    await sincronizar(pacote({}));
    expect((await lerConfiguracao(base)).require_operational_result).toBe(true);
  });

  it('a regra é da organização: trocar de organização limpa a anterior antes de baixar a nova', async () => {
    await sincronizar(pacote({ settings: { require_operational_result: true } }));
    quem = { organizacao: 'org-b', usuario: 'ana@campo.test' };
    // O servidor da org-b ainda não manda a regra (versão anterior): não pode
    // valer a da org-a.
    await sincronizar(pacote({ incremental: false }));
    expect((await lerConfiguracao(base)).require_operational_result).toBe(false);
  });
});
