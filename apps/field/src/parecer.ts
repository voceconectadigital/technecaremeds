/**
 * Aurora — o parecer do equipamento na conclusão, visto do aparelho (PF-41).
 *
 * A organização pode exigir que concluir a OS venha com o parecer LIBERADO ou
 * PARADO (`require_operational_result`). O servidor recusa a conclusão sem ele
 * (422) — e, sem campo no aparelho, a conclusão feita no subsolo voltava
 * horas depois na tela de atenção, sem que o técnico tivesse onde responder.
 *
 * Aqui o parecer é escolhido na tela da OS e vira COMANDO junto com a
 * conclusão: `PATCH /work-orders/:id/service-report` com `operational_result`,
 * enfileirado ANTES da transição, no mesmo agregado. A fila manda os comandos
 * de um agregado em ordem, então o servidor recebe o parecer antes do
 * "concluir" — que é a ordem em que ele confere.
 *
 * A regra, com a exigência ligada, é recusar NO APARELHO, na hora, a conclusão
 * sem parecer: o técnico ainda está na frente do equipamento. Com ela
 * desligada, o parecer é opcional e vai junto se tiver sido escolhido.
 */
import type { ArmazenamentoOffline } from './armazenamento';
import type { ComandoNaFila } from './fila';

export type Parecer = 'released' | 'stopped';

export const ROTULO_DO_PARECER: Record<Parecer, string> = {
  released: 'LIBERADO',
  stopped: 'PARADO',
};

export function ehParecer(v: unknown): v is Parecer {
  return v === 'released' || v === 'stopped';
}

/** As regras da organização que o pacote do dia traz (`settings`). */
export interface ConfiguracaoDoCampo {
  require_operational_result: boolean;
}

/** Onde a configuração mora no aparelho: na coleção `meta`, como a marca da sincronização. */
export const CHAVE_DA_CONFIGURACAO = 'configuracao';

/**
 * A configuração guardada. Sem pacote que a tenha trazido (aparelho que nunca
 * sincronizou com um servidor desta versão), vale o padrão do servidor:
 * desligada. Não exigir é o comportamento de antes; inventar a exigência
 * travaria conclusões que o servidor aceitaria.
 */
export async function lerConfiguracao(base: ArmazenamentoOffline): Promise<ConfiguracaoDoCampo> {
  const c = await base.colecao<Partial<ConfiguracaoDoCampo>>('meta').ler(CHAVE_DA_CONFIGURACAO);
  return { require_operational_result: c?.require_operational_result === true };
}

/**
 * O parecer que JÁ está a caminho do servidor para esta OS: o último
 * `service-report` com `operational_result` ainda na fila. Conta como
 * informado — concluir de novo depois de um "concluir" recusado não pede o
 * parecer outra vez.
 */
export function parecerNaFila(comandos: readonly ComandoNaFila[], workOrderId: string): Parecer | null {
  let achado: Parecer | null = null;
  for (const c of comandos) {
    if (c.agregado !== `work_order:${workOrderId}` || !c.caminho.endsWith('/service-report')) continue;
    const v = (c.corpo as { operational_result?: unknown } | null)?.operational_result;
    if (ehParecer(v)) achado = v;
  }
  return achado;
}

export type PlanoDeConclusao = { ok: true; enviarParecer: Parecer | null } | { ok: false; erro: string };

/**
 * O que fazer ao tocar numa mudança de situação.
 *
 * - Destino que não é conclusão (categoria `review`): nada com o parecer.
 * - Conclusão com parecer escolhido na tela: ele vai antes, como comando.
 * - Conclusão sem parecer escolhido, com a exigência ligada: só passa se a OS
 *   já tiver um (gravado no servidor ou na fila); senão, recusa aqui.
 */
export function planoDeConclusao(e: {
  categoriaDestino: string | null | undefined;
  exige: boolean;
  escolhido: Parecer | null;
  jaRegistrado: Parecer | null;
}): PlanoDeConclusao {
  if (e.categoriaDestino !== 'review') return { ok: true, enviarParecer: null };
  if (e.escolhido) return { ok: true, enviarParecer: e.escolhido };
  if (e.exige && !e.jaRegistrado) {
    return {
      ok: false,
      erro: 'Esta organização exige o parecer do equipamento para concluir: escolha LIBERADO ou PARADO.',
    };
  }
  return { ok: true, enviarParecer: null };
}
