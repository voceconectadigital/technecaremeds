/**
 * Aurora — orçamentos pela HTTP (SPEC v0.2 §16 · EPIC-016).
 *
 * O que a borda tem de provar: que a permissão exigida sai do grafo, e não de
 * um decorador fixo — quem pode editar não necessariamente pode aprovar, e é
 * essa separação que impede o vendedor de aprovar a própria proposta.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext, toCents } from '@aurora/domain';
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
  provisionWorkOrderStates,
  createCustomer,
  createLocation,
  createCatalogItem,
  createAssetCategory,
  createAsset,
  createItem,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const FIN_USER = newId(),
  FIN_MEM = newId();
const COORD_USER = newId(),
  COORD_MEM = newId();
const EMAIL_FIN = 'fin@qt.test';
// O coordenador LÊ orçamento e não envia. É o caso que prova que a permissão
// sai do grafo: se ela viesse de um decorador fixo na rota de transição, ou ele
// poderia tudo, ou não poderia nem abrir a proposta.
const EMAIL_COORD = 'coord@qt.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let cliente: string, contato: string, item: string, motivoRecusa: string;

const dia = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: FIN_USER, membershipId: FIN_MEM },
    { slug: 'qtapi', name: 'Prestadora', email: EMAIL_FIN, userName: 'Financeiro' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: COORD_USER, membershipId: COORD_MEM },
    { email: EMAIL_COORD, userName: 'Coordenadora' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, FIN_MEM, roles.get('finance')!);
    await assignRole(s, COORD_MEM, roles.get('coordinator')!);

    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });

    contato = newId();
    await s.query(
      `INSERT INTO aurora.customer_contacts (id, organization_id, customer_id, name, email)
       VALUES ($1, $2, $3, 'Compras', 'compras@h.test')`,
      [contato, ORG, cliente]
    );

    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: unidade,
    });
    await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    motivoRecusa = await createCatalogItem(s, {
      catalogKey: 'rejection_reason',
      key: 'preco',
      label: 'Preço',
    });
    item = await createItem(s, { sku: 'FLT-1', name: 'Filtro' });
    await s.query(`UPDATE aurora.inventory_items SET list_price_cents = 12000 WHERE id = $1`, [item]);
  });

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

let orcamento: string;

describe('montagem', () => {
  it('cria em rascunho', async () => {
    const r = await http
      .post('/v1/quotes')
      .set(auth(EMAIL_FIN))
      .send({ customerId: cliente, approverContactId: contato, validUntil: dia(30) })
      .expect(201);
    orcamento = r.body.id;
  });

  it('a data de validade fora do formato é recusada', async () => {
    await http
      .post('/v1/quotes')
      .set(auth(EMAIL_FIN))
      .send({ customerId: cliente, validUntil: '30/12/2025' })
      .expect(422);
  });

  it('a rota de preço mostra o que a cascata daria, antes de a linha existir', async () => {
    const r = await http
      .get(`/v1/quotes/price?itemId=${item}&customerId=${cliente}`)
      .set(auth(EMAIL_FIN))
      .expect(200);
    expect(r.body.price).toEqual({ cents: 12000, source: 'catalog' });
  });

  it('a rota de preço não colide com a rota de detalhe', async () => {
    const r = await http.get(`/v1/quotes/${orcamento}`).set(auth(EMAIL_FIN)).expect(200);
    expect(r.body.quote.id).toBe(orcamento);
    expect(r.body.effective_status).toBe('draft');
  });

  it('a borda recebe reais e o miolo guarda centavos', async () => {
    await http
      .post(`/v1/quotes/${orcamento}/items`)
      .set(auth(EMAIL_FIN))
      .send({ kind: 'service', description: 'Mão de obra', quantity: 2, unitPrice: 189.9 })
      .expect(201);

    const r = await http.get(`/v1/quotes/${orcamento}`).set(auth(EMAIL_FIN)).expect(200);
    expect(Number(r.body.quote.total_cents)).toBe(toCents(189.9) * 2);
  });

  it('quantidade não positiva é recusada', async () => {
    await http
      .post(`/v1/quotes/${orcamento}/items`)
      .set(auth(EMAIL_FIN))
      .send({ kind: 'service', description: 'x', quantity: 0, unitPrice: 10 })
      .expect(422);
  });

  it('as transições possíveis vêm junto do detalhe', async () => {
    const r = await http.get(`/v1/quotes/${orcamento}`).set(auth(EMAIL_FIN)).expect(200);
    expect(r.body.transitions.map((x: { to: string }) => x.to).sort()).toEqual(['cancelled', 'sent']);
  });
});

describe('permissão vem do grafo, não do decorador', () => {
  it('quem só lê a proposta não a envia, e a mensagem nomeia a permissão', async () => {
    const r = await http
      .post(`/v1/quotes/${orcamento}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'sent' })
      .expect(403);
    expect(r.body.message).toMatch(/quote\.send/);
  });

  it('quem envia é o financeiro', async () => {
    await http
      .post(`/v1/quotes/${orcamento}/transitions`)
      .set(auth(EMAIL_FIN))
      .send({ to: 'sent' })
      .expect(201);

    const r = await http.get(`/v1/quotes/${orcamento}`).set(auth(EMAIL_FIN)).expect(200);
    expect(r.body.quote.status).toBe('sent');
  });

  it('destino desconhecido é recusado listando os válidos', async () => {
    const r = await http
      .post(`/v1/quotes/${orcamento}/transitions`)
      .set(auth(EMAIL_FIN))
      .send({ to: 'aprovadissimo' })
      .expect(422);
    expect(r.body.message).toMatch(/approved/);
  });

  it('recusar sem motivo é barrado', async () => {
    const r = await http
      .post(`/v1/quotes/${orcamento}/transitions`)
      .set(auth(EMAIL_FIN))
      .send({ to: 'rejected' })
      .expect(422);
    expect(r.body.message).toMatch(/análise de perda/);
  });

  it('a evidência do aceite usa o endereço do soquete, não um cabeçalho', async () => {
    await http
      .post(`/v1/quotes/${orcamento}/transitions`)
      .set(auth(EMAIL_FIN))
      .set('x-forwarded-for', '10.0.0.1')
      .send({ to: 'approved', acceptanceNote: 'aprovado em reunião' })
      .expect(201);

    const [q] = await withTenant(
      t.db,
      buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'check' }),
      (s) =>
        s.query<{ accepted_ip: string | null }>(`SELECT accepted_ip FROM aurora.quotes WHERE id = $1`, [
          orcamento,
        ])
    );
    expect(q!.accepted_ip).not.toBe('10.0.0.1');
  });
});

describe('revisão', () => {
  it('cria a versão seguinte e lista o histórico', async () => {
    const nova = await http.post(`/v1/quotes/${orcamento}/revisions`).set(auth(EMAIL_FIN)).expect(201);

    const r = await http.get(`/v1/quotes/${nova.body.id}/versions`).set(auth(EMAIL_FIN)).expect(200);
    expect(r.body.items.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    const antiga = await http.get(`/v1/quotes/${orcamento}`).set(auth(EMAIL_FIN)).expect(200);
    expect(antiga.body.quote.status).toBe('superseded');
    expect(antiga.body.transitions).toEqual([]);
  });
});

describe('recusa registrada', () => {
  it('grava o motivo do catálogo', async () => {
    const q = await http
      .post('/v1/quotes')
      .set(auth(EMAIL_FIN))
      .send({ customerId: cliente, approverContactId: contato, validUntil: dia(10) })
      .expect(201);

    await http
      .post(`/v1/quotes/${q.body.id}/items`)
      .set(auth(EMAIL_FIN))
      .send({ kind: 'part', itemId: item, quantity: 1 })
      .expect(201);

    await http
      .post(`/v1/quotes/${q.body.id}/transitions`)
      .set(auth(EMAIL_FIN))
      .send({ to: 'sent' })
      .expect(201);

    await http
      .post(`/v1/quotes/${q.body.id}/transitions`)
      .set(auth(EMAIL_FIN))
      .send({ to: 'rejected', rejectionReasonId: motivoRecusa, note: 'preço acima do orçado' })
      .expect(201);

    const r = await http.get(`/v1/quotes/${q.body.id}`).set(auth(EMAIL_FIN)).expect(200);
    expect(r.body.quote.status).toBe('rejected');
  });
});

describe('a resposta e o contrato', () => {
  it('a lista e o detalhe satisfazem o contrato', async () => {
    const { quotesList, quoteDetail } = await import('@aurora/contracts');

    const lista = await http.get('/v1/quotes').set(auth(EMAIL_COORD));
    const conferidaLista = quotesList.response.safeParse(lista.body);
    if (!conferidaLista.success) {
      throw new Error(
        'lista de orçamentos:\n' +
          conferidaLista.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n')
      );
    }

    const primeiro = lista.body.items[0];
    if (!primeiro) return;
    const detalhe = await http.get(`/v1/quotes/${primeiro.id}`).set(auth(EMAIL_COORD));
    const conferido = quoteDetail.response.safeParse(detalhe.body);
    if (!conferido.success) {
      throw new Error(
        'detalhe do orçamento:\n' +
          conferido.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n')
      );
    }
  });
});
