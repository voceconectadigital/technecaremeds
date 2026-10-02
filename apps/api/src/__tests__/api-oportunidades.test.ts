/**
 * Aurora — oportunidade, o núcleo (0057 · gap V2 P1.7).
 *
 *  · registrar a necessidade com origem, ativo, prazo, prioridade, fornecedor;
 *  · o técnico registra, mas não autoriza — a permissão sai da aresta;
 *  · recusar e cancelar exigem motivo; converter exige orçamento do cliente;
 *  · a trilha é escrita só pelo banco; a aplicação não forja autorização;
 *  · outra organização não vê nada; o portal não tem acesso.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import {
  newId,
  OPPORTUNITY_STATUSES as DOMINIO,
  OPPORTUNITY_ORIGINS as ORIGENS_DOMINIO,
} from '@aurora/domain';
import { OPPORTUNITY_STATUSES, OPPORTUNITY_ORIGINS, OpportunityRow } from '@aurora/contracts';
import { createTestDatabase, type TestDatabase } from '@aurora/db/testing/harness';
import { withTenant, createAsset, createCustomer, createQuote } from '@aurora/db';
import { auth, criarOrganizacao, criarPessoa, ctxSistema, subirApi, type OrgDeTeste } from './apoio/cenario';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let A: OrgDeTeste;
let B: OrgDeTeste;
let tecnico: { email: string };
let financeiro: { email: string; mem: string };
let portal: { email: string };
let ativo = '';
let ativoDeOutroCliente = '';
let orcamento = '';
let orcamentoDeOutroCliente = '';

beforeAll(async () => {
  t = await createTestDatabase();
  A = await criarOrganizacao(t, 'opp-a');
  B = await criarOrganizacao(t, 'opp-b');
  tecnico = await criarPessoa(t, A, 'tecnico', 'technician');
  financeiro = await criarPessoa(t, A, 'financeiro', 'finance');
  portal = await criarPessoa(t, A, 'cliente', 'customer_manager', {
    seatType: 'portal',
    customerIds: [A.cliente],
  });

  await withTenant(t.db, ctxSistema(A.org), async (s) => {
    const outro = await createCustomer(s, { name: 'Outro hospital', isInternal: false });
    ativo = await createAsset(s, {
      name: 'Autoclave 02',
      customerId: A.cliente,
      assetCategoryId: A.categoria,
    });
    ativoDeOutroCliente = await createAsset(s, {
      name: 'Alheio',
      customerId: outro,
      assetCategoryId: A.categoria,
    });
    orcamento = await createQuote(s, { customerId: A.cliente, validUntil: '2030-12-31' });
    orcamentoDeOutroCliente = await createQuote(s, { customerId: outro, validUntil: '2030-12-31' });
  });

  ({ app, http } = await subirApi(t.db));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

let opp = '';

describe('registro', () => {
  it('contrato e domínio declaram as mesmas listas', () => {
    expect([...OPPORTUNITY_STATUSES]).toEqual([...DOMINIO]);
    expect([...OPPORTUNITY_ORIGINS]).toEqual([...ORIGENS_DOMINIO]);
  });

  it('o técnico registra a necessidade que viu no equipamento', async () => {
    const r = await http.post('/v1/opportunities').set(auth(tecnico.email)).send({
      customer_id: A.cliente,
      origin: 'inspection',
      title: 'Autoclave sem peça de reposição',
      need: 'Fabricante descontinuou a placa; substituição do equipamento em 6 meses',
      priority: 'urgent',
      due_on: '2027-03-31',
      asset_id: ativo,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    opp = r.body.id;

    const d = await http.get(`/v1/opportunities/${opp}`).set(auth(tecnico.email));
    expect(OpportunityRow.parse(d.body.opportunity)).toMatchObject({
      status: 'identified',
      origin: 'inspection',
      asset_name: 'Autoclave 02',
      due_on: '2027-03-31',
    });
    expect(d.body.history).toHaveLength(1);
  });

  it('ativo de OUTRO cliente na oportunidade deste é recusado', async () => {
    const r = await http.post('/v1/opportunities').set(auth(tecnico.email)).send({
      customer_id: A.cliente,
      origin: 'other',
      title: 'Misturada',
      need: 'equipamento alheio',
      asset_id: ativoDeOutroCliente,
    });
    expect(r.status).toBe(422);
  });

  it('origem "OS" sem a OS é recusada pelo banco', async () => {
    const r = await http.post('/v1/opportunities').set(auth(tecnico.email)).send({
      customer_id: A.cliente,
      origin: 'work_order',
      title: 'Sem OS',
      need: 'veio de uma OS que não disse qual',
    });
    expect(r.status).toBe(422);
  });
});

describe('o grafo e a permissão de cada aresta', () => {
  it('o técnico não qualifica nem autoriza (403 nomeando a permissão)', async () => {
    const r = await http
      .post(`/v1/opportunities/${opp}/transitions`)
      .set(auth(tecnico.email))
      .send({ to: 'qualified' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('opportunity.update');
  });

  it('pular etapa é recusado: identificada não vai direto para autorizada', async () => {
    const r = await http
      .post(`/v1/opportunities/${opp}/transitions`)
      .set(auth(A.email))
      .send({ to: 'authorized' });
    expect(r.status).toBe(409);
  });

  it('qualificar e autorizar, com carimbo de quem autorizou e a nota na trilha', async () => {
    expect(
      (await http.post(`/v1/opportunities/${opp}/transitions`).set(auth(A.email)).send({ to: 'qualified' }))
        .status
    ).toBe(200);
    const r = await http
      .post(`/v1/opportunities/${opp}/transitions`)
      .set(auth(financeiro.email))
      .send({ to: 'authorized', note: 'cliente pediu proposta de substituição' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('authorized');

    const [linha] = await t.raw(`SELECT authorized_by FROM aurora.opportunities WHERE id = $1`, [opp]);
    expect(linha!.authorized_by).toBe(financeiro.mem);
    const d = await http.get(`/v1/opportunities/${opp}`).set(auth(A.email));
    expect(d.body.history.map((h: { to_status: string }) => h.to_status)).toEqual([
      'identified',
      'qualified',
      'authorized',
    ]);
    expect(d.body.history[2].note).toBe('cliente pediu proposta de substituição');
  });

  it('converter exige orçamento, e do mesmo cliente', async () => {
    const sem = await http
      .post(`/v1/opportunities/${opp}/transitions`)
      .set(auth(A.email))
      .send({ to: 'converted' });
    expect(sem.status).toBe(422);
    const alheio = await http
      .post(`/v1/opportunities/${opp}/transitions`)
      .set(auth(A.email))
      .send({ to: 'converted', quote_id: orcamentoDeOutroCliente });
    expect(alheio.status).toBe(422);
    const ok = await http
      .post(`/v1/opportunities/${opp}/transitions`)
      .set(auth(A.email))
      .send({ to: 'converted', quote_id: orcamento });
    expect(ok.body).toMatchObject({ status: 'converted', quote_id: orcamento });
  });

  it('encerrada não se edita', async () => {
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        s.query(`UPDATE aurora.opportunities SET need = 'reescrita depois' WHERE id = $1`, [opp])
      )
    ).rejects.toThrow(/encerrada não se edita/);
  });

  it('recusar exige motivo', async () => {
    const r = await http.post('/v1/opportunities').set(auth(tecnico.email)).send({
      customer_id: A.cliente,
      origin: 'customer_request',
      title: 'Pedido do cliente',
      need: 'monitor extra para a UTI',
    });
    await http
      .post(`/v1/opportunities/${r.body.id}/transitions`)
      .set(auth(A.email))
      .send({ to: 'qualified' });
    const sem = await http
      .post(`/v1/opportunities/${r.body.id}/transitions`)
      .set(auth(financeiro.email))
      .send({ to: 'declined' });
    expect(sem.status).toBe(422);
    const com = await http
      .post(`/v1/opportunities/${r.body.id}/transitions`)
      .set(auth(financeiro.email))
      .send({ to: 'declined', reason: 'fora do orçamento anual do cliente' });
    expect(com.body).toMatchObject({
      status: 'declined',
      closed_reason: 'fora do orçamento anual do cliente',
    });
  });
});

describe('a trilha não se forja', () => {
  it('a aplicação não insere no histórico', async () => {
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        s.query(
          `INSERT INTO aurora.opportunity_status_history (id, organization_id, opportunity_id, to_status)
           VALUES ($1, $2, $3, 'authorized')`,
          [newId(), A.org, opp]
        )
      )
    ).rejects.toThrow(/permission denied|permissão negada/i);
  });

  it('a aplicação não apaga oportunidade', async () => {
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        s.query(`DELETE FROM aurora.opportunities WHERE id = $1`, [opp])
      )
    ).rejects.toThrow(/permission denied|permissão negada/i);
  });
});

describe('isolamento', () => {
  it('outra organização: lista vazia e 404 no detalhe e na transição', async () => {
    const l = await http.get('/v1/opportunities').set(auth(B.email));
    expect(l.body.items).toEqual([]);
    expect((await http.get(`/v1/opportunities/${opp}`).set(auth(B.email))).status).toBe(404);
    expect(
      (
        await http
          .post(`/v1/opportunities/${opp}/transitions`)
          .set(auth(B.email))
          .send({ to: 'cancelled', reason: 'tentativa alheia' })
      ).status
    ).toBe(404);
  });

  it('cliente de outra organização não é aceito como cliente da oportunidade', async () => {
    const r = await http
      .post('/v1/opportunities')
      .set(auth(A.email))
      .send({ customer_id: B.cliente, origin: 'other', title: 'Cruzada', need: 'cliente de outro tenant' });
    expect(r.status).toBe(404);
  });

  it('o portal do cliente não tem acesso a oportunidades (403)', async () => {
    const r = await http.get('/v1/opportunities').set(auth(portal.email));
    expect(r.status).toBe(403);
  });
});
