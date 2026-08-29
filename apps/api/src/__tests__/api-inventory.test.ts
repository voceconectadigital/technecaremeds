/**
 * Aurora — estoque pela HTTP (SPEC v0.2 §15 · EPIC-015).
 *
 * O QUE ESTE ARQUIVO PROVA É QUE O RAZÃO NÃO MENTE.
 *
 * Saldo é o resultado de uma sequência de movimentos, e a tentação em todo
 * sistema de estoque é "corrigir" o saldo direto quando ele não bate. Aqui não
 * há como: só existem operações com significado, o ajuste exige motivo, e o
 * estorno grava um movimento contrário em vez de apagar.
 *
 * O caso do estorno é o que mais importa. Apagar o movimento deixaria o saldo
 * certo e a história errada — e quem conferisse o extrato três meses depois
 * veria uma peça que apareceu e sumiu sem explicação.
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
  createWarehouse,
  createItem,
  recordMovement,
  setMinimum,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const GESTOR_USER = newId(),
  GESTOR_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();

const EMAIL_GESTOR = 'gestor@estoque.test';
const EMAIL_TEC = 'tecnico@estoque.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let central: string, base: string;
let valvula: string, filtro: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: GESTOR_USER, membershipId: GESTOR_MEM },
    { slug: 'estoque', name: 'Rede Estoque', email: EMAIL_GESTOR, userName: 'Gestora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, GESTOR_MEM, papeis.get('storekeeper')!);
    await assignRole(s, TEC_MEM, papeis.get('technician')!);

    central = await createWarehouse(s, { name: 'Depósito Central' });
    base = await createWarehouse(s, { name: 'Base UTI' });

    valvula = await createItem(s, { sku: 'VAL-001', name: 'Válvula de exalação', unit: 'un' });
    filtro = await createItem(s, { sku: 'FIL-002', name: 'Filtro HEPA', unit: 'un' });

    // Saldo inicial por RECEBIMENTO — não por escrita direta na tabela de
    // saldos. Semear o saldo por fora produziria um estado que a aplicação não
    // sabe criar, e o teste provaria um mundo que não existe.
    await recordMovement(s, {
      itemId: valvula,
      warehouseId: central,
      kind: 'receipt',
      qty: 20,
      unitCost: 150,
    });
    await recordMovement(s, {
      itemId: filtro,
      warehouseId: central,
      kind: 'receipt',
      qty: 3,
      unitCost: 90,
    });
    // O filtro tem mínimo 10 e só 3 em mãos: é o que a aba "abaixo do mínimo"
    // existe para mostrar.
    await setMinimum(s, filtro, central, 10);
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

/* -------------------------------------------------------------------------- */

describe('saldos', () => {
  it('devolve em mãos, reservado e disponível — os três, e a diferença importa', async () => {
    const r = await http.get('/v1/inventory/balances').set(auth(EMAIL_GESTOR));
    expect(r.status).toBe(200);

    const v = r.body.items.find((b: { sku: string }) => b.sku === 'VAL-001');
    // Comparação por VALOR, e não por formato: a coluna é `numeric` com escala
    // 4, e devolve "20.0000". O formato é do banco; o que o teste afirma é a
    // quantidade.
    expect(Number(v.on_hand)).toBe(20);
    expect(Number(v.reserved)).toBe(0);
    expect(Number(v.available)).toBe(20);
  });

  it('below_minimum devolve SÓ o que está abaixo — é a pergunta de quem compra', async () => {
    // Na referência auditada isto era um relatório, e relatório é pergunta que
    // só é feita por quem lembra de fazê-la.
    const r = await http.get('/v1/inventory/balances?below_minimum=true').set(auth(EMAIL_GESTOR));
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0].sku).toBe('FIL-002');

    // E o item SEM mínimo definido não aparece: mínimo zero significa "não
    // vigiado", e não "mínimo é zero".
    const skus = r.body.items.map((b: { sku: string }) => b.sku);
    expect(skus).not.toContain('VAL-001');
  });

  it('os saldos satisfazem o contrato', async () => {
    const { inventoryBalances } = await import('@aurora/contracts');
    const r = await http.get('/v1/inventory/balances').set(auth(EMAIL_GESTOR));
    const conferido = inventoryBalances.response.safeParse(r.body);
    if (!conferido.success) {
      throw new Error(
        conferido.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
      );
    }
  });

  it('quantidade e custo viajam como TEXTO, e não como número', async () => {
    /*
     * A coluna é `numeric`, e `numeric` existe porque ponto flutuante erra em
     * dinheiro e em quantidade fracionada. Se a resposta trouxesse `number`, a
     * decisão do banco teria sido desfeita na fronteira — em silêncio, e o
     * erro apareceria meses depois, no fechamento.
     */
    const r = await http.get('/v1/inventory/balances').set(auth(EMAIL_GESTOR));
    const v = r.body.items.find((b: { sku: string }) => b.sku === 'VAL-001');
    expect(typeof v.on_hand).toBe('string');
    expect(typeof v.average_cost).toBe('string');
  });
});

