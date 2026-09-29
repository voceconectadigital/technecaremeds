/**
 * Aurora — entrar e sair pela borda HTTP (SPEC v0.2 §36 · §37).
 *
 * A suíte é escrita do ponto de vista de quem tenta abusar da rota: ela é
 * pública, aceita corpo do mundo inteiro, e é a única porta para dentro do
 * sistema.
 *
 * As três propriedades que ela protege:
 *
 *   1. a recusa não conta NADA sobre o cadastro;
 *   2. o token deixa de valer no instante em que a pessoa sai;
 *   3. o provedor em uso é o que a CONFIGURAÇÃO diz, e não um padrão embutido.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, SENHA_MINIMA } from '@aurora/domain';
import { createTestDatabase, seedOrganization, type TestDatabase } from '@aurora/db/testing/harness';
import { withTenant, provisionFactoryRoles, assignRole, definirSenha } from '@aurora/db';
import { buildContext } from '@aurora/domain';
import { loadEnv, type AuroraEnv } from '@aurora/config';
import { createApp } from '../bootstrap';
import { PasswordAuthProvider } from '../auth/password-auth-provider';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const EMAIL = 'coordenadora@hospital.test';
const SENHA = 'girassol tranquilo na varanda';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

function env(extra: Partial<Record<string, string>> = {}): AuroraEnv {
  return loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
    ...extra,
  } as NodeJS.ProcessEnv);
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'hosp', name: 'Hospital de Teste', email: EMAIL, userName: 'Coordenadora' }
  );
  await withTenant(
    t.db,
    buildContext({
      organizationId: ORG,
      membershipId: MEM,
      actorId: USER,
      actorKind: 'system',
      requestId: 'setup',
      permissions: ['*'],
    }),
    async (s) => {
      const papeis = await provisionFactoryRoles(s);
      await assignRole(s, MEM, papeis.get('admin')!);
    }
  );
  await definirSenha(t.admin, { userId: USER, senha: SENHA });

  /*
   * O provedor é injetado EXPLICITAMENTE, e não herdado do padrão.
   *
   * A suíte inteira do resto do repositório roda com o provedor local, porque
   * é o que os outros testes usam. Esta precisa do de verdade — e injetá-lo
   * aqui prova, de quebra, que os dois convivem atrás da mesma porta.
   */
  app = await createApp({
    db: t.db,
    env: env({ AURORA_AUTH_PROVIDER: 'password' }),
    authProvider: new PasswordAuthProvider(t.db),
  });
  await app.init();
  http = request(app.getHttpServer());
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

async function entrar(senha = SENHA, email = EMAIL) {
  return http.post('/v1/auth/login').send({ email, senha });
}

describe('GET /v1/auth/config', () => {
  it('responde sem credencial e diz qual provedor está em uso', async () => {
    const r = await http.get('/v1/auth/config');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      provider: 'password',
      ambiente: 'desenvolvimento',
      senha_minima: SENHA_MINIMA,
    });
  });
});

