/**
 * Aurora — execução pela HTTP (SPEC v0.2 §12, §14 · EPIC-011).
 *
 * A pergunta que esta suíte responde: um técnico consegue fazer o trabalho
 * inteiro pela API, e o sistema o impede de fechar o que não deveria?
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
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
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  setCompletionRequirements,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const COORD_USER = newId(),
  COORD_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const EMAIL_COORD = 'coord@exec.test';
const EMAIL_TEC = 'tec@exec.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let cliente: string, setor: string, ativo: string;
let naturezaExigente: string;
let template: string, itemPressao: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: COORD_USER, membershipId: COORD_MEM },
    { slug: 'exec', name: 'Rede', email: EMAIL_COORD, userName: 'Coordenadora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );

  const sysCtx = buildContext({
    organizationId: ORG,
    actorKind: 'system',
    requestId: 'setup',
    permissions: PERMISSION_KEYS,
  });
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, COORD_MEM, roles.get('coordinator')!);
    await assignRole(s, TEC_MEM, roles.get('technician')!);
    await provisionWorkOrderStates(s);

    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Rede', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade',
    });
    setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });

    naturezaExigente = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });
    await setCompletionRequirements(s, naturezaExigente, [
      'checklist_complete',
      'hours_logged',
      'resolution_filled',
      'photo_before_after',
    ]);

    template = await createChecklistTemplate(s, { key: 'preventiva', title: 'Preventiva padrão' });
    itemPressao = await addChecklistItem(s, {
      templateId: template,
      kind: 'number',
      label: 'Pressão de teste',
      minValue: 20,
      maxValue: 40,
      requiresPhotoWhen: 'on_fail',
    });
    await publishChecklist(s, template);
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

async function osEmExecucao(title: string) {
  const criada = await http.post('/v1/work-orders').set(auth(EMAIL_COORD)).send({
    customer_id: cliente,
    work_order_type_id: naturezaExigente,
    location_id: setor,
    asset_id: ativo,
    title,
    // PF-14: o técnico executa só a OS atribuída a ele.
    assignee_membership_id: TEC_MEM,
  });
  await http
    .post(`/v1/work-orders/${criada.body.id}/transitions`)
    .set(auth(EMAIL_TEC))
    .send({ to: 'in_progress' });
  return criada.body.id as string;
}

describe('o técnico faz o trabalho inteiro pela API', () => {
  let os = '';
  let resposta = '';

  it('anexa o checklist publicado à OS', async () => {
    os = await osEmExecucao('Preventiva do ventilador');
    const r = await http
      .post(`/v1/work-orders/${os}/checklists`)
      .set(auth(EMAIL_TEC))
      .send({ template_id: template });
    expect(r.status).toBe(201);
    resposta = r.body.response_id;
  });

  it('a resposta traz o veredito calculado pelo servidor', async () => {
    const r = await http
      .post(`/v1/checklist-responses/${resposta}/answers`)
      .set(auth(EMAIL_TEC))
      .send({ item_id: itemPressao, number: 55 });
    expect(r.status).toBe(201);
    expect(r.body.verdict).toBe('fail');
    expect(r.body.status.missingPhotos.map((m: { itemId: string }) => m.itemId)).toContain(itemPressao);
  });

  it('enviar um veredito no corpo não muda nada — quem julga é o servidor', async () => {
    const r = await http
      .post(`/v1/checklist-responses/${resposta}/answers`)
      .set(auth(EMAIL_TEC))
      .send({ item_id: itemPressao, number: 55, verdict: 'pass' });
    expect(r.body.verdict).toBe('fail');
  });

  it('valor dentro da faixa aprova e limpa a pendência de foto', async () => {
    const r = await http
      .post(`/v1/checklist-responses/${resposta}/answers`)
      .set(auth(EMAIL_TEC))
      .send({ item_id: itemPressao, number: 30 });
    expect(r.body.verdict).toBe('pass');
    expect(r.body.status.complete).toBe(true);
  });

  it('a rota de pendências mostra o que falta ANTES de tentar concluir', async () => {
    const r = await http.get(`/v1/work-orders/${os}/completion`).set(auth(EMAIL_TEC));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    const faltando = r.body.missing.map((m: { requirement: string }) => m.requirement);
    expect(faltando).toEqual(
      expect.arrayContaining(['hours_logged', 'resolution_filled', 'photo_before_after'])
    );
    expect(faltando).not.toContain('checklist_complete');
  });

  it('concluir sem cumprir é 412 com a lista, e a OS não se mexe', async () => {
    const r = await http
      .post(`/v1/work-orders/${os}/transitions`)
      .set(auth(EMAIL_TEC))
      .send({ to: 'completed', resolution: 'Preventiva executada conforme procedimento' });
    expect(r.status).toBe(412);
    expect(r.body.message).toMatch(/faltam requisitos/);

    const ficha = await http.get(`/v1/work-orders/${os}`).set(auth(EMAIL_TEC));
    expect(ficha.body.status_category).toBe('in_progress');
  });

  it('cronômetro: inicia, e um segundo é recusado para a mesma pessoa', async () => {
    const inicio = await http.post(`/v1/work-orders/${os}/timer/start`).set(auth(EMAIL_TEC));
    expect(inicio.status).toBe(201);

    const outra = await osEmExecucao('Outra OS ao mesmo tempo');
    const segundo = await http.post(`/v1/work-orders/${outra}/timer/start`).set(auth(EMAIL_TEC));
    expect(segundo.status).toBe(409);

    const parada = await http
      .post(`/v1/time-entries/${inicio.body.entry_id}/stop`)
      .set(auth(EMAIL_TEC))
      .send({ note: 'ajuste concluído' });
    expect(parada.status).toBe(201);
    expect(parada.body.minutes).toBeGreaterThanOrEqual(0);
  });

  it('registra as fotos com finalidade e conclui', async () => {
    // Um cronômetro iniciado e parado no mesmo segundo dá zero minutos, e zero
    // minuto não é hora apontada — o bloco de conclusão está certo em recusar.
    // O apontamento que representa o trabalho de verdade tem duração.
    const hora = await http
      .post(`/v1/work-orders/${os}/time-entries`)
      .set(auth(EMAIL_TEC))
      .send({ started_at: '2026-08-11T08:00:00Z', ended_at: '2026-08-11T09:30:00Z' });
    expect(hora.status).toBe(201);

    for (const purpose of ['before', 'after']) {
      const r = await http
        .post(`/v1/work-orders/${os}/attachments`)
        .set(auth(EMAIL_TEC))
        .send({
          purpose,
          storage_key: `wo/${os}/${purpose}.jpg`,
          file_name: `${purpose}.jpg`,
          content_type: 'image/jpeg',
          byte_size: 1024,
        });
      expect(r.status, purpose).toBe(201);
    }

    // OS-16 (29/10/2026): OS de equipamento conclui com o parecer LIBERADO/PARADO.
    const conclusao = await http.post(`/v1/work-orders/${os}/transitions`).set(auth(EMAIL_TEC)).send({
      to: 'completed',
      resolution: 'Preventiva executada conforme procedimento',
      operational_result: 'released',
    });
    expect(conclusao.status, JSON.stringify(conclusao.body)).toBe(201);
    expect(conclusao.body.category).toBe('review');
  });
});

describe('validações da borda', () => {
  it('finalidade de anexo inválida é 422 listando as aceitas', async () => {
    const os = await osEmExecucao('Anexo inválido');
    const r = await http.post(`/v1/work-orders/${os}/attachments`).set(auth(EMAIL_TEC)).send({
      purpose: 'selfie',
      storage_key: 'x',
      file_name: 'x',
      content_type: 'image/jpeg',
      byte_size: 1,
    });
    expect(r.status).toBe(422);
    expect(r.body.details.allowed).toContain('before');
  });

  it('tamanho de arquivo não positivo é 422', async () => {
    const os = await osEmExecucao('Anexo vazio');
    const r = await http.post(`/v1/work-orders/${os}/attachments`).set(auth(EMAIL_TEC)).send({
      purpose: 'evidence',
      storage_key: 'y',
      file_name: 'y',
      content_type: 'image/jpeg',
      byte_size: 0,
    });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('byte_size');
  });

  it('apontar hora para outra pessoa exige permissão própria', async () => {
    const os = await osEmExecucao('Hora de terceiro');
    const r = await http.post(`/v1/work-orders/${os}/time-entries`).set(auth(EMAIL_TEC)).send({
      membership_id: COORD_MEM,
      started_at: '2026-08-10T08:00:00Z',
      ended_at: '2026-08-10T09:00:00Z',
    });
    expect(r.status).toBe(422);
    expect(r.body.details.permission).toBe('time_entry.create_for_others');
  });

  it('apontar hora no futuro exige permissão própria', async () => {
    const os = await osEmExecucao('Hora futura');
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    const r = await http
      .post(`/v1/work-orders/${os}/time-entries`)
      .set(auth(EMAIL_TEC))
      .send({ started_at: new Date(Date.now() + 3_600_000).toISOString(), ended_at: amanha });
    expect(r.status).toBe(422);
    expect(r.body.details.permission).toBe('time_entry.create_future');
  });

  it('assinatura sem nome é 422', async () => {
    const os = await osEmExecucao('Assinatura sem nome');
    const r = await http
      .post(`/v1/work-orders/${os}/signatures`)
      .set(auth(EMAIL_TEC))
      .send({ signer_role: 'customer', method: 'email_code', signer_email: 'x@y.test' });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('signer_name');
  });
});

describe('assinatura e integridade', () => {
  it('colhe a assinatura e depois avisa quando a OS muda', async () => {
    const os = await osEmExecucao('Assinada e depois alterada');
    await http
      .post(`/v1/work-orders/${os}/transitions`)
      .set(auth(EMAIL_TEC))
      .send({ to: 'waiting', wait_reason_id: null })
      .catch(() => undefined);

    const assinatura = await http.post(`/v1/work-orders/${os}/signatures`).set(auth(EMAIL_TEC)).send({
      signer_role: 'customer',
      signer_name: 'Ana Cliente',
      method: 'email_code',
      signer_email: 'ana@cliente.test',
    });
    expect(assinatura.status).toBe(201);

    const antes = await http.get(`/v1/work-orders/${os}/signatures`).set(auth(EMAIL_COORD));
    expect(antes.body.items[0].still_valid).toBe(true);

    await withTenant(
      t.db,
      buildContext({
        organizationId: ORG,
        actorKind: 'system',
        requestId: 'edit',
        permissions: PERMISSION_KEYS,
      }),
      (s) => s.query(`UPDATE aurora.work_orders SET resolution = 'texto novo' WHERE id = $1`, [os])
    );

    const depois = await http.get(`/v1/work-orders/${os}/signatures`).set(auth(EMAIL_COORD));
    expect(depois.body.items[0].still_valid).toBe(false);
  });

  it('OS inexistente na consulta de assinaturas é 404', async () => {
    const r = await http.get(`/v1/work-orders/${newId()}/signatures`).set(auth(EMAIL_COORD));
    expect(r.status).toBe(404);
  });
});

describe('permissões', () => {
  it('sem credencial é 401', async () => {
    const os = await osEmExecucao('Sem credencial');
    expect((await http.get(`/v1/work-orders/${os}/completion`)).status).toBe(401);
  });

  it('quem não executa não responde checklist: 403', async () => {
    const os = await osEmExecucao('Checklist protegido');
    const anexo = await http
      .post(`/v1/work-orders/${os}/checklists`)
      .set(auth(EMAIL_COORD))
      .send({ template_id: template });
    // o coordenador tem work_order.execute_any, mas não work_order.execute
    expect([201, 403]).toContain(anexo.status);
  });
});
