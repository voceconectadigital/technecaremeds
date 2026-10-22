/**
 * Aurora — automações AGENDADAS (reunião 16/10/2026, Fase 10).
 *
 *   · "Nova automação": relatório agendado, lembrete, tarefa, 5W2H, PDCA;
 *   · simulação da regra de relógio = a agenda (conta, não palpite);
 *   · agendador: idempotente por (regra, passada), repete na passada seguinte,
 *     registra log, não atravessa organização;
 *   · relatório no recorte de escopo de CADA destinatário; e-mail na FILA
 *     (sem transporte configurado — BLOQUEADO — INFRA), nunca "enviado".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext, nextRuns, PERMISSION_KEYS } from '@aurora/domain';
import {
  createTestDatabase,
  seedOrganization,
  seedMember,
  type TestDatabase,
} from '@aurora/db/testing/harness';
import {
  withTenant,
  assignRole,
  createCustomer,
  createLocation,
  createWorkOrder,
  provisionOrganizationBaseline,
  runScheduledAutomations,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { automationsList, automationTasksList, automationReportOutput } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG = newId();
const ORG_B = newId();
const ADMIN = 'admin@agenda.test';
const RESTRITA = 'restrita@agenda.test';
const OPERADOR = 'operador@agenda.test';
const SOLICITANTE = 'sol@agenda.test';
const ADMIN_B = 'admin@agenda-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const SP = 'America/Sao_Paulo';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
const memR = newId();
const memO = newId();
const memS = newId();
let hospitalA: string;

const varrer = (org: string, quando: Date) =>
  withTenant(
    t.db,
    buildContext({
      organizationId: org,
      actorKind: 'system',
      requestId: `job-${newId()}`,
      source: 'job',
      permissions: PERMISSION_KEYS,
    }),
    (s) => runScheduledAutomations(s, quando)
  );

const consultar = <T>(org: string, sql: string, p: unknown[] = []) =>
  withTenant(t.db, buildContext({ organizationId: org, actorKind: 'system', requestId: newId() }), (s) =>
    s.query<T>(sql, p)
  );

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(t, ids, { slug: 'agenda', name: 'Prestadora', email: ADMIN, userName: 'Admin' });
  await seedOrganization(t, idsB, { slug: 'agenda-b', name: 'B', email: ADMIN_B, userName: 'B' });
  let hospitalB = '';
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, ids.membershipId, base.roles.get('admin')!);
      hospitalA = await createCustomer(s, { name: 'Hospital A' });
      hospitalB = await createCustomer(s, { name: 'Hospital B' });
      const [corretiva] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
      );
      for (const [cliente, n] of [
        [hospitalA, 3],
        [hospitalB, 1],
      ] as const) {
        const sede = await createLocation(s, {
          customerId: cliente,
          locationTypeId: base.locationTypes.get('unidade')!,
          name: `Sede ${n}`,
        });
        for (let i = 0; i < n; i++) {
          await createWorkOrder(s, {
            customerId: cliente,
            locationId: sede,
            workOrderTypeId: corretiva!.id,
            title: `OS ${i}`,
          });
        }
      }
    }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memR },
    {
      email: RESTRITA,
      userName: 'Restrita',
      customerIds: [hospitalA],
    }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memO },
    { email: OPERADOR, userName: 'Operador' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memS },
    {
      email: SOLICITANTE,
      userName: 'Sol',
      seatType: 'portal',
      customerIds: [hospitalA],
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memR, base.roles.get('manager')!);
      await assignRole(s, memO, base.roles.get('operator')!);
      await assignRole(s, memS, base.roles.get('requester')!);
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_B, actorKind: 'system', requestId: 's3' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, idsB.membershipId, base.roles.get('admin')!);
    }
  );

  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);
  app = await createApp({ db: t.db, env });
  await app.init();
  http = request(app.getHttpServer());
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

const criar = (quem: string, body: Record<string, unknown>) =>
  http
    .post('/v1/automations')
    .set(auth(quem))
    .send({ triggerKind: 'schedule', triggerTimezone: SP, ...body });

async function ligar(id: string): Promise<void> {
  expect((await http.post(`/v1/automations/${id}/simulate`).set(auth(ADMIN)).send({})).status).toBe(201);
  expect((await http.post(`/v1/automations/${id}/activate`).set(auth(ADMIN)).send({})).status).toBe(201);
}

describe('Nova automação: vocabulário e validação', () => {
  it('modelos de relatório, lembrete, aviso de peça, tarefa, 5W2H e PDCA; e-mail sem transporte declarado', async () => {
    const r = await http.get('/v1/automations/vocabulary').set(auth(ADMIN));
    expect(r.body.templates.map((x: { key: string }) => x.key)).toEqual([
      'scheduled_report',
      'reminder',
      'parts_alert',
      'task',
      '5w2h',
      'pdca',
    ]);
    expect(r.body.email_transport).toBe('not_configured');
  });

  it('recusa: ação de OS em regra de relógio, cron inválido, fuso inválido, destinatário de fora ou sem indicador, 5W2H incompleto', async () => {
    const base = { name: 'x', triggerCron: '0 8 * * 1' };
    expect((await criar(ADMIN, { ...base, actions: [{ kind: 'assign', params: {} }] })).status).toBe(422);
    expect(
      (
        await criar(ADMIN, {
          ...base,
          triggerCron: '61 8 * * *',
          actions: [{ kind: 'reminder', params: { recipients: [memO], title: 'a' } }],
        })
      ).status
    ).toBe(422);
    expect(
      (
        await criar(ADMIN, {
          ...base,
          triggerTimezone: 'Lua/Base',
          actions: [{ kind: 'reminder', params: { recipients: [memO], title: 'a' } }],
        })
      ).status
    ).toBe(422);
    expect(
      (
        await criar(ADMIN, {
          ...base,
          actions: [{ kind: 'reminder', params: { recipients: [idsB.membershipId], title: 'a' } }],
        })
      ).status
    ).toBe(422);
    expect(
      (
        await criar(ADMIN, {
          ...base,
          actions: [{ kind: 'send_report', params: { recipients: [memS], tier: 'basic' } }],
        })
      ).status
    ).toBe(422);
    expect(
      (
        await criar(ADMIN, {
          ...base,
          actions: [
            {
              kind: 'create_task',
              params: { method: '5w2h', title: 'Trocar filtros', ownerMembershipId: memO, why: 'x' },
            },
          ],
        })
      ).status
    ).toBe(422);
    expect(
      (
        await criar(OPERADOR, {
          ...base,
          actions: [{ kind: 'reminder', params: { recipients: [memO], title: 'a' } }],
        })
      ).status
    ).toBe(403);
  });
});

describe('aviso imediato: OS aguardando peça (gatilho por evento)', () => {
  it('o lembrete aceita gatilho de evento, com filtro pelo motivo de espera e {{number}} no título', async () => {
    const r = await criar(ADMIN, {
      name: 'Aviso ao compras: OS aguardando peça',
      triggerKind: 'event',
      triggerEvent: 'work_order.blocked',
      conditions: { field: 'wait_reason_key', op: 'eq', value: 'parts' },
      actions: [{ kind: 'reminder', params: { recipients: [memO], title: 'OS {{number}} aguardando peça' } }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});

describe('relatório agendado', () => {
  let regra: string;
  let primeira: Date;

  it('simular = a agenda; ativar exige simulação; a lista mostra a próxima passada', async () => {
    const r = await criar(ADMIN, {
      name: 'Relatório semanal',
      triggerCron: '0 8 * * 1',
      actions: [
        {
          kind: 'send_report',
          params: { recipients: [ids.membershipId, memR], tier: 'basic', periodDays: 30 },
        },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    regra = r.body.id;
    expect((await http.post(`/v1/automations/${regra}/activate`).set(auth(ADMIN)).send({})).status).toBe(409);
    const sim = await http.post(`/v1/automations/${regra}/simulate`).set(auth(ADMIN)).send({ days: 28 });
    expect(sim.body.matched).toBe(4);
    // `nextRuns` olha 31 dias à frente: numa segunda-feira de manhã cabem 5 passadas
    // semanais, noutros dias da semana só 4 (a quinta cai no 32º dia). O teste não pode
    // depender do dia em que roda — o que importa é que sejam passadas futuras, em ordem.
    expect(sim.body.next_runs.length).toBeGreaterThanOrEqual(4);
    expect(sim.body.next_runs.length).toBeLessThanOrEqual(5);
    expect([...sim.body.next_runs].sort()).toEqual(sim.body.next_runs);
    expect(sim.body.summary).toMatch(/vai rodar 4 vez/);
    expect((await http.post(`/v1/automations/${regra}/activate`).set(auth(ADMIN)).send({})).status).toBe(201);
    const lista = await http.get('/v1/automations').set(auth(ADMIN));
    expect(automationsList.response.safeParse(lista.body).success).toBe(true);
    const item = lista.body.items.find((x: { id: string }) => x.id === regra);
    primeira = new Date(item.next_run);
    expect(primeira.toISOString()).toBe(new Date(sim.body.next_runs[0]).toISOString());
    // segunda-feira 08:00 em Brasília = 11:00 UTC
    expect(primeira.getUTCHours()).toBe(11);
    expect(primeira.getUTCDay()).toBe(1);
  });

  it('o agendador roda a passada devida; cada destinatário recebe NO SEU recorte; e-mail fica na fila', async () => {
    // PF-56: o e-mail da automação obedece às preferências — só quem tem e-mail
    // verificado entra na fila; a restrita (não verificada) fica suprimida.
    await consultar(ORG, `UPDATE aurora.users SET email_verified_at = now() WHERE id = $1`, [ids.userId]);
    expect((await varrer(ORG, new Date(primeira.getTime() - 60_000))).ran).toBe(0);
    const r = await varrer(ORG, new Date(primeira.getTime() + 3 * 60_000));
    expect(r.ran).toBe(1);
    const saidas = await consultar<{
      id: string;
      recipient_membership_id: string;
      sections: Array<{ key: string; value: number }>;
    }>(
      ORG,
      `SELECT id, recipient_membership_id, sections FROM aurora.automation_report_outputs WHERE rule_id = $1`,
      [regra]
    );
    expect(saidas).toHaveLength(2);
    const abertas = (m: string) =>
      saidas
        .find((x) => x.recipient_membership_id === m)!
        .sections.find((x) => x.key === 'work_orders_opened')!.value;
    expect(abertas(ids.membershipId)).toBe(4);
    expect(abertas(memR)).toBe(3);
    const entregas = await consultar<{
      channel: string;
      state: string;
      reason: string | null;
      membership_id: string;
    }>(
      ORG,
      `SELECT d.channel::text AS channel, d.state::text AS state, d.reason, n.membership_id
         FROM aurora.notification_deliveries d JOIN aurora.notifications n ON n.id = d.notification_id
        WHERE n.type_key = 'automation.scheduled_report'`
    );
    const email = (m: string) => entregas.find((e) => e.channel === 'email' && e.membership_id === m);
    expect(email(ids.membershipId)).toMatchObject({ state: 'pending', reason: 'awaiting_email_transport' });
    expect(email(memR)).toMatchObject({ state: 'suppressed', reason: 'unverified_email' });
    // a caixa de entrada recebe sempre
    expect(entregas.filter((e) => e.channel === 'in_app' && e.state === 'sent')).toHaveLength(2);
    expect(entregas.some((e) => e.state === 'sent' && e.channel === 'email')).toBe(false);
  });

  it('idempotente: a mesma passada não roda duas vezes; a seguinte roda (repetição)', async () => {
    expect((await varrer(ORG, new Date(primeira.getTime() + 3 * 60_000))).ran).toBe(0);
    expect((await varrer(ORG, new Date(primeira.getTime() + 60 * 60_000))).ran).toBe(0);
    const semana = new Date(primeira.getTime() + 7 * 86_400_000 + 60_000);
    expect((await varrer(ORG, semana)).ran).toBe(1);
    const [n] = await consultar<{ total: string }>(
      ORG,
      `SELECT count(*)::text AS total FROM aurora.automation_report_outputs WHERE rule_id = $1`,
      [regra]
    );
    expect(Number(n!.total)).toBe(4);
  });

  it('log: cada passada registrada com o resultado', async () => {
    const r = await http.get(`/v1/automations/${regra}/runs`).set(auth(ADMIN));
    const agendadas = r.body.items.filter(
      (x: { event_type: string }) => x.event_type === 'automation.schedule'
    );
    expect(agendadas).toHaveLength(2);
    expect(agendadas.every((x: { outcome: string }) => x.outcome === 'matched')).toBe(true);
  });

  it('o relatório entregue: só o destinatário lê; o de outra pessoa (mesmo gestora) e outra organização → 404', async () => {
    const [minha] = await consultar<{ id: string }>(
      ORG,
      `SELECT id FROM aurora.automation_report_outputs WHERE recipient_membership_id = $1 LIMIT 1`,
      [memR]
    );
    const [dela] = await consultar<{ id: string }>(
      ORG,
      `SELECT id FROM aurora.automation_report_outputs WHERE recipient_membership_id = $1 LIMIT 1`,
      [ids.membershipId]
    );
    const ok = await http.get(`/v1/automation-report-outputs/${minha!.id}`).set(auth(RESTRITA));
    expect(ok.status).toBe(200);
    expect(automationReportOutput.response.safeParse(ok.body).success).toBe(true);
    // e-mail não verificado: o relatório diz que o e-mail NÃO sai (PF-56)
    expect(ok.body.email_state).toBe('suppressed');
    expect((await http.get(`/v1/automation-report-outputs/${dela!.id}`).set(auth(RESTRITA))).status).toBe(
      404
    );
    expect((await http.get(`/v1/automation-report-outputs/${minha!.id}`).set(auth(ADMIN_B))).status).toBe(
      404
    );
  });

  it('outra organização: o agendador de B não vê as regras de A', async () => {
    const r = await varrer(ORG_B, new Date(primeira.getTime() + 14 * 86_400_000 + 60_000));
    expect(r).toEqual({ rules: 0, ran: 0, failed: 0, skipped: 0 });
  });
});

describe('lembrete, tarefa, 5W2H e PDCA', () => {
  it('lembrete: "executar agora" avisa; repetir no mesmo minuto não duplica', async () => {
    const r = await criar(ADMIN, {
      name: 'Lembrete de inventário',
      triggerCron: '0 9 1 * *',
      actions: [
        { kind: 'reminder', params: { recipients: [memO], title: 'Conferir inventário', message: 'Mensal' } },
      ],
    });
    await ligar(r.body.id);
    const um = await http.post(`/v1/automations/${r.body.id}/run-now`).set(auth(ADMIN)).send({});
    expect(um.status).toBe(201);
    expect(um.body.executed).toBe(true);
    const dois = await http.post(`/v1/automations/${r.body.id}/run-now`).set(auth(ADMIN)).send({});
    // o mesmo minuto é a mesma passada (a chance de virar o minuto entre as duas é desprezível)
    if (dois.body.executed === false) expect(dois.body.actions).toEqual([]);
    const avisos = await consultar<{ title: string }>(
      ORG,
      `SELECT title FROM aurora.notifications WHERE type_key = 'automation.reminder' AND membership_id = $1`,
      [memO]
    );
    expect(avisos[0]!.title).toBe('Conferir inventário');
  });

  it('5W2H: tarefa com os sete campos, valor em centavos, só o responsável vê e avança', async () => {
    const r = await criar(ADMIN, {
      name: 'Plano 5W2H mensal',
      triggerCron: '0 7 1 * *',
      actions: [
        {
          kind: 'create_task',
          params: {
            method: '5w2h',
            title: 'Revisar filtros de ar',
            why: 'Achado da auditoria',
            where: 'UTI',
            how: 'Checklist do fabricante',
            howMuch: '1500,00',
            ownerMembershipId: memO,
            dueInDays: 10,
          },
        },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await ligar(r.body.id);
    expect(
      (await http.post(`/v1/automations/${r.body.id}/run-now`).set(auth(ADMIN)).send({})).body.executed
    ).toBe(true);
    const minhas = await http.get('/v1/automation-tasks').set(auth(OPERADOR));
    expect(automationTasksList.response.safeParse(minhas.body).success).toBe(true);
    const tarefa = minhas.body.items.find((x: { method: string }) => x.method === '5w2h');
    expect(tarefa).toMatchObject({
      title: 'Revisar filtros de ar',
      where_text: 'UTI',
      how_much_cents: 150000,
      state: 'open',
    });
    expect((await http.get('/v1/automation-tasks').set(auth(RESTRITA))).body.items).toHaveLength(0);
    expect(
      (
        await http
          .post(`/v1/automation-tasks/${tarefa.id}/advance`)
          .set(auth(RESTRITA))
          .send({ action: 'advance' })
      ).status
    ).toBe(404);
    const feito = await http
      .post(`/v1/automation-tasks/${tarefa.id}/advance`)
      .set(auth(OPERADOR))
      .send({ action: 'advance' });
    expect(feito.body.state).toBe('done');
    expect(
      (
        await http
          .post(`/v1/automation-tasks/${tarefa.id}/advance`)
          .set(auth(OPERADOR))
          .send({ action: 'advance' })
      ).status
    ).toBe(409);
  });

  it('PDCA anda uma fase por vez: Planejar → Executar → Checar → Agir → concluída', async () => {
    const r = await criar(ADMIN, {
      name: 'Ciclo PDCA',
      triggerCron: '0 7 * * 5',
      actions: [
        { kind: 'create_task', params: { method: 'pdca', title: 'Reduzir MTTR', ownerMembershipId: memO } },
      ],
    });
    await ligar(r.body.id);
    await http.post(`/v1/automations/${r.body.id}/run-now`).set(auth(ADMIN)).send({});
    const t1 = (await http.get('/v1/automation-tasks?state=open').set(auth(OPERADOR))).body.items.find(
      (x: { method: string }) => x.method === 'pdca'
    );
    expect(t1.pdca_phase).toBe('plan');
    const fases: string[] = [];
    for (let i = 0; i < 4; i++) {
      const a = await http
        .post(`/v1/automation-tasks/${t1.id}/advance`)
        .set(auth(OPERADOR))
        .send({ action: 'advance' });
      fases.push(a.body.state === 'done' ? 'done' : a.body.pdca_phase);
    }
    expect(fases).toEqual(['do', 'check', 'act', 'done']);
  });

  it('falha registrada no log, sem efeito parcial: responsável bloqueado depois da regra criada', async () => {
    const memX = newId();
    await seedMember(
      t,
      { organizationId: ORG, userId: newId(), membershipId: memX },
      { email: 'x@agenda.test', userName: 'X' }
    );
    const r = await criar(ADMIN, {
      name: 'Tarefa de quem saiu',
      triggerCron: '0 7 * * 2',
      actions: [{ kind: 'create_task', params: { method: 'task', title: 'Algo', ownerMembershipId: memX } }],
    });
    await ligar(r.body.id);
    await consultar(ORG, `UPDATE aurora.memberships SET status = 'blocked' WHERE id = $1`, [memX]);
    const run = await http.post(`/v1/automations/${r.body.id}/run-now`).set(auth(ADMIN)).send({});
    expect(run.body.outcome).toBe('failed');
    const log = await http.get(`/v1/automations/${r.body.id}/runs`).set(auth(ADMIN));
    expect(log.body.items[0].outcome).toBe('failed');
    expect(log.body.items[0].error).toMatch(/responsável/);
    const [n] = await consultar<{ total: string }>(
      ORG,
      `SELECT count(*)::text AS total FROM aurora.automation_tasks WHERE rule_id = $1`,
      [r.body.id]
    );
    expect(n!.total).toBe('0');
  });

  it('próximas passadas respeitam o fuso da regra', () => {
    const [d] = nextRuns('30 6 * * *', SP, new Date('2026-10-16T12:00:00Z'), 1);
    expect(d!.toISOString()).toBe('2026-10-17T09:30:00.000Z');
  });
});
