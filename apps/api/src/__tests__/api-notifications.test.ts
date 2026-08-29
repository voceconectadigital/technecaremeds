/**
 * Aurora — notificações pela HTTP (SPEC v0.2 §23 · EPIC-023).
 *
 * O que a borda precisa provar acima de tudo: a caixa é sempre a de quem pede.
 * Não existe parâmetro que faça uma pessoa ler as notificações de outra.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
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
  routeEvent,
  markEmailVerified,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const COORD_USER = newId(),
  COORD_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const ADM_USER = newId(),
  ADM_MEM = newId();
const EMAIL_GESTOR = 'gestor@ntf.test';
const EMAIL_TEC = 'tec@ntf.test';
const EMAIL_ADM = 'adm@ntf.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let os: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: COORD_USER, membershipId: COORD_MEM },
    { slug: 'ntf', name: 'Prestadora', email: EMAIL_GESTOR, userName: 'Gestor' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: ADM_USER, membershipId: ADM_MEM },
    { email: EMAIL_ADM, userName: 'Administradora' }
  );

  const ctx = buildContext({
    organizationId: ORG,
    actorId: COORD_USER,
    membershipId: COORD_MEM,
    requestId: 'setup',
    permissions: PERMISSION_KEYS,
  });

  await withTenant(t.db, ctx, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    // O gestor de manutenção é quem tem `audit.read`, e a fila de saída é
    // trilha operacional: quem a lê é quem responde por ela. LER, só.
    await assignRole(s, COORD_MEM, papeis.get('maintenance_manager')!);
    await assignRole(s, TEC_MEM, papeis.get('technician')!);
    await assignRole(s, ADM_MEM, papeis.get('admin')!);

    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    const cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const local = await createLocation(s, {
      customerId: cliente,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    const ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: local,
    });
    const natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });

    const w = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: 'Reparo',
      locationId: local,
      assetId: ativo,
      assigneeMembershipId: TEC_MEM,
    });
    os = w.id;

    await markEmailVerified(s, TEC_USER);
    await markEmailVerified(s, COORD_USER);

    await routeEvent(s, {
      type: 'sla.breached',
      aggregateType: 'work_order',
      aggregateId: os,
      payload: { number: 'WO-2025-00001' },
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

describe('a caixa é de quem pede', () => {
  it('cada um vê o seu, com a contagem junto', async () => {
    const tecnico = await http.get('/v1/notifications').set(auth(EMAIL_TEC)).expect(200);
    const coord = await http.get('/v1/notifications').set(auth(EMAIL_GESTOR)).expect(200);

    expect(tecnico.body.items).toHaveLength(1);
    expect(coord.body.items).toHaveLength(1);
    expect(tecnico.body.items[0].id).not.toBe(coord.body.items[0].id);
    expect(tecnico.body.unread).toBe(1);
  });

  it('não há parâmetro que faça ler a caixa alheia', async () => {
    const alheia = await http
      .get(`/v1/notifications?membershipId=${COORD_MEM}`)
      .set(auth(EMAIL_TEC))
      .expect(200);
    const propria = await http.get('/v1/notifications').set(auth(EMAIL_TEC)).expect(200);
    expect(alheia.body.items.map((i: { id: string }) => i.id)).toEqual(
      propria.body.items.map((i: { id: string }) => i.id)
    );
  });

  it('marcar como lida vale só para os próprios avisos', async () => {
    const coord = await http.get('/v1/notifications').set(auth(EMAIL_GESTOR)).expect(200);
    const idAlheio = coord.body.items[0].id;

    const r = await http
      .post('/v1/notifications/read')
      .set(auth(EMAIL_TEC))
      .send({ ids: [idAlheio] })
      .expect(201);
    expect(r.body.marked).toBe(0);

    const aindaNaoLida = await http.get('/v1/notifications').set(auth(EMAIL_GESTOR)).expect(200);
    expect(aindaNaoLida.body.unread).toBe(1);
  });

  it('marcar os próprios funciona e é idempotente', async () => {
    const meus = await http.get('/v1/notifications').set(auth(EMAIL_TEC)).expect(200);
    const ids = meus.body.items.map((i: { id: string }) => i.id);

    expect(
      (await http.post('/v1/notifications/read').set(auth(EMAIL_TEC)).send({ ids }).expect(201)).body.marked
    ).toBe(1);
    expect(
      (await http.post('/v1/notifications/read').set(auth(EMAIL_TEC)).send({ ids }).expect(201)).body.marked
    ).toBe(0);
  });

  it('lista inválida de identificadores é recusada', async () => {
    await http
      .post('/v1/notifications/read')
      .set(auth(EMAIL_TEC))
      .send({ ids: ['nao-e-uuid'] })
      .expect(422);

    await http.post('/v1/notifications/read').set(auth(EMAIL_TEC)).send({ ids: 'tudo' }).expect(422);
  });
});

describe('preferências', () => {
  it('o catálogo diz quais canais cada tipo aceita', async () => {
    const r = await http.get('/v1/notifications/types').set(auth(EMAIL_TEC)).expect(200);
    const sla = r.body.items.find((x: { key: string }) => x.key === 'sla_warning');
    expect(sla.channels).toEqual(['in_app', 'push']);
    expect(r.body.items.find((x: { key: string }) => x.key === 'sla_breached').bypassesQuietHours).toBe(true);
  });

  it('salva a preferência do próprio vínculo', async () => {
    await http
      .post('/v1/notifications/preferences')
      .set(auth(EMAIL_TEC))
      .send({ typeKey: 'work_order_rescheduled', channel: 'email', enabled: false })
      .expect(201);
  });

  it('canal que o tipo não aceita é recusado, listando os possíveis', async () => {
    const r = await http
      .post('/v1/notifications/preferences')
      .set(auth(EMAIL_TEC))
      .send({ typeKey: 'sla_warning', channel: 'email' })
      .expect(422);
    expect(r.body.message).toMatch(/in_app, push/);
  });

  it('canal desconhecido é recusado', async () => {
    await http
      .post('/v1/notifications/preferences')
      .set(auth(EMAIL_TEC))
      .send({ typeKey: 'sla_warning', channel: 'pombo_correio' })
      .expect(422);
  });

  it('o silêncio é gravado em minutos do dia, e o inválido é recusado', async () => {
    await http
      .post('/v1/notifications/quiet-hours')
      .set(auth(EMAIL_TEC))
      .send({ startMinute: 1200, endMinute: 420, fullDays: [0, 6] })
      .expect(201);

    await http
      .post('/v1/notifications/quiet-hours')
      .set(auth(EMAIL_TEC))
      .send({ startMinute: 5000, endMinute: 420 })
      .expect(422);

    await http
      .post('/v1/notifications/quiet-hours')
      .set(auth(EMAIL_TEC))
      .send({ startMinute: 1200, endMinute: 420, fullDays: [9] })
      .expect(422);
  });
});

describe('fila de saída', () => {
  it('quem não tem trilha de auditoria não vê a fila', async () => {
    await http.get('/v1/notifications/outbox?channel=email').set(auth(EMAIL_TEC)).expect(403);
  });

  it('canal desconhecido é recusado listando os válidos', async () => {
    const r = await http.get('/v1/notifications/outbox?channel=pombo').set(auth(EMAIL_GESTOR)).expect(422);
    expect(r.body.message).toMatch(/in_app, email/);
  });

  /*
   * LER a fila e ESCREVER nela são permissões diferentes.
   *
   * Marcar como enviada uma notificação que nunca saiu é a pior mentira que um
   * sistema de notificação pode contar: o alerta some da fila e ninguém fica
   * sabendo. Isso era guardado por `audit.read` — que o Auditor tem, e sobre
   * quem a §21 diz "somente leitura em tudo. Nenhuma escrita".
   */
  it('quem só audita não marca entrega: lê a fila e recebe 403 ao escrever', async () => {
    const fila = await http.get('/v1/notifications/outbox?channel=email').set(auth(EMAIL_GESTOR)).expect(200);
    expect(fila.body.items.length).toBeGreaterThan(0);

    const r = await http
      .post(`/v1/notifications/outbox/${fila.body.items[0].id}/sent`)
      .set(auth(EMAIL_GESTOR))
      .expect(403);
    expect(r.body.details.permission).toContain('notification.deliver');
  });

  it('lista o que espera e permite marcar o resultado real do envio', async () => {
    const fila = await http.get('/v1/notifications/outbox?channel=email').set(auth(EMAIL_GESTOR)).expect(200);
    expect(fila.body.items.length).toBeGreaterThan(0);
    expect(fila.body.items[0].email).toContain('@');

    const alvo = fila.body.items[0].id;
    await http.post(`/v1/notifications/outbox/${alvo}/sent`).set(auth(EMAIL_ADM)).expect(201);

    const depois = await http
      .get('/v1/notifications/outbox?channel=email')
      .set(auth(EMAIL_GESTOR))
      .expect(200);
    expect(depois.body.items.find((i: { id: string }) => i.id === alvo)).toBeUndefined();
  });

  it('a falha registra o erro em vez de sumir com a entrega', async () => {
    const fila = await http
      .get('/v1/notifications/outbox?channel=in_app')
      .set(auth(EMAIL_GESTOR))
      .expect(200);
    if (fila.body.items.length === 0) return;

    await http
      .post(`/v1/notifications/outbox/${fila.body.items[0].id}/failed`)
      .set(auth(EMAIL_ADM))
      .send({ error: 'servidor recusou a conexão' })
      .expect(201);
  });
});
