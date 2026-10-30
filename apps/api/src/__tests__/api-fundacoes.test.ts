/**
 * Aurora — fundações do escopo V2 pela HTTP (gap V2 P0.1, P0.3, P0.4).
 *
 *  · P0.1 — a correção de uma resposta aparece no histórico, pela rota;
 *  · P0.3 — identificador externo único por organização e origem, nunca global;
 *  · P0.4 — modo de uso e recursos habilitados da organização do CONTEXTO.
 *
 * Cada bloco tem o seu caso de outra organização: é a propriedade que não pode
 * falhar uma vez.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import {
  ORGANIZATION_FEATURES as FEATURES_DOMINIO,
  ORGANIZATION_USAGE_MODES as MODOS_DOMINIO,
} from '@aurora/domain';
import {
  ORGANIZATION_FEATURES,
  ORGANIZATION_USAGE_MODES,
  OrganizationConfiguration,
} from '@aurora/contracts';
import { createTestDatabase, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  createAsset,
  createWorkOrder,
  transitionWorkOrder,
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  attachChecklist,
} from '@aurora/db';
import { auth, criarOrganizacao, criarPessoa, ctxSistema, subirApi, type OrgDeTeste } from './apoio/cenario';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let A: OrgDeTeste;
let B: OrgDeTeste;
let tecnicoA: { email: string };
let respostaA = '';
let itemA = '';

beforeAll(async () => {
  t = await createTestDatabase();
  A = await criarOrganizacao(t, 'fund-a');
  B = await criarOrganizacao(t, 'fund-b');
  tecnicoA = await criarPessoa(t, A, 'tecnico', 'technician');

  await withTenant(t.db, ctxSistema(A.org), async (s) => {
    const ativo = await createAsset(s, {
      name: 'Monitor',
      customerId: A.cliente,
      assetCategoryId: A.categoria,
      locationId: A.setor,
    });
    const tpl = await createChecklistTemplate(s, { key: 'inspecao', title: 'Inspeção' });
    itemA = await addChecklistItem(s, {
      templateId: tpl,
      kind: 'number',
      label: 'Tensão',
      minValue: 100,
      maxValue: 130,
      unit: 'V',
    });
    await publishChecklist(s, tpl);
    const os = await createWorkOrder(s, {
      customerId: A.cliente,
      workOrderTypeId: A.natureza,
      title: 'Inspeção',
      locationId: A.setor,
      assetId: ativo,
    });
    await transitionWorkOrder(s, os.id, 'in_progress');
    respostaA = await attachChecklist(s, os.id, tpl);
  });

  ({ app, http } = await subirApi(t.db));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('P0.1 — correção de medição pela HTTP', () => {
  it('responder e corrigir devolve a revisão, e o histórico mostra o original', async () => {
    const r1 = await http
      .post(`/v1/checklist-responses/${respostaA}/answers`)
      .set(auth(A.email))
      .send({ item_id: itemA, number: 98 });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ verdict: 'fail', revision: 1 });

    const r2 = await http
      .post(`/v1/checklist-responses/${respostaA}/answers`)
      .set(auth(A.email))
      .send({ item_id: itemA, number: 118, correction_reason: 'leitura repetida após estabilizar' });
    expect(r2.body).toMatchObject({ verdict: 'pass', revision: 2, answer_id: r1.body.answer_id });

    const h = await http.get(`/v1/checklist-responses/${respostaA}/revisions`).set(auth(A.email));
    expect(h.status).toBe(200);
    expect(
      h.body.items.map((i: { value_number: number; current: boolean }) => [i.value_number, i.current])
    ).toEqual([
      [98, false],
      [118, true],
    ]);
  });

  it('outra organização recebe 404 no histórico alheio', async () => {
    const r = await http.get(`/v1/checklist-responses/${respostaA}/revisions`).set(auth(B.email));
    expect(r.status).toBe(404);
  });
});

describe('P0.3 — identificador externo', () => {
  it('mesmo identificador na mesma organização e origem é recusado', async () => {
    await withTenant(t.db, ctxSistema(A.org), (s) =>
      createAsset(s, {
        name: 'Legado 1042',
        customerId: A.cliente,
        assetCategoryId: A.categoria,
        externalSource: 'arkmeds',
        externalId: '1042',
      })
    );
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        createAsset(s, {
          name: 'Legado 1042 de novo',
          customerId: A.cliente,
          assetCategoryId: A.categoria,
          externalSource: 'arkmeds',
          externalId: '1042',
        })
      )
    ).rejects.toThrow(/assets_external_uq|duplicate|duplicad/i);
  });

  it('o mesmo identificador em OUTRA organização é aceito — a unicidade não é global', async () => {
    await expect(
      withTenant(t.db, ctxSistema(B.org), (s) =>
        createAsset(s, {
          name: 'Outro 1042',
          customerId: B.cliente,
          assetCategoryId: B.categoria,
          externalSource: 'arkmeds',
          externalId: '1042',
        })
      )
    ).resolves.toBeTruthy();
  });

  it('o mesmo identificador vindo de OUTRA origem é outro registro', async () => {
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        createAsset(s, {
          name: 'Omie 1042',
          customerId: A.cliente,
          assetCategoryId: A.categoria,
          externalSource: 'omie',
          externalId: '1042',
        })
      )
    ).resolves.toBeTruthy();
  });

  it('identificador sem origem é recusado pelo domínio, com o nome do campo', async () => {
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        createAsset(s, {
          name: 'Órfão',
          customerId: A.cliente,
          assetCategoryId: A.categoria,
          externalId: '7',
        })
      )
    ).rejects.toThrow(/origem e identificador juntos/);
  });

  it('o banco recusa o par incompleto mesmo por fora do domínio', async () => {
    // Como superusuário de propósito: a prova é da RESTRIÇÃO, que vale para
    // qualquer caminho de escrita, inclusive os que não passam pelo domínio.
    await expect(
      t.raw(`UPDATE aurora.customers SET external_id = 'x' WHERE id = $1`, [A.cliente])
    ).rejects.toThrow(/customers_external_pair/);
  });
});

describe('P0.4 — modo de uso e recursos habilitados', () => {
  it('contrato e domínio declaram as MESMAS listas', () => {
    expect([...ORGANIZATION_FEATURES]).toEqual([...FEATURES_DOMINIO]);
    expect([...ORGANIZATION_USAGE_MODES]).toEqual([...MODOS_DOMINIO]);
  });

  it('sem configuração, a organização é prestadora com TODOS os recursos', async () => {
    const r = await http.get('/v1/organizations/current').set(auth(A.email));
    expect(r.status).toBe(200);
    expect(r.body.usage_mode).toBe('service_provider');
    expect(r.body.features_customized).toBe(false);
    expect(r.body.enabled_features).toEqual([...ORGANIZATION_FEATURES]);
  });

  it('o administrador muda o modo e a lista; a resposta cabe no contrato', async () => {
    const r = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(A.email))
      .send({ usage_mode: 'hospital', enabled_features: ['work_orders', 'assets', 'portal'] });
    expect(r.status).toBe(200);
    expect(OrganizationConfiguration.parse(r.body)).toEqual({
      usage_mode: 'hospital',
      // ordem canônica, não a de quem enviou
      enabled_features: ['assets', 'work_orders', 'portal'],
      features_customized: true,
      // OS-16 (29/10/2026): a exigência do parecer nasce LIGADA (antes, PF-41, nascia desligada).
      require_operational_result: true,
    });
  });

  it('a mudança fica só na organização do contexto — a outra continua no padrão', async () => {
    const r = await http.get('/v1/organizations/current').set(auth(B.email));
    expect(r.body.usage_mode).toBe('service_provider');
    expect(r.body.features_customized).toBe(false);
  });

  it('não há como mirar outra organização pelo cabeçalho: o vínculo decide', async () => {
    const r = await http
      .patch('/v1/organizations/current/configuration')
      .set({ ...auth(B.email), 'x-aurora-organization': A.org })
      .send({ usage_mode: 'laboratory' });
    // B não tem vínculo com A: ou 403, ou a mudança cai na própria B. Nunca em A.
    const a = await t.raw(`SELECT usage_mode::text AS m FROM aurora.organizations WHERE id = $1`, [A.org]);
    expect(a[0]!.m).toBe('hospital');
    expect([200, 403]).toContain(r.status);
  });

  it('null volta ao padrão; lista vazia e recurso desconhecido são recusados', async () => {
    const vazio = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(A.email))
      .send({ enabled_features: [] });
    expect(vazio.status).toBe(422);

    const estranho = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(A.email))
      .send({ enabled_features: ['marketplace'] });
    expect(estranho.status).toBe(422);

    const reset = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(A.email))
      .send({ enabled_features: null });
    expect(reset.body.features_customized).toBe(false);
    // A organização A está no modo hospital (teste acima): o padrão DO MODO é tudo menos
    // orçamento (OS-03 · CLI-07, 29/10/2026). Antes o padrão era tudo, em qualquer modo.
    expect(reset.body.enabled_features).toEqual(ORGANIZATION_FEATURES.filter((f) => f !== 'quotes'));
  });

  it('o técnico não muda a configuração da organização (403 nomeando a permissão)', async () => {
    const r = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(tecnicoA.email))
      .send({ usage_mode: 'manufacturer' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('organization.update');
  });
});
