/**
 * Aurora — cadastro do cliente e do equipamento (pedidos do cliente, WhatsApp 19/10/2026 · 0085).
 *
 *   · ATV-08 — o nome do equipamento é o do catálogo da família; o tipo vai por baixo;
 *   · ATV-07 — foto obrigatória no cadastro (API recusa sem foto), conferida pelos BYTES, com
 *     SHA-256; troca e download com o mesmo escopo da ficha; outra organização não vê;
 *   · ATV-15 — SLA do equipamento: liga/desliga e a política própria, pela API;
 *   · CLI-05 — relatório incluso no contrato do cliente (basic, advanced, expert);
 *   · CLI-06 — vigência do contrato (fim depois do início) e a situação derivada.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext, localDay, addDaysToDay } from '@aurora/domain';
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
  createAssetCategory,
  createAsset,
  createSlaPolicy,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { assetDetail, assetsFormOptions, customersList } from '@aurora/contracts';
import { createApp } from '../bootstrap';
import { armazenamentoEmMemoria } from '../common/arquivos/memoria';
import type { ArmazenamentoDeObjetos } from '../common/arquivos/porta';
import { FOTO_PNG, PNG_1X1_BASE64 } from './apoio/foto';

const ORG_A = newId();
const ORG_B = newId();
const GESTORA = 'gestora@cad-a.test';
const GESTOR_UTI = 'gestor-uti@cad-a.test';
const OPERADOR = 'operador@cad-a.test';
const ADMIN_B = 'admin@cad-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

/** O armazenamento em memória, com o registro do que foi gravado e apagado. */
const gravados: string[] = [];
const apagados: string[] = [];
const memoria = armazenamentoEmMemoria();
const arquivos: ArmazenamentoDeObjetos = {
  ...memoria,
  async escrever(chave, deslocamento, bytes) {
    gravados.push(chave);
    return memoria.escrever(chave, deslocamento, bytes);
  },
  async apagar(chave) {
    apagados.push(chave);
    return memoria.apagar(chave);
  },
};

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospital: string, outroHospital: string, uti: string, bloco: string, setorDoOutro: string;
let tipoVentilador: string;
let ativoAntigo: string, ativoDoBloco: string, ativoDeB: string;
let politicaVip: string, politicaArquivada: string;

const PNG = Buffer.from(PNG_1X1_BASE64, 'base64');
/** JPEG mínimo o bastante para a assinatura (FF D8 FF) — é a assinatura que a API confere. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]);

beforeAll(async () => {
  t = await createTestDatabase();
  const idsA = { organizationId: ORG_A, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, idsA, { slug: 'cad-a', name: 'Org A', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'cad-b', name: 'Org B', email: ADMIN_B, userName: 'Admin B' });

  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, idsA.membershipId, base.roles.get('manager')!);
      hospital = await createCustomer(s, { name: 'Hospital Alfa' });
      outroHospital = await createCustomer(s, { name: 'Hospital Beta' });
      const sede = await createLocation(s, {
        customerId: hospital,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'Sede',
      });
      uti = await createLocation(s, {
        customerId: hospital,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI',
      });
      bloco = await createLocation(s, {
        customerId: hospital,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'Bloco Cirúrgico',
      });
      const sedeB = await createLocation(s, {
        customerId: outroHospital,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'Sede Beta',
      });
      setorDoOutro = await createLocation(s, {
        customerId: outroHospital,
        parentId: sedeB,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI Beta',
      });
      tipoVentilador = await createAssetCategory(s, {
        name: 'Ventilador pulmonar',
        parentId: base.families.get('life_support'),
      });
      // O parque de antes da foto obrigatória: cadastrado sem foto, segue válido.
      ativoAntigo = await createAsset(s, {
        name: 'Ventilador pulmonar',
        tag: 'VNT-ANT',
        customerId: hospital,
        assetCategoryId: tipoVentilador,
        locationId: uti,
      });
      ativoDoBloco = await createAsset(s, {
        name: 'Ventilador pulmonar',
        tag: 'VNT-BLC',
        customerId: hospital,
        assetCategoryId: tipoVentilador,
        locationId: bloco,
      });
      politicaVip = await createSlaPolicy(s, { name: 'Equipamento crítico' });
      politicaArquivada = await createSlaPolicy(s, { name: 'Antiga' });
      await s.query(`UPDATE aurora.sla_policies SET archived_at = now() WHERE id = $1`, [politicaArquivada]);
    }
  );

  // Gestor com escopo SÓ na UTI do Hospital Alfa; operador também (e sem asset.update).
  for (const [email, papel] of [
    [GESTOR_UTI, 'manager'],
    [OPERADOR, 'operator'],
  ] as const) {
    const mem = newId();
    await seedMember(
      t,
      { organizationId: ORG_A, userId: newId(), membershipId: mem },
      { email, userName: email, customerIds: [hospital], locationIds: [uti] }
    );
    await withTenant(
      t.db,
      buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: `s-${papel}` }),
      async (s) => {
        const base = await provisionOrganizationBaseline(s);
        await assignRole(s, mem, base.roles.get(papel)!);
      }
    );
  }

  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_B, actorKind: 'system', requestId: 's3' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, idsB.membershipId, base.roles.get('admin')!);
      const cli = await createCustomer(s, { name: 'Hospital B' });
      const sede = await createLocation(s, {
        customerId: cli,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'S',
      });
      const loc = await createLocation(s, {
        customerId: cli,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI B',
      });
      const cat = await createAssetCategory(s, { name: 'Monitor', parentId: base.families.get('diagnosis') });
      ativoDeB = await createAsset(s, {
        name: 'Monitor',
        customerId: cli,
        assetCategoryId: cat,
        locationId: loc,
      });
    }
  );

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

const cadastro = (extra: Record<string, unknown> = {}) => ({
  name: 'Ventilador pulmonar',
  customer_id: hospital,
  location_id: uti,
  asset_category_id: tipoVentilador,
  photo: FOTO_PNG,
  ...extra,
});

/* -------------------------------------------------------------------------- */
/* ATV-07 — foto obrigatória                                                   */
/* -------------------------------------------------------------------------- */

