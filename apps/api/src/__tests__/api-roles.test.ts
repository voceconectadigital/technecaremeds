/**
 * Aurora — papéis, permissões e a explicação (SPEC v0.2 §04, §05 · EPIC-002).
 *
 * O QUE ESTE ARQUIVO PROVA É A CONTA, e não a listagem.
 *
 * Permissão efetiva é o resultado de uma soma com uma subtração: os papéis
 * somam, as exceções decidem por último, `deny` vence, e exceção vencida não
 * conta. Cada um desses quatro comportamentos tem um caso aqui, porque cada um
 * deles, errado, produz o mesmo sintoma na tela — "não entendo por que essa
 * pessoa consegue isso" — e nenhum deles se distingue dos outros olhando só o
 * resultado final.
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
import { withTenant, provisionFactoryRoles, assignRole } from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const ADMIN_USER = newId(),
  ADMIN_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();

const EMAIL_ADMIN = 'admin@rbac.test';
const EMAIL_TEC = 'tecnico@rbac.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let papeis: Map<string, string>;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: ADMIN_USER, membershipId: ADMIN_MEM },
    { slug: 'rbac', name: 'Rede RBAC', email: EMAIL_ADMIN, userName: 'Administradora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    papeis = await provisionFactoryRoles(s);
    await assignRole(s, ADMIN_MEM, papeis.get('admin')!);
    await assignRole(s, TEC_MEM, papeis.get('technician')!);
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

/* -------------------------------------------------------------------------- */

