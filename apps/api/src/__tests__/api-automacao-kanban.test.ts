/**
 * Aurora — AUT-07 "gatilhos de movimentação em Kanban" (29/10/2026).
 *
 * Arrastar a OS de coluna no quadro (`apps/web/src/features/ordens/lista.tsx`) é pedir a
 * TRANSIÇÃO de situação (`POST /work-orders/:id/transitions`). A transição grava o evento no
 * outbox; o publicador entrega o evento ao destino das automações (`apps/workers`), e a regra
 * que escuta aquele evento roda:
 *
 *   · UMA vez por evento — a segunda entrega (o outbox é "ao menos uma vez") não age nem avisa;
 *   · só com mudança REAL — soltar na mesma coluna não é transição e não gera evento;
 *   · sem LAÇO — o que a própria regra causou não a dispara de novo, e a cadeia tem teto.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext } from '@aurora/domain';
import { createTestDatabase, seedOrganization, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  assignRole,
  createCustomer,
  createLocation,
  createWorkOrder,
  emitEvent,
  automationRequestId,
  provisionOrganizationBaseline,
  type PendingEvent,
} from '@aurora/db';
import { OutboxPublisher, entregarAsAutomacoes, type EventSink } from '@aurora/workers';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const ADMIN = 'admin@kanban.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let os: string;
let regra: string;

const sistema = (requestId = newId()) =>
  buildContext({ organizationId: ORG, actorKind: 'system', requestId });
const consultar = <T>(sql: string, p: unknown[] = []) =>
  withTenant(t.db, sistema(), (s) => s.query<T>(sql, p));

/** Uma passada do publicador, guardando o que ele entregaria (o PGlite é uma conexão só). */
async function publicar(): Promise<PendingEvent[]> {
  const recebidos: PendingEvent[] = [];
  const registro: EventSink = {
    name: 'teste',
    async deliver(e) {
      recebidos.push(e);
    },
  };
  await new OutboxPublisher(t.db, registro).runOnce();
  return recebidos;
}

const avisos = () =>
  consultar<{ title: string }>(
    `SELECT title FROM aurora.notifications WHERE type_key = 'automation.reminder' AND membership_id = $1`,
    [ids.membershipId]
  );
