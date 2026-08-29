/**
 * Aurora — agenda pela HTTP (SPEC v0.2 §13 · EPIC-012).
 *
 * O critério do épico na borda: conferir custa uma requisição e não muda nada,
 * o aviso volta com o motivo escrito, e o bloqueio é só o que precisa ser.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext } from '@aurora/domain';
import {
  createTestDatabase,
  seedOrganization,
  seedMember,
  type TestDatabase,
} from '@aurora/db/testing/harness';
import {
  withTenant,
  provisionFactoryRoles,
  assignRole,
  provisionStarterLocationTypes,
  provisionWorkOrderStates,
  createCustomer,
  createLocation,
  createCatalogItem,
  createAssetCategory,
  createAsset,
  createWorkOrder,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const COORD_USER = newId(),
  COORD_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const EMAIL_COORD = 'coord@ag.test';
const EMAIL_TEC = 'tec@ag.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let cliente: string, setor: string, ativo: string, natureza: string;

const em = (iso: string) => new Date(iso).toISOString();

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: COORD_USER, membershipId: COORD_MEM },
    { slug: 'agapi', name: 'Prestadora', email: EMAIL_COORD, userName: 'Coordenadora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, COORD_MEM, roles.get('coordinator')!);
    await assignRole(s, TEC_MEM, roles.get('technician')!);
    await s.query(`UPDATE aurora.memberships SET daily_hours = 8 WHERE id = $1`, [TEC_MEM]);

    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede',
    });
    setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });
    natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });
  });

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

async function novaOs(titulo: string): Promise<string> {
  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'wo' });
  return withTenant(t.db, sysCtx, async (s) => {
    const w = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: titulo,
      locationId: setor,
      assetId: ativo,
      assigneeMembershipId: TEC_MEM,
    });
    return w.id;
  });
}

describe('conferir e agendar', () => {
  let os: string;

  beforeAll(async () => {
    os = await novaOs('Preventiva');
  });

  it('conferir não grava nada', async () => {
    const r = await http
      .post('/v1/schedule/check')
      .set(auth(EMAIL_COORD))
      .send({
        workOrderId: os,
        startsAt: em('2025-03-10T09:00:00Z'),
        endsAt: em('2025-03-10T11:00:00Z'),
      })
      .expect(201);
    expect(r.body.conflicts).toEqual([]);

    const [w] = await withTenant(
      t.db,
      buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'c' }),
      (s) =>
        s.query<{ scheduled_start: Date | null }>(
          `SELECT scheduled_start FROM aurora.work_orders WHERE id = $1`,
          [os]
        )
    );
    expect(w!.scheduled_start).toBeNull();
  });

  it('data inválida é recusada antes de chegar ao domínio', async () => {
    const r = await http
      .post('/v1/schedule/check')
      .set(auth(EMAIL_COORD))
      .send({ workOrderId: os, startsAt: 'amanhã cedo', endsAt: em('2025-03-10T11:00:00Z') })
      .expect(422);
    expect(r.body.message).toMatch(/data e hora/);
  });

  it('agendar grava e devolve a contagem de reagendamentos', async () => {
    const r = await http
      .post('/v1/schedule')
      .set(auth(EMAIL_COORD))
      .send({
        workOrderId: os,
        startsAt: em('2025-03-10T09:00:00Z'),
        endsAt: em('2025-03-10T11:00:00Z'),
      })
      .expect(201);
    expect(r.body.rescheduleCount).toBe(0);
    expect(r.body.signal).toBe(false);
  });

  it('o técnico não programa a agenda da equipe', async () => {
    await http
      .post('/v1/schedule')
      .set(auth(EMAIL_TEC))
      .send({
        workOrderId: os,
        startsAt: em('2025-03-11T09:00:00Z'),
        endsAt: em('2025-03-11T11:00:00Z'),
      })
      .expect(403);
  });
});

describe('as três lentes', () => {
  it('o calendário devolve o que cruza o intervalo', async () => {
    const r = await http
      .get(`/v1/schedule?from=${em('2025-03-10T00:00:00Z')}&to=${em('2025-03-11T00:00:00Z')}`)
      .set(auth(EMAIL_COORD))
      .expect(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0].customer_name).toBe('Hospital');
  });

  it('intervalo grande demais é recusado, com o limite dito', async () => {
    const r = await http
      .get(`/v1/schedule?from=${em('2025-01-01T00:00:00Z')}&to=${em('2025-12-31T00:00:00Z')}`)
      .set(auth(EMAIL_COORD))
      .expect(422);
    expect(r.body.message).toMatch(/62 dias/);
  });

  it('a lente de recursos traz carga e capacidade', async () => {
    const r = await http
      .get(`/v1/schedule/resources?day=${em('2025-03-10T00:00:00Z')}`)
      .set(auth(EMAIL_COORD))
      .expect(200);
    const tecnico = r.body.items.find((x: { membershipId: string }) => x.membershipId === TEC_MEM);
    expect(tecnico.load.capacityMinutes).toBe(480);
    expect(tecnico.load.bookedMinutes).toBe(120);
  });

  it('o painel lateral vem com contadores prontos e os rótulos', async () => {
    await novaOs('Sem programação');
    const r = await http.get('/v1/schedule/buckets').set(auth(EMAIL_COORD)).expect(200);
    expect(r.body.labels.unscheduled).toBe('Não agendadas');
    expect(r.body.counts.unscheduled).toBeGreaterThanOrEqual(1);
    expect(r.body.items.filter((i: { bucket: string }) => i.bucket === 'unscheduled')).toHaveLength(
      r.body.counts.unscheduled
    );
  });

  it('as rotas de lente não colidem com a rota de agendar', async () => {
    // `resources` e `buckets` são caminhos literais sob o mesmo controlador do
    // POST sem sufixo; a colisão só não acontece porque nenhum deles é `:id`.
    await http.get('/v1/schedule/buckets').set(auth(EMAIL_COORD)).expect(200);
    await http
      .get(`/v1/schedule/resources?day=${em('2025-03-10T00:00:00Z')}`)
      .set(auth(EMAIL_COORD))
      .expect(200);
  });
});

describe('ausências', () => {
  it('férias registradas jogam a OS marcada para o balde "Reagendar"', async () => {
    const os = await novaOs('Vai cair nas férias');
    await http
      .post('/v1/schedule')
      .set(auth(EMAIL_COORD))
      .send({
        workOrderId: os,
        startsAt: em('2025-04-10T09:00:00Z'),
        endsAt: em('2025-04-10T11:00:00Z'),
      })
      .expect(201);

    await http
      .post('/v1/schedule/absences')
      .set(auth(EMAIL_COORD))
      .send({
        membershipId: TEC_MEM,
        kind: 'vacation',
        startsAt: em('2025-04-07T00:00:00Z'),
        endsAt: em('2025-04-20T00:00:00Z'),
      })
      .expect(201);

    const r = await http.get('/v1/schedule/buckets').set(auth(EMAIL_COORD)).expect(200);
    const linha = r.body.items.find((i: { work_order_id: string }) => i.work_order_id === os);
    expect(linha.bucket).toBe('to_reschedule');
    expect(linha.window_invalidated_reason).toMatch(/férias/);
  });

  it('agendar dentro das férias é 409, com o motivo', async () => {
    const os = await novaOs('Tentativa sobre férias');
    const r = await http
      .post('/v1/schedule')
      .set(auth(EMAIL_COORD))
      .send({
        workOrderId: os,
        startsAt: em('2025-04-12T09:00:00Z'),
        endsAt: em('2025-04-12T11:00:00Z'),
      })
      .expect(409);
    expect(r.body.message).toMatch(/em férias/);
  });

  it('espécie de ausência desconhecida é recusada listando as válidas', async () => {
    const r = await http
      .post('/v1/schedule/absences')
      .set(auth(EMAIL_COORD))
      .send({
        membershipId: TEC_MEM,
        kind: 'sabatico',
        startsAt: em('2025-06-01T00:00:00Z'),
        endsAt: em('2025-06-02T00:00:00Z'),
      })
      .expect(422);
    expect(r.body.message).toMatch(/vacation/);
  });
});
