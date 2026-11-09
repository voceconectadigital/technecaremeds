/**
 * Aurora — logomarcas da organização (Anderson, 06/11/2026), pela HTTP.
 *
 *   · zero, uma ou duas; a vaga 1 sai antes da 2;
 *   · pôr, trocar (o arquivo antigo sai do armazenamento) e tirar;
 *   · só PNG, JPEG e WebP de verdade, até 512 kB; SVG e conteúdo que não bate com o tipo, recusados;
 *   · pôr/tirar exige `organization.update`; ler, só o vínculo (quem imprime a OS precisa);
 *   · isolamento entre organizações e a configuração da organização preservada.
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
import { withTenant, assignRole, provisionOrganizationBaseline } from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';
import { armazenamentoEmMemoria } from '../common/arquivos/memoria';
import type { ArmazenamentoDeObjetos } from '../common/arquivos/porta';
import { assinaturaConfere } from '../platform/organizations.controller';

const ORG_A = newId();
const ORG_B = newId();
const ADMIN_A = 'admin@logo-a.test';
const TECNICO_A = 'tecnico@logo-a.test';
const ADMIN_B = 'admin@logo-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-de-teste'),
]);
const PNG_2 = Buffer.concat([PNG, Buffer.from('-versao-2')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-de-teste')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let arquivos: ArmazenamentoDeObjetos & { chaves?: () => string[] };
const chavesGravadas = new Set<string>();

const corpo = (bytes: Buffer, tipo: string, extra: Record<string, unknown> = {}) => ({
  file_name: 'logo.png',
  content_type: tipo,
  data_base64: bytes.toString('base64'),
  ...extra,
});

beforeAll(async () => {
  t = await createTestDatabase();
  const idsA = { organizationId: ORG_A, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, idsA, { slug: 'logo-a', name: 'Org A', email: ADMIN_A, userName: 'Admin A' });
  await seedOrganization(t, idsB, { slug: 'logo-b', name: 'Org B', email: ADMIN_B, userName: 'Admin B' });
  const tecnico = newId();
  await seedMember(
    t,
    { organizationId: ORG_A, userId: newId(), membershipId: tecnico },
    { email: TECNICO_A, userName: 'Técnico' }
  );
  for (const [org, membro, papel] of [
    [ORG_A, idsA.membershipId, 'admin'],
    [ORG_A, tecnico, 'technician'],
    [ORG_B, idsB.membershipId, 'admin'],
  ] as const) {
    await withTenant(
      t.db,
      buildContext({ organizationId: org, actorKind: 'system', requestId: newId() }),
      async (s) => {
        const base = await provisionOrganizationBaseline(s);
        await assignRole(s, membro, base.roles.get(papel)!);
      }
    );
  }

  // O armazenamento em memória, com um registro das chaves gravadas para conferir a limpeza.
  const memoria = armazenamentoEmMemoria();
  arquivos = {
    ...memoria,
    async escrever(chave, desloc, bytes) {
      chavesGravadas.add(chave);
      return memoria.escrever(chave, desloc, bytes);
    },
  };
  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);
  app = await createApp({ db: t.db, env, arquivos });
  await app.init();
  http = request(app.getHttpServer());
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('logomarcas da organização', () => {
  it('começa sem nenhuma', async () => {
    const r = await http.get('/v1/organizations/current/logos').set(auth(ADMIN_A));
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
  });

  it('o administrador põe duas; saem na ordem das vagas, com o rótulo e a imagem', async () => {
    const r2 = await http
      .put('/v1/organizations/current/logos/2')
      .set(auth(ADMIN_A))
      .send(corpo(JPEG, 'image/jpeg', { file_name: 'grupo.jpg', label: 'Mantenedora' }));
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ slot: 2, label: 'Mantenedora', content_type: 'image/jpeg' });

    const r1 = await http
      .put('/v1/organizations/current/logos/1')
      .set(auth(ADMIN_A))
      .send(corpo(PNG, 'image/png', { label: '  Hospital  ' }));
    expect(r1.status).toBe(200);
    expect(r1.body.label).toBe('Hospital');
    expect(r1.body.data_url).toBe(`data:image/png;base64,${PNG.toString('base64')}`);

    const lista = await http.get('/v1/organizations/current/logos').set(auth(ADMIN_A));
    expect(lista.body.items.map((l: { slot: number }) => l.slot)).toEqual([1, 2]);
    expect(lista.body.items[1].data_url).toBe(`data:image/jpeg;base64,${JPEG.toString('base64')}`);
  });

  it('trocar a logo de uma vaga substitui a anterior e apaga o arquivo antigo', async () => {
    const antes = await http.get('/v1/organizations/current/logos').set(auth(ADMIN_A));
    const chaveAntiga = [...chavesGravadas].find((c) => c.includes('/logo-1-'))!;
    expect(await arquivos.ler(chaveAntiga)).toBeDefined();

    const r = await http
      .put('/v1/organizations/current/logos/1')
      .set(auth(ADMIN_A))
      .send(corpo(PNG_2, 'image/png', { label: 'Hospital' }));
    expect(r.status).toBe(200);
    const depois = await http.get('/v1/organizations/current/logos').set(auth(ADMIN_A));
    expect(depois.body.items).toHaveLength(2);
    expect(depois.body.items[0].data_url).not.toBe(antes.body.items[0].data_url);
    expect(depois.body.items[0].data_url).toBe(`data:image/png;base64,${PNG_2.toString('base64')}`);
    expect(await arquivos.ler(chaveAntiga)).toBeUndefined();
    expect(chaveAntiga.startsWith(`orgs/${ORG_A}/marca/`)).toBe(true);
  });

  it('recusa SVG, conteúdo que não bate com o tipo, arquivo grande e vaga inexistente', async () => {
    const svg = await http
      .put('/v1/organizations/current/logos/1')
      .set(auth(ADMIN_A))
      .send(corpo(Buffer.from('<svg/>'), 'image/svg+xml'));
    expect(svg.status).toBe(422);

    const falso = await http
      .put('/v1/organizations/current/logos/1')
      .set(auth(ADMIN_A))
      .send(corpo(Buffer.from('<html>não sou png</html>'), 'image/png'));
    expect(falso.status).toBe(422);

    const grande = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]);
    const r = await http
      .put('/v1/organizations/current/logos/1')
      .set(auth(ADMIN_A))
      .send(corpo(grande, 'image/png'));
    expect(r.status).toBe(422);

    const vaga3 = await http
      .put('/v1/organizations/current/logos/3')
      .set(auth(ADMIN_A))
      .send(corpo(PNG, 'image/png'));
    expect(vaga3.status).toBe(422);

    // Nada disso mexeu nas duas que existem.
    const lista = await http.get('/v1/organizations/current/logos').set(auth(ADMIN_A));
    expect(lista.body.items).toHaveLength(2);
  });

  it('confere a assinatura de PNG, JPEG e WebP', () => {
    expect(assinaturaConfere('image/png', PNG)).toBe(true);
    expect(assinaturaConfere('image/jpeg', JPEG)).toBe(true);
    expect(assinaturaConfere('image/webp', WEBP)).toBe(true);
    expect(assinaturaConfere('image/webp', PNG)).toBe(false);
    expect(assinaturaConfere('image/png', JPEG)).toBe(false);
  });

  it('o técnico lê (para imprimir a OS), mas não põe nem tira', async () => {
    const lista = await http.get('/v1/organizations/current/logos').set(auth(TECNICO_A));
    expect(lista.status).toBe(200);
    expect(lista.body.items).toHaveLength(2);

    const put = await http
      .put('/v1/organizations/current/logos/1')
      .set(auth(TECNICO_A))
      .send(corpo(PNG, 'image/png'));
    expect(put.status).toBe(403);
    const del = await http.delete('/v1/organizations/current/logos/1').set(auth(TECNICO_A));
    expect(del.status).toBe(403);
  });

  it('outra organização não vê nem apaga as logomarcas da primeira', async () => {
    const lista = await http.get('/v1/organizations/current/logos').set(auth(ADMIN_B));
    expect(lista.body.items).toEqual([]);
    const del = await http.delete('/v1/organizations/current/logos/1').set(auth(ADMIN_B));
    expect(del.status).toBe(404);
    const daA = await http.get('/v1/organizations/current/logos').set(auth(ADMIN_A));
    expect(daA.body.items).toHaveLength(2);
  });

  it('tirar uma deixa a outra; tirar de novo dá 404; a configuração da organização fica intacta', async () => {
    const conf = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(ADMIN_A))
      .send({ require_operational_result: true });
    expect(conf.status).toBe(200);

    const del = await http.delete('/v1/organizations/current/logos/1').set(auth(ADMIN_A));
    expect(del.status).toBe(200);
    const lista = await http.get('/v1/organizations/current/logos').set(auth(ADMIN_A));
    expect(lista.body.items.map((l: { slot: number }) => l.slot)).toEqual([2]);
    const outra = await http.delete('/v1/organizations/current/logos/1').set(auth(ADMIN_A));
    expect(outra.status).toBe(404);

    const org = await http.get('/v1/organizations/current').set(auth(ADMIN_A));
    expect(org.status).toBe(200);
    expect(org.body.require_operational_result).toBe(true);

    // E pôr a logo depois de mexer na configuração também não apaga a configuração.
    await http.put('/v1/organizations/current/logos/1').set(auth(ADMIN_A)).send(corpo(WEBP, 'image/webp'));
    const org2 = await http.get('/v1/organizations/current').set(auth(ADMIN_A));
    expect(org2.body.require_operational_result).toBe(true);
  });
});
