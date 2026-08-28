/**
 * Aurora — auditoria e outbox (SPEC v0.2 §22, §31, EPIC-001).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext } from '@aurora/domain';
import { withTenant } from '../client';
import { emitEvent, fetchUnpublished, markPublished, markFailed } from '../outbox';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId();
const USER = newId();
const MEM = newId();
// segundo vínculo, criado no arranjo para que os testes de auditoria tenham
// uma linha descartável sem depender da ordem de execução
const USER2 = newId();
const MEM2 = newId();

const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  actorKind: 'user',
  requestId: 'req-audit-1',
  source: 'web',
  clientIp: '203.0.113.7',
  userAgent: 'Aurora/Test',
});

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    {
      slug: 'org-audit',
      name: 'Org Auditoria',
      email: 'audit@aurora.test',
      userName: 'Auditor',
    }
  );
  // usuário adicional criado fora de qualquer transação de tenant
  await t.raw(`INSERT INTO aurora.users (id, email, name) VALUES ($1,$2,$3)`, [
    USER2,
    'tecnico@aurora.test',
    'Técnico Dois',
  ]);
}, 60_000);

afterAll(async () => {
  await t?.close();
});

describe('trilha de auditoria (§22)', () => {
  it('registra criação com ator, IP, agente, request_id e origem', async () => {
    await withTenant(t.db, ctx, (s) =>
      s.query(
        `INSERT INTO aurora.memberships (id, organization_id, user_id, status, job_title)
         VALUES ($1,$2,$3,'active','Técnico')`,
        [MEM2, ORG, USER2]
      )
    );

    const rows = await t.raw(
      `SELECT actor_user_id, actor_kind, entity_type, action, client_ip, user_agent, request_id, source, entity_label
         FROM aurora.audit_logs
        WHERE entity_type = 'memberships' AND action = 'create'
        ORDER BY occurred_at DESC LIMIT 1`
    );
    const log = rows[0]!;
    expect(log.actor_user_id).toBe(USER);
    expect(log.actor_kind).toBe('user');
    expect(log.client_ip).toBe('203.0.113.7');
    expect(log.user_agent).toBe('Aurora/Test');
    expect(log.request_id).toBe('req-audit-1');
    expect(log.source).toBe('web');
    expect(log.entity_label).toBe('Técnico');
  });

  it('registra diff campo a campo apenas do que mudou', async () => {
    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.memberships SET job_title = 'Supervisor' WHERE id = $1`, [MEM])
    );
    const rows = await t.raw(
      `SELECT changes FROM aurora.audit_logs
        WHERE entity_type='memberships' AND action='update' ORDER BY occurred_at DESC LIMIT 1`
    );
    const changes = rows[0]!.changes as Record<string, { from: unknown; to: unknown }>;
    expect(Object.keys(changes)).toEqual(['job_title']);
    expect(changes.job_title!.to).toBe('Supervisor');
    expect(changes).not.toHaveProperty('updated_at');
  });

  it('não registra update que não alterou nada', async () => {
    const before = await t.raw(
      `SELECT count(*)::int c FROM aurora.audit_logs WHERE entity_type='memberships'`
    );
    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.memberships SET job_title = 'Supervisor' WHERE id = $1`, [MEM])
    );
    const after = await t.raw(
      `SELECT count(*)::int c FROM aurora.audit_logs WHERE entity_type='memberships'`
    );
    expect(after[0]!.c).toBe(before[0]!.c);
  });

  it('classifica soft delete como delete, não como update', async () => {
    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.memberships SET deleted_at = now() WHERE id = $1`, [MEM2])
    );
    const rows = await t.raw(
      `SELECT action FROM aurora.audit_logs WHERE entity_type='memberships' ORDER BY occurred_at DESC LIMIT 1`
    );
    expect(rows[0]!.action).toBe('delete');
  });

  it('redige valores sensíveis mas registra que mudaram', async () => {
    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.memberships SET signature_key = 'segredo-real' WHERE id = $1`, [MEM])
    );
    const rows = await t.raw(
      `SELECT changes FROM aurora.audit_logs WHERE entity_type='memberships' ORDER BY occurred_at DESC LIMIT 1`
    );
    const changes = rows[0]!.changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes).toHaveProperty('signature_key');
    expect(changes.signature_key!.to).toBe('[redacted]');
    expect(JSON.stringify(changes)).not.toContain('segredo-real');
  });

  it('a aplicação não consegue escrever nem apagar a trilha', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(
          `INSERT INTO aurora.audit_logs (organization_id, entity_type, entity_id, action)
                 VALUES ($1,'x','y','create')`,
          [ORG]
        )
      )
    ).rejects.toThrow(/permission denied/i);

    await expect(withTenant(t.db, ctx, (s) => s.query(`DELETE FROM aurora.audit_logs`))).rejects.toThrow(
      /permission denied/i
    );
  });

  it('a trilha é tenant-scoped na leitura', async () => {
    const other = buildContext({ organizationId: newId(), requestId: 'r' });
    const rows = await withTenant(t.db, other, (s) => s.query('SELECT id FROM aurora.audit_logs'));
    expect(rows).toEqual([]);
  });
});

describe('outbox de eventos de domínio (§31)', () => {
  it('grava o evento com contexto da sessão', async () => {
    const target = newId();
    const emitted = await withTenant(t.db, ctx, (s) =>
      emitEvent(s, { type: 'organization.updated', aggregateId: target, payload: { field: 'name' } })
    );
    expect(emitted.aggregateType).toBe('organization');

    const rows = await t.raw(`SELECT * FROM aurora.domain_events WHERE id = $1`, [emitted.id]);
    const ev = rows[0]!;
    expect(ev.organization_id).toBe(ORG);
    expect(ev.type).toBe('organization.updated');
    expect(ev.actor_user_id).toBe(USER);
    expect(ev.request_id).toBe('req-audit-1');
    expect(ev.published_at).toBeNull();
    expect(ev.payload).toEqual({ field: 'name' });
  });

  it('reverte junto com a transação — nunca fica evento órfão', async () => {
    const before = await t.raw(`SELECT count(*)::int c FROM aurora.domain_events`);
    await expect(
      withTenant(t.db, ctx, async (s) => {
        await emitEvent(s, { type: 'organization.updated', aggregateId: newId() });
        throw new Error('falha depois de emitir');
      })
    ).rejects.toThrow('falha depois de emitir');
    const after = await t.raw(`SELECT count(*)::int c FROM aurora.domain_events`);
    expect(after[0]!.c).toBe(before[0]!.c);
  });

  it('recusa tipo fora do catálogo', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        emitEvent(s, { type: 'work_order.teleported' as never, aggregateId: newId() })
      )
    ).rejects.toThrow(/catálogo/);
  });

  it('recusa profundidade de causação acima do limite (trava anti-laço)', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        emitEvent(s, { type: 'work_order.opened', aggregateId: newId(), causationDepth: 4 })
      )
    ).rejects.toThrow(/laço|limite/i);
  });

  it('eventos são tenant-scoped', async () => {
    const other = buildContext({ organizationId: newId(), requestId: 'r' });
    const rows = await withTenant(t.db, other, (s) => s.query('SELECT id FROM aurora.domain_events'));
    expect(rows).toEqual([]);
  });

  it('publicador lê pendentes, marca publicados e registra falha', async () => {
    const pending = await t.db.transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE aurora_publisher');
      return fetchUnpublished(tx, 10);
    });
    expect(pending.length).toBeGreaterThan(0);

    await t.db.transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE aurora_publisher');
      await markPublished(tx, [pending[0]!.id]);
    });
    const [row] = await t.raw(`SELECT published_at FROM aurora.domain_events WHERE id=$1`, [pending[0]!.id]);
    expect(row!.published_at).not.toBeNull();

    if (pending[1]) {
      await t.db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE aurora_publisher');
        await markFailed(tx, pending[1]!.id, 'endpoint fora do ar');
      });
      const [failed] = await t.raw(
        `SELECT publish_attempts, last_error FROM aurora.domain_events WHERE id=$1`,
        [pending[1]!.id]
      );
      expect(failed!.publish_attempts).toBe(1);
      expect(failed!.last_error).toBe('endpoint fora do ar');
    }
  });

  it('publicador não consegue alterar dado de negócio', async () => {
    await expect(
      t.db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE aurora_publisher');
        return tx.query(`UPDATE aurora.organizations SET name = 'invadido'`);
      })
    ).rejects.toThrow(/permission denied/i);
  });
});
