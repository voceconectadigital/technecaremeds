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
const AUD_USER = newId(),
  AUD_MEM = newId();
const EMAIL_GESTOR = 'gestor@ast.test';
const EMAIL_TEC = 'tecnico@ast.test';
/**
 * A auditora enxerga o ativo e NÃO enxerga nem valor nem observação interna.
 *
 * Existe porque o técnico não serve de sonda para os dois eixos: ele VÊ nota
 * interna de propósito — "este aparelho já voltou três vezes pelo mesmo
 * defeito" é contexto de manutenção — e não vê valor. Provar os dois filtros
 * exige alguém que não veja nenhum dos dois.
 */
const EMAIL_AUD = 'auditora@ast.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let cliente: string;
let unidadeNorte: string, unidadeSul: string, utiNorte: string, utiSul: string;
let categoria: string;
let ativoNorte: string;
/** Fica na Norte o teste inteiro: `ativoNorte` é transferido para a Sul no meio da suíte. */
let ativoFixoNorte: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: GESTOR_USER, membershipId: GESTOR_MEM },
    { slug: 'ast', name: 'Rede Hospitalar', email: EMAIL_GESTOR, userName: 'Gestora' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  let tecnicoRole = '';
  let auditorRole = '';
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, GESTOR_MEM, roles.get('maintenance_manager')!);
    tecnicoRole = roles.get('technician')!;
    auditorRole = roles.get('auditor')!;

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

  await seedMember(
    t,
    { organizationId: ORG, userId: AUD_USER, membershipId: AUD_MEM },
    { email: EMAIL_AUD, userName: 'Auditora' }
  );
  await withTenant(t.db, sysCtx, (s) => assignRole(s, AUD_MEM, auditorRole));

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

describe('o que NÃO sai do servidor', () => {
  it('valor financeiro e observação interna saem da consulta para quem não pode vê-los', async () => {
    /*
     * A ficha fazia `SELECT a.*`.
     *
     * A tabela tem `internal_notes` e três valores — compra, residual e
     * reposição. `asset.read_financials` estava no catálogo de permissões
     * desde o começo, sem nenhum lugar que a aplicasse: o valor de compra do
     * parque inteiro trafegava para qualquer um com `asset.read`.
     *
     * A gestora tem a permissão; o técnico não. É a comparação que prova o
     * filtro — um teste com um papel só confirmaria que o dado chega a quem
     * deve e não diria nada sobre quem não deve.
     */
    // O ativo precisa TER valor e observação, senão o teste compara nulo com
    // nulo e passa sem provar nada.
    const sys = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'valores' });
    ativoFixoNorte = await withTenant(t.db, sys, (s2) =>
      createAsset(s2, {
        name: 'Ventilador Norte 02',
        customerId: cliente,
        assetCategoryId: categoria,
        locationId: utiNorte,
        serialNumber: 'SN-NORTE-02',
      })
    );
    await withTenant(t.db, sys, (s2) =>
      s2.query(
        `UPDATE aurora.assets
            SET purchase_value = 48000, residual_value = 12000,
                replacement_value = 61000, currency = 'BRL',
                internal_notes = 'Cliente contesta toda fatura deste parque.'
          WHERE id = $1`,
        [ativoFixoNorte]
      )
    );

    const daGestora = await http.get(`/v1/assets/${ativoFixoNorte}`).set(auth(EMAIL_GESTOR));
    expect(daGestora.status).toBe(200);
    expect(daGestora.body.purchase_value).toBe('48000.00');
    expect(daGestora.body.internal_notes).toContain('contesta toda fatura');

    // O técnico só enxerga a unidade Norte: o ativo precisa estar nela (desde
    // 16/10/2026 o escopo vale também na ficha por id).
    const doTecnico = await http.get(`/v1/assets/${ativoFixoNorte}`).set(auth(EMAIL_TEC));
    expect(doTecnico.status).toBe(200);
    expect(doTecnico.body.purchase_value).toBeNull();
    expect(doTecnico.body.residual_value).toBeNull();
    expect(doTecnico.body.replacement_value).toBeNull();
    // O técnico VÊ a observação interna, e isso é escolha: o histórico do
    // defeito é contexto de quem vai consertar.
    expect(doTecnico.body.internal_notes).toContain('contesta toda fatura');
    // Mas nenhum valor está em canto nenhum do corpo — nem num campo esquecido.
    expect(JSON.stringify(doTecnico.body)).not.toContain('48000');

    // A auditora não vê nenhum dos dois.
    const daAuditoria = await http.get(`/v1/assets/${ativoFixoNorte}`).set(auth(EMAIL_AUD));
    expect(daAuditoria.status).toBe(200);
    expect(daAuditoria.body.internal_notes).toBeNull();
    expect(daAuditoria.body.purchase_value).toBeNull();
    expect(JSON.stringify(daAuditoria.body)).not.toContain('contesta toda fatura');
    expect(JSON.stringify(daAuditoria.body)).not.toContain('48000');
  });

  it('a ficha satisfaz o contrato campo a campo, sem sobrar nem faltar', async () => {
    // `a.*` devolvia quarenta e sete colunas, incluindo `organization_id`,
    // `created_by` e `deleted_at`. Com `strict()`, coluna nova na tabela deixa
    // de chegar ao navegador por acidente: alguém precisa declará-la aqui, e
    // ao declarar decide se ela deve mesmo sair do servidor.
    const { AssetDetail } = await import('@aurora/contracts');
    const r = await http.get(`/v1/assets/${ativoNorte}`).set(auth(EMAIL_GESTOR));
    const conferido = AssetDetail.strict().safeParse(r.body);
    if (!conferido.success) {
      throw new Error(
        'a ficha do ativo divergiu do contrato:\n' +
          conferido.error.issues.map((i) => `  · ${i.path.join('.') || '(raiz)'}: ${i.message}`).join('\n')
      );
    }
  });

  it('a lista de ativos satisfaz o contrato', async () => {
    const { assetsList } = await import('@aurora/contracts');
    const r = await http.get('/v1/assets').set(auth(EMAIL_GESTOR));
    const conferido = assetsList.response.safeParse(r.body);
    if (!conferido.success) {
      throw new Error(
        'a lista de ativos divergiu do contrato:\n' +
          conferido.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n')
      );
    }
  });

  it('a lista de locais satisfaz o contrato', async () => {
    const { locationsList } = await import('@aurora/contracts');
    const r = await http.get('/v1/locations').set(auth(EMAIL_GESTOR));
    const conferido = locationsList.response.safeParse(r.body);
    if (!conferido.success) {
      throw new Error(
        'a lista de locais divergiu do contrato:\n' +
          conferido.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n')
      );
    }
  });
});
