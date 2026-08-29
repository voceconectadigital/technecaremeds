/**
 * Aurora — solicitações pela HTTP (SPEC v0.2 §08, ADR-002 · EPIC-007).
 *
 * O cenário tem três pessoas com poderes diferentes sobre a mesma fila: quem
 * abre (solicitante do portal), quem tria e decide (coordenador) e quem executa
 * (técnico). É a separação que o ADR-002 comprou, e é o que esta suíte verifica
 * na borda.
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
  createCatalogItem,
  createAssetCategory,
  createAsset,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const COORD_USER = newId(),
  COORD_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const SOLIC_USER = newId(),
  SOLIC_MEM = newId();
const EMAIL_COORD = 'coordenador@sr.test';
const EMAIL_TEC = 'tecnico@sr.test';
const EMAIL_SOLIC = 'solicitante@sr.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let cliente: string, setor: string, ativo: string;
let sintoma: string, motivoRecusa: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: COORD_USER, membershipId: COORD_MEM },
    { slug: 'sr', name: 'Rede Hospitalar', email: EMAIL_COORD, userName: 'Coordenadora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: SOLIC_USER, membershipId: SOLIC_MEM },
    { email: EMAIL_SOLIC, userName: 'Solicitante' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, COORD_MEM, roles.get('coordinator')!);
    await assignRole(s, TEC_MEM, roles.get('technician')!);
    await assignRole(s, SOLIC_MEM, roles.get('requester')!);

    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Rede Hospitalar', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade Norte',
    });
    setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    const cat = await createAssetCategory(s, { name: 'Desfibrilador' });
    ativo = await createAsset(s, {
      name: 'DEA 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });
    sintoma = await createCatalogItem(s, {
      catalogKey: 'failure_symptom',
      key: 'nao_liga',
      label: 'Não liga',
    });
    motivoRecusa = await createCatalogItem(s, {
      catalogKey: 'rejection_reason',
      key: 'fora_escopo',
      label: 'Fora de escopo contratual',
    });
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

async function abrir(email: string, over: Record<string, unknown> = {}) {
  return http
    .post('/v1/service-requests')
    .set(auth(email))
    .send({
      customer_id: cliente,
      location_id: setor,
      asset_id: ativo,
      reported_failure_code_id: sintoma,
      summary: 'DEA não liga',
      description: 'Desde ontem à noite',
      requested_priority: 'urgent',
      ...over,
    });
}

describe('abrir solicitação', () => {
  it('o solicitante abre e recebe o número da série própria', async () => {
    const r = await abrir(EMAIL_SOLIC);
    expect(r.status).toBe(201);
    expect(r.body.number).toMatch(/^SR-\d{4}-\d{4}$/);
    expect(r.body.duplicate_hints).toEqual([]);
  });

  it('a segunda para o mesmo ativo vem com aviso — e mesmo assim é criada', async () => {
    const r = await abrir(EMAIL_SOLIC, { summary: 'DEA continua sem ligar' });
    expect(r.status).toBe(201);
    expect(r.body.duplicate_hints.length).toBeGreaterThan(0);
    expect(r.body.duplicate_hints[0].reason).toBe('mesmo_ativo');
    expect(r.body.duplicate_hints[0].candidate.number).toMatch(/^SR-/);
  });

  it('resumo curto demais é 422 nomeando o campo', async () => {
    const r = await abrir(EMAIL_SOLIC, { summary: 'x' });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('summary');
  });

  it('prioridade fora da lista é 422 listando as aceitas', async () => {
    const r = await abrir(EMAIL_SOLIC, { requested_priority: 'urgentíssimo' });
    expect(r.status).toBe(422);
    expect(r.body.details.allowed).toContain('emergency');
  });

  it('sem credencial é 401', async () => {
    const r = await http.post('/v1/service-requests').send({ customer_id: cliente, summary: 'Anônima' });
    expect(r.status).toBe(401);
  });
});

describe('quem pode o quê', () => {
  let pedido = '';

  beforeAll(async () => {
    const r = await abrir(EMAIL_SOLIC, { summary: 'Bomba de infusão com alarme' });
    pedido = r.body.id;
  });

  it('o solicitante NÃO tria', async () => {
    const r = await http
      .post(`/v1/service-requests/${pedido}/transitions`)
      .set(auth(EMAIL_SOLIC))
      .send({ to: 'triage' });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/service_request\.triage|possíveis/);
  });

  it('a ficha mostra a cada pessoa só o que ela pode fazer', async () => {
    const doSolicitante = await http.get(`/v1/service-requests/${pedido}`).set(auth(EMAIL_SOLIC));
    const doCoordenador = await http.get(`/v1/service-requests/${pedido}`).set(auth(EMAIL_COORD));
    expect(doSolicitante.body.available_transitions.map((x: { to: string }) => x.to)).toEqual(['cancelled']);
    expect(doCoordenador.body.available_transitions.map((x: { to: string }) => x.to)).toContain('triage');
  });

  it('o coordenador tria, e a ficha passa a oferecer as decisões', async () => {
    const r = await http
      .post(`/v1/service-requests/${pedido}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'triage' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('triage');

    const ficha = await http.get(`/v1/service-requests/${pedido}`).set(auth(EMAIL_COORD));
    const oferecidas = ficha.body.available_transitions.map((x: { to: string }) => x.to);
    expect(oferecidas).toEqual(expect.arrayContaining(['accepted', 'rejected', 'duplicate', 'info_needed']));
  });

  it('a ficha diz o que cada transição exige, para o formulário não adivinhar', async () => {
    const ficha = await http.get(`/v1/service-requests/${pedido}`).set(auth(EMAIL_COORD));
    const recusa = ficha.body.available_transitions.find((x: { to: string }) => x.to === 'rejected');
    expect(recusa.requires).toEqual(['rejection_reason_id']);
  });
});

describe('decisões da triagem', () => {
  async function novoEmTriagem(summary: string) {
    const r = await abrir(EMAIL_SOLIC, { summary, asset_id: null });
    await http
      .post(`/v1/service-requests/${r.body.id}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'triage' });
    return r.body.id as string;
  }

  it('recusar sem motivo é recusado; com motivo, encerra', async () => {
    const id = await novoEmTriagem('Pedido fora do contrato');
    const semMotivo = await http
      .post(`/v1/service-requests/${id}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'rejected' });
    expect(semMotivo.status).toBe(409);

    const comMotivo = await http
      .post(`/v1/service-requests/${id}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'rejected', rejection_reason_id: motivoRecusa });
    expect(comMotivo.status).toBe(201);
    expect(comMotivo.body.status).toBe('rejected');
  });

  it('pedir informação exige dizer o que falta', async () => {
    const id = await novoEmTriagem('Falta detalhe');
    const vazio = await http
      .post(`/v1/service-requests/${id}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'info_needed' });
    expect(vazio.status).toBe(409);

    const ok = await http
      .post(`/v1/service-requests/${id}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'info_needed', info_request: 'Qual o número de patrimônio do equipamento?' });
    expect(ok.status).toBe(201);
  });

  it('estado terminal não aceita mais movimento, e diz que é terminal', async () => {
    const id = await novoEmTriagem('Vai ser recusada');
    await http
      .post(`/v1/service-requests/${id}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'rejected', rejection_reason_id: motivoRecusa });

    const r = await http
      .post(`/v1/service-requests/${id}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'triage' });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/estado terminal/);
  });

  it('estado inexistente é 422, não 409 — o pedido é que está malformado', async () => {
    const id = await novoEmTriagem('Estado inventado');
    const r = await http
      .post(`/v1/service-requests/${id}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'resolvido_magicamente' });
    expect(r.status).toBe(422);
    expect(r.body.details.allowed).toContain('accepted');
  });
});

describe('fila de triagem', () => {
  it('o coordenador vê a fila em ordem de prioridade e idade', async () => {
    const r = await http.get('/v1/service-requests/queue').set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    const prioridades = r.body.items.map((x: { priority: string }) => x.priority);
    const ordem = ['emergency', 'very_urgent', 'urgent', 'low', 'none'];
    const indices = prioridades.map((p: string) => ordem.indexOf(p));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('a fila só tem o que aguarda decisão', async () => {
    const r = await http.get('/v1/service-requests/queue').set(auth(EMAIL_COORD));
    for (const item of r.body.items) {
      expect(['submitted', 'triage', 'info_needed']).toContain(item.status);
    }
  });

  it('o técnico lê a fila mas não decide nada nela', async () => {
    const leitura = await http.get('/v1/service-requests/queue').set(auth(EMAIL_TEC));
    expect(leitura.status).toBe(200);
    const alvo = leitura.body.items[0];
    const tentativa = await http
      .post(`/v1/service-requests/${alvo.id}/transitions`)
      .set(auth(EMAIL_TEC))
      .send({ to: 'accepted' });
    expect(tentativa.status).toBe(409);
  });
});

describe('o relato do cliente sobrevive à triagem', () => {
  it('não há rota que permita reescrever o resumo do solicitante', async () => {
    const r = await abrir(EMAIL_SOLIC, { summary: 'Relato original do cliente' });
    const id = r.body.id;

    // não existe PATCH na superfície
    const patch = await http
      .patch(`/v1/service-requests/${id}`)
      .set(auth(EMAIL_COORD))
      .send({ summary: 'Reescrito pelo técnico' });
    expect(patch.status).toBe(404);

    const ficha = await http.get(`/v1/service-requests/${id}`).set(auth(EMAIL_COORD));
    expect(ficha.body.summary).toBe('Relato original do cliente');
  });
});

describe('histórico', () => {
  it('a ficha traz o histórico com o tempo passado em cada estado', async () => {
    const r = await abrir(EMAIL_SOLIC, { summary: 'Para conferir histórico' });
    await http
      .post(`/v1/service-requests/${r.body.id}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'triage' });

    const ficha = await http.get(`/v1/service-requests/${r.body.id}`).set(auth(EMAIL_COORD));
    expect(ficha.body.history.map((h: { to_status: string }) => h.to_status)).toEqual([
      'submitted',
      'triage',
    ]);
    expect(Number(ficha.body.history[1].seconds_in_from)).toBeGreaterThanOrEqual(0);
  });
});
