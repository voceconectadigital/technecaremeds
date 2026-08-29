/**
 * Aurora — QR Code (SPEC v0.2 §07 · EPIC-006).
 *
 * Esta é a única rota pública do sistema, e por isso a suíte é escrita do ponto
 * de vista de quem tenta abusar dela: token adivinhado, token de outra
 * organização, token de organização que não autorizou acesso anônimo, e o que
 * a resposta revela em cada caso.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext } from '@aurora/domain';
import { createTestDatabase, seedOrganization, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  provisionFactoryRoles,
  assignRole,
  provisionStarterLocationTypes,
  createCustomer,
  createLocation,
  createAssetCategory,
  createAsset,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG_ABERTA = newId(),
  USER_A = newId(),
  MEM_A = newId();
const ORG_FECHADA = newId(),
  USER_F = newId(),
  MEM_F = newId();
const EMAIL_A = 'gestor@aberta.test';
const EMAIL_F = 'gestor@fechada.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAberta = '';
let tokenFechada = '';
let ativoAberta = '';
let ativoDois = '';

beforeAll(async () => {
  t = await createTestDatabase();

  for (const [org, user, mem, slug, email] of [
    [ORG_ABERTA, USER_A, MEM_A, 'aberta', EMAIL_A],
    [ORG_FECHADA, USER_F, MEM_F, 'fechada', EMAIL_F],
  ] as const) {
    await seedOrganization(
      t,
      { organizationId: org, userId: user, membershipId: mem },
      { slug, name: `Rede ${slug}`, email, userName: 'Gestor' }
    );
    const ctx = buildContext({ organizationId: org, actorKind: 'system', requestId: `setup-${slug}` });
    await withTenant(t.db, ctx, async (s) => {
      const roles = await provisionFactoryRoles(s);
      await assignRole(s, mem, roles.get('maintenance_manager')!);
      const tipos = await provisionStarterLocationTypes(s);
      const cliente = await createCustomer(s, { name: `Cliente ${slug}`, isInternal: true });
      const unidade = await createLocation(s, {
        customerId: cliente,
        locationTypeId: tipos.get('unidade')!,
        name: 'Sede',
      });
      const setor = await createLocation(s, {
        customerId: cliente,
        parentId: unidade,
        locationTypeId: tipos.get('setor')!,
        name: 'UTI',
      });
      const cat = await createAssetCategory(s, { name: 'Ventilador Pulmonar' });
      const ativo = await createAsset(s, {
        name: `Ventilador ${slug}`,
        customerId: cliente,
        assetCategoryId: cat,
        locationId: setor,
        serialNumber: `SEGREDO-${slug}`,
        assetNumber: `PATR-${slug}`,
      });
      const [row] = await s.query<{ qr_token: string }>('SELECT qr_token FROM aurora.assets WHERE id = $1', [
        ativo,
      ]);
      if (org === ORG_ABERTA) {
        tokenAberta = row!.qr_token;
        ativoAberta = ativo;
        ativoDois = await createAsset(s, {
          name: 'Segundo ativo',
          customerId: cliente,
          assetCategoryId: cat,
          locationId: setor,
        });
      } else {
        tokenFechada = row!.qr_token;
      }
    });
  }

  // Só uma das organizações autoriza identificação sem sessão.
  await t.raw(`UPDATE aurora.organizations SET allow_anonymous_requests = true WHERE id = $1`, [ORG_ABERTA]);

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

describe('rota pública /q/{token}', () => {
  it('responde sem credencial nenhuma e fora do prefixo de versão', async () => {
    const r = await http.get(`/q/${tokenAberta}`);
    expect(r.status).toBe(200);
    expect(r.body.asset.name).toBe('Ventilador aberta');
    expect(r.body.asset.category).toBe('Ventilador Pulmonar');
    expect(r.body.asset.location).toBe('UTI');
    expect(r.body.can_open_request).toBe(true);
  });

  it('NÃO revela série, patrimônio, caminho do local nem identificadores internos', async () => {
    const r = await http.get(`/q/${tokenAberta}`);
    const corpo = JSON.stringify(r.body);
    expect(corpo).not.toContain('SEGREDO');
    expect(corpo).not.toContain('PATR-');
    expect(corpo).not.toContain(ativoAberta);
    expect(corpo).not.toMatch(/\/[0-9a-f-]{36}\//); // nenhum caminho de local
    expect(r.body.asset).not.toHaveProperty('serial_number');
    expect(r.body).not.toHaveProperty('asset_id');
  });

  it('organização que não autorizou responde igual a etiqueta inexistente', async () => {
    const naoAutorizada = await http.get(`/q/${tokenFechada}`);
    const inexistente = await http.get('/q/AAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(naoAutorizada.status).toBe(404);
    expect(inexistente.status).toBe(404);
    // mesma resposta: a rota não é oráculo de quais tokens existem
    expect(naoAutorizada.body.message).toBe(inexistente.body.message);
    expect(naoAutorizada.body.code).toBe(inexistente.body.code);
  });

  it('token malformado é 404, não 500 nem 422 — a forma também não vaza', async () => {
    for (const ruim of ['abc', '../../etc/passwd', 'AAAAAAAAAAAAAAAAAAAAAAAAA0']) {
      const r = await http.get(`/q/${encodeURIComponent(ruim)}`);
      expect(r.status, ruim).toBe(404);
    }
  });

  it('a resposta traz o rótulo que a organização usa para "ativo"', async () => {
    const r = await http.get(`/q/${tokenAberta}`);
    expect(r.body.asset_label).toBeTruthy();
    expect(r.body.organization).toBe('Rede aberta');
  });
});

describe('etiquetas em lote', () => {
  it('devolve o conteúdo de impressão para os ativos pedidos', async () => {
    const r = await http
      .post('/v1/labels')
      .set(auth(EMAIL_A))
      .send({ ids: [ativoAberta, ativoDois] });
    expect(r.status).toBe(201);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.items[0].qr_token).toBeTruthy();
    expect(r.body.items[0].category_name).toBe('Ventilador Pulmonar');
  });

  it('sem ids é 422; acima de 500 é 422 com o limite', async () => {
    expect((await http.post('/v1/labels').set(auth(EMAIL_A)).send({})).status).toBe(422);
    const muitos = Array.from({ length: 501 }, () => newId());
    const r = await http.post('/v1/labels').set(auth(EMAIL_A)).send({ ids: muitos });
    expect(r.status).toBe(422);
    expect(r.body.details.max).toBe(500);
  });

  it('id de ativo de outra organização simplesmente não aparece', async () => {
    const [alheio] = await withTenant(
      t.db,
      buildContext({ organizationId: ORG_FECHADA, actorKind: 'system', requestId: 'x' }),
      (s) => s.query<{ id: string }>(`SELECT id FROM aurora.assets LIMIT 1`)
    );
    const r = await http
      .post('/v1/labels')
      .set(auth(EMAIL_A))
      .send({ ids: [ativoAberta, alheio!.id] });
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0].id).toBe(ativoAberta);
  });

  it('sem credencial é 401', async () => {
    expect((await http.post('/v1/labels').send({ ids: [ativoAberta] })).status).toBe(401);
  });
});

describe('troca de token', () => {
  it('invalida a etiqueta antiga na hora e devolve o token anterior', async () => {
    const antes = await http.get(`/q/${tokenAberta}`);
    expect(antes.status).toBe(200);

    const r = await http.post(`/v1/assets/${ativoAberta}/rotate-qr`).set(auth(EMAIL_A));
    expect(r.status).toBe(201);
    expect(r.body.previous_token).toBe(tokenAberta);
    expect(r.body.qr_token).not.toBe(tokenAberta);

    expect((await http.get(`/q/${tokenAberta}`)).status).toBe(404);
    expect((await http.get(`/q/${r.body.qr_token}`)).status).toBe(200);
    tokenAberta = r.body.qr_token;
  });

  it('não troca token de ativo de outra organização', async () => {
    const [alheio] = await withTenant(
      t.db,
      buildContext({ organizationId: ORG_FECHADA, actorKind: 'system', requestId: 'x' }),
      (s) => s.query<{ id: string }>(`SELECT id FROM aurora.assets LIMIT 1`)
    );
    const r = await http.post(`/v1/assets/${alheio!.id}/rotate-qr`).set(auth(EMAIL_A));
    expect(r.status).toBeGreaterThanOrEqual(400);
    // e o token do outro continua funcionando lá
    const [ainda] = await withTenant(
      t.db,
      buildContext({ organizationId: ORG_FECHADA, actorKind: 'system', requestId: 'x' }),
      (s) => s.query<{ qr_token: string }>(`SELECT qr_token FROM aurora.assets WHERE id = $1`, [alheio!.id])
    );
    expect(ainda!.qr_token).toBe(tokenFechada);
  });
});

describe('ativo descomissionado', () => {
  it('a etiqueta continua resolvendo, mas não oferece abrir solicitação', async () => {
    await withTenant(
      t.db,
      buildContext({ organizationId: ORG_ABERTA, actorKind: 'system', requestId: 'baixa' }),
      (s) =>
        s.query(
          `UPDATE aurora.assets
              SET status = 'decommissioned', decommissioned_at = now(),
                  decommission_reason = 'baixa para teste da etiqueta'
            WHERE id = $1`,
          [ativoAberta]
        )
    );
    const r = await http.get(`/q/${tokenAberta}`);
    expect(r.status).toBe(200);
    expect(r.body.asset.retired).toBe(true);
    expect(r.body.can_open_request).toBe(false);
  });
});

describe('limite de tentativas', () => {
  /**
   * O limitador é chaveado no endereço do soquete, não em `x-forwarded-for`.
   * Este teste existe porque a primeira versão usava o cabeçalho, que o cliente
   * escreve: bastaria trocá-lo a cada requisição para o limite virar enfeite.
   */
  it('trocar x-forwarded-for a cada requisição não escapa do limite', async () => {
    let bloqueado = false;
    for (let i = 0; i < 80; i++) {
      const r = await http.get('/q/AAAAAAAAAAAAAAAAAAAAAAAAAA').set('x-forwarded-for', `10.0.0.${i}`);
      if (r.status === 422) {
        bloqueado = true;
        break;
      }
    }
    expect(bloqueado, 'o limite deveria ter disparado dentro de 80 tentativas').toBe(true);
  }, 60_000);
});
