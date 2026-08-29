/**
 * Aurora — teste de adversário multitenant na camada HTTP (SPEC v0.2 §37).
 *
 * A suíte de banco prova que o PostgreSQL isola. Esta prova que a API não
 * abre um caminho por cima disso — que é onde a maioria dos vazamentos
 * realmente acontece.
 *
 * Tentativas cobertas:
 *   · trocar o cabeçalho de organização para o tenant alheio
 *   · usar credencial de um tenant e pedir dados do outro
 *   · chamar endpoint sem credencial
 *   · usar credencial de usuário desativado / membership removido
 *   · forjar identidade inexistente
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId } from '@aurora/domain';
import { createTestDatabase, seedOrganization, type TestDatabase } from '@aurora/db/testing/harness';
import { withTenant, provisionFactoryRoles, assignRole } from '@aurora/db';
import { buildContext } from '@aurora/domain';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG_A = newId(),
  USER_A = newId(),
  MEM_A = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();

const EMAIL_A = 'ana@org-a.test';
const EMAIL_B = 'bruno@org-b.test';
const tokenFor = (email: string) => `local:${email}:${email}`;

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: USER_A, membershipId: MEM_A },
    {
      slug: 'org-a',
      name: 'Organização A',
      email: EMAIL_A,
      userName: 'Ana',
    }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    {
      slug: 'org-b',
      name: 'Organização B',
      email: EMAIL_B,
      userName: 'Bruno',
    }
  );

  // papéis de fábrica e atribuição: sem papel, o guard nega tudo — corretamente
  for (const [org, mem, role] of [
    [ORG_A, MEM_A, 'admin'],
    [ORG_B, MEM_B, 'admin'],
  ] as const) {
    const ctx = buildContext({ organizationId: org, actorKind: 'system', requestId: 'setup' });
    await withTenant(t.db, ctx, async (s) => {
      const ids = await provisionFactoryRoles(s);
      await assignRole(s, mem, ids.get(role)!);
    });
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

describe('saúde', () => {
  it('liveness responde sem credencial', async () => {
    const r = await http.get('/v1/health/live');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });

  it('readiness verifica o banco', async () => {
    const r = await http.get('/v1/health/ready');
    expect(r.status).toBe(200);
    expect(r.body.checks.database).toBe('ok');
  });
});

describe('autenticação', () => {
  it('sem credencial: 401 com problem details e request_id', async () => {
    const r = await http.get('/v1/organizations/current');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('unauthenticated');
    expect(r.body.request_id).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.ts:\d+/); // sem stack trace
  });

  it('credencial malformada: 401', async () => {
    const r = await http.get('/v1/organizations/current').set('authorization', 'Bearer lixo');
    expect(r.status).toBe(401);
  });

  it('identidade inexistente: 403, sem revelar se a organização existe', async () => {
    const r = await http
      .get('/v1/organizations/current')
      .set('authorization', `Bearer ${tokenFor('ninguem@lugar.test')}`);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('forbidden');
  });
});

describe('isolamento na camada HTTP', () => {
  it('A recebe a própria organização', async () => {
    const r = await http.get('/v1/organizations/current').set('authorization', `Bearer ${tokenFor(EMAIL_A)}`);
    expect(r.status).toBe(200);
    expect(r.body.slug).toBe('org-a');
    expect(r.body.seats_used).toBe(1);
  });

  it('B recebe a própria organização', async () => {
    const r = await http.get('/v1/organizations/current').set('authorization', `Bearer ${tokenFor(EMAIL_B)}`);
    expect(r.status).toBe(200);
    expect(r.body.slug).toBe('org-b');
  });

  it('ADVERSÁRIO: A força o cabeçalho de organização para o tenant de B', async () => {
    const r = await http
      .get('/v1/organizations/current')
      .set('authorization', `Bearer ${tokenFor(EMAIL_A)}`)
      .set('x-aurora-organization', ORG_B);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain('org-b');
  });

  it('ADVERSÁRIO: A força cabeçalho com uuid inexistente', async () => {
    const r = await http
      .get('/v1/organizations/current')
      .set('authorization', `Bearer ${tokenFor(EMAIL_A)}`)
      .set('x-aurora-organization', newId());
    expect(r.status).toBe(403);
  });

  it('a listagem de membros só mostra gente da própria organização', async () => {
    const a = await http
      .get('/v1/organizations/current/members')
      .set('authorization', `Bearer ${tokenFor(EMAIL_A)}`);
    expect(a.status).toBe(200);
    expect(a.body.items).toHaveLength(1);
    expect(a.body.items[0].email).toBe(EMAIL_A);

    const b = await http
      .get('/v1/organizations/current/members')
      .set('authorization', `Bearer ${tokenFor(EMAIL_B)}`);
    expect(b.body.items[0].email).toBe(EMAIL_B);
    expect(JSON.stringify(b.body)).not.toContain(EMAIL_A);
  });

  it('membership removido perde acesso imediatamente', async () => {
    await t.raw(`UPDATE aurora.memberships SET status = 'removed' WHERE id = $1`, [MEM_B]);
    const r = await http.get('/v1/organizations/current').set('authorization', `Bearer ${tokenFor(EMAIL_B)}`);
    expect(r.status).toBe(403);
    await t.raw(`UPDATE aurora.memberships SET status = 'active' WHERE id = $1`, [MEM_B]);
  });

  it('usuário desativado perde acesso', async () => {
    await t.raw(`UPDATE aurora.users SET status = 'disabled' WHERE id = $1`, [USER_B]);
    const r = await http.get('/v1/organizations/current').set('authorization', `Bearer ${tokenFor(EMAIL_B)}`);
    expect(r.status).toBe(403);
    await t.raw(`UPDATE aurora.users SET status = 'active' WHERE id = $1`, [USER_B]);
  });

  it('organização arquivada bloqueia o acesso', async () => {
    await t.raw(`UPDATE aurora.organizations SET status = 'archived' WHERE id = $1`, [ORG_B]);
    const r = await http.get('/v1/organizations/current').set('authorization', `Bearer ${tokenFor(EMAIL_B)}`);
    expect(r.status).toBe(403);
    await t.raw(`UPDATE aurora.organizations SET status = 'active' WHERE id = $1`, [ORG_B]);
  });
});

describe('correlação e diagnóstico', () => {
  it('propaga o request_id fornecido pelo cliente', async () => {
    const r = await http
      .get('/v1/organizations/current')
      .set('authorization', 'Bearer invalido')
      .set('x-request-id', 'trace-123');
    expect(r.body.request_id).toBe('trace-123');
  });

  it('rota inexistente devolve problem details, não HTML', async () => {
    const r = await http.get('/v1/nao-existe').set('authorization', `Bearer ${tokenFor(EMAIL_A)}`);
    expect(r.status).toBe(404);
    expect(r.body.code).toBeTruthy();
    expect(r.body.request_id).toBeTruthy();
  });
});

describe('seletor de organização (/me/organizations)', () => {
  it('lista apenas as organizações do portador da credencial', async () => {
    const r = await http.get('/v1/me/organizations').set('authorization', `Bearer ${tokenFor(EMAIL_A)}`);
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0].slug).toBe('org-a');
    expect(JSON.stringify(r.body)).not.toContain('org-b');
  });

  it('sem credencial: 401', async () => {
    const r = await http.get('/v1/me/organizations');
    expect(r.status).toBe(401);
  });

  it('identidade sem vínculo: lista vazia, não erro', async () => {
    const r = await http
      .get('/v1/me/organizations')
      .set('authorization', `Bearer ${tokenFor('ninguem@lugar.test')}`);
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
  });
});

describe('permissões na borda HTTP (EPIC-002)', () => {
  it('rota protegida responde 403 nomeando a permissão que falta', async () => {
    // técnico não tem organization.manage_members
    const ctx = buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 'perm-setup' });
    const techUser = newId();
    const techMem = newId();
    await t.raw(`INSERT INTO aurora.users (id, email, name) VALUES ($1,$2,$3)`, [
      techUser,
      'tecnico@org-a.test',
      'Técnico',
    ]);
    await withTenant(t.db, ctx, async (s) => {
      await s.query(
        `INSERT INTO aurora.memberships (id, organization_id, user_id, status) VALUES ($1,$2,$3,'active')`,
        [techMem, ORG_A, techUser]
      );
      const ids = await provisionFactoryRoles(s);
      await assignRole(s, techMem, ids.get('technician')!);
    });

    const ok = await http
      .get('/v1/organizations/current')
      .set('authorization', `Bearer ${tokenFor('tecnico@org-a.test')}`);
    expect(ok.status, 'técnico deveria ler a própria organização').toBe(200);

    const denied = await http
      .get('/v1/organizations/current/members')
      .set('authorization', `Bearer ${tokenFor('tecnico@org-a.test')}`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('forbidden');
    expect(denied.body.message).toContain('organization.manage_members');
    expect(denied.body.details.permission).toContain('organization.manage_members');
  });

  it('revogação individual derruba a permissão mesmo com o papel concedendo', async () => {
    await withTenant(
      t.db,
      buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 'deny-setup' }),
      (s) =>
        s.query(
          `INSERT INTO aurora.membership_permission_overrides
             (organization_id, membership_id, permission_key, effect, reason)
           VALUES ($1, $2, 'organization.manage_members', 'deny', 'suspenso durante apuração interna')`,
          [ORG_A, MEM_A]
        )
    );
    const r = await http
      .get('/v1/organizations/current/members')
      .set('authorization', `Bearer ${tokenFor(EMAIL_A)}`);
    expect(r.status).toBe(403);

    // limpa para não afetar outros testes
    await t.raw(`DELETE FROM aurora.membership_permission_overrides WHERE membership_id = $1`, [MEM_A]);
  });
});