describe('catálogo e papéis', () => {
  it('o catálogo de permissões é o do domínio, inteiro', async () => {
    const r = await http.get('/v1/permissions').set(auth(EMAIL_ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(PERMISSION_KEYS.length);
    expect(r.body.items.map((p: { key: string }) => p.key).sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('as permissões de campo vêm marcadas', async () => {
    // Conceder uma permissão de campo não abre tela nova: muda o que aparece
    // DENTRO das telas que a pessoa já vê. Sem a marca, quem administra marca
    // a caixa, não vê nada mudar e conclui que não funcionou.
    const r = await http.get('/v1/permissions').set(auth(EMAIL_ADMIN));
    const custo = r.body.items.find((p: { key: string }) => p.key === 'work_order.read_costs');
    expect(custo.field_level).toBe(true);
    const ler = r.body.items.find((p: { key: string }) => p.key === 'work_order.read');
    expect(ler.field_level).toBe(false);
  });

  it('os papéis dizem quantas pessoas cada um tem', async () => {
    // Mexer num papel com uma pessoa e num com quarenta são operações de risco
    // diferente. Quem edita precisa saber qual está fazendo ANTES de clicar.
    const r = await http.get('/v1/roles').set(auth(EMAIL_ADMIN));
    expect(r.status).toBe(200);
    const tecnico = r.body.items.find((x: { key: string }) => x.key === 'technician');
    expect(tecnico.member_count).toBe(1);
    expect(tecnico.permission_count).toBeGreaterThan(0);
    expect(tecnico.is_system).toBe(true);

    const semNinguem = r.body.items.find((x: { key: string }) => x.key === 'metrologist');
    expect(semNinguem.member_count).toBe(0);
  });

  it('a lista de papéis satisfaz o contrato', async () => {
    const { rolesList } = await import('@aurora/contracts');
    const r = await http.get('/v1/roles').set(auth(EMAIL_ADMIN));
    const conferido = rolesList.response.safeParse(r.body);
    if (!conferido.success) {
      throw new Error(conferido.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
    }
  });
});

describe('a explicação', () => {
  it('cada permissão diz de QUAL papel veio', async () => {
    const r = await http.get(`/v1/memberships/${TEC_MEM}/permissions`).set(auth(EMAIL_ADMIN));
    expect(r.status).toBe(200);

    const executar = r.body.items.filter(
      (i: { permission_key: string }) => i.permission_key === 'work_order.execute'
    );
    expect(executar).toHaveLength(1);
    expect(executar[0].source).toBe('role');
    expect(executar[0].role_key).toBe('technician');
    expect(executar[0].effect).toBe('grant');
  });

  it('a permissão que vem de DOIS papéis aparece duas vezes', async () => {
    /*
     * A duplicidade é a informação, e não ruído a ser consolidado.
     *
     * É exatamente ela que explica por que remover um papel não tirou o
     * acesso — a confusão mais comum de quem administra permissões. Uma lista
     * consolidada mostraria uma linha e deixaria a pessoa remover o papel
     * errado.
     */
    const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'dois' });
    await withTenant(t.db, sysCtx, (s) => assignRole(s, TEC_MEM, papeis.get('storekeeper')!));

    const r = await http.get(`/v1/memberships/${TEC_MEM}/permissions`).set(auth(EMAIL_ADMIN));
    const leituras = r.body.items.filter(
      (i: { permission_key: string; source: string }) =>
        i.permission_key === 'work_order.read' && i.source === 'role'
    );
    expect(leituras.length).toBeGreaterThanOrEqual(2);
    const origens = leituras.map((i: { role_key: string }) => i.role_key).sort();
    expect(origens).toContain('technician');
    expect(origens).toContain('storekeeper');

    // E o efetivo não duplica: a conta é sobre o conjunto.
    expect(r.body.effective.filter((k: string) => k === 'work_order.read')).toHaveLength(1);
  });

  it('a negação VENCE o papel, e o efetivo reflete isso', async () => {
    await http
      .put(`/v1/memberships/${TEC_MEM}/permissions/work_order.complete`)
      .set(auth(EMAIL_ADMIN))
      .send({ effect: 'deny', reason: 'em treinamento até a avaliação de novembro' })
      .expect(200);

    const r = await http.get(`/v1/memberships/${TEC_MEM}/permissions`).set(auth(EMAIL_ADMIN));

    // O papel continua concedendo — e a linha do papel CONTINUA na explicação.
    // Some-la faria a tela dizer "ninguém concede isso", e quem removesse a
    // exceção teria uma surpresa.
    const doPapel = r.body.items.filter(
      (i: { permission_key: string; source: string }) =>
        i.permission_key === 'work_order.complete' && i.source === 'role'
    );
    expect(doPapel.length).toBeGreaterThan(0);

    const excecao = r.body.items.find(
      (i: { permission_key: string; source: string }) =>
        i.permission_key === 'work_order.complete' && i.source === 'override'
    );
    expect(excecao.effect).toBe('deny');
    expect(excecao.reason).toContain('treinamento');

    // E o resultado da conta: não pode.
    expect(r.body.effective).not.toContain('work_order.complete');
  });

  it('exceção vencida não conta, e some da explicação', async () => {
    // Mantê-la visível faria alguém "corrigir" removendo uma linha que já não
    // fazia nada — e concluir que a remoção não resolveu.
    await http
      .put(`/v1/memberships/${TEC_MEM}/permissions/contract.read`)
      .set(auth(EMAIL_ADMIN))
      .send({
        effect: 'grant',
        reason: 'cobertura da auditoria de setembro',
        expires_at: new Date('2020-01-01T00:00:00Z').toISOString(),
      })
      .expect(200);

    const r = await http.get(`/v1/memberships/${TEC_MEM}/permissions`).set(auth(EMAIL_ADMIN));
    const vencida = r.body.items.find(
      (i: { permission_key: string; source: string }) =>
        i.permission_key === 'contract.read' && i.source === 'override'
    );
    expect(vencida).toBeUndefined();
  });

  it('remover a exceção devolve o que o papel concede', async () => {
    await http
      .delete(`/v1/memberships/${TEC_MEM}/permissions/work_order.complete`)
      .set(auth(EMAIL_ADMIN))
      .expect(200);

    const r = await http.get(`/v1/memberships/${TEC_MEM}/permissions`).set(auth(EMAIL_ADMIN));
    expect(r.body.effective).toContain('work_order.complete');
  });

  it('a explicação satisfaz o contrato', async () => {
    const { membershipPermissions } = await import('@aurora/contracts');
    const r = await http.get(`/v1/memberships/${TEC_MEM}/permissions`).set(auth(EMAIL_ADMIN));
    const conferido = membershipPermissions.response.safeParse(r.body);
    if (!conferido.success) {
      throw new Error(conferido.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
    }
  });
});

describe('as recusas', () => {
  it('exceção sem motivo é recusada, e a mensagem diz por quê', async () => {
    const r = await http
      .put(`/v1/memberships/${TEC_MEM}/permissions/work_order.close`)
      .set(auth(EMAIL_ADMIN))
      .send({ effect: 'grant', reason: 'ok' });
    expect(r.status).toBe(422);
    expect(r.body.message).toContain('motivo');
  });

  it('permissão inventada é recusada', async () => {
    const r = await http
      .put(`/v1/memberships/${TEC_MEM}/permissions/work_order.teleportar`)
      .set(auth(EMAIL_ADMIN))
      .send({ effect: 'grant', reason: 'motivo suficientemente longo' });
    expect(r.status).toBe(422);
  });

  it('quem não administra pessoas não lê a explicação de ninguém', async () => {
    // A explicação diz o que uma pessoa pode fazer no sistema inteiro. É mapa
    // de acesso, e mapa de acesso não é leitura pública.
    const r = await http.get(`/v1/memberships/${ADMIN_MEM}/permissions`).set(auth(EMAIL_TEC));
    expect(r.status).toBe(403);
  });

  it('trocar papéis exige administrar pessoas', async () => {
    const r = await http
      .put(`/v1/memberships/${ADMIN_MEM}/roles`)
      .set(auth(EMAIL_TEC))
      .send({ role_ids: [] });
    expect(r.status).toBe(403);
  });
});

describe('troca de papéis', () => {
  it('o conjunto enviado SUBSTITUI o anterior', async () => {
    // Enviar o conjunto inteiro é o que torna a operação idempotente: duas
    // telas abertas não somam papéis que ninguém pediu junto.
    await http
      .put(`/v1/memberships/${TEC_MEM}/roles`)
      .set(auth(EMAIL_ADMIN))
      .send({ role_ids: [papeis.get('coordinator')!] })
      .expect(200);

    const r = await http.get(`/v1/memberships/${TEC_MEM}/permissions`).set(auth(EMAIL_ADMIN));
    const origens = new Set(
      r.body.items
        .filter((i: { source: string }) => i.source === 'role')
        .map((i: { role_key: string }) => i.role_key)
    );
    expect(origens).toEqual(new Set(['coordinator']));

    // Repetir dá o mesmo resultado — não duplica nem acumula.
    await http
      .put(`/v1/memberships/${TEC_MEM}/roles`)
      .set(auth(EMAIL_ADMIN))
      .send({ role_ids: [papeis.get('coordinator')!] })
      .expect(200);
    const denovo = await http.get(`/v1/memberships/${TEC_MEM}/permissions`).set(auth(EMAIL_ADMIN));
    expect(new Set(denovo.body.effective)).toEqual(new Set(r.body.effective));
  });
});