describe('ATV-07: foto do equipamento', () => {
  let novo: string;

  it('sem foto, o cadastro é recusado (422, campo photo) — e nada é gravado', async () => {
    const antes = gravados.length;
    const r = await http
      .post('/v1/assets')
      .set(auth(GESTORA))
      .send({ ...cadastro({ tag: 'SEM-FOTO' }), photo: undefined });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toMatch(/photo/);
    expect(gravados.length).toBe(antes);
  });

  it('o tipo é conferido pelos BYTES: "PNG" que é HTML, GIF e base64 quebrado → 422', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
    const disfarcado = await http
      .post('/v1/assets')
      .set(auth(GESTORA))
      .send(cadastro({ tag: 'HTML-1', photo: { content_type: 'image/png', data_base64: html } }));
    expect(disfarcado.status).toBe(422);
    expect(disfarcado.body.message).toMatch(/não é a imagem declarada/);

    const gif = await http
      .post('/v1/assets')
      .set(auth(GESTORA))
      .send(cadastro({ tag: 'GIF-1', photo: { content_type: 'image/gif', data_base64: PNG_1X1_BASE64 } }));
    expect(gif.status).toBe(422);

    const quebrado = await http
      .post('/v1/assets')
      .set(auth(GESTORA))
      .send(
        cadastro({
          tag: 'B64-1',
          photo: { content_type: 'image/png', data_base64: 'data:image/png;base64,AAAA' },
        })
      );
    expect(quebrado.status).toBe(422);
  });

  it('acima de 8 MB → 422', async () => {
    const grande = Buffer.concat([PNG.subarray(0, 16), Buffer.alloc(8 * 1024 * 1024, 1)]);
    const r = await http
      .post('/v1/assets')
      .set(auth(GESTORA))
      .send(
        cadastro({
          tag: 'GRANDE-1',
          photo: { content_type: 'image/png', data_base64: grande.toString('base64') },
        })
      );
    expect(r.status).toBe(422);
  });

  it('setor de outro cliente recusa o cadastro ANTES de gravar a foto', async () => {
    const antes = gravados.length;
    const r = await http
      .post('/v1/assets')
      .set(auth(GESTORA))
      .send(cadastro({ tag: 'OUTRO-1', location_id: setorDoOutro }));
    expect(r.status).toBe(422);
    expect(gravados.length).toBe(antes);
  });

  it('com foto: cadastra, a ficha traz tipo/tamanho/SHA-256 (sem a chave) e o download devolve os bytes', async () => {
    const r = await http
      .post('/v1/assets')
      .set(auth(GESTORA))
      .send(cadastro({ tag: 'VNT-001' }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    novo = r.body.id;

    const ficha = await http.get(`/v1/assets/${novo}`).set(auth(GESTORA));
    expect(assetDetail.response.safeParse(ficha.body).success).toBe(true);
    expect(ficha.body.photo).toMatchObject({
      content_type: 'image/png',
      size: PNG.byteLength,
      sha256: createHash('sha256').update(PNG).digest('hex'),
    });
    expect(JSON.stringify(ficha.body)).not.toContain('photo_key');
    expect(gravados.some((k) => k.includes(`/assets/${novo}/`) && k.startsWith(`org/${ORG_A}/`))).toBe(true);

    const foto = await http
      .get(`/v1/assets/${novo}/photo`)
      .set(auth(GESTORA))
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
    expect(foto.status).toBe(200);
    expect(foto.headers['content-type']).toBe('image/png');
    expect(foto.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(foto.body as Buffer, PNG)).toBe(0);
  });

  it('o parque antigo segue sem foto (ficha com photo nula, download 404) e ganha foto pelo PUT', async () => {
    const ficha = await http.get(`/v1/assets/${ativoAntigo}`).set(auth(GESTORA));
    expect(ficha.status).toBe(200);
    expect(ficha.body.photo).toBeNull();
    expect((await http.get(`/v1/assets/${ativoAntigo}/photo`).set(auth(GESTORA))).status).toBe(404);

    const r = await http
      .put(`/v1/assets/${ativoAntigo}/photo`)
      .set(auth(GESTORA))
      .send({ photo: { content_type: 'image/jpeg', data_base64: JPEG.toString('base64') } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.photo.content_type).toBe('image/jpeg');
    const depois = await http.get(`/v1/assets/${ativoAntigo}`).set(auth(GESTORA));
    expect(depois.body.photo.sha256).toBe(createHash('sha256').update(JPEG).digest('hex'));
  });

  it('trocar a foto apaga a anterior do armazenamento', async () => {
    const chaveAntiga = gravados.find((k) => k.includes(`/assets/${novo}/`))!;
    const r = await http
      .put(`/v1/assets/${novo}/photo`)
      .set(auth(GESTORA))
      .send({ photo: { content_type: 'image/jpeg', data_base64: JPEG.toString('base64') } });
    expect(r.status).toBe(200);
    expect(apagados).toContain(chaveAntiga);
    expect(await arquivos.tamanho(chaveAntiga)).toBeUndefined();
  });

  it('escopo: quem só alcança a UTI baixa a foto da UTI, e não a do Bloco (404); nem troca a do Bloco', async () => {
    expect((await http.get(`/v1/assets/${novo}/photo`).set(auth(OPERADOR))).status).toBe(200);
    expect((await http.get(`/v1/assets/${ativoDoBloco}/photo`).set(auth(OPERADOR))).status).toBe(404);
    const troca = await http
      .put(`/v1/assets/${ativoDoBloco}/photo`)
      .set(auth(GESTOR_UTI))
      .send({ photo: FOTO_PNG });
    expect(troca.status).toBe(404);
    // Operador não edita equipamento: trocar foto é edição.
    expect(
      (await http.put(`/v1/assets/${novo}/photo`).set(auth(OPERADOR)).send({ photo: FOTO_PNG })).status
    ).toBe(403);
  });

  it('tenant: outra organização não baixa nem troca a foto (404), nos dois sentidos', async () => {
    expect((await http.get(`/v1/assets/${novo}/photo`).set(auth(ADMIN_B))).status).toBe(404);
    expect(
      (await http.put(`/v1/assets/${novo}/photo`).set(auth(ADMIN_B)).send({ photo: FOTO_PNG })).status
    ).toBe(404);
    expect((await http.get(`/v1/assets/${ativoDeB}/photo`).set(auth(GESTORA))).status).toBe(404);
  });

  it('banco: a foto é inteira ou nenhuma (chave sem tipo é recusada)', async () => {
    await expect(
      withTenant(t.db, buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 'chk' }), (s) =>
        s.query(`UPDATE aurora.assets SET photo_key = 'x' WHERE id = $1`, [ativoDoBloco])
      )
    ).rejects.toThrow(/assets_photo_all_or_none/);
  });
});