describe('POST /v1/auth/login', () => {
  it('a senha certa devolve token, validade e quem é', async () => {
    const r = await entrar();
    expect(r.status).toBe(200);
    expect(r.body.token).toMatch(/^aus_/);
    expect(r.body.user.email).toBe(EMAIL);
    expect(new Date(r.body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('a senha errada devolve 401', async () => {
    expect((await entrar('outra coisa qualquer')).status).toBe(401);
  });

  /**
   * A MENSAGEM É A MESMA, PALAVRA POR PALAVRA.
   *
   * Uma diferença de texto entre "não existe" e "senha errada" entrega a lista
   * de quem tem conta aqui a qualquer um com um script e uma lista de e-mails.
   */
  it('e-mail inexistente e senha errada respondem IGUAL', async () => {
    const inexistente = await entrar(SENHA, 'ninguem@hospital.test');
    const errada = await entrar('outra coisa qualquer');
    expect(inexistente.status).toBe(errada.status);
    expect(inexistente.body.message).toBe(errada.body.message);
    expect(inexistente.body.code).toBe(errada.body.code);
  });

  it('e-mail malformado é 422, e não 401 — é erro de entrada', async () => {
    const r = await http.post('/v1/auth/login').send({ email: 'nao-e-email', senha: SENHA });
    expect(r.status).toBe(422);
  });

  it('corpo vazio não derruba a rota', async () => {
    const r = await http.post('/v1/auth/login').send({});
    expect(r.status).toBe(422);
  });

  /**
   * A senha curta NÃO é 422.
   *
   * A regra de força vale para DEFINIR senha; recusar a tentativa curta com 422
   * contaria a quem tenta que aquela senha não poderia existir — a validação
   * de entrada viraria um oráculo do formato das senhas cadastradas.
   */
  it('senha curta é 401 como qualquer outra errada, e não 422', async () => {
    expect((await entrar('123')).status).toBe(401);
  });

  it('a resposta NUNCA devolve o resumo da senha', async () => {
    const corpo = JSON.stringify((await entrar()).body);
    expect(corpo).not.toContain('scrypt');
    expect(corpo).not.toContain(SENHA);
  });
});

describe('a sessão vale em toda a API', () => {
  it('sem token, rota protegida é 401', async () => {
    expect((await http.get('/v1/me/session')).status).toBe(401);
  });

  it('token inventado é 401', async () => {
    const r = await http.get('/v1/me/session').set('authorization', 'Bearer aus_' + 'x'.repeat(43));
    expect(r.status).toBe(401);
  });

  it('com o token do login, a sessão resolve com papel e permissões', async () => {
    const token = (await entrar()).body.token as string;
    const r = await http
      .get('/v1/me/session')
      .set('authorization', `Bearer ${token}`)
      .set('x-aurora-organization', ORG);

    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe(EMAIL);
    expect(r.body.membership.roles).toContain('admin');
    expect(r.body.permissions.length).toBeGreaterThan(50);
  });

  it('pedir uma organização sem vínculo é 403, e não 200 vazio', async () => {
    const token = (await entrar()).body.token as string;
    const r = await http
      .get('/v1/me/session')
      .set('authorization', `Bearer ${token}`)
      .set('x-aurora-organization', newId());
    expect(r.status).toBe(403);
  });
});

describe('POST /v1/auth/logout', () => {
  it('encerra a sessão, e o token deixa de valer NA HORA', async () => {
    const token = (await entrar()).body.token as string;

    // vale antes
    expect((await http.get('/v1/me/organizations').set('authorization', `Bearer ${token}`)).status).toBe(200);

    const saida = await http.post('/v1/auth/logout').set('authorization', `Bearer ${token}`);
    expect(saida.status).toBe(200);
    expect(saida.body.encerradas).toBe(1);

    /*
     * A prova que dá nome ao defeito corrigido: sair não é esconder a chave, é
     * invalidá-la. Sem a chamada ao servidor, este 401 seria um 200.
     */
    expect((await http.get('/v1/me/organizations').set('authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('sair duas vezes devolve 0, e não erro', async () => {
    const token = (await entrar()).body.token as string;
    await http.post('/v1/auth/logout').set('authorization', `Bearer ${token}`);
    const segunda = await http.post('/v1/auth/logout').set('authorization', `Bearer ${token}`);
    expect(segunda.status).toBe(200);
    expect(segunda.body.encerradas).toBe(0);
  });

  it('sair sem token nenhum é 200 com 0 — a tela de logout não quebra', async () => {
    const r = await http.post('/v1/auth/logout');
    expect(r.status).toBe(200);
    expect(r.body.encerradas).toBe(0);
  });

  it('sair com o token de outra pessoa encerra só aquele token', async () => {
    const a = (await entrar()).body.token as string;
    const b = (await entrar()).body.token as string;
    await http.post('/v1/auth/logout').set('authorization', `Bearer ${a}`);
    // A sessão B continua: uma sessão não derruba a outra por acidente.
    expect((await http.get('/v1/me/organizations').set('authorization', `Bearer ${b}`)).status).toBe(200);
  });
});

describe('limite de tentativas', () => {
  it('a rajada da mesma origem recebe 429, com o código do contrato', async () => {
    let bloqueado: request.Response | null = null;
    for (let i = 0; i < 40; i++) {
      const r = await entrar('errada demais 1', `alvo${i}@hospital.test`);
      if (r.status === 429) {
        bloqueado = r;
        break;
      }
    }
    expect(bloqueado, 'o limite deveria ter disparado').not.toBeNull();
    expect(bloqueado!.body.code).toBe('rate_limited');
    // Um 429 sem prazo empurra todo cliente para a mesma estratégia: tentar já.
    expect(bloqueado!.body.details?.retry_after_seconds).toBeGreaterThan(0);
  }, 60_000);
});
