/**
 * Aurora — publicador do outbox (EPIC-001).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { newId, buildContext } from '@aurora/domain';
import { withTenant, emitEvent, type PendingEvent } from '@aurora/db';
import { createTestDatabase, seedOrganization, type TestDatabase } from '@aurora/db/testing/harness';
import { OutboxPublisher, IntervalScheduler, type EventSink } from '../outbox-publisher';

const ORG_A = newId(),
  USER_A = newId(),
  MEM_A = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();
const ctxA = buildContext({ organizationId: ORG_A, actorId: USER_A, requestId: 'r1' });
const ctxB = buildContext({ organizationId: ORG_B, actorId: USER_B, requestId: 'r2' });

class RecordingSink implements EventSink {
  readonly name = 'recording';
  readonly received: PendingEvent[] = [];
  failOn = new Set<string>();
  async deliver(e: PendingEvent): Promise<void> {
    if (this.failOn.has(e.type)) throw new Error(`destino recusou ${e.type}`);
    this.received.push(e);
  }
}

let t: TestDatabase;
let sink: RecordingSink;

beforeEach(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: USER_A, membershipId: MEM_A },
    {
      slug: 'pub-a',
      name: 'A',
      email: 'a@pub.test',
      userName: 'A',
    }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    {
      slug: 'pub-b',
      name: 'B',
      email: 'b@pub.test',
      userName: 'B',
    }
  );
  sink = new RecordingSink();
}, 60_000);

afterEach(async () => {
  await t?.close();
});

describe('publicador do outbox', () => {
  it('publica eventos pendentes e marca como publicados', async () => {
    await withTenant(t.db, ctxA, (s) => emitEvent(s, { type: 'asset.created', aggregateId: newId() }));
    await withTenant(t.db, ctxA, (s) => emitEvent(s, { type: 'asset.updated', aggregateId: newId() }));

    const run = await new OutboxPublisher(t.db, sink).runOnce();
    expect(run).toEqual({ fetched: 2, published: 2, failed: 0 });
    expect(sink.received.map((e) => e.type).sort()).toEqual(['asset.created', 'asset.updated']);

    const rest = await new OutboxPublisher(t.db, sink).runOnce();
    expect(rest.fetched).toBe(0);
  });

  it('atravessa organizações — o publicador é de plataforma', async () => {
    await withTenant(t.db, ctxA, (s) => emitEvent(s, { type: 'asset.created', aggregateId: newId() }));
    await withTenant(t.db, ctxB, (s) => emitEvent(s, { type: 'asset.created', aggregateId: newId() }));

    const run = await new OutboxPublisher(t.db, sink).runOnce();
    expect(run.published).toBe(2);
    expect(new Set(sink.received.map((e) => e.organization_id)).size).toBe(2);
  });

  it('falha de entrega não marca como publicado e conta a tentativa', async () => {
    sink.failOn.add('asset.created');
    await withTenant(t.db, ctxA, (s) => emitEvent(s, { type: 'asset.created', aggregateId: newId() }));

    const run = await new OutboxPublisher(t.db, sink).runOnce();
    expect(run).toEqual({ fetched: 1, published: 0, failed: 1 });

    const [row] = await t.raw('SELECT published_at, publish_attempts, last_error FROM aurora.domain_events');
    expect(row!.published_at).toBeNull();
    expect(row!.publish_attempts).toBe(1);
    expect(String(row!.last_error)).toContain('recusou');
  });

  it('um evento com falha não impede os outros do mesmo lote', async () => {
    sink.failOn.add('asset.updated');
    await withTenant(t.db, ctxA, (s) => emitEvent(s, { type: 'asset.created', aggregateId: newId() }));
    await withTenant(t.db, ctxA, (s) => emitEvent(s, { type: 'asset.updated', aggregateId: newId() }));

    const run = await new OutboxPublisher(t.db, sink).runOnce();
    expect(run.published).toBe(1);
    expect(run.failed).toBe(1);
    expect(sink.received.map((e) => e.type)).toEqual(['asset.created']);
  });

  it('para de tentar após o limite, mas não descarta o evento', async () => {
    sink.failOn.add('asset.created');
    await withTenant(t.db, ctxA, (s) => emitEvent(s, { type: 'asset.created', aggregateId: newId() }));
    const publisher = new OutboxPublisher(t.db, sink, { maxAttempts: 2 });

    await publisher.runOnce();
    await publisher.runOnce();
    const third = await publisher.runOnce();
    expect(third.published).toBe(0);
    expect(third.failed).toBe(0); // não tentou mais

    const [row] = await t.raw('SELECT publish_attempts, published_at FROM aurora.domain_events');
    expect(row!.publish_attempts).toBe(2);
    expect(row!.published_at, 'evento esgotado foi descartado').toBeNull();
  });

  it('respeita o tamanho do lote', async () => {
    for (let i = 0; i < 5; i++) {
      await withTenant(t.db, ctxA, (s) => emitEvent(s, { type: 'asset.created', aggregateId: newId() }));
    }
    const run = await new OutboxPublisher(t.db, sink, { batchSize: 2 }).runOnce();
    expect(run.fetched).toBe(2);
  });

  it('o publicador não consegue escrever dado de negócio', async () => {
    await expect(
      t.db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE aurora_publisher');
        return tx.query(`UPDATE aurora.memberships SET job_title = 'invadido'`);
      })
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('agendador por intervalo', () => {
  it('não sobrepõe execuções lentas', async () => {
    const scheduler = new IntervalScheduler();
    let concurrent = 0;
    let maxConcurrent = 0;
    let runs = 0;
    scheduler.every(5, async () => {
      concurrent++;
      runs++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 30));
      concurrent--;
    });
    await new Promise((r) => setTimeout(r, 200));
    await scheduler.stop();
    expect(runs).toBeGreaterThan(0);
    expect(maxConcurrent, 'execuções se sobrepuseram').toBe(1);
  });
});
