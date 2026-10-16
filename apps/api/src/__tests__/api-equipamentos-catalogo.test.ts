/**
 * Aurora — equipamentos: família × tipo, modelo, chip e QR (reunião 16/10/2026, Fase 3).
 *
 *   · as cinco famílias nascem no ponto de partida (e não duplicam categoria de mesmo nome);
 *   · tipo nasce DENTRO de uma família; modelo, de um tipo; só quem cura o catálogo cria;
 *   · cliente → setor → equipamento com família, criticidade e chip; filtros no servidor;
 *   · chip: par obrigatório e único por organização;
 *   · QR: vincular etiqueta já impressa, recusar código inválido ou já usado;
 *   · etiquetas em lote e QR respeitam escopo e tenant.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { newId, buildContext, generateQrToken } from '@aurora/domain';
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
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { assetsFormOptions, assetsList } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG_A = newId();
const ORG_B = newId();
const GESTORA = 'gestora@equip-a.test';
const OPERADOR = 'operador@equip-a.test';
const ADMIN_B = 'admin@equip-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
const novoToken = () => generateQrToken((n) => new Uint8Array(randomBytes(n)));

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospital: string, uti: string, bloco: string;
let familias: Map<string, string>;
let ativoBloco: string, ativoDeB: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const idsA = { organizationId: ORG_A, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, idsA, { slug: 'equip-a', name: 'Org A', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'equip-b', name: 'Org B', email: ADMIN_B, userName: 'Admin B' });

  let utiId = '';
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 's' }),
    async (s) => {
      // Uma categoria-raiz com o NOME de uma família, criada antes: deve ser marcada, não duplicada.
      await createAssetCategory(s, { name: 'Diagnóstico' });
      const base = await provisionOrganizationBaseline(s);
      familias = base.families;
      await assignRole(s, idsA.membershipId, base.roles.get('manager')!);
      hospital = await createCustomer(s, { name: 'Hospital Alfa' });
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
      utiId = uti;
      bloco = await createLocation(s, {
        customerId: hospital,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'Bloco Cirúrgico',
      });
      const tipoAntigo = await createAssetCategory(s, { name: 'Bisturi elétrico' });
      ativoBloco = await createAsset(s, {
        name: 'Bisturi BC',
        customerId: hospital,
        assetCategoryId: tipoAntigo,
        locationId: bloco,
      });
    }
  );
  const memOp = newId();
  await seedMember(
    t,
    { organizationId: ORG_A, userId: newId(), membershipId: memOp },
    {
      email: OPERADOR,
      userName: 'Operador',
      customerIds: [hospital],
      locationIds: [utiId],
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memOp, base.roles.get('operator')!);
    }
  );
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
        name: 'Monitor B',
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
  app = await createApp({ db: t.db, env });
  await app.init();
  http = request(app.getHttpServer());
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

let tipoVentilador: string, modelo: string, ativoUti: string;

describe('famílias e tipos', () => {
  it('as cinco famílias existem uma vez cada; "Diagnóstico" antigo foi marcado, não duplicado', async () => {
    const r = await http.get('/v1/assets/form-options').set(auth(GESTORA));
    expect(assetsFormOptions.response.safeParse(r.body).success).toBe(true);
    const fam = r.body.categories.filter((c: { family_key: string | null }) => c.family_key);
    expect(fam.map((f: { name: string }) => f.name).sort()).toEqual(
      ['Diagnóstico', 'Equipamentos de apoio', 'Suporte à vida', 'Terapia', 'Tratamento'].sort()
    );
    const diag = r.body.categories.filter((c: { name: string }) => c.name === 'Diagnóstico');
    expect(diag).toHaveLength(1);
  });

  it('cria o tipo dentro da família', async () => {
    const r = await http
      .post('/v1/asset-categories')
      .set(auth(GESTORA))
      .send({ name: 'Ventilador pulmonar', family_id: familias.get('life_support') });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    tipoVentilador = r.body.id;
  });

  it('tipo repetido → 409; família inválida → 422; operador → 403', async () => {
    const dup = await http
      .post('/v1/asset-categories')
      .set(auth(GESTORA))
      .send({ name: 'Ventilador pulmonar', family_id: familias.get('therapy') });
    expect(dup.status).toBe(409);
    const inv = await http
      .post('/v1/asset-categories')
      .set(auth(GESTORA))
      .send({ name: 'Algo', family_id: tipoVentilador });
    expect(inv.status).toBe(422);
    const op = await http
      .post('/v1/asset-categories')
      .set(auth(OPERADOR))
      .send({ name: 'Algo', family_id: familias.get('therapy') });
    expect(op.status).toBe(403);
  });

  it('tipo antigo (sem família) entra numa família', async () => {
    const opcoes = await http.get('/v1/assets/form-options').set(auth(GESTORA));
    const bisturi = opcoes.body.categories.find((c: { name: string }) => c.name === 'Bisturi elétrico');
    const r = await http
      .patch(`/v1/asset-categories/${bisturi.id}`)
      .set(auth(GESTORA))
      .send({ family_id: familias.get('treatment') });
    expect(r.status).toBe(200);
  });

  it('cria o modelo (e o fabricante) do tipo', async () => {
    const r = await http
      .post('/v1/asset-models')
      .set(auth(GESTORA))
      .send({ name: 'Servo-i', manufacturer: 'Maquet', asset_category_id: tipoVentilador });
    expect(r.status).toBe(201);
    modelo = r.body.id;
    const opcoes = await http.get('/v1/assets/form-options').set(auth(GESTORA));
    const m = opcoes.body.models.find((x: { id: string }) => x.id === modelo);
    expect(m.manufacturer_name).toBe('Maquet');
  });
});

describe('cliente → setor → equipamento, com chip', () => {
  it('cadastra com tipo, modelo, criticidade e chip', async () => {
    const opcoes = await http.get('/v1/assets/form-options').set(auth(GESTORA));
    const alta = opcoes.body.criticalities.find((c: { name: string }) => c.name === 'Alta');
    const r = await http.post('/v1/assets').set(auth(GESTORA)).send({
      name: 'Ventilador leito 3',
      customer_id: hospital,
      location_id: uti,
      asset_category_id: tipoVentilador,
      asset_model_id: modelo,
      criticality_id: alta.id,
      tag: 'VNT-003',
      serial_number: 'SN-V3',
      asset_number: 'PAT-0003',
      tracker_kind: 'gps',
      tracker_tag: 'GPS-000123',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ativoUti = r.body.id;
    const ficha = await http.get(`/v1/assets/${ativoUti}`).set(auth(GESTORA));
    expect(ficha.body.family_name).toBe('Suporte à vida');
    expect(ficha.body.tracker_tag).toBe('GPS-000123');
  });

  it('chip repetido → 409; chip pela metade → 422', async () => {
    const base = { customer_id: hospital, location_id: uti, asset_category_id: tipoVentilador };
    const dup = await http
      .post('/v1/assets')
      .set(auth(GESTORA))
      .send({ ...base, name: 'Outro', tracker_kind: 'gps', tracker_tag: 'GPS-000123' });
    expect(dup.status).toBe(409);
    const meio = await http
      .post('/v1/assets')
      .set(auth(GESTORA))
      .send({ ...base, name: 'Outro', tracker_kind: 'rfid' });
    expect(meio.status).toBe(422);
  });

  it('filtros no servidor: família, tipo, criticidade, chip', async () => {
    const pega = async (q: string) =>
      (await http.get(`/v1/assets?${q}`).set(auth(GESTORA))).body.items.map((a: { name: string }) => a.name);
    expect(await pega('family=life_support')).toEqual(['Ventilador leito 3']);
    expect(await pega('family=treatment')).toEqual(['Bisturi BC']);
    expect(await pega(`category=${tipoVentilador}`)).toEqual(['Ventilador leito 3']);
    expect(await pega('tracker=yes')).toEqual(['Ventilador leito 3']);
    expect(await pega('tracker=no')).toEqual(['Bisturi BC']);
    expect(await pega('manufacturer=Maquet')).toEqual(['Ventilador leito 3']);
    const r = await http.get('/v1/assets?family=life_support').set(auth(GESTORA));
    expect(assetsList.response.safeParse(r.body).success).toBe(true);
  });

  it('operador da UTI não enxerga o equipamento do Bloco nem em etiqueta', async () => {
    const lista = await http.get('/v1/assets').set(auth(OPERADOR));
    expect(lista.body.items.map((a: { name: string }) => a.name)).toEqual(['Ventilador leito 3']);
    const etiquetas = await http
      .post('/v1/labels')
      .set(auth(OPERADOR))
      .send({ ids: [ativoUti, ativoBloco] });
    expect(etiquetas.status).toBe(201);
    expect(etiquetas.body.items.map((a: { id: string }) => a.id)).toEqual([ativoUti]);
  });
});

describe('QR: vincular etiqueta existente', () => {
  it('aceita a URL lida da etiqueta e a resolução pública passa a apontar para o equipamento', async () => {
    const token = novoToken();
    const r = await http
      .post(`/v1/assets/${ativoUti}/qr`)
      .set(auth(GESTORA))
      .send({ code: `https://exemplo.test/q/${token}` });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.qr_token).toBe(token);
    const ficha = await http.get(`/v1/assets/${ativoUti}`).set(auth(GESTORA));
    expect(ficha.body.qr_token).toBe(token);
  });

  it('etiqueta já usada por outro equipamento → 409', async () => {
    const ficha = await http.get(`/v1/assets/${ativoUti}`).set(auth(GESTORA));
    const r = await http
      .post(`/v1/assets/${ativoBloco}/qr`)
      .set(auth(GESTORA))
      .send({ code: ficha.body.qr_token });
    expect(r.status).toBe(409);
  });

  it('código que não é etiqueta desta plataforma → 422', async () => {
    const r = await http
      .post(`/v1/assets/${ativoUti}/qr`)
      .set(auth(GESTORA))
      .send({ code: 'https://outro-sistema.test/etiqueta/123' });
    expect(r.status).toBe(422);
  });

  it('fora do escopo e de outra organização: nunca vincula', async () => {
    const op = await http.post(`/v1/assets/${ativoBloco}/qr`).set(auth(OPERADOR)).send({ code: novoToken() });
    expect(op.status).not.toBe(201);
    const cruzado = await http
      .post(`/v1/assets/${ativoDeB}/qr`)
      .set(auth(GESTORA))
      .send({ code: novoToken() });
    expect(cruzado.status).not.toBe(201);
    expect([403, 404, 422]).toContain(cruzado.status);
  });
});
