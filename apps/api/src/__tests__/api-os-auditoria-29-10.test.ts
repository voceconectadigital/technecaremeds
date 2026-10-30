/**
 * Aurora — ordens de serviço: itens da auditoria de 29/10/2026.
 *
 *   · OS-16 · ATV-16 — o parecer LIBERADO/PARADO é obrigatório na conclusão de TODA OS de
 *     equipamento (padrão ligado, a organização pode desligar) e tem EFEITO no ativo: PARADO →
 *     "em manutenção"; LIBERADO → volta "em operação" se estava em manutenção; ativo baixado
 *     nunca é tocado; tudo na trilha de auditoria e no evento `asset.status_changed`;
 *   · OS-17 — `GET /completion` devolve a MESMA lista com que a transição recusa (inclui o parecer);
 *   · OS-24 — validar o laudo de obsolescência registra a assinatura pela sessão de quem validou;
 *   · OS-12 — a OS aceita anexo de finalidade `document` (PDF);
 *   · OS-01 — a lista filtra pela situação: `status=denied` é a visão "Negados";
 *   · OS-03 · ORC-01 · CLI-07 — orçamento só para quem usa o recurso `quotes`: a prestadora tem, o
 *     hospital não (salvo se ligar); a API de criar orçamento recusa com o recurso desligado;
 *   · OS-08 — descrição e observações persistem, ficam na trilha de auditoria com quem editou e só
 *     quem executa a OS as escreve.
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
  assignRole,
  createCustomer,
  createLocation,
  createAssetCategory,
  createAsset,
  createWorkOrder,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { workOrderDetail, workOrderSignatures } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG = newId();
const HOSP = newId();
const ADMIN = 'admin@os2910.test';
const GESTORA = 'gestora@os2910.test';
const OPERADOR = 'operador@os2910.test';
const OPERADOR_BLOCO = 'bloco@os2910.test';
const AUDITOR = 'auditor@os2910.test';
const SOLICITANTE = 'solicitante@os2910.test';
const ADMIN_H = 'admin@hospital2910.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

let cliente = '';
let uti = '';
let corretiva = '';
let memOp = '';
let userOp = '';
let ativoMonitor = '';
let ativoReserva = '';
let ativoBaixado = '';
let ativoLaudo = '';
let clienteH = '';
let corretivaH = '';

const sistema = (org: string) =>
  buildContext({ organizationId: org, actorKind: 'system', requestId: 'os2910' });

async function novaOs(titulo: string, assetId: string | null): Promise<string> {
  return withTenant(t.db, sistema(ORG), async (s) => {
    const { id } = await createWorkOrder(s, {
      customerId: cliente,
      locationId: uti,
      assetId,
      workOrderTypeId: corretiva,
      title: titulo,
      description: 'Relato do solicitante para a auditoria.',
    });
    await s.query(`UPDATE aurora.work_orders SET assignee_membership_id = $1 WHERE id = $2`, [memOp, id]);
    return id;
  });
}

const transicao = (id: string, body: Record<string, unknown>, quem = OPERADOR) =>
  http.post(`/v1/work-orders/${id}/transitions`).set(auth(quem)).send(body);

const relatorio = (id: string, body: Record<string, unknown>, quem = OPERADOR) =>
  http.patch(`/v1/work-orders/${id}/service-report`).set(auth(quem)).send(body);

async function statusDoAtivo(id: string): Promise<string> {
  const [a] = await t.raw(`SELECT status::text AS status FROM aurora.assets WHERE id = $1`, [id]);
  return (a as { status: string }).status;
}

/** Em execução e com a descrição: o que toda conclusão daqui pede antes do parecer. */
async function prontaParaConcluir(os: string): Promise<void> {
  expect((await transicao(os, { to: 'in_progress' })).status).toBe(201);
  expect(
    (await relatorio(os, { service_description: 'Troca do sensor e teste funcional completo.' })).status
  ).toBe(200);
}

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  const idsH = { organizationId: HOSP, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, { slug: 'os2910', name: 'Prestadora', email: ADMIN, userName: 'Admin' });
  await seedOrganization(t, idsH, {
    slug: 'hosp2910',
    name: 'Hospital Próprio',
    email: ADMIN_H,
    userName: 'Admin do Hospital',
  });

  let bloco = '';
  await withTenant(t.db, sistema(ORG), async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, ids.membershipId, base.roles.get('admin')!);
    cliente = await createCustomer(s, { name: 'Hospital Cliente' });
    const sede = await createLocation(s, {
      customerId: cliente,
      locationTypeId: base.locationTypes.get('unidade')!,
      name: 'Sede',
    });
    uti = await createLocation(s, {
      customerId: cliente,
      parentId: sede,
      locationTypeId: base.locationTypes.get('setor')!,
      name: 'UTI',
    });
    bloco = await createLocation(s, {
      customerId: cliente,
      parentId: sede,
      locationTypeId: base.locationTypes.get('setor')!,
      name: 'Bloco',
    });
    const cat = await createAssetCategory(s, {
      name: 'Monitor',
      parentId: base.families.get('life_support'),
    });
    const ativo = (name: string, status?: 'standby') =>
      createAsset(s, { name, customerId: cliente, assetCategoryId: cat, locationId: uti, status });
    ativoMonitor = await ativo('Monitor multiparamétrico');
    ativoReserva = await ativo('Monitor de reserva', 'standby');
    ativoBaixado = await ativo('Monitor antigo');
    ativoLaudo = await ativo('Monitor obsoleto');
    const [c] = await s.query<{ id: string }>(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
    );
    corretiva = c!.id;
  });

  memOp = newId();
  userOp = newId();
  const memBloco = newId();
  const memGestora = newId();
  const memAuditor = newId();
  const memSol = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: userOp, membershipId: memOp },
    { email: OPERADOR, userName: 'Operador', customerIds: [cliente], locationIds: [uti] }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memBloco },
    { email: OPERADOR_BLOCO, userName: 'Operador do Bloco', customerIds: [cliente], locationIds: [bloco] }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memGestora },
    { email: GESTORA, userName: 'Gestora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memAuditor },
    { email: AUDITOR, userName: 'Auditor' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memSol },
    { email: SOLICITANTE, userName: 'Solicitante', seatType: 'portal', customerIds: [cliente] }
  );
  await withTenant(t.db, sistema(ORG), async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, memOp, base.roles.get('operator')!);
    await assignRole(s, memBloco, base.roles.get('operator')!);
    await assignRole(s, memGestora, base.roles.get('manager')!);
    await assignRole(s, memAuditor, base.roles.get('auditor')!);
    await assignRole(s, memSol, base.roles.get('requester')!);
  });

  await withTenant(t.db, sistema(HOSP), async (s) => {
    const base = await provisionOrganizationBaseline(s);
    await assignRole(s, idsH.membershipId, base.roles.get('admin')!);
    clienteH = await createCustomer(s, { name: 'Unidade própria' });
    const [c] = await s.query<{ id: string }>(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
    );
    corretivaH = c!.id;
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

describe('OS-16 · ATV-16 — parecer obrigatório na conclusão, com efeito no equipamento', () => {
  it('o padrão é exigir: a configuração diz true e concluir OS de equipamento sem parecer → 422', async () => {
    const org = await http.get('/v1/organizations/current').set(auth(ADMIN));
    expect(org.body.require_operational_result).toBe(true);

    const os = await novaOs('Monitor sem parecer', ativoMonitor);
    await prontaParaConcluir(os);
    const r = await transicao(os, { to: 'completed', resolution: 'Troca do sensor e teste funcional.' });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('operational_result');
    expect(await statusDoAtivo(ativoMonitor)).toBe('active');
  });

  it('OS-17: a lista do que falta traz o parecer, e ele sai dela quando é marcado', async () => {
    const os = await novaOs('Monitor — lista do que falta', ativoReserva);
    await prontaParaConcluir(os);
    const antes = await http.get(`/v1/work-orders/${os}/completion`).set(auth(OPERADOR));
    expect(antes.status).toBe(200);
    expect(antes.body.ok).toBe(false);
    expect(antes.body.requires_operational_result).toBe(true);
    expect(antes.body.missing.map((m: { requirement: string }) => m.requirement)).toContain(
      'operational_result'
    );

    expect((await relatorio(os, { operational_result: 'released' })).status).toBe(200);
    const depois = await http.get(`/v1/work-orders/${os}/completion`).set(auth(OPERADOR));
    expect(depois.body.ok).toBe(true);
    expect(depois.body.missing).toEqual([]);
  });

  it('PARADO: o ativo vai para "em manutenção", com trilha de auditoria e evento', async () => {
    const os = await novaOs('Monitor com falha de placa', ativoMonitor);
    await prontaParaConcluir(os);
    expect((await relatorio(os, { operational_result: 'stopped' })).status).toBe(200);
    const r = await transicao(os, { to: 'completed', resolution: 'Placa-mãe condenada; aguarda peça.' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await statusDoAtivo(ativoMonitor)).toBe('under_maintenance');

    // Na trilha: quem mudou (o operador) e de quê para quê.
    const trilha = await http.get(`/v1/audit?entityType=assets&entityId=${ativoMonitor}`).set(auth(AUDITOR));
    expect(trilha.status, JSON.stringify(trilha.body)).toBe(200);
    const mudanca = trilha.body.items.find(
      (i: { changes: { status?: { to: string } } }) => i.changes?.status?.to === 'under_maintenance'
    );
    expect(mudanca).toBeTruthy();
    expect(mudanca.changes.status.from).toBe('active');
    expect(mudanca.actor_user_id).toBe(userOp);

    const eventos = await t.raw(
      `SELECT payload FROM aurora.domain_events WHERE type = 'asset.status_changed' AND aggregate_id = $1`,
      [ativoMonitor]
    );
    expect(eventos.map((e) => (e as { payload: { work_order_id: string } }).payload.work_order_id)).toContain(
      os
    );
  });

  it('LIBERADO na própria transição: o ativo em manutenção volta para "em operação"', async () => {
    expect(await statusDoAtivo(ativoMonitor)).toBe('under_maintenance');
    const os = await novaOs('Monitor — troca da placa', ativoMonitor);
    await prontaParaConcluir(os);
    const r = await transicao(os, {
      to: 'completed',
      resolution: 'Placa substituída; testes ok.',
      operational_result: 'released',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await statusDoAtivo(ativoMonitor)).toBe('active');
    const det = await http.get(`/v1/work-orders/${os}`).set(auth(GESTORA));
    expect(det.body.operational_result).toBe('released');
  });

  it('LIBERADO não mexe em ativo de reserva; PARADO nunca mexe em ativo baixado', async () => {
    // Ativo de reserva concluído como LIBERADO continua de reserva: só sai de manutenção o que estava nela.
    const reserva = await novaOs('Reserva — preventiva', ativoReserva);
    await prontaParaConcluir(reserva);
    expect(
      (
        await transicao(reserva, {
          to: 'completed',
          resolution: 'ok, revisado',
          operational_result: 'released',
        })
      ).status
    ).toBe(201);
    expect(await statusDoAtivo(ativoReserva)).toBe('standby');

    const baixa = await novaOs('Monitor antigo — última visita', ativoBaixado);
    await prontaParaConcluir(baixa);
    await t.raw(
      `UPDATE aurora.assets SET status = 'decommissioned', decommissioned_at = now(),
              decommission_reason = 'Baixado por obsolescência para o teste.'
        WHERE id = $1`,
      [ativoBaixado]
    );
    const r = await transicao(baixa, {
      to: 'completed',
      resolution: 'Retirado do setor.',
      operational_result: 'stopped',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await statusDoAtivo(ativoBaixado)).toBe('decommissioned');
  });

  it('parecer que não é LIBERADO nem PARADO, na transição → 422', async () => {
    const os = await novaOs('Monitor — parecer inválido', ativoReserva);
    await prontaParaConcluir(os);
    const r = await transicao(os, {
      to: 'completed',
      resolution: 'ok, revisado',
      operational_result: 'aprovado',
    });
    expect(r.status).toBe(422);
  });

  it('OS sem equipamento conclui sem parecer', async () => {
    const os = await novaOs('Instalação de tomada no setor', null);
    await prontaParaConcluir(os);
    const r = await transicao(os, { to: 'completed', resolution: 'Tomada instalada e testada.' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('a organização pode desligar a exigência (a chave continua); religar volta a exigir', async () => {
    const desliga = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(ADMIN))
      .send({ require_operational_result: false });
    expect(desliga.body.require_operational_result).toBe(false);
    const os = await novaOs('Monitor — sem exigência', ativoReserva);
    await prontaParaConcluir(os);
    expect((await transicao(os, { to: 'completed', resolution: 'ok, revisado' })).status).toBe(201);
    expect(await statusDoAtivo(ativoReserva)).toBe('standby');

    const liga = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(ADMIN))
      .send({ require_operational_result: true });
    expect(liga.body.require_operational_result).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('OS-24 · OS-12 — laudo de obsolescência assinado por quem valida; anexo de documento', () => {
  let laudo = '';

  it('o laudo conclui pela regra própria (justificativa e foto), sem pedir parecer', async () => {
    const r = await http.post(`/v1/assets/${ativoLaudo}/obsolescence-report`).set(auth(ADMIN)).send({
      justification:
        'Equipamento com 15 anos, sem peças no fabricante e reparo acima de 70% do valor de reposição.',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    laudo = r.body.id;
    expect(r.body.number).toMatch(/^OBC-/);
    await t.raw(`UPDATE aurora.work_orders SET assignee_membership_id = $1 WHERE id = $2`, [memOp, laudo]);
    expect((await transicao(laudo, { to: 'in_progress' })).status).toBe(201);

    const falta = await http.get(`/v1/work-orders/${laudo}/completion`).set(auth(OPERADOR));
    const exigencias = falta.body.missing.map((m: { requirement: string }) => m.requirement);
    expect(exigencias).toContain('obsolescence_photo');
    expect(exigencias).not.toContain('operational_result');

    // OS-12: documento (PDF) com a finalidade `document`.
    const doc = await http
      .post(`/v1/work-orders/${laudo}/attachments`)
      .set(auth(OPERADOR))
      .send({
        purpose: 'document',
        file_name: 'manual-do-fabricante.pdf',
        content_type: 'application/pdf',
        byte_size: 2048,
        sha256: 'a'.repeat(64),
      });
    expect(doc.status, JSON.stringify(doc.body)).toBe(201);
    const anexos = await http.get(`/v1/work-orders/${laudo}/attachments`).set(auth(GESTORA));
    expect(anexos.body.items.map((a: { purpose: string }) => a.purpose)).toContain('document');

    const c = await transicao(laudo, { to: 'completed', resolution: 'Laudo emitido após inspeção.' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    // Concluir não assina nem baixa: quem valida é que aceita.
    const antes = await http.get(`/v1/work-orders/${laudo}/signatures`).set(auth(GESTORA));
    expect(antes.body.items).toEqual([]);
    expect(await statusDoAtivo(ativoLaudo)).toBe('active');
  });

  it('ao VALIDAR, quem valida assina pela sessão: resumo SHA-256, e-mail, hora; e o equipamento sai', async () => {
    const v = await transicao(laudo, { to: 'validated' }, GESTORA);
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(await statusDoAtivo(ativoLaudo)).toBe('decommissioned');

    const r = await http.get(`/v1/work-orders/${laudo}/signatures`).set(auth(GESTORA));
    expect(r.status).toBe(200);
    expect(workOrderSignatures.response.safeParse(r.body).success).toBe(true);
    expect(r.body.items).toHaveLength(1);
    const a = r.body.items[0];
    expect(a.signer_role).toBe('supervisor');
    expect(a.method).toBe('session');
    expect(a.signer_name).toBe('Gestora');
    expect(a.signer_email).toBe(GESTORA);
    expect(a.signed_content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.still_valid).toBe(true);
    expect(Number.isNaN(new Date(a.signed_at).getTime())).toBe(false);
  });

  it('OS comum validada não ganha assinatura de laudo', async () => {
    const os = await novaOs('Monitor — validação comum', ativoReserva);
    await prontaParaConcluir(os);
    await transicao(os, { to: 'completed', resolution: 'ok, revisado', operational_result: 'released' });
    expect((await transicao(os, { to: 'validated' }, GESTORA)).status).toBe(201);
    const r = await http.get(`/v1/work-orders/${os}/signatures`).set(auth(GESTORA));
    expect(r.body.items).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('OS-01 — visão "Negados" pela situação', () => {
  it('status=denied traz só as negadas; a categoria sozinha misturaria com as canceladas', async () => {
    const negada = await novaOs('Pedido fora do contrato', null);
    const cancelada = await novaOs('Pedido duplicado', null);
    expect(
      (
        await transicao(
          negada,
          { to: 'denied', cancellation_reason: 'Fora da cobertura do contrato' },
          GESTORA
        )
      ).status
    ).toBe(201);
    expect(
      (await transicao(cancelada, { to: 'cancelled', cancellation_reason: 'Aberto em duplicidade' }, GESTORA))
        .status
    ).toBe(201);

    const negados = await http.get('/v1/work-orders?status=denied').set(auth(GESTORA));
    expect(negados.status).toBe(200);
    const ids = negados.body.items.map((o: { id: string }) => o.id);
    expect(ids).toContain(negada);
    expect(ids).not.toContain(cancelada);
    expect(negados.body.items.every((o: { status_key: string }) => o.status_key === 'denied')).toBe(true);

    const mal = await http.get('/v1/work-orders?status=1;drop').set(auth(GESTORA));
    expect(mal.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */

describe('OS-03 · ORC-01 · CLI-07 — orçamento só para quem usa o recurso', () => {
  it('prestadora: a ficha diz uses_quotes=true e o orçamento é criado a partir da OS', async () => {
    const os = await novaOs('Monitor — orçar reparo', ativoReserva);
    const det = await http.get(`/v1/work-orders/${os}`).set(auth(GESTORA));
    expect(workOrderDetail.response.safeParse(det.body).success).toBe(true);
    expect(det.body.uses_quotes).toBe(true);
    const q = await http.post('/v1/quotes').set(auth(GESTORA)).send({ customerId: cliente, workOrderId: os });
    expect(q.status, JSON.stringify(q.body)).toBe(201);
  });

  let osH = '';

  it('hospital: no padrão do modo não há orçamento — a ficha esconde e a API recusa (409)', async () => {
    const modo = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(ADMIN_H))
      .send({ usage_mode: 'hospital' });
    expect(modo.status, JSON.stringify(modo.body)).toBe(200);
    expect(modo.body.features_customized).toBe(false);
    expect(modo.body.enabled_features).not.toContain('quotes');
    expect(modo.body.enabled_features).toContain('work_orders');

    osH = await withTenant(t.db, sistema(HOSP), async (s) => {
      const { id } = await createWorkOrder(s, {
        customerId: clienteH,
        workOrderTypeId: corretivaH,
        title: 'Bomba de infusão alarmando',
      });
      return id;
    });
    const det = await http.get(`/v1/work-orders/${osH}`).set(auth(ADMIN_H));
    expect(det.body.uses_quotes).toBe(false);

    const q = await http
      .post('/v1/quotes')
      .set(auth(ADMIN_H))
      .send({ customerId: clienteH, workOrderId: osH });
    expect(q.status).toBe(409);
    expect(q.body.details.feature).toBe('quotes');

    const daOs = await http
      .post(`/v1/work-orders/${osH}/quotes`)
      .set(auth(ADMIN_H))
      .send({
        clientRequestId: newId(),
        items: [{ kind: 'service', description: 'Hora técnica', quantity: 1, unitPrice: 100 }],
      });
    expect(daOs.status).toBe(409);
    const [n] = await t.raw(`SELECT count(*)::int AS n FROM aurora.quotes WHERE organization_id = $1`, [
      HOSP,
    ]);
    expect((n as { n: number }).n).toBe(0);
  });

  it('o hospital que LIGA o recurso passa a orçar (o modo muda o comportamento, não a permissão)', async () => {
    const liga = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(ADMIN_H))
      .send({ enabled_features: ['assets', 'service_requests', 'work_orders', 'quotes'] });
    expect(liga.body.enabled_features).toContain('quotes');
    const det = await http.get(`/v1/work-orders/${osH}`).set(auth(ADMIN_H));
    expect(det.body.uses_quotes).toBe(true);
    const q = await http
      .post('/v1/quotes')
      .set(auth(ADMIN_H))
      .send({ customerId: clienteH, workOrderId: osH });
    expect(q.status, JSON.stringify(q.body)).toBe(201);
  });
});

/* -------------------------------------------------------------------------- */

describe('OS-08 — descrição e observações: persistência, auditoria e permissão por perfil', () => {
  let os = '';

  it('persistem e voltam na ficha; texto acima do limite → 422 e nada muda', async () => {
    os = await novaOs('Monitor — relatório de serviço', ativoReserva);
    expect((await transicao(os, { to: 'in_progress' })).status).toBe(201);
    expect(
      (
        await relatorio(os, {
          service_description: 'Calibração do módulo de SpO2.',
          service_observations: 'Orientado o setor sobre o cabo.',
        })
      ).status
    ).toBe(200);
    expect((await relatorio(os, { service_description: 'Calibração do módulo de SpO2 e ECG.' })).status).toBe(
      200
    );
    const longo = await relatorio(os, { service_observations: 'x'.repeat(5001) });
    expect(longo.status).toBe(422);
    const det = await http.get(`/v1/work-orders/${os}`).set(auth(GESTORA));
    expect(det.body.service_description).toBe('Calibração do módulo de SpO2 e ECG.');
    expect(det.body.service_observations).toBe('Orientado o setor sobre o cabo.');
  });

  it('cada edição fica na trilha de auditoria, com o texto anterior e quem editou', async () => {
    const r = await http.get(`/v1/audit?entityType=work_orders&entityId=${os}`).set(auth(AUDITOR));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const edicoes = r.body.items.filter(
      (i: { changes: Record<string, unknown> }) => i.changes && 'service_description' in i.changes
    );
    expect(edicoes.length).toBeGreaterThanOrEqual(2);
    const ultima = edicoes.find(
      (i: { changes: { service_description: { to: string } } }) =>
        i.changes.service_description.to === 'Calibração do módulo de SpO2 e ECG.'
    );
    expect(ultima.changes.service_description.from).toBe('Calibração do módulo de SpO2.');
    expect(ultima.actor_user_id).toBe(userOp);
    expect(
      r.body.items.some(
        (i: { changes: Record<string, unknown> }) => i.changes && 'service_observations' in i.changes
      )
    ).toBe(true);
  });

  it('por perfil: solicitante e auditor → 403, operador de outro setor → 404; o texto não muda', async () => {
    expect(
      (await relatorio(os, { service_description: 'tentativa do solicitante' }, SOLICITANTE)).status
    ).toBe(403);
    expect((await relatorio(os, { service_description: 'tentativa do auditor' }, AUDITOR)).status).toBe(403);
    expect((await relatorio(os, { service_description: 'tentativa de fora' }, OPERADOR_BLOCO)).status).toBe(
      404
    );
    const det = await http.get(`/v1/work-orders/${os}`).set(auth(GESTORA));
    expect(det.body.service_description).toBe('Calibração do módulo de SpO2 e ECG.');
    // A trilha pública de auditoria é de quem tem `audit.read`: o operador não a lê.
    expect(
      (await http.get(`/v1/audit?entityType=work_orders&entityId=${os}`).set(auth(OPERADOR))).status
    ).toBe(403);
  });
});
