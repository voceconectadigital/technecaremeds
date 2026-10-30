/**
 * Aurora — equipamento: identificação, ANVISA, filtros, ficha de vida e certificado (rodada 29/10/2026).
 *
 *   · ATV-04  tag única na organização (índice parcial da 0089), não se apaga na edição — só se
 *             troca —, e a colisão antiga (anterior à 0089) segue editável sem travar ninguém;
 *   · ATV-11  registro ANVISA pesquisável (busca e filtro da lista) e "não se aplica", validado;
 *   · ATV-12  `?customer=` e `?status=` respeitam escopo e tenant;
 *   · ATV-13  ficha de vida: planos que cobrem o equipamento, procedimentos executados e histórico
 *             de campos, cada um com a sua permissão;
 *   · ATV-10  depreciação com a metodologia na ficha e o residual no cálculo do servidor;
 *   · QUA-04  certificado de qualificação com referência ao procedimento (versão publicada).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import { createTestDatabase, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  createAsset,
  createCustomer,
  createLocation,
  provisionStarterLocationTypes,
  createPlan,
  addPlanTask,
  createWorkOrder,
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  attachChecklist,
  answerChecklistItem,
  transitionWorkOrder,
} from '@aurora/db';
import { assetDetail, assetsList, assetsLifeRecord, qualityList } from '@aurora/contracts';
import { auth, criarOrganizacao, criarPessoa, ctxSistema, subirApi, type OrgDeTeste } from './apoio/cenario';
import { FOTO_PNG } from './apoio/foto';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let A: OrgDeTeste;
let B: OrgDeTeste;
/** Técnico restrito ao hospital principal de A (sem plano, sem trilha, sem financeiro). */
let tecnico: { email: string; mem: string };
/** Coordenador: lê planos e edita equipamento, mas não vê valor financeiro. */
let coordenador: { email: string; mem: string };
let outroCliente = '';
let setorOutro = '';
let blocoA = '';
let ventilador = '';
let monitorOutro = '';
let reservaA = '';
let deB = '';
let templatePublicado = '';
let templateRascunho = '';
let templateDeB = '';