describe('ajuste', () => {
  it('exige motivo, e a mensagem diz por quê', async () => {
    const r = await http
      .post('/v1/inventory/adjustments')
      .set(auth(EMAIL_GESTOR))
      .send({ item_id: valvula, warehouse_id: central, qty: -2, reason: 'oi' });
    expect(r.status).toBe(422);
    expect(r.body.message).toContain('motivo');
  });

  it('recusa ajuste de zero: não há o que ajustar', async () => {
    const r = await http
      .post('/v1/inventory/adjustments')
      .set(auth(EMAIL_GESTOR))
      .send({ item_id: valvula, warehouse_id: central, qty: 0, reason: 'contagem bateu' });
    expect(r.status).toBe(422);
  });

  it('o ajuste negativo muda o saldo e deixa rastro no razão', async () => {
    await http
      .post('/v1/inventory/adjustments')
      .set(auth(EMAIL_GESTOR))
      .send({
        item_id: valvula,
        warehouse_id: central,
        qty: -2,
        reason: 'duas unidades danificadas no transporte, descartadas',
      })
      .expect(201);

    const saldos = await http.get('/v1/inventory/balances').set(auth(EMAIL_GESTOR));
    const v = saldos.body.items.find((b: { sku: string }) => b.sku === 'VAL-001');
    expect(Number(v.on_hand)).toBe(18);

    const extrato = await http
      .get(`/v1/inventory/ledger?item=${valvula}&warehouse=${central}`)
      .set(auth(EMAIL_GESTOR));
    expect(extrato.status).toBe(200);
    const ajuste = extrato.body.items.find((m: { kind: string }) => m.kind === 'adjustment');
    expect(ajuste.reason).toContain('danificadas');
  });

  it('quem não ajusta estoque é recusado com 403', async () => {
    const r = await http
      .post('/v1/inventory/adjustments')
      .set(auth(EMAIL_TEC))
      .send({ item_id: valvula, warehouse_id: central, qty: -1, reason: 'motivo suficiente' });
    expect(r.status).toBe(403);
  });
});

describe('transferência', () => {
  it('sai de um almoxarifado e entra no outro, e o total se conserva', async () => {
    const antes = await http.get('/v1/inventory/balances').set(auth(EMAIL_GESTOR));
    const totalAntes = antes.body.items
      .filter((b: { sku: string }) => b.sku === 'VAL-001')
      .reduce((acc: number, b: { on_hand: string }) => acc + Number(b.on_hand), 0);

    const r = await http
      .post('/v1/inventory/transfers')
      .set(auth(EMAIL_GESTOR))
      .send({
        item_id: valvula,
        from_warehouse_id: central,
        to_warehouse_id: base,
        qty: 5,
        reason: 'reposição da base',
      });
    expect(r.status).toBe(201);
    expect(r.body.out_id).toBeTruthy();
    expect(r.body.in_id).toBeTruthy();

    const depois = await http.get('/v1/inventory/balances').set(auth(EMAIL_GESTOR));
    const linhas = depois.body.items.filter((b: { sku: string }) => b.sku === 'VAL-001');
    const totalDepois = linhas.reduce(
      (acc: number, b: { on_hand: string }) => acc + Number(b.on_hand),
      0
    );

    // A transferência MOVE, não cria nem destrói. O total conservado é a
    // afirmação que distingue uma transferência de duas pernas de duas
    // operações soltas que podem divergir.
    expect(totalDepois).toBe(totalAntes);

    const naBase = linhas.find((b: { warehouse_name: string }) => b.warehouse_name === 'Base UTI');
    expect(Number(naBase.on_hand)).toBe(5);
  });

  it('recusa transferência para o mesmo almoxarifado', async () => {
    const r = await http
      .post('/v1/inventory/transfers')
      .set(auth(EMAIL_GESTOR))
      .send({ item_id: valvula, from_warehouse_id: central, to_warehouse_id: central, qty: 1 });
    expect(r.status).toBe(422);
  });

  it('recusa quantidade zero ou negativa', async () => {
    for (const qty of [0, -3]) {
      const r = await http
        .post('/v1/inventory/transfers')
        .set(auth(EMAIL_GESTOR))
        .send({ item_id: valvula, from_warehouse_id: central, to_warehouse_id: base, qty });
      expect(r.status, String(qty)).toBe(422);
    }
  });
});