/* -------------------------------------------------------------------------- */
/* ATV-08 — o nome é o do catálogo                                             */
/* -------------------------------------------------------------------------- */

describe('ATV-08: nome do equipamento pelo catálogo', () => {
  it('o catálogo da família traz o nome; o equipamento com esse nome fica ligado ao tipo', async () => {
    const opcoes = await http.get('/v1/assets/form-options').set(auth(GESTORA));
    const tipo = opcoes.body.categories.find((c: { id: string }) => c.id === tipoVentilador);
    expect(tipo.name).toBe('Ventilador pulmonar');
    const r = await http
      .post('/v1/assets')
      .set(auth(GESTORA))
      .send(cadastro({ tag: 'VNT-CAT' }));
    expect(r.status).toBe(201);
    const ficha = await http.get(`/v1/assets/${r.body.id}`).set(auth(GESTORA));
    expect(ficha.body.name).toBe(ficha.body.category_name);
    expect(ficha.body.family_name).toBe('Suporte à vida');
  });

  it('nome novo no catálogo: só quem cura o catálogo cadastra', async () => {
    const familia = (await http.get('/v1/assets/form-options').set(auth(GESTORA))).body.categories.find(
      (c: { family_key: string | null }) => c.family_key === 'life_support'
    );
    expect(
      (
        await http
          .post('/v1/asset-categories')
          .set(auth(OPERADOR))
          .send({ name: 'Desfibrilador', family_id: familia.id })
      ).status
    ).toBe(403);
    expect(
      (
        await http
          .post('/v1/asset-categories')
          .set(auth(GESTORA))
          .send({ name: 'Desfibrilador', family_id: familia.id })
      ).status
    ).toBe(201);
  });
});

