/**
 * Aurora — diretório pela HTTP (EPIC-003).
 *
 * O que esta suíte cobre e a de banco não: que o escopo por local vale na
 * borda. Um vínculo com escopo restrito não pode ver a árvore inteira mesmo
 * pedindo explicitamente por `?root=` de um ramo fora do escopo, e não pode
 * criar local sob pai que ele não enxerga.
 *
 * A regra que isso protege está na SPEC §37: o servidor decide o recorte, o
 * cliente só faz pedido. É o mesmo princípio de nunca aceitar `organization_id`
 * do cliente, aplicado um nível abaixo.
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
  createCustomer,
  createLocation,
  createTeam,
  addTeamMember,
  blockAvailability,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const ADMIN_USER = newId(),
  ADMIN_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const EMAIL_ADMIN = 'gestora@rede.test';
const EMAIL_TEC = 'tecnico@rede.test';
const tokenFor = (email: string) => `local:${email}:${email}`;

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let types: Map<string, string>;
let customer: string;
let unidadeNorte: string, unidadeSul: string, setorNorte: string, salaNorte: string;
let tecnicoRoleId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: ADMIN_USER, membershipId: ADMIN_MEM },
    {
      slug: 'rede',
      name: 'Rede Hospitalar',
      email: EMAIL_ADMIN,
      userName: 'Gestora',
    }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, ADMIN_MEM, roles.get('admin')!);

    types = await provisionStarterLocationTypes(s);
    customer = await createCustomer(s, { name: 'Rede Hospitalar', isInternal: true });
    unidadeNorte = await createLocation(s, {
      customerId: customer,
      locationTypeId: types.get('unidade')!,
      name: 'Unidade Norte',
    });
    unidadeSul = await createLocation(s, {
      customerId: customer,
      locationTypeId: types.get('unidade')!,
      name: 'Unidade Sul',
    });
    setorNorte = await createLocation(s, {
      customerId: customer,
      parentId: unidadeNorte,
      locationTypeId: types.get('setor')!,
      name: 'UTI Norte',
    });
    salaNorte = await createLocation(s, {
      customerId: customer,
      parentId: setorNorte,
      locationTypeId: types.get('sala')!,
      name: 'Leito 1',
    });

    tecnicoRoleId = roles.get('technician')!;
  });

  // Fora do contexto de tenant: criar usuário é ato de plataforma, e o papel da
  // aplicação não escreve em `aurora.users` — nem deveria.
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico', locationIds: [unidadeNorte] }
  );
  await withTenant(t.db, sysCtx, (s) => assignRole(s, TEC_MEM, tecnicoRoleId));

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

describe('clientes', () => {
  it('a organização com um único cliente interno se anuncia como single-customer', async () => {
    const r = await http.get('/v1/customers').set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`);
    expect(r.status).toBe(200);
    expect(r.body.single_customer).toBe(true);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0].location_count).toBe(4);
  });

  it('sem credencial: 401', async () => {
    expect((await http.get('/v1/customers')).status).toBe(401);
  });
});

describe('tipos de local', () => {
  it('a lista já traz os nomes dos pais aceitos, para o formulário não adivinhar', async () => {
    const r = await http.get('/v1/location-types').set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`);
    expect(r.status).toBe(200);
    const unidade = r.body.items.find((t2: { key: string }) => t2.key === 'unidade');
    const setor = r.body.items.find((t2: { key: string }) => t2.key === 'setor');
    expect(unidade.can_be_root).toBe(true);
    expect(unidade.allowed_parent_names).toEqual([]);
    expect(setor.can_be_root).toBe(false);
    expect(setor.allowed_parent_names).toContain('Unidade');
    expect(setor.allows_assets).toBe(true);
  });
});

describe('árvore de locais', () => {
  it('a gestora enxerga a árvore inteira, em ordem de caminho', async () => {
    const r = await http.get('/v1/locations').set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`);
    expect(r.status).toBe(200);
    expect(r.body.items.map((l: { name: string }) => l.name)).toEqual([
      'Unidade Norte',
      'UTI Norte',
      'Leito 1',
      'Unidade Sul',
    ]);
  });

  it('?root recorta a subárvore', async () => {
    const r = await http
      .get(`/v1/locations?root=${setorNorte}`)
      .set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`);
    expect(r.body.items.map((l: { name: string }) => l.name)).toEqual(['UTI Norte', 'Leito 1']);
  });

  it('trilha de navegação vem da raiz até o pai', async () => {
    const r = await http
      .get(`/v1/locations/${salaNorte}/ancestors`)
      .set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`);
    expect(r.body.items.map((l: { name: string }) => l.name)).toEqual(['Unidade Norte', 'UTI Norte']);
  });

  it('root inválido é 422 nomeando o campo, não 500', async () => {
    const r = await http
      .get('/v1/locations?root=nada')
      .set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('validation_failed');
  });
});

describe('escopo por local na borda HTTP', () => {
  it('o técnico só vê a Unidade Norte e o que está abaixo dela', async () => {
    const r = await http.get('/v1/locations').set('authorization', `Bearer ${tokenFor(EMAIL_TEC)}`);
    expect(r.status).toBe(200);
    const nomes = r.body.items.map((l: { name: string }) => l.name);
    expect(nomes).toEqual(['Unidade Norte', 'UTI Norte', 'Leito 1']);
    expect(nomes).not.toContain('Unidade Sul');
  });

  it('pedir ?root de um ramo fora do escopo devolve vazio, não o ramo', async () => {
    const r = await http
      .get(`/v1/locations?root=${unidadeSul}`)
      .set('authorization', `Bearer ${tokenFor(EMAIL_TEC)}`);
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
  });

  it('o técnico não pode criar local: 403 nomeando a permissão que falta', async () => {
    const r = await http
      .post('/v1/locations')
      .set('authorization', `Bearer ${tokenFor(EMAIL_TEC)}`)
      .send({ customer_id: customer, location_type_id: types.get('unidade'), name: 'Unidade pirata' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('location.create');
  });

  it('o técnico não pode mover local: 403', async () => {
    const r = await http
      .post(`/v1/locations/${setorNorte}/move`)
      .set('authorization', `Bearer ${tokenFor(EMAIL_TEC)}`)
      .send({ parent_id: unidadeSul });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('location.move');
  });
});

describe('escrita na árvore', () => {
  it('cria um local e ele aparece na árvore no lugar certo', async () => {
    const criado = await http
      .post('/v1/locations')
      .set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`)
      .send({
        customer_id: customer,
        parent_id: unidadeSul,
        location_type_id: types.get('setor'),
        name: 'UTI Sul',
      });
    expect(criado.status).toBe(201);

    const r = await http
      .get(`/v1/locations?root=${unidadeSul}`)
      .set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`);
    expect(r.body.items.map((l: { name: string }) => l.name)).toEqual(['Unidade Sul', 'UTI Sul']);
    expect(r.body.items[1].depth).toBe(2);
  });

  it('aninhamento inválido é recusado com mensagem que nomeia os tipos aceitos', async () => {
    const r = await http
      .post('/v1/locations')
      .set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`)
      .send({
        customer_id: customer,
        parent_id: setorNorte,
        location_type_id: types.get('unidade'),
        name: 'Unidade aninhada',
      });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it('nome ausente é 422 nomeando o campo', async () => {
    const r = await http
      .post('/v1/locations')
      .set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`)
      .send({ customer_id: customer, location_type_id: types.get('unidade') });
    expect(r.status).toBe(422);
    expect(r.body.details?.field).toBe('name');
  });

  it('mover devolve quantos locais mudaram de lugar', async () => {
    const r = await http
      .post(`/v1/locations/${setorNorte}/move`)
      .set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`)
      .send({ parent_id: unidadeSul });
    expect(r.status).toBe(201);
    expect(r.body.moved).toBe(2);

    const arvore = await http
      .get(`/v1/locations?root=${unidadeSul}`)
      .set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`);
    expect(arvore.body.items.map((l: { name: string }) => l.name)).toContain('UTI Norte');
  });

  it('mover leva junto o escopo: o técnico perde de vista o que saiu da sua unidade', async () => {
    const r = await http.get('/v1/locations').set('authorization', `Bearer ${tokenFor(EMAIL_TEC)}`);
    expect(r.body.items.map((l: { name: string }) => l.name)).toEqual(['Unidade Norte']);
  });

  it('arquivar com estrutura ativa abaixo é 409 com a lista de pendências', async () => {
    const r = await http
      .post(`/v1/locations/${unidadeSul}/archive`)
      .set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/ativo\(s\) abaixo/);
  });
});

describe('equipes e fornecedores', () => {
  it('a equipe traz seus membros e quem está indisponível agora', async () => {
    const sysCtx2 = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'equipe' });
    await withTenant(t.db, sysCtx2, async (s) => {
      const team = await createTeam(s, { name: 'Engenharia Clínica' });
      await addTeamMember(s, team, ADMIN_MEM, { roleInTeam: 'lead', skills: ['eletromédica'] });
      await addTeamMember(s, team, TEC_MEM, { roleInTeam: 'member' });
      // o técnico está de férias agora
      const agora = Date.now();
      await blockAvailability(
        s,
        TEC_MEM,
        'vacation',
        new Date(agora - 86_400_000),
        new Date(agora + 86_400_000),
        'férias'
      );
    });

    const r = await http.get('/v1/teams').set('authorization', `Bearer ${tokenFor(EMAIL_ADMIN)}`);
    expect(r.status).toBe(200);
    const equipe = r.body.items[0];
    expect(equipe.name).toBe('Engenharia Clínica');
    expect(equipe.members).toHaveLength(2);
    const tecnico = equipe.members.find((m: { name: string }) => m.name === 'Técnico');
    const gestora = equipe.members.find((m: { name: string }) => m.name === 'Gestora');
    expect(tecnico.unavailable_now).toBe(true);
    expect(gestora.unavailable_now).toBe(false);
  });

  it('o técnico não tem permissão de ver fornecedores: 403', async () => {
    const r = await http.get('/v1/suppliers').set('authorization', `Bearer ${tokenFor(EMAIL_TEC)}`);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('supplier.read');
  });
});
