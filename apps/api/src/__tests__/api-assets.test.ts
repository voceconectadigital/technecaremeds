/**
 * Aurora — ativos pela HTTP (EPIC-005).
 *
 * O que esta suíte prova e a de banco não: que o escopo por local recorta o
 * inventário na borda, que a transferência não tem atalho pela API, e que a
 * importação devolve sucesso parcial com o relatório em vez de erro total.
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
  createAssetCategory,
  createAsset,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const GESTOR_USER = newId(),
  GESTOR_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const EMAIL_GESTOR = 'gestor@ast.test';
const EMAIL_TEC = 'tecnico@ast.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let cliente: string;
let unidadeNorte: string, unidadeSul: string, utiNorte: string, utiSul: string;
let categoria: string;
let ativoNorte: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: GESTOR_USER, membershipId: GESTOR_MEM },
    { slug: 'ast', name: 'Rede Hospitalar', email: EMAIL_GESTOR, userName: 'Gestora' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  let tecnicoRole = '';
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, GESTOR_MEM, roles.get('maintenance_manager')!);
    tecnicoRole = roles.get('technician')!;

    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Rede Hospitalar', isInternal: true });
    unidadeNorte = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade Norte',
    });
    unidadeSul = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade Sul',
    });
    utiNorte = await createLocation(s, {
      customerId: cliente,
      parentId: unidadeNorte,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI Norte',
      code: 'UTI-N',
    });
    utiSul = await createLocation(s, {
      customerId: cliente,
      parentId: unidadeSul,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI Sul',
      code: 'UTI-S',
    });

    categoria = await createAssetCategory(s, { name: 'Ventilador Pulmonar' });
    ativoNorte = await createAsset(s, {
      name: 'Ventilador Norte 01',
      customerId: cliente,
      assetCategoryId: categoria,
      locationId: utiNorte,
      serialNumber: 'SN-NORTE-01',
    });
    await createAsset(s, {
      name: 'Ventilador Sul 01',
      customerId: cliente,
      assetCategoryId: categoria,
      locationId: utiSul,
      serialNumber: 'SN-SUL-01',
    });
  });

  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico', locationIds: [unidadeNorte] }
  );
  await withTenant(t.db, sysCtx, (s) => assignRole(s, TEC_MEM, tecnicoRole));

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

describe('inventário', () => {
  it('devolve os ativos com o rótulo que a organização usa', async () => {
    const r = await http.get('/v1/assets').set(auth(EMAIL_GESTOR));
    expect(r.status).toBe(200);
    expect(r.body.asset_label).toBeTruthy();
    expect(r.body.items).toHaveLength(2);
    expect(r.body.items[0].category_name).toBe('Ventilador Pulmonar');
  });

  it('filtra por subárvore de local', async () => {
    const r = await http.get(`/v1/assets?location=${unidadeNorte}`).set(auth(EMAIL_GESTOR));
    expect(r.body.items.map((a: { name: string }) => a.name)).toEqual(['Ventilador Norte 01']);
  });

  it('o técnico com escopo restrito só vê o inventário da unidade dele', async () => {
    const r = await http.get('/v1/assets').set(auth(EMAIL_TEC));
    expect(r.status).toBe(200);
    expect(r.body.items.map((a: { name: string }) => a.name)).toEqual(['Ventilador Norte 01']);
  });

  it('pedir explicitamente o ramo fora do escopo não devolve nada', async () => {
    const r = await http.get(`/v1/assets?location=${unidadeSul}`).set(auth(EMAIL_TEC));
    expect(r.body.items).toEqual([]);
  });

  it('a ficha traz specs resolvidas, garantia e idade calculadas', async () => {
    const r = await http.get(`/v1/assets/${ativoNorte}`).set(auth(EMAIL_GESTOR));
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Ventilador Norte 01');
    expect(r.body.specs).toEqual({});
    expect(r.body.under_warranty).toBe(false);
    expect(r.body.age_years).toBeNull();
    expect(r.body.transfers).toEqual([]);
  });

  it('ativo inexistente é 404', async () => {
    const r = await http.get(`/v1/assets/${newId()}`).set(auth(EMAIL_GESTOR));
    expect(r.status).toBe(404);
  });
});

describe('transferência não tem atalho', () => {
  it('o técnico não pode transferir: 403 nomeando a permissão', async () => {
    const r = await http
      .post(`/v1/assets/${ativoNorte}/transfer`)
      .set(auth(EMAIL_TEC))
      .send({ to_location_id: utiSul, reason: 'tentativa indevida' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('asset.transfer');
  });

  it('transferir sem motivo é 422', async () => {
    const r = await http
      .post(`/v1/assets/${ativoNorte}/transfer`)
      .set(auth(EMAIL_GESTOR))
      .send({ to_location_id: utiSul, reason: 'ok' });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('reason');
  });

  it('empréstimo sem data de devolução é 422 antes de tocar o banco', async () => {
    const r = await http
      .post(`/v1/assets/${ativoNorte}/transfer`)
      .set(auth(EMAIL_GESTOR))
      .send({ to_location_id: utiSul, reason: 'empréstimo temporário', kind: 'loan' });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('due_back_at');
  });

  it('transferir registra a movimentação e ela aparece na ficha', async () => {
    const r = await http
      .post(`/v1/assets/${ativoNorte}/transfer`)
      .set(auth(EMAIL_GESTOR))
      .send({ to_location_id: utiSul, reason: 'realocação por demanda da UTI Sul' });
    expect(r.status).toBe(201);
    expect(r.body.transfer_id).toBeTruthy();

    const ficha = await http.get(`/v1/assets/${ativoNorte}`).set(auth(EMAIL_GESTOR));
    expect(ficha.body.location_id).toBe(utiSul);
    expect(ficha.body.transfers).toHaveLength(1);
    expect(ficha.body.transfers[0].reason).toMatch(/realocação/);
  });

  it('depois da transferência, o técnico do Norte deixa de ver o ativo', async () => {
    const r = await http.get('/v1/assets').set(auth(EMAIL_TEC));
    expect(r.body.items).toEqual([]);
  });
});

describe('descomissionamento', () => {
  it('justificativa curta é 422', async () => {
    const r = await http
      .post(`/v1/assets/${ativoNorte}/decommission`)
      .set(auth(EMAIL_GESTOR))
      .send({ reason: 'velho' });
    expect(r.status).toBe(422);
  });

  it('com justificativa, encerra o ativo', async () => {
    const r = await http
      .post(`/v1/assets/${ativoNorte}/decommission`)
      .set(auth(EMAIL_GESTOR))
      .send({ reason: 'obsolescência declarada em laudo técnico 2026-08' });
    expect(r.status).toBe(201);

    const ficha = await http.get(`/v1/assets/${ativoNorte}`).set(auth(EMAIL_GESTOR));
    expect(ficha.body.status).toBe('decommissioned');
  });
});

describe('importação', () => {
  it('sucesso parcial responde 200 com o relatório por linha, não erro total', async () => {
    const r = await http
      .post('/v1/assets/import')
      .set(auth(EMAIL_GESTOR))
      .send({
        customer_id: cliente,
        rows: [
          {
            name: 'Importado 1',
            category: 'Ventilador Pulmonar',
            manufacturer: 'Mindray',
            model: 'R3',
            location_code: 'UTI-N',
          },
          { name: '', category: 'Ventilador Pulmonar' },
          { name: 'Importado 3', category: 'Categoria fantasma' },
          { name: 'Importado 4', category: 'Ventilador Pulmonar', location_code: 'UTI-S' },
        ],
      });

    expect(r.status).toBe(201);
    expect(r.body.imported).toBe(2);
    expect(r.body.failed).toBe(2);
    expect(r.body.createdManufacturers).toBe(1);
    expect(r.body.issues.map((i: { line: number }) => i.line).sort()).toEqual([2, 3]);
    expect(r.body.issues.find((i: { line: number }) => i.line === 2).message).toMatch(/nome é obrigatório/);
  });

  it('lote acima do limite é recusado com o limite na resposta', async () => {
    const r = await http
      .post('/v1/assets/import')
      .set(auth(EMAIL_GESTOR))
      .send({ customer_id: cliente, rows: Array.from({ length: 50_001 }, () => ({ name: 'x' })) });
    expect(r.status).toBe(422);
    expect(r.body.details.max).toBe(50_000);
  });

  it('a fila de curadoria mostra o que a importação criou sem conferência', async () => {
    const r = await http.get('/v1/assets/curation/queue').set(auth(EMAIL_GESTOR));
    expect(r.status).toBe(200);
    expect(r.body.manufacturers.map((m: { name: string }) => m.name)).toContain('Mindray');
    expect(r.body.models.map((m: { name: string }) => m.name)).toContain('R3');
  });

  it('o técnico cadastra ativo em campo, mas não importa planilha: 403', async () => {
    const r = await http
      .post('/v1/assets/import')
      .set(auth(EMAIL_TEC))
      .send({ customer_id: cliente, rows: [] });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('asset.import');
  });
});