const execucoes = () =>
  consultar<{ outcome: string; event_id: string | null }>(
    `SELECT outcome::text AS outcome, event_id FROM aurora.rule_runs WHERE rule_id = $1 ORDER BY ran_at`,
    [regra]
  );

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(t, ids, { slug: 'kanban', name: 'Prestadora', email: ADMIN, userName: 'Admin' });
  await withTenant(t.db, sistema(), async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, ids.membershipId, base.roles.get('admin')!);
    const cliente = await createCustomer(s, { name: 'Hospital' });
    const sede = await createLocation(s, {
      customerId: cliente,
      locationTypeId: base.locationTypes.get('unidade')!,
      name: 'Sede',
    });
    const [corretiva] = await s.query<{ id: string }>(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
    );
    os = (
      await createWorkOrder(s, {
        customerId: cliente,
        locationId: sede,
        workOrderTypeId: corretiva!.id,
        title: 'Bomba de infusão alarmando',
        assigneeMembershipId: ids.membershipId,
      })
    ).id;
  });
  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);
  app = await createApp({ db: t.db, env });
  await app.init();
  http = request(app.getHttpServer());

  // A regra: OS começou (foi para "em andamento") → aviso ao coordenador.
  const r = await http
    .post('/v1/automations')
    .set(auth(ADMIN))
    .send({
      name: 'Avisar quando a OS começa',
      triggerKind: 'event',
      triggerEvent: 'work_order.started',
      actions: [
        { kind: 'reminder', params: { recipients: [ids.membershipId], title: 'OS {{number}} começou' } },
      ],
    });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  regra = r.body.id;
  expect((await http.post(`/v1/automations/${regra}/simulate`).set(auth(ADMIN)).send({})).status).toBe(201);
  expect((await http.post(`/v1/automations/${regra}/activate`).set(auth(ADMIN)).send({})).status).toBe(201);
  // O que já estava no outbox (abertura da OS etc.) sai antes do movimento.
  await publicar();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('mover no quadro dispara a automação, uma vez', () => {
  it('soltar em "em andamento" = transição → evento work_order.started → a regra roda uma vez', async () => {
    const ficha = await http.get(`/v1/work-orders/${os}`).set(auth(ADMIN));
    // O mesmo corpo que o quadro manda ao soltar o cartão.
    const mover = await http
      .post(`/v1/work-orders/${os}/transitions`)
      .set(auth(ADMIN))
      .send({ to: 'in_progress', version: ficha.body.version });
    expect(mover.status, JSON.stringify(mover.body)).toBeLessThan(300);

    const eventos = (await publicar()).filter((e) => e.aggregate_id === os);
    expect(eventos.map((e) => e.type)).toEqual(['work_order.started']);
    expect(await entregarAsAutomacoes(t.db, eventos[0]!)).toBe(1);

    const runs = await execucoes();
    expect(runs).toEqual([{ outcome: 'matched', event_id: eventos[0]!.id }]);
    const meus = await avisos();
    expect(meus).toHaveLength(1);
    expect(meus[0]!.title).toMatch(/^OS .+ começou$/);
  });

  it('a mesma entrega de novo (o outbox repete o lote que falhou) não roda nem avisa outra vez', async () => {
    const [ev] = await consultar<{ id: string }>(
      `SELECT id FROM aurora.domain_events WHERE aggregate_id = $1 AND type = 'work_order.started'`,
      [os]
    );
    const pendente = {
      id: ev!.id,
      organization_id: ORG,
      type: 'work_order.started',
      aggregate_type: 'work_order',
      aggregate_id: os,
      payload: {},
      occurred_at: new Date(),
      publish_attempts: 1,
    };
    expect(await entregarAsAutomacoes(t.db, pendente)).toBe(0);
    expect(await entregarAsAutomacoes(t.db, pendente)).toBe(0);
    expect(await execucoes()).toHaveLength(1);
    expect(await avisos()).toHaveLength(1);
  });

  it('soltar na MESMA coluna não é mudança: nenhum evento novo, nenhuma execução nova', async () => {
    const ficha = await http.get(`/v1/work-orders/${os}`).set(auth(ADMIN));
    const mesma = await http
      .post(`/v1/work-orders/${os}/transitions`)
      .set(auth(ADMIN))
      .send({ to: 'in_progress', version: ficha.body.version });
    expect(mesma.status).toBeGreaterThanOrEqual(400);
    const eventos = (await publicar()).filter((e) => e.aggregate_id === os);
    expect(eventos).toHaveLength(0);
    expect(await execucoes()).toHaveLength(1);
  });
});

describe('sem laço', () => {
  async function eventoCausadoPor(requestId: string): Promise<PendingEvent> {
    await withTenant(t.db, sistema(requestId), (s) =>
      emitEvent(s, { type: 'work_order.started', aggregateId: os, payload: { number: 'X' } })
    );
    const [e] = (await publicar()).filter((x) => x.aggregate_id === os);
    expect(e).toBeDefined();
    return e!;
  }

  it('o evento que a PRÓPRIA regra causou não a dispara de novo (registrado como recursão)', async () => {
    const e = await eventoCausadoPor(automationRequestId(regra, 1));
    expect(await entregarAsAutomacoes(t.db, e)).toBe(1);
    const runs = await execucoes();
    expect(runs.at(-1)).toEqual({ outcome: 'skipped_recursion', event_id: e.id });
    expect(await avisos()).toHaveLength(1);
  });

  it('a cadeia de automações tem teto: no limite de profundidade, nenhuma regra reage', async () => {
    const e = await eventoCausadoPor(automationRequestId(newId(), 3));
    await entregarAsAutomacoes(t.db, e);
    expect((await execucoes()).at(-1)).toEqual({ outcome: 'skipped_recursion', event_id: e.id });
    expect(await avisos()).toHaveLength(1);
  });
});
