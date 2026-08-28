/**
 * Aurora — outbox transacional de eventos de domínio (SPEC v0.2 §31).
 *
 * O evento é gravado na MESMA transação do dado. Se a transação reverte, o
 * evento desaparece com ela. Nunca "salva no banco, tenta publicar fora da
 * transação e torce para funcionar".
 *
 * A publicação é responsabilidade de um processo separado que lê o que ainda
 * não foi publicado — daí o nome outbox.
 */
import { newId } from '@aurora/domain';
import { isEventType, aggregateTypeOf, MAX_CAUSATION_DEPTH, type EventType } from '@aurora/events';
import type { TenantSession } from './client';

export interface EmitEventInput {
  type: EventType;
  aggregateId: string;
  payload?: Record<string, unknown>;
  schemaVersion?: number;
  causedByEventId?: string | null;
  causedByRuleId?: string | null;
  causationDepth?: number;
}

export interface EmittedEvent {
  id: string;
  type: EventType;
  aggregateType: string;
  aggregateId: string;
}

/**
 * Grava um evento no outbox, dentro da transação corrente do tenant.
 * O contexto (organização, ator, request_id) vem da sessão — não é parâmetro,
 * justamente para que não possa divergir do que está sendo gravado.
 */
export async function emitEvent(session: TenantSession, input: EmitEventInput): Promise<EmittedEvent> {
  if (!isEventType(input.type)) {
    throw new TypeError(
      `tipo de evento desconhecido: "${input.type}". Todo evento precisa estar no catálogo de @aurora/events.`
    );
  }
  const depth = input.causationDepth ?? 0;
  if (depth > MAX_CAUSATION_DEPTH) {
    throw new RangeError(
      `profundidade de causação ${depth} excede o limite de ${MAX_CAUSATION_DEPTH} — possível automação em laço`
    );
  }

  const id = newId();
  const aggregateType = aggregateTypeOf(input.type);
  const ctx = session.context;

  await session.query(
    `INSERT INTO aurora.domain_events
       (id, organization_id, type, schema_version, aggregate_type, aggregate_id,
        payload, actor_user_id, actor_kind, request_id,
        caused_by_event_id, caused_by_rule_id, causation_depth)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      ctx.organizationId,
      input.type,
      input.schemaVersion ?? 1,
      aggregateType,
      input.aggregateId,
      JSON.stringify(input.payload ?? {}),
      ctx.actorId,
      ctx.actorKind,
      ctx.requestId,
      input.causedByEventId ?? null,
      input.causedByRuleId ?? null,
      depth,
    ]
  );

  return { id, type: input.type, aggregateType, aggregateId: input.aggregateId };
}

export interface PendingEvent {
  id: string;
  organization_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  publish_attempts: number;
}

/**
 * Lê eventos ainda não publicados. Usado apenas pelo publicador, que roda com o
 * papel `aurora_publisher` (leitura de todas as organizações, sem poder alterar
 * dado de negócio) — é o que evita dar BYPASSRLS ao papel da aplicação.
 */
export async function fetchUnpublished(
  client: { query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> },
  limit = 100
): Promise<PendingEvent[]> {
  return client.query<PendingEvent>(
    `SELECT id, organization_id, type, aggregate_type, aggregate_id, payload,
            occurred_at, publish_attempts
       FROM aurora.domain_events
      WHERE published_at IS NULL
      ORDER BY occurred_at, sequence
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit]
  );
}

export async function markPublished(
  client: { query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> },
  ids: readonly string[]
): Promise<void> {
  if (ids.length === 0) return;
  await client.query(`UPDATE aurora.domain_events SET published_at = now() WHERE id = ANY($1::uuid[])`, [
    ids,
  ]);
}

export async function markFailed(
  client: { query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> },
  id: string,
  error: string
): Promise<void> {
  await client.query(
    `UPDATE aurora.domain_events
        SET publish_attempts = publish_attempts + 1,
            last_error = $2
      WHERE id = $1`,
    [id, error.slice(0, 2000)]
  );
}
