/**
 * Aurora — convite e vínculo pela HTTP (SPEC v0.2 §05 · EPIC-002).
 *
 * O que esta suíte cobre e a de banco não cobre: a borda. Convite é a operação
 * em que uma organização escreve numa tabela de plataforma (`users`), e é
 * exatamente o tipo de rota em que um `organization_id` no corpo viraria
 * autorização se ninguém verificasse.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext } from '@aurora/domain';
import { createTestDatabase, seedOrganization, type TestDatabase } from '@aurora/db/testing/harness';
import { withTenant, provisionFactoryRoles, assignRole } from '@aurora/db';
import { loadEnv } from '@aurora/config';
import {
  membersList,
  membersInvite,
  organizationsCurrent,
  meOrganizations,
  healthReady,
  ProblemDetails,
} from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG_A = newId(),
  USER_A = newId(),
  MEM_A = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();

const DONA = 'dona@membros-a.test';
const DONO_B = 'dono@membros-b.test';
const tokenFor = (email: string) => `local:${email}:${email}`;

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: USER_A, membershipId: MEM_A },
    { slug: 'membros-a', name: 'Membros A', email: DONA, userName: 'Dona A' }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    { slug: 'membros-b', name: 'Membros B', email: DONO_B, userName: 'Dono B' }
  );

  for (const [org, mem] of [
    [ORG_A, MEM_A],
    [ORG_B, MEM_B],
  ] as const) {
    await withTenant(
      t.db,
      buildContext({ organizationId: org, actorKind: 'system', requestId: 'setup' }),
      async (s) => {
        const ids = await provisionFactoryRoles(s);
        await assignRole(s, mem, ids.get('admin')!);
      }
    );
  }

  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);
  app = await createApp({ db: t.db, env });
  await app.init();
  http = request(app.getHttpServer());
}, 90_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

const comoDona = (r: request.Test) => r.set('authorization', `Bearer ${tokenFor(DONA)}`);

describe('convite (POST /organizations/current/members)', () => {
  it('cria a pessoa, o vínculo e o escopo numa chamada só', async () => {
    const r = await comoDona(http.post('/v1/organizations/current/members')).send({
      email: 'novato@membros-a.test',
      name: 'Novato da Silva',
      role_keys: ['technician'],
    });

    expect(r.status).toBe(201);
    expect(r.body.membership_id).toBeTruthy();
    expect(r.body.reused_user).toBe(false);

    const lista = await comoDona(http.get('/v1/organizations/current/members'));
    const novato = lista.body.items.find((m: { email: string }) => m.email === 'novato@membros-a.test');
    expect(novato.roles).toEqual(['technician']);
    // O escopo existe desde o primeiro segundo: sem ele a pessoa entra numa
    // tela vazia e não tem como saber por quê.
    expect(novato.customer_scope).toBe('all');
  });

  it('quem não pode gerir membros recebe 403 nomeando a permissão', async () => {
    const r = await http
      .post('/v1/organizations/current/members')
      .set('authorization', `Bearer ${tokenFor('novato@membros-a.test')}`)
      .send({ email: 'x@membros-a.test', name: 'Xis' });

    expect(r.status).toBe(403);
    expect(r.body.details.permission).toContain('organization.manage_members');
  });

  it('sem credencial: 401', async () => {
    const r = await http
      .post('/v1/organizations/current/members')
      .send({ email: 'y@membros-a.test', name: 'Ípsilon' });
    expect(r.status).toBe(401);
  });

  it('e-mail inválido: 422 apontando o campo', async () => {
    const r = await comoDona(http.post('/v1/organizations/current/members')).send({
      email: 'isto-nao-e-email',
      name: 'Alguém',
    });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('email');
  });

  it('convidar de novo: 409 dizendo que já faz parte', async () => {
    const r = await comoDona(http.post('/v1/organizations/current/members')).send({
      email: 'novato@membros-a.test',
      name: 'Novato da Silva',
    });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('já faz parte');
  });

  it('organization_id no corpo é ignorado — não é autorização', async () => {
    const r = await comoDona(http.post('/v1/organizations/current/members')).send({
      email: 'infiltrado@membros-a.test',
      name: 'Infiltrado',
      organization_id: ORG_B,
    });
    expect(r.status).toBe(201);

    // A pessoa entrou em A, que é a organização de quem convidou.
    const emB = await http
      .get('/v1/organizations/current/members')
      .set('authorization', `Bearer ${tokenFor(DONO_B)}`);
    expect(JSON.stringify(emB.body)).not.toContain('infiltrado@membros-a.test');
  });

  it('escopo restrito com lista vazia: 422 antes de criar qualquer coisa', async () => {
    const r = await comoDona(http.post('/v1/organizations/current/members')).send({
      email: 'cego@membros-a.test',
      name: 'Cego',
      location_scope: 'listed',
      location_ids: [],
    });
    expect(r.status).toBe(422);

    const lista = await comoDona(http.get('/v1/organizations/current/members'));
    expect(JSON.stringify(lista.body)).not.toContain('cego@membros-a.test');
  });

  it('a mesma pessoa em duas organizações é um cadastro só', async () => {
    const email = 'consultora@parceira.test';
    const emA = await comoDona(http.post('/v1/organizations/current/members')).send({
      email,
      name: 'Consultora',
    });
    const emB = await http
      .post('/v1/organizations/current/members')
      .set('authorization', `Bearer ${tokenFor(DONO_B)}`)
      .send({ email, name: 'Consultora' });

    expect(emA.body.reused_user).toBe(false);
    expect(emB.body.reused_user).toBe(true);
    expect(emB.body.user_id).toBe(emA.body.user_id);
    expect(emB.body.membership_id).not.toBe(emA.body.membership_id);
  });
});

describe('escopo (PATCH .../:id/scope)', () => {
  it('ajusta o escopo de um vínculo existente', async () => {
    const lista = await comoDona(http.get('/v1/organizations/current/members'));
    const alvo = lista.body.items.find((m: { email: string }) => m.email === 'novato@membros-a.test');

    const r = await comoDona(
      http.patch(`/v1/organizations/current/members/${alvo.membership_id}/scope`)
    ).send({ customer_scope: 'all', location_scope: 'all' });
    expect(r.status).toBe(200);
  });

  it('identificador que não é uuid é recusado', async () => {
    const r = await comoDona(http.patch('/v1/organizations/current/members/abc/scope')).send({
      customer_scope: 'all',
    });
    // 422: a rota existe e o identificador é que não presta.
    expect(r.status).toBe(422);
  });

  it('vínculo de outra organização: 404, não 403 — nem confirma que existe', async () => {
    const r = await comoDona(http.patch(`/v1/organizations/current/members/${MEM_B}/scope`)).send({
      customer_scope: 'all',
    });
    expect(r.status).toBe(404);
  });
});

describe('suspensão (POST .../:id/suspension)', () => {
  it('exige motivo', async () => {
    const lista = await comoDona(http.get('/v1/organizations/current/members'));
    const alvo = lista.body.items.find((m: { email: string }) => m.email === 'infiltrado@membros-a.test');

    const semMotivo = await comoDona(
      http.post(`/v1/organizations/current/members/${alvo.membership_id}/suspension`)
    ).send({});
    expect(semMotivo.status).toBe(422);

    const r = await comoDona(
      http.post(`/v1/organizations/current/members/${alvo.membership_id}/suspension`)
    ).send({ reason: 'encerrou o contrato de prestação' });
    expect(r.status).toBe(201);

    const depois = await comoDona(http.get('/v1/organizations/current/members'));
    const agora = depois.body.items.find((m: { email: string }) => m.email === 'infiltrado@membros-a.test');
    // Continua na lista, suspenso: apagar levaria junto a trilha de auditoria.
    expect(agora.status).toBe('suspended');
  });

  it('o último proprietário ativo não pode ser suspenso', async () => {
    const r = await comoDona(http.post(`/v1/organizations/current/members/${MEM_A}/suspension`)).send({
      reason: 'tentativa de deixar a organização sem dono',
    });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('último proprietário ativo');
  });
});

/*
 * O contrato só vale se a API o cumprir.
 *
 * Sem estes testes, `@aurora/contracts` seria documentação: descreveria uma
 * resposta que ninguém confere, o cliente do frontend confiaria nela, e a
 * divergência apareceria como campo `undefined` numa tela.
 */