describe('estorno', () => {
  it('grava movimento CONTRÁRIO e não apaga o original', async () => {
    /*
     * Apagar deixaria o saldo certo e a história errada.
     *
     * Quem conferisse o extrato três meses depois veria uma peça que apareceu
     * e sumiu sem explicação — e é exatamente essa a auditoria que um razão
     * existe para permitir.
     */
    const criado = await http
      .post('/v1/inventory/adjustments')
      .set(auth(EMAIL_GESTOR))
      .send({ item_id: filtro, warehouse_id: central, qty: 7, reason: 'entrada lançada por engano' })
      .expect(201);

    const antes = await http.get('/v1/inventory/balances').set(auth(EMAIL_GESTOR));
    const f1 = antes.body.items.find(
      (b: { sku: string; warehouse_name: string }) =>
        b.sku === 'FIL-002' && b.warehouse_name === 'Depósito Central'
    );
    expect(Number(f1.on_hand)).toBe(10);

    await http
      .post(`/v1/inventory/movements/${criado.body.id}/reversal`)
      .set(auth(EMAIL_GESTOR))
      .send({ reason: 'lançamento indevido, desfeito' })
      .expect(201);

    const depois = await http.get('/v1/inventory/balances').set(auth(EMAIL_GESTOR));
    const f2 = depois.body.items.find(
      (b: { sku: string; warehouse_name: string }) =>
        b.sku === 'FIL-002' && b.warehouse_name === 'Depósito Central'
    );
    expect(Number(f2.on_hand)).toBe(3);

    // As DUAS linhas continuam no extrato: a original e o estorno.
    const extrato = await http
      .get(`/v1/inventory/ledger?item=${filtro}&warehouse=${central}`)
      .set(auth(EMAIL_GESTOR));
    const estorno = extrato.body.items.find(
      (m: { reverses_id: string | null }) => m.reverses_id !== null
    );
    expect(estorno).toBeTruthy();
    expect(estorno.reverses_id).toBe(criado.body.id);
    // O movimento ORIGINAL continua lá: o estorno somou uma linha, não
    // subtraiu uma. É a diferença entre saldo certo com história certa e
    // saldo certo com história apagada.
    const entradas = extrato.body.items.filter((m: { kind: string }) => m.kind === 'adjustment');
    expect(entradas.length).toBeGreaterThanOrEqual(2);
  });

  it('o extrato satisfaz o contrato', async () => {
    const { inventoryLedger } = await import('@aurora/contracts');
    const r = await http
      .get(`/v1/inventory/ledger?item=${valvula}&warehouse=${central}`)
      .set(auth(EMAIL_GESTOR));
    const conferido = inventoryLedger.response.safeParse(r.body);
    if (!conferido.success) {
      throw new Error(
        conferido.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
      );
    }
  });
});

describe('mínimos', () => {
  it('o mínimo é por (item, almoxarifado), e não por item', async () => {
    // A mesma peça pode ser crítica na base que atende a UTI e dispensável no
    // depósito central. Um mínimo global avisaria onde não importa e ficaria
    // calado onde importa.
    await http
      .post('/v1/inventory/minimums')
      .set(auth(EMAIL_GESTOR))
      .send({ item_id: valvula, warehouse_id: base, min_qty: 8 })
      .expect(201);

    const r = await http.get('/v1/inventory/balances?below_minimum=true').set(auth(EMAIL_GESTOR));
    const linhas = r.body.items.filter((b: { sku: string }) => b.sku === 'VAL-001');

    // 5 na base, mínimo 8 → aparece. 13 no central, sem mínimo → não aparece.
    expect(linhas).toHaveLength(1);
    expect(linhas[0].warehouse_name).toBe('Base UTI');
  });

  it('recusa mínimo negativo', async () => {
    const r = await http
      .post('/v1/inventory/minimums')
      .set(auth(EMAIL_GESTOR))
      .send({ item_id: valvula, warehouse_id: base, min_qty: -1 });
    expect(r.status).toBe(422);
  });
});

describe('identificador malformado', () => {
  it('é recusado antes de chegar ao banco', async () => {
    const r = await http
      .get('/v1/inventory/ledger?item=nao-e-uuid&warehouse=tambem-nao')
      .set(auth(EMAIL_GESTOR));
    expect(r.status).toBe(422);
  });
});