/* -------------------------------------------------------------------------- */
/* ATV-15 — SLA do equipamento                                                 */
/* -------------------------------------------------------------------------- */

describe('ATV-15: SLA do equipamento', () => {
  it('as opções do formulário trazem as políticas vigentes (a arquivada, não)', async () => {
    const r = await http.get('/v1/assets/form-options').set(auth(GESTORA));
    expect(assetsFormOptions.response.safeParse(r.body).success).toBe(true);
    const ids = r.body.sla_policies.map((p: { id: string }) => p.id);
    expect(ids).toContain(politicaVip);
    expect(ids).not.toContain(politicaArquivada);
  });

  it('cadastra com SLA desabilitado; liga com a política própria; política arquivada → 422', async () => {
    const r = await http
      .post('/v1/assets')
      .set(auth(GESTORA))
      .send(cadastro({ tag: 'VNT-SLA', sla_enabled: false }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.id as string;
    expect((await http.get(`/v1/assets/${id}`).set(auth(GESTORA))).body.sla_enabled).toBe(false);

    const ruim = await http
      .patch(`/v1/assets/${id}`)
      .set(auth(GESTORA))
      .send({ sla_enabled: true, sla_policy_id: politicaArquivada });
    expect(ruim.status).toBe(422);
    expect(ruim.body.field ?? ruim.body.details?.field).toBe('sla_policy_id');

    const ok = await http
      .patch(`/v1/assets/${id}`)
      .set(auth(GESTORA))
      .send({ sla_enabled: true, sla_policy_id: politicaVip });
    expect(ok.status).toBe(200);
    const ficha = await http.get(`/v1/assets/${id}`).set(auth(GESTORA));
    expect(ficha.body).toMatchObject({
      sla_enabled: true,
      sla_policy_id: politicaVip,
      sla_policy_name: 'Equipamento crítico',
    });

    // Desligado de novo: a cascata do banco devolve nula — nenhum relógio abrirá para ele.
    await http.patch(`/v1/assets/${id}`).set(auth(GESTORA)).send({ sla_enabled: false });
    const [resolvida] = await withTenant(
      t.db,
      buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 'sla' }),
      (s) => s.query<{ id: string | null }>(`SELECT aurora.resolve_sla_policy($1, $2) AS id`, [id, hospital])
    );
    expect(resolvida!.id).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* CLI-05 / CLI-06 — contrato no cadastro do cliente                           */
/* -------------------------------------------------------------------------- */

describe('CLI-05/06: relatório incluso e vigência do contrato', () => {
  const hoje = localDay(new Date());
  const dia = (n: number) => addDaysToDay(hoje, n);
  let cliente: string;

  it('cadastra com relatório Expert e vigência; a resposta traz a situação derivada', async () => {
    const r = await http
      .post('/v1/customers')
      .set(auth(GESTORA))
      .send({
        name: 'Hospital Contrato',
        report_tier: 'expert',
        contract_starts_on: dia(-10),
        contract_ends_on: dia(200),
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    cliente = r.body.id;
    expect(r.body).toMatchObject({
      report_tier: 'expert',
      contract_starts_on: dia(-10),
      contract_ends_on: dia(200),
      contract_status: 'active',
    });
  });

  it('valida: relatório fora da lista, fim antes do início, e só uma das datas → 422', async () => {
    const tier = await http
      .post('/v1/customers')
      .set(auth(GESTORA))
      .send({ name: 'X1', report_tier: 'gold' });
    expect(tier.status).toBe(422);
    const invertido = await http
      .post('/v1/customers')
      .set(auth(GESTORA))
      .send({ name: 'X2', contract_starts_on: dia(10), contract_ends_on: dia(10) });
    expect(invertido.status).toBe(422);
    expect(invertido.body.field ?? invertido.body.details?.field).toBe('contract_ends_on');
    const metade = await http
      .post('/v1/customers')
      .set(auth(GESTORA))
      .send({ name: 'X3', contract_starts_on: dia(1) });
    expect(metade.status).toBe(422);
    // Mandar só o fim, antes do início GRAVADO, também é recusado.
    const patch = await http
      .patch(`/v1/customers/${cliente}`)
      .set(auth(GESTORA))
      .send({ contract_ends_on: dia(-20) });
    expect(patch.status).toBe(422);
  });

  it('a situação acompanha as datas: vence em 30 dias, vencido, a iniciar, não informado', async () => {
    const casos: Array<[string | null, string | null, string]> = [
      [dia(-100), dia(30), 'expiring'],
      [dia(-100), dia(0), 'expiring'],
      [dia(-100), dia(-1), 'expired'],
      [dia(5), dia(50), 'not_started'],
      [null, null, 'not_informed'],
    ];
    for (const [inicio, fim, esperado] of casos) {
      const r = await http
        .patch(`/v1/customers/${cliente}`)
        .set(auth(GESTORA))
        .send({ contract_starts_on: inicio, contract_ends_on: fim });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.contract_status, `${inicio}..${fim}`).toBe(esperado);
    }
  });

  it('PATCH troca e limpa o relatório; lista e ficha mostram os campos', async () => {
    await http
      .patch(`/v1/customers/${cliente}`)
      .set(auth(GESTORA))
      .send({ report_tier: 'basic', contract_starts_on: dia(-1), contract_ends_on: dia(365) });
    const lista = await http.get('/v1/customers').set(auth(GESTORA));
    expect(customersList.response.safeParse(lista.body).success).toBe(true);
    const linha = lista.body.items.find((c: { id: string }) => c.id === cliente);
    expect(linha).toMatchObject({ report_tier: 'basic', contract_status: 'active' });
    const ficha = await http.get(`/v1/customers/${cliente}`).set(auth(GESTORA));
    expect(ficha.body.customer).toMatchObject({ report_tier: 'basic', contract_ends_on: dia(365) });

    const limpo = await http.patch(`/v1/customers/${cliente}`).set(auth(GESTORA)).send({ report_tier: null });
    expect(limpo.body.report_tier).toBeNull();
    // Cliente que nunca informou: campos nulos e "não informado".
    const antigo = lista.body.items.find((c: { id: string }) => c.id === hospital);
    expect(antigo).toMatchObject({
      report_tier: null,
      contract_starts_on: null,
      contract_status: 'not_informed',
    });
  });

  it('banco: o fim da vigência depois do início, e as duas datas juntas', async () => {
    const ctx = buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 'chk2' });
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(
          `UPDATE aurora.customers SET contract_starts_on = '2026-05-01', contract_ends_on = '2026-04-01' WHERE id = $1`,
          [cliente]
        )
      )
    ).rejects.toThrow(/customers_contract_term_order/);
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.customers SET contract_starts_on = NULL WHERE id = $1`, [cliente])
      )
    ).rejects.toThrow(/customers_contract_term_pair/);
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.customers SET report_tier = 'gold' WHERE id = $1`, [cliente])
      )
    ).rejects.toThrow(/customers_report_tier_valid/);
  });
});
