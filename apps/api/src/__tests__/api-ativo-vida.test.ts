/**
 * Aurora — a vida do equipamento (gap V2 P1.3 e P1.5 · critério 3 do PLAT §14).
 *
 *  · uma linha do tempo com ciclo de vida, transferência, OS, medição,
 *    documento e substituição — mais recente primeiro;
 *  · quem não lê OS/documento não os vê por esta porta;
 *  · substituição é relação entre dois ativos da mesma organização, com regras
 *    de forma; outra organização não aparece nem como sucessora.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import { ASSET_TIMELINE_KINDS as KINDS_DB } from '@aurora/db';
import { ASSET_TIMELINE_KINDS, AssetTimelineEvent } from '@aurora/contracts';
import { createTestDatabase, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  createAsset,
  createLocation,
  provisionStarterLocationTypes,
  transferAsset,
  createWorkOrder,
  transitionWorkOrder,
  provisionDocumentTypes,
  createDocument,
  transitionDocument,
  issueDocument,
} from '@aurora/db';
import { auth, criarOrganizacao, criarPessoa, ctxSistema, subirApi, type OrgDeTeste } from './apoio/cenario';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let A: OrgDeTeste;
let B: OrgDeTeste;
let semOs: { email: string; mem: string };
let antigo = '';
let novo = '';
let deB = '';

beforeAll(async () => {
  t = await createTestDatabase();
  A = await criarOrganizacao(t, 'vida-a');
  B = await criarOrganizacao(t, 'vida-b');
  semOs = await criarPessoa(t, A, 'consulta', 'auditor');
  // O auditor lê tudo; tiramos dele OS e documento para provar o recorte.
  for (const k of ['work_order.read', 'document.read']) {
    await t.raw(
      `INSERT INTO aurora.membership_permission_overrides (organization_id, membership_id, permission_key, effect, reason)
       VALUES ($1, $2, $3, 'deny', 'prova de recorte')`,
      [A.org, semOs.mem, k]
    );
  }

  await withTenant(t.db, ctxSistema(A.org), async (s) => {
    const tipos = await provisionStarterLocationTypes(s);
    const cc = await createLocation(s, {
      customerId: A.cliente,
      parentId: A.unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'Centro Cirúrgico',
    });
    antigo = await createAsset(s, {
      name: 'Ventilador 03',
      customerId: A.cliente,
      assetCategoryId: A.categoria,
      locationId: A.setor,
      acquiredAt: '2019-05-10',
    });
    novo = await createAsset(s, {
      name: 'Ventilador 07',
      customerId: A.cliente,
      assetCategoryId: A.categoria,
      locationId: A.setor,
    });
    await transferAsset(s, antigo, cc, 'remanejado para o centro cirúrgico');
    const os = await createWorkOrder(s, {
      customerId: A.cliente,
      workOrderTypeId: A.natureza,
      title: 'Corretiva — alarme',
      assetId: antigo,
    });
    await transitionWorkOrder(s, os.id, 'in_progress');
    // OS-16 (29/10/2026): OS de equipamento conclui com o parecer LIBERADO/PARADO.
    await transitionWorkOrder(s, os.id, 'completed', {
      resolution: 'Sensor de fluxo substituído e testado',
      operationalResult: 'released',
    });

    const tiposDoc = await provisionDocumentTypes(s);
    const d = await createDocument(s, {
      documentTypeId: tiposDoc.get('work_order_report')!,
      assetId: antigo,
      verdict: 'conforming',
      title: 'Relatório',
    });
    await transitionDocument(s, d, 'under_review');
    await issueDocument(s, d);
  });

  await withTenant(t.db, ctxSistema(B.org), async (s) => {
    deB = await createAsset(s, {
      name: 'Ventilador de B',
      customerId: B.cliente,
      assetCategoryId: B.categoria,
    });
  });

  ({ app, http } = await subirApi(t.db));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('substituição', () => {
  it('sucessor de outra organização é "não existe" (404)', async () => {
    const r = await http
      .post(`/v1/assets/${antigo}/decommission`)
      .set(auth(A.email))
      .send({ reason: 'fim da vida útil declarado pelo fabricante', replaced_by_asset_id: deB });
    expect(r.status).toBe(404);
  });

  it('um ativo não substitui a si mesmo', async () => {
    const r = await http
      .post(`/v1/assets/${antigo}/decommission`)
      .set(auth(A.email))
      .send({ reason: 'fim da vida útil declarado pelo fabricante', replaced_by_asset_id: antigo });
    expect(r.status).toBe(422);
  });

  it('descomissionar com sucessor registra a relação nos dois lados', async () => {
    const r = await http
      .post(`/v1/assets/${antigo}/decommission`)
      .set(auth(A.email))
      .send({ reason: 'fim da vida útil declarado pelo fabricante', replaced_by_asset_id: novo });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const velho = await http.get(`/v1/assets/${antigo}`).set(auth(A.email));
    expect(velho.body.replaced_by_asset_id ?? velho.body.asset?.replaced_by_asset_id).toBe(novo);
    const sucessor = await http.get(`/v1/assets/${novo}`).set(auth(A.email));
    expect(sucessor.body.replaces_asset_id ?? sucessor.body.asset?.replaces_asset_id).toBe(antigo);
  });

  it('o banco recusa sucessor em ativo que segue em operação', async () => {
    await expect(
      t.raw(`UPDATE aurora.assets SET replaced_by_asset_id = $2 WHERE id = $1`, [novo, antigo])
    ).rejects.toThrow(/assets_replacement_shape/);
  });
});

describe('linha do tempo', () => {
  it('contrato e camada de dados declaram os mesmos tipos de evento', () => {
    expect([...ASSET_TIMELINE_KINDS]).toEqual([...KINDS_DB]);
  });

  it('conta a vida inteira, mais recente primeiro, e cabe no contrato', async () => {
    const r = await http.get(`/v1/assets/${antigo}/timeline`).set(auth(A.email));
    expect(r.status).toBe(200);
    const itens = r.body.items.map((i: unknown) => AssetTimelineEvent.parse(i));
    const tipos = itens.map((i: AssetTimelineEvent) => i.kind);
    for (const k of [
      'registered',
      'acquired',
      'transferred',
      'work_order_opened',
      'work_order_completed',
      'document_issued',
      'decommissioned',
      'replaced',
    ]) {
      expect(tipos, k).toContain(k);
    }
    const datas = itens.map((i: AssetTimelineEvent) => i.at);
    expect(datas).toEqual([...datas].sort().reverse());
    expect(itens.find((i: AssetTimelineEvent) => i.kind === 'acquired')!.at).toBe('2019-05-10');
    expect(itens.find((i: AssetTimelineEvent) => i.kind === 'replaced')!.ref).toEqual({
      type: 'asset',
      id: novo,
    });
  });

  it('o sucessor mostra quem ele substituiu', async () => {
    const r = await http.get(`/v1/assets/${novo}/timeline`).set(auth(A.email));
    const subst = r.body.items.find((i: AssetTimelineEvent) => i.kind === 'replaces');
    expect(subst.ref).toEqual({ type: 'asset', id: antigo });
  });

  it('quem não lê OS nem documento não os vê por esta porta', async () => {
    const r = await http.get(`/v1/assets/${antigo}/timeline`).set(auth(semOs.email));
    expect(r.status).toBe(200);
    const tipos = r.body.items.map((i: AssetTimelineEvent) => i.kind);
    expect(tipos).toContain('transferred');
    expect(tipos.some((k: string) => k.startsWith('work_order') || k.startsWith('document'))).toBe(false);
  });

  it('não há valor financeiro em nenhum evento', async () => {
    const r = await http.get(`/v1/assets/${antigo}/timeline`).set(auth(A.email));
    expect(JSON.stringify(r.body)).not.toMatch(/purchase_value|residual_value|replacement_value|cost/);
  });

  it('outra organização recebe 404', async () => {
    const r = await http.get(`/v1/assets/${antigo}/timeline`).set(auth(B.email));
    expect(r.status).toBe(404);
  });
});
