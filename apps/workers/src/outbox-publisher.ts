/**
 * Aurora — publicador do outbox (SPEC v0.2 §31, EPIC-001).
 *
 * Lê eventos de domínio ainda não publicados e os entrega a um destino. Roda
 * com o papel `aurora_publisher`: enxerga todas as organizações, mas não pode
 * alterar dado de negócio. É essa separação que evita dar BYPASSRLS ao papel da
 * aplicação.
 *
 * Garantias:
 *  · at-least-once — o consumidor precisa ser idempotente por `event_id`
 *  · sem perda — só marca publicado depois de a entrega ter sucesso
 *  · sem bloqueio mútuo — `FOR UPDATE SKIP LOCKED` permite vários publicadores
 *  · falha isolada — um evento que falha não impede os demais
 */
import { fetchUnpublished, markPublished, markFailed, type PendingEvent, type Database } from '@aurora/db';

/** Destino da entrega. Implementações: webhook, fila, log, teste. */
export interface EventSink {
  readonly name: string;
  deliver(event: PendingEvent): Promise<void>;
}

export interface PublisherOptions {
  batchSize?: number;
  /** Após quantas falhas o evento para de ser tentado nesta rodada. */
  maxAttempts?: number;
  onError?: (event: PendingEvent, error: unknown) => void;
}

export interface PublishRun {
  fetched: number;
  published: number;
  failed: number;
}

export class OutboxPublisher {
  private readonly batchSize: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly db: Database,
    private readonly sink: EventSink,
    private readonly options: PublisherOptions = {}
  ) {
    this.batchSize = options.batchSize ?? 100;
    this.maxAttempts = options.maxAttempts ?? 8;
  }

  /**
   * Uma passada. Retorna o que aconteceu para que o chamador decida se vale
   * rodar de novo imediatamente (lote cheio) ou aguardar.
   */
  async runOnce(): Promise<PublishRun> {
    return this.db.transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE aurora_publisher');

      const pending = await fetchUnpublished(tx, this.batchSize, this.maxAttempts);
      const delivered: string[] = [];
      let failed = 0;

      for (const event of pending) {
        if (event.publish_attempts >= this.maxAttempts) {
          // esgotado: fica no outbox para inspeção manual, não é descartado
          continue;
        }
        try {
          await this.sink.deliver(event);
          delivered.push(event.id);
        } catch (e) {
          failed += 1;
          await markFailed(tx, event.id, e instanceof Error ? e.message : String(e));
          this.options.onError?.(event, e);
        }
      }

      await markPublished(tx, delivered);
      return { fetched: pending.length, published: delivered.length, failed };
    });
  }
}

/**
 * NÃO EXISTE MAIS UM AGENDADOR AQUI.
 *
 * Havia um `IntervalScheduler` — `setInterval` que não sobrepunha execuções —
 * como medida temporária enquanto não havia PostgreSQL real para o pg-boss.
 * Ele saiu quando o `JobRuntime` entrou (`./jobs/runtime`), e saiu de vez em
 * vez de ficar "por perto, por garantia":
 *
 *   · `setInterval` não sobrevive a reinício — a passada perdida some;
 *   · não coordena DUAS instâncias do worker, e a segunda instância rodaria a
 *     mesma varredura ao mesmo tempo, gerando a mesma OS preventiva duas vezes;
 *   · não tem retentativa, nem carta morta: a falha vira `catch(() => undefined)`.
 *
 * Um substituto ruim deixado ao lado do bom é um substituto que alguém usa.
 */
