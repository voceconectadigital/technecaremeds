/**
 * Aurora — o cronômetro aberto, visto do aparelho (pente-fino PF-65).
 *
 * O APARELHO SÓ TINHA "INICIAR".
 *
 * Cada toque enfileirava um novo início; o servidor aceitava o primeiro e
 * recusava o segundo (um cronômetro aberto por pessoa), que ia parar na tela
 * de atenção. E não havia "parar": o cronômetro iniciado no campo só fechava
 * pela web, ou pelo fechamento automático da OS.
 *
 * Aqui a tela descobre se há cronômetro aberto, e onde, juntando duas fontes:
 *
 *   1. o que o SERVIDOR disse no pacote do dia (`open_timers`, guardado na
 *      coleção `cronometros`) — inclusive o aberto pela web;
 *   2. o que ainda está NA FILA: um "iniciar" que não subiu abre; um "parar"
 *      que não subiu fecha.
 *
 * A fila vence, porque é o que vai acontecer quando o sinal voltar. É a mesma
 * regra da situação da OS na tela (`situacoesNaFila` em `telas/ordem.tsx`).
 *
 * O IDENTIFICADOR DO APONTAMENTO NASCE NO APARELHO, junto com o "iniciar". É o
 * que permite enfileirar o "parar" logo atrás, sem rede, sabendo o que vai
 * parar — o servidor usa o mesmo identificador (`POST
 * /work-orders/:id/timer/start` com `id`).
 */
import type { ComandoNaFila } from './fila';

/** Como o pacote do dia descreve um cronômetro aberto. */
export interface CronometroBaixado {
  id: string;
  work_order_id: string;
  started_at: string;
}

export interface CronometroAberto {
  /**
   * O identificador do apontamento. `null` quando o "iniciar" foi enfileirado
   * por uma versão anterior, que não gerava identificador: dá para mostrar que
   * está rodando, mas o "parar" só depois de o servidor devolver o dele.
   */
  id: string | null;
  workOrderId: string;
  /** Desde quando, em ISO — a hora do aparelho, quando veio de lá. */
  desde: string;
  /** Ainda não chegou ao servidor. */
  naFila: boolean;
}

const INICIAR = /^\/work-orders\/([^/]+)\/timer\/start$/;
const PARAR = /^\/time-entries\/([^/]+)\/stop$/;

/**
 * O cronômetro aberto desta sessão, ou `null`.
 *
 * `comandos` é a fila inteira; `daSessao` separa o que é de quem está logado
 * (`FilaDeSaida.daSessaoAtual`) — o "iniciar" de outra pessoa neste aparelho
 * não é o cronômetro de quem está com ele na mão.
 */
export function cronometroAberto(
  comandos: readonly ComandoNaFila[],
  baixados: readonly CronometroBaixado[],
  daSessao: (c: ComandoNaFila) => boolean = () => true
): CronometroAberto | null {
  const abertos = new Map<string, CronometroAberto>();
  for (const b of baixados) {
    abertos.set(b.id, { id: b.id, workOrderId: b.work_order_id, desde: b.started_at, naFila: false });
  }

  let semId = 0;
  for (const c of [...comandos].sort((a, b) => a.seq - b.seq)) {
    if (!daSessao(c)) continue;
    const corpo = (c.corpo ?? {}) as { id?: unknown; started_at?: unknown };

    const inicio = INICIAR.exec(c.caminho);
    if (inicio) {
      const id = typeof corpo.id === 'string' ? corpo.id : null;
      abertos.set(id ?? `sem-id:${semId++}`, {
        id,
        workOrderId: inicio[1]!,
        desde: typeof corpo.started_at === 'string' ? corpo.started_at : c.criadoEm,
        naFila: true,
      });
      continue;
    }

    const fim = PARAR.exec(c.caminho);
    if (fim) abertos.delete(fim[1]!);
  }

  // O mais recente: é o que a pessoa acabou de tocar. Mais de um só existe se
  // o servidor ainda vai recusar algum — e esse vai para a atenção.
  const lista = [...abertos.values()];
  return lista.length > 0 ? lista[lista.length - 1]! : null;
}

/** "09:12" — a hora local do aparelho, que é a que a pessoa viu no relógio. */
export function horaCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