describe('a resposta cumpre o contrato', () => {
  it('members.list', async () => {
    const r = await comoDona(http.get('/v1/organizations/current/members')).expect(200);
    const conferido = membersList.response.safeParse(r.body);
    expect(conferido.success ? null : conferido.error.issues).toBeNull();
  });

  it('members.invite', async () => {
    const r = await comoDona(http.post('/v1/organizations/current/members'))
      .send({ email: 'contrato@membros-a.test', name: 'Contrato' })
      .expect(201);
    const conferido = membersInvite.response.safeParse(r.body);
    expect(conferido.success ? null : conferido.error.issues).toBeNull();
  });

  it('organizations.current', async () => {
    const r = await comoDona(http.get('/v1/organizations/current')).expect(200);
    const conferido = organizationsCurrent.response.safeParse(r.body);
    expect(conferido.success ? null : conferido.error.issues).toBeNull();
  });

  it('me.organizations', async () => {
    const r = await comoDona(http.get('/v1/me/organizations')).expect(200);
    const conferido = meOrganizations.response.safeParse(r.body);
    expect(conferido.success ? null : conferido.error.issues).toBeNull();
  });

  it('health.ready', async () => {
    const r = await http.get('/v1/health/ready').expect(200);
    expect(healthReady.response.safeParse(r.body).success).toBe(true);
  });

  /*
   * O erro também é contrato. Uma tela que trata falha lendo `code` e
   * `request_id` quebra em silêncio se um deles faltar num caminho de erro.
   */
  it('o problem details do 403 tem a forma declarada', async () => {
    const r = await http
      .post('/v1/organizations/current/members')
      .set('authorization', `Bearer ${tokenFor('novato@membros-a.test')}`)
      .send({ email: 'z@membros-a.test', name: 'Zeta' })
      .expect(403);
    const conferido = ProblemDetails.safeParse(r.body);
    expect(conferido.success ? null : conferido.error.issues).toBeNull();
  });

  it('o problem details do 422 aponta o campo', async () => {
    const r = await comoDona(http.post('/v1/organizations/current/members'))
      .send({ email: 'nao-e-email', name: 'Alguém' })
      .expect(422);
    expect(ProblemDetails.safeParse(r.body).success).toBe(true);
    expect(r.body.details.field).toBe('email');
  });
});