beforeAll(async () => {
  t = await createTestDatabase();
  A = await criarOrganizacao(t, 'atv-a');
  B = await criarOrganizacao(t, 'atv-b');

  await withTenant(t.db, ctxSistema(A.org), async (s) => {
    const tipos = await provisionStarterLocationTypes(s);
    blocoA = await createLocation(s, {
      customerId: A.cliente,
      parentId: A.unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'Bloco Cirúrgico',
    });
    outroCliente = await createCustomer(s, { name: 'Clínica Outra' });
    const sede = await createLocation(s, {
      customerId: outroCliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede Outra',
    });
    setorOutro = await createLocation(s, {
      customerId: outroCliente,
      parentId: sede,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI Outra',
    });
    ventilador = await createAsset(s, {
      name: 'Ventilador Leito 1',
      tag: 'VNT-0001',
      customerId: A.cliente,
      assetCategoryId: A.categoria,
      locationId: A.setor,
      anvisaRegistration: '80102030040',
    });
    reservaA = await createAsset(s, {
      name: 'Ventilador Reserva',
      tag: 'VNT-0002',
      customerId: A.cliente,
      assetCategoryId: A.categoria,
      locationId: blocoA,
      status: 'standby',
    });
    monitorOutro = await createAsset(s, {
      name: 'Monitor da Outra',
      tag: 'MON-0001',
      customerId: outroCliente,
      assetCategoryId: A.categoria,
      locationId: setorOutro,
      anvisaNotApplicable: true,
    });

    // Plano que cobre o ventilador pela CATEGORIA (ATV-13).
    const plano = await createPlan(s, {
      name: 'Preventiva de ventiladores',
      customerId: A.cliente,
      anchorDate: new Date('2026-01-01T00:00:00Z'),
    });
    await addPlanTask(s, {
      planId: plano,
      name: 'Preventiva anual',
      targetKind: 'asset_category',
      targetCategoryId: A.categoria,
      workOrderTypeId: A.natureza,
      frequencyUnit: 'year',
    });

    // Um procedimento executado nele (ATV-13), e o mesmo procedimento serve ao certificado (QUA-04).
    templatePublicado = await createChecklistTemplate(s, {
      key: 'qualificacao_vent',
      title: 'Qualificação de ventilador',
    });
    const item = await addChecklistItem(s, {
      templateId: templatePublicado,
      kind: 'boolean',
      label: 'Alarme de desconexão funciona',
      expectedBoolean: true,
    });
    await publishChecklist(s, templatePublicado);
    templateRascunho = await createChecklistTemplate(s, { key: 'rascunho_vent', title: 'Ainda em rascunho' });
    const os = await createWorkOrder(s, {
      customerId: A.cliente,
      workOrderTypeId: A.natureza,
      title: 'Qualificação anual',
      assetId: ventilador,
    });
    const resposta = await attachChecklist(s, os.id, templatePublicado);
    await transitionWorkOrder(s, os.id, 'in_progress');
    await answerChecklistItem(s, resposta, item, { boolean: true });
  });

  await withTenant(t.db, ctxSistema(B.org), async (s) => {
    deB = await createAsset(s, {
      name: 'Ventilador de B',
      tag: 'VNT-0001', // a MESMA tag de A: a unicidade é por organização
      customerId: B.cliente,
      assetCategoryId: B.categoria,
      locationId: B.setor,
    });
    templateDeB = await createChecklistTemplate(s, { key: 'proc_de_b', title: 'Procedimento de B' });
    await addChecklistItem(s, {
      templateId: templateDeB,
      kind: 'boolean',
      label: 'Ok',
      expectedBoolean: true,
    });
    await publishChecklist(s, templateDeB);
  });

  tecnico = await criarPessoa(t, A, 'tecnico', 'technician', { customerIds: [A.cliente] });
  coordenador = await criarPessoa(t, A, 'coordenador', 'coordinator');
  ({ app, http } = await subirApi(t.db));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

const base = () => ({
  customer_id: A.cliente,
  location_id: A.setor,
  asset_category_id: A.categoria,
  photo: FOTO_PNG,
});

describe('ATV-04 · tag única por organização, e que não se apaga', () => {
  it('tag repetida na organização → 409 no campo tag — mesmo escrita de outro jeito', async () => {
    const r = await http
      .post('/v1/assets')
      .set(auth(A.email))
      .send({ ...base(), name: 'Ventilador Duplicado', tag: 'vnt 0001' });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.details.field).toBe('tag');
  });

  it('a mesma tag em OUTRA organização é permitida (a unicidade é por organização)', async () => {
    const r = await http.get(`/v1/assets/${deB}`).set(auth(B.email));
    expect(r.body.tag).toBe('VNT-0001');
  });

  it('editar: apagar a tag é recusado (422); trocar por outra válida passa; trocar por uma usada é 409', async () => {
    for (const tag of [null, '', '   ']) {
      const r = await http.patch(`/v1/assets/${reservaA}`).set(auth(A.email)).send({ tag });
      expect(r.status, JSON.stringify(tag)).toBe(422);
      expect(r.body.details.field).toBe('tag');
    }
    const ok = await http.patch(`/v1/assets/${reservaA}`).set(auth(A.email)).send({ tag: 'VNT-0002-B' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const usada = await http.patch(`/v1/assets/${reservaA}`).set(auth(A.email)).send({ tag: 'VNT-0001' });
    expect(usada.status).toBe(409);
    expect(usada.body.details.field).toBe('tag');
  });

  it('o banco também recusa apagar a tag (gatilho da 0089), fora da API', async () => {
    await expect(t.raw(`UPDATE aurora.assets SET tag = NULL WHERE id = $1`, [ventilador])).rejects.toThrow(
      /tag do equipamento não pode ser apagada/
    );
  });

  it('o parque antigo SEM tag segue editável sem ela', async () => {
    const semTag = await withTenant(t.db, ctxSistema(A.org), (s) =>
      createAsset(s, {
        name: 'Maca antiga',
        customerId: A.cliente,
        assetCategoryId: A.categoria,
        locationId: A.setor,
      })
    );
    const r = await http
      .patch(`/v1/assets/${semTag}`)
      .set(auth(A.email))
      .send({ name: 'Maca antiga (revisada)' });
    expect(r.status).toBe(200);
    // E ganhar a primeira tag também é permitido.
    expect(
      (await http.patch(`/v1/assets/${semTag}`).set(auth(A.email)).send({ tag: 'MAC-0001' })).status
    ).toBe(200);
    await t.raw(`UPDATE aurora.assets SET deleted_at = now() WHERE id = $1`, [semTag]);
  });

  it('colisão ANTERIOR à 0089 (marcada, fora do índice): o equipamento segue editável; a regra vale para a tag nova', async () => {
    const legado = await withTenant(t.db, ctxSistema(A.org), (s) =>
      createAsset(s, {
        name: 'Ventilador legado',
        tag: 'LEG-TEMP',
        customerId: A.cliente,
        assetCategoryId: A.categoria,
        locationId: A.setor,
      })
    );
    // Simula o que a migration encontrou: a mesma tag de outro equipamento, marcada como colisão antiga.
    await t.raw(`ALTER TABLE aurora.assets DISABLE TRIGGER assets_tag_guard`);
    await t.raw(`UPDATE aurora.assets SET tag = 'VNT-0001', tag_legacy_duplicate = true WHERE id = $1`, [
      legado,
    ]);
    await t.raw(`ALTER TABLE aurora.assets ENABLE TRIGGER assets_tag_guard`);

    // Editar outro campo não esbarra na colisão antiga.
    expect(
      (await http.patch(`/v1/assets/${legado}`).set(auth(A.email)).send({ name: 'Ventilador legado (UTI)' }))
        .status
    ).toBe(200);
    // Trocar a tag passa pela regra: a nova é única, a marcação cai.
    expect(
      (await http.patch(`/v1/assets/${legado}`).set(auth(A.email)).send({ tag: 'VNT-0099' })).status
    ).toBe(200);
    const [linha] = await t.raw(`SELECT tag_legacy_duplicate FROM aurora.assets WHERE id = $1`, [legado]);
    expect(linha!.tag_legacy_duplicate).toBe(false);
    // E não volta para a tag repetida.
    expect(
      (await http.patch(`/v1/assets/${legado}`).set(auth(A.email)).send({ tag: 'VNT-0001' })).status
    ).toBe(409);
    await t.raw(`UPDATE aurora.assets SET deleted_at = now() WHERE id = $1`, [legado]);
  });

  it('equipamento na lixeira não prende a tag', async () => {
    const r1 = await http
      .post('/v1/assets')
      .set(auth(A.email))
      .send({ ...base(), name: 'Bomba 1', tag: 'BOM-0001' });
    expect(r1.status).toBe(201);
    await t.raw(`UPDATE aurora.assets SET deleted_at = now() WHERE id = $1`, [r1.body.id]);
    const r2 = await http
      .post('/v1/assets')
      .set(auth(A.email))
      .send({ ...base(), name: 'Bomba 2', tag: 'BOM-0001' });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    await t.raw(`UPDATE aurora.assets SET deleted_at = now() WHERE id = $1`, [r2.body.id]);
  });
});

describe('ATV-11 · ANVISA pesquisável e "não se aplica"', () => {
  it('número e "não se aplica" juntos → 422; só "não se aplica" → 201', async () => {
    const junto = await http
      .post('/v1/assets')
      .set(auth(A.email))
      .send({
        ...base(),
        name: 'Maca',
        tag: 'MAC-0100',
        anvisa_registration: '80102030099',
        anvisa_not_applicable: true,
      });
    expect(junto.status).toBe(422);
    expect(junto.body.details.field).toBe('anvisa_not_applicable');

    const na = await http
      .post('/v1/assets')
      .set(auth(A.email))
      .send({ ...base(), name: 'Maca', tag: 'MAC-0100', anvisa_not_applicable: true });
    expect(na.status, JSON.stringify(na.body)).toBe(201);
    const ficha = await http.get(`/v1/assets/${na.body.id}`).set(auth(A.email));
    expect(ficha.body.anvisa_not_applicable).toBe(true);
    expect(assetDetail.response.safeParse(ficha.body).success).toBe(true);
    await t.raw(`UPDATE aurora.assets SET deleted_at = now() WHERE id = $1`, [na.body.id]);
  });

  it('na edição a regra vale para o estado que FICA: marcar "não se aplica" exige limpar o número', async () => {
    const r = await http
      .patch(`/v1/assets/${ventilador}`)
      .set(auth(A.email))
      .send({ anvisa_not_applicable: true });
    expect(r.status).toBe(422);
    // O banco também recusa os dois juntos.
    await expect(
      t.raw(`UPDATE aurora.assets SET anvisa_not_applicable = true WHERE id = $1`, [ventilador])
    ).rejects.toThrow(/assets_anvisa_na_exclusive/);
  });

  it('a busca da lista acha pelo número ANVISA, e o filtro separa com número / não se aplica / pendente', async () => {
    const pega = async (q: string) =>
      (await http.get(`/v1/assets?${q}`).set(auth(A.email))).body.items.map((a: { name: string }) => a.name);
    expect(await pega('q=801020300')).toEqual(['Ventilador Leito 1']);
    expect(await pega('q=vnt-0001')).toEqual(['Ventilador Leito 1']);
    expect(await pega('anvisa=registered')).toEqual(['Ventilador Leito 1']);
    expect(await pega('anvisa=not_applicable')).toEqual(['Monitor da Outra']);
    expect(await pega('anvisa=pending')).toContain('Ventilador Reserva');
    expect(await pega('anvisa=pending')).not.toContain('Ventilador Leito 1');
    // Curinga digitado é texto, não curinga.
    expect(await pega('q=%25')).toEqual([]);
    const r = await http.get('/v1/assets?anvisa=registered').set(auth(A.email));
    expect(assetsList.response.safeParse(r.body).success).toBe(true);
    expect(r.body.items[0].anvisa_registration).toBe('80102030040');
    expect((await http.get('/v1/assets?anvisa=talvez').set(auth(A.email))).status).toBe(422);
  });

  it('a busca não atravessa organização nem escopo', async () => {
    const deB_ = await http.get('/v1/assets?q=801020300').set(auth(B.email));
    expect(deB_.body.items).toEqual([]);
    const tec = await http.get('/v1/assets?anvisa=not_applicable').set(auth(tecnico.email));
    expect(tec.body.items).toEqual([]); // o Monitor é de outro cliente, fora do escopo do técnico
  });
});

describe('ATV-12 · lista com ?customer= e ?status=, sempre no escopo e no tenant', () => {
  const nomes = (r: { body: { items: { name: string }[] } }) => r.body.items.map((a) => a.name).sort();

  it('?customer= devolve só os equipamentos daquele cliente', async () => {
    const r = await http.get(`/v1/assets?customer=${outroCliente}`).set(auth(A.email));
    expect(r.status).toBe(200);
    expect(nomes(r)).toEqual(['Monitor da Outra']);
    const p = await http.get(`/v1/assets?customer=${A.cliente}`).set(auth(A.email));
    expect(nomes(p)).toEqual(['Ventilador Leito 1', 'Ventilador Reserva']);
  });

  it('?status= filtra a situação', async () => {
    const r = await http.get('/v1/assets?status=standby').set(auth(A.email));
    expect(nomes(r)).toEqual(['Ventilador Reserva']);
    const c = await http.get(`/v1/assets?status=standby&customer=${outroCliente}`).set(auth(A.email));
    expect(c.body.items).toEqual([]);
  });

  it('cliente fora do escopo do vínculo: lista vazia, mesmo pedindo pelo id', async () => {
    const r = await http.get(`/v1/assets?customer=${outroCliente}`).set(auth(tecnico.email));
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
    const s = await http.get('/v1/assets?status=active').set(auth(tecnico.email));
    expect(nomes(s)).toEqual(['Ventilador Leito 1']);
  });

  it('cliente de OUTRA organização: lista vazia (o tenant manda)', async () => {
    const r = await http.get(`/v1/assets?customer=${A.cliente}`).set(auth(B.email));
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
    const s = await http.get('/v1/assets?status=standby').set(auth(B.email));
    expect(s.body.items).toEqual([]);
  });

  it('identificador de cliente malformado → 422', async () => {
    expect((await http.get('/v1/assets?customer=nao-e-uuid').set(auth(A.email))).status).toBe(422);
  });
});

describe('ATV-10 · depreciação com metodologia e residual', () => {
  let bem = '';
  it('o residual entra no cálculo do servidor e a ficha mostra a metodologia', async () => {
    const r = await http
      .post('/v1/assets')
      .set(auth(A.email))
      .send({
        ...base(),
        name: 'Monitor multiparâmetro',
        tag: 'MON-0500',
        acquired_at: '2020-01-01',
        useful_life_years: 10,
        purchase_value: 12000,
        residual_value: 2000,
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    bem = r.body.id;
    const ficha = await http.get(`/v1/assets/${bem}`).set(auth(A.email));
    expect(ficha.body.residual_value).toBe('2000.00');
    expect(ficha.body.depreciation.methodology).toEqual({
      method: 'straight_line',
      baseDate: '2020-01-01',
      usefulLifeYears: 10,
      endDate: '2030-01-01',
      residualValue: 2000,
      depreciableBase: 10000,
    });
    expect(ficha.body.depreciation.annualDepreciation).toBe(1000);
  });

  it('residual maior que a compra → 422; sem permissão financeira, residual → 403 e a metodologia vem sem valores', async () => {
    const maior = await http.patch(`/v1/assets/${bem}`).set(auth(A.email)).send({ residual_value: 12001 });
    expect(maior.status).toBe(422);
    expect(maior.body.details.field).toBe('residual_value');
    const semPermissao = await http
      .patch(`/v1/assets/${bem}`)
      .set(auth(coordenador.email))
      .send({ residual_value: 1 });
    expect(semPermissao.status).toBe(403);
    const ficha = await http.get(`/v1/assets/${bem}`).set(auth(coordenador.email));
    expect(ficha.body.residual_value).toBeNull();
    expect(ficha.body.depreciation.methodology.residualValue).toBeNull();
    expect(ficha.body.depreciation.methodology.method).toBe('straight_line');
  });
});

describe('ATV-13 · ficha de vida: planos, procedimentos e histórico de campos', () => {
  it('quem lê tudo vê os planos que cobrem, o procedimento executado e as alterações de campo', async () => {
    await http.patch(`/v1/assets/${ventilador}`).set(auth(A.email)).send({ serial_number: 'SN-VENT-1' });
    const r = await http.get(`/v1/assets/${ventilador}/life-record`).set(auth(A.email));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(assetsLifeRecord.response.safeParse(r.body).success).toBe(true);
    expect(r.body.plans).toHaveLength(1);
    expect(r.body.plans[0]).toMatchObject({
      plan_name: 'Preventiva de ventiladores',
      task_name: 'Preventiva anual',
      target_kind: 'asset_category',
      frequency_unit: 'year',
    });
    expect(r.body.procedures).toHaveLength(1);
    expect(r.body.procedures[0]).toMatchObject({
      template_title: 'Qualificação de ventilador',
      template_version: 1,
      answers: { pass: 1, fail: 0, na: 0 },
    });
    const serie = r.body.field_changes.find((m: { changes: { field: string }[] }) =>
      m.changes.some((c) => c.field === 'serial_number')
    );
    expect(serie.action).toBe('update');
    expect(serie.changes).toContainEqual({ field: 'serial_number', from: null, to: 'SN-VENT-1' });
    expect(serie.actor_name).toBeTruthy();
    // O cadastro aparece como "create", sem despejar todas as colunas.
    const criado = r.body.field_changes.find((m: { action: string }) => m.action === 'create');
    expect(criado.changes).toEqual([]);
  });

  it('um equipamento de outro tipo não herda o plano', async () => {
    const r = await http.get(`/v1/assets/${monitorOutro}/life-record`).set(auth(A.email));
    expect(r.body.plans).toEqual([]);
    expect(r.body.procedures).toEqual([]);
  });

  it('sem a permissão, a seção vem null: o técnico não vê plano nem trilha, mas vê o procedimento', async () => {
    const r = await http.get(`/v1/assets/${ventilador}/life-record`).set(auth(tecnico.email));
    expect(r.status).toBe(200);
    expect(r.body.plans).toBeNull();
    expect(r.body.field_changes).toBeNull();
    expect(r.body.procedures).toHaveLength(1);
  });

  it('o histórico não mostra valor financeiro a quem não tem asset.read_financials', async () => {
    await http.patch(`/v1/assets/${ventilador}`).set(auth(A.email)).send({ purchase_value: 50000 });
    const admin = await http.get(`/v1/assets/${ventilador}/life-record`).set(auth(A.email));
    expect(JSON.stringify(admin.body.field_changes)).toContain('purchase_value');
    const coord = await http.get(`/v1/assets/${ventilador}/life-record`).set(auth(coordenador.email));
    expect(coord.status).toBe(200);
    expect(coord.body.plans).not.toBeNull();
    expect(coord.body.field_changes).not.toBeNull();
    expect(JSON.stringify(coord.body)).not.toMatch(/purchase_value|50000/);
  });

  it('fora do escopo e de outra organização: 404', async () => {
    expect((await http.get(`/v1/assets/${monitorOutro}/life-record`).set(auth(tecnico.email))).status).toBe(
      404
    );
    expect((await http.get(`/v1/assets/${ventilador}/life-record`).set(auth(B.email))).status).toBe(404);
  });
});

describe('QUA-04 · certificado de qualificação com o procedimento', () => {
  it('grava a referência à versão publicada do procedimento, além do equipamento, e a lista a devolve', async () => {
    const r = await http.post('/v1/quality-records').set(auth(A.email)).send({
      kind: 'qualification',
      title: 'Qualificação de instalação — Ventilador Leito 1',
      asset_id: ventilador,
      procedure_template_id: templatePublicado,
      issued_at: '2026-10-01',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const lista = await http.get(`/v1/quality-records?asset=${ventilador}`).set(auth(A.email));
    expect(qualityList.response.safeParse(lista.body).success).toBe(true);
    expect(lista.body.items[0]).toMatchObject({
      asset_id: ventilador,
      procedure_template_id: templatePublicado,
      procedure_title: 'Qualificação de ventilador',
      procedure_version: 1,
    });
  });

  it('a referência é opcional', async () => {
    const r = await http.post('/v1/quality-records').set(auth(A.email)).send({
      kind: 'qualification',
      title: 'Qualificação sem procedimento',
      asset_id: ventilador,
      issued_at: '2026-10-02',
    });
    expect(r.status).toBe(201);
  });

  it('rascunho, procedimento de outra organização ou inexistente → 422 no campo', async () => {
    for (const id of [templateRascunho, templateDeB, '00000000-0000-4000-8000-000000000000']) {
      const r = await http.post('/v1/quality-records').set(auth(A.email)).send({
        kind: 'qualification',
        title: 'Qualificação inválida',
        asset_id: ventilador,
        procedure_template_id: id,
        issued_at: '2026-10-03',
      });
      expect(r.status, id).toBe(422);
      expect(r.body.details.field).toBe('procedure_template_id');
    }
  });
});
