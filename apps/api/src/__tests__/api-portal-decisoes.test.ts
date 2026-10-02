/**
 * Aurora — as escritas novas do portal (gap V2 P1.1 e P1.2): decidir sobre o
 * orçamento e avaliar o atendimento.
 *
 * O portal é a superfície mais exposta do produto. Cada caso aqui é uma
 * tentativa de usar a escrita para fora do recorte: orçamento de outro cliente
 * da mesma prestadora, de outra organização, já decidido, em rascunho;
 * avaliação de solicitação alheia, em andamento, repetida.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import { newId } from '@aurora/domain';
import { createTestDatabase, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  createCustomer,
  createQuote,
  addQuoteItem,
  transitionQuote,
  createCatalogItem,
  createServiceRequest,
} from '@aurora/db';
import { auth, criarOrganizacao, criarPessoa, ctxSistema, subirApi, type OrgDeTeste } from './apoio/cenario';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let A: OrgDeTeste;
let B: OrgDeTeste;
let cliente: { email: string };
let outroCliente: { email: string };
let semAprovar: { email: string; mem: string };
let orcamentoA = '';
let orcamentoA2 = '';
let rascunho = '';
let orcamentoDoOutro = '';
let orcamentoB = '';
let motivo = '';
let solicitacaoAtendida = '';
let solicitacaoEmAndamento = '';
let solicitacaoDoOutro = '';

async function orcamentoEnviado(org: OrgDeTeste, customerId: string, enviar = true): Promise<string> {
  return withTenant(t.db, ctxSistema(org.org), async (s) => {
    const contato = newId();
    await s.query(
      `INSERT INTO aurora.customer_contacts (id, organization_id, customer_id, name, email)
       VALUES ($1, $2, $3, 'Contato', $4)`,
      [contato, org.org, customerId, `c-${contato.slice(-6)}@x.test`]
    );
    const q = await createQuote(s, { customerId, approverContactId: contato, validUntil: '2030-12-31' });
    await addQuoteItem(s, {
      quoteId: q,
      kind: 'service',
      description: 'Troca de válvula',
      quantity: 1,
      unitPriceCents: 50000,
    });
    if (enviar) await transitionQuote(s, q, 'sent');
    return q;
  });
}

beforeAll(async () => {
  t = await createTestDatabase();
  A = await criarOrganizacao(t, 'portal-dec-a');
  B = await criarOrganizacao(t, 'portal-dec-b');
  const outro = await withTenant(t.db, ctxSistema(A.org), (s) =>
    createCustomer(s, { name: 'Outro hospital', isInternal: false })
  );
  cliente = await criarPessoa(t, A, 'gestor-cliente', 'customer_manager', {
    seatType: 'portal',
    customerIds: [A.cliente],
  });
  outroCliente = await criarPessoa(t, A, 'gestor-outro', 'customer_manager', {
    seatType: 'portal',
    customerIds: [outro],
  });
  semAprovar = await criarPessoa(t, A, 'sem-aprovar', 'customer_manager', {
    seatType: 'portal',
    customerIds: [A.cliente],
  });
  await t.raw(
    `INSERT INTO aurora.membership_permission_overrides (organization_id, membership_id, permission_key, effect, reason)
     VALUES ($1, $2, 'quote.approve', 'deny', 'só acompanha')`,
    [A.org, semAprovar.mem]
  );

  orcamentoA = await orcamentoEnviado(A, A.cliente);
  orcamentoA2 = await orcamentoEnviado(A, A.cliente);
  rascunho = await orcamentoEnviado(A, A.cliente, false);
  orcamentoDoOutro = await orcamentoEnviado(A, outro);
  orcamentoB = await orcamentoEnviado(B, B.cliente);

  await withTenant(t.db, ctxSistema(A.org), async (s) => {
    motivo = await createCatalogItem(s, { catalogKey: 'rejection_reason', key: 'preco', label: 'Preço' });
    const quem = { requesterName: 'Enfermagem UTI', requesterEmail: 'uti@hospital.test' };
    solicitacaoAtendida = (
      await createServiceRequest(s, { customerId: A.cliente, summary: 'Monitor sem imagem', ...quem })
    ).id;
    solicitacaoEmAndamento = (
      await createServiceRequest(s, { customerId: A.cliente, summary: 'Bomba alarmando', ...quem })
    ).id;
    solicitacaoDoOutro = (await createServiceRequest(s, { customerId: outro, summary: 'Alheia', ...quem }))
      .id;
  });
  for (const id of [solicitacaoAtendida, solicitacaoDoOutro]) {
    await t.raw(`UPDATE aurora.service_requests SET status = 'fulfilled' WHERE id = $1`, [id]);
  }

  ({ app, http } = await subirApi(t.db));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('decisão sobre orçamento', () => {
  it('o cliente aprova o seu orçamento, com evidência de aceite', async () => {
    const r = await http
      .post(`/v1/portal/quotes/${orcamentoA}/decision`)
      .set({ ...auth(cliente.email), 'user-agent': 'navegador-do-hospital' })
      .send({ decision: 'approve', note: 'De acordo com a proposta' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ status: 'approved' });

    const [q] = await t.raw(
      `SELECT status::text AS status, accepted_user_agent, acceptance_note, updated_by FROM aurora.quotes WHERE id = $1`,
      [orcamentoA]
    );
    expect(q).toMatchObject({
      status: 'approved',
      accepted_user_agent: 'navegador-do-hospital',
      acceptance_note: 'De acordo com a proposta',
    });
    expect(q!.updated_by).not.toBeNull();
  });

  it('decidir de novo o mesmo orçamento é 409 — não aguarda mais decisão', async () => {
    const r = await http
      .post(`/v1/portal/quotes/${orcamentoA}/decision`)
      .set(auth(cliente.email))
      .send({ decision: 'reject', rejection_reason_id: motivo });
    expect(r.status).toBe(409);
  });

  it('recusar exige motivo do catálogo', async () => {
    const sem = await http
      .post(`/v1/portal/quotes/${orcamentoA2}/decision`)
      .set(auth(cliente.email))
      .send({ decision: 'reject' });
    expect(sem.status).toBe(422);
    const inventado = await http
      .post(`/v1/portal/quotes/${orcamentoA2}/decision`)
      .set(auth(cliente.email))
      .send({ decision: 'reject', rejection_reason_id: newId() });
    expect(inventado.status).toBe(422);

    const motivos = await http.get('/v1/portal/quotes/rejection-reasons').set(auth(cliente.email));
    expect(motivos.body.items).toEqual([{ id: motivo, label: 'Preço' }]);

    const ok = await http
      .post(`/v1/portal/quotes/${orcamentoA2}/decision`)
      .set(auth(cliente.email))
      .send({ decision: 'reject', rejection_reason_id: motivo, note: 'acima do orçado para o trimestre' });
    expect(ok.body).toEqual({ status: 'rejected' });
  });

  it('rascunho nunca chegou ao cliente: 404', async () => {
    const r = await http
      .post(`/v1/portal/quotes/${rascunho}/decision`)
      .set(auth(cliente.email))
      .send({ decision: 'approve' });
    expect(r.status).toBe(404);
  });

  it('orçamento de OUTRO cliente da mesma prestadora: 404', async () => {
    const r = await http
      .post(`/v1/portal/quotes/${orcamentoDoOutro}/decision`)
      .set(auth(cliente.email))
      .send({ decision: 'approve' });
    expect(r.status).toBe(404);
    const [q] = await t.raw(`SELECT status::text AS s FROM aurora.quotes WHERE id = $1`, [orcamentoDoOutro]);
    expect(q!.s).toBe('sent');
  });

  it('orçamento de OUTRA organização: 404', async () => {
    const r = await http
      .post(`/v1/portal/quotes/${orcamentoB}/decision`)
      .set(auth(cliente.email))
      .send({ decision: 'approve' });
    expect(r.status).toBe(404);
  });

  it('vínculo sem quote.approve não decide (403 nomeando a permissão)', async () => {
    const r = await http
      .post(`/v1/portal/quotes/${orcamentoDoOutro}/decision`)
      .set(auth(semAprovar.email))
      .send({ decision: 'approve' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('quote.approve');
  });
});

describe('avaliação do atendimento', () => {
  it('em andamento não se avalia', async () => {
    const r = await http
      .post(`/v1/portal/requests/${solicitacaoEmAndamento}/rating`)
      .set(auth(cliente.email))
      .send({ rating: 5 });
    expect(r.status).toBe(409);
  });

  it('atendida, avalia-se uma vez — e a nota fica gravada como veio', async () => {
    const r = await http
      .post(`/v1/portal/requests/${solicitacaoAtendida}/rating`)
      .set(auth(cliente.email))
      .send({ rating: 4, comment: 'Rápido, mas faltou avisar o horário' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [sr] = await t.raw(`SELECT rating, rating_comment FROM aurora.service_requests WHERE id = $1`, [
      solicitacaoAtendida,
    ]);
    expect(sr).toEqual({ rating: 4, rating_comment: 'Rápido, mas faltou avisar o horário' });

    const deNovo = await http
      .post(`/v1/portal/requests/${solicitacaoAtendida}/rating`)
      .set(auth(cliente.email))
      .send({ rating: 5 });
    expect(deNovo.status).toBe(409);
  });

  it('fora da escala é recusado', async () => {
    const r = await http
      .post(`/v1/portal/requests/${solicitacaoAtendida}/rating`)
      .set(auth(cliente.email))
      .send({ rating: 10 });
    expect(r.status).toBe(422);
  });

  it('solicitação de outro cliente: 404, e nada é gravado', async () => {
    const r = await http
      .post(`/v1/portal/requests/${solicitacaoDoOutro}/rating`)
      .set(auth(cliente.email))
      .send({ rating: 1 });
    expect(r.status).toBe(404);
    const [sr] = await t.raw(`SELECT rating FROM aurora.service_requests WHERE id = $1`, [
      solicitacaoDoOutro,
    ]);
    expect(sr!.rating).toBeNull();
  });

  it('outra organização: 404', async () => {
    const r = await http
      .post(`/v1/portal/requests/${solicitacaoAtendida}/rating`)
      .set(auth(B.email))
      .send({ rating: 1 });
    expect([403, 404]).toContain(r.status);
  });
});

describe('as respostas novas do portal não carregam nada além do necessário', () => {
  /*
   * Lista de PERMISSÃO, mais estrita que a varredura PORTAL-011: estas rotas
   * nasceram agora, e o jeito de elas nunca vazarem custo, margem ou nota
   * interna é só poderem devolver as chaves que a tela usa.
   */
  it('motivos de recusa: só id e rótulo', async () => {
    const r = await http.get('/v1/portal/quotes/rejection-reasons').set(auth(cliente.email));
    expect(r.body.items.length).toBeGreaterThan(0);
    for (const item of r.body.items) expect(Object.keys(item).sort()).toEqual(['id', 'label']);
  });

  it('a lista de chamados ganhou só a nota do próprio cliente', async () => {
    const r = await http.get('/v1/portal/requests').set(auth(cliente.email));
    const avaliado = r.body.items.find((i: { id: string }) => i.id === solicitacaoAtendida);
    expect(avaliado.rating).toBe(4);
    expect(Object.keys(avaliado)).not.toContain('rating_comment');
  });
});
