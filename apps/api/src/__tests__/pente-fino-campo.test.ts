/**
 * Aurora — pente-fino da execução de campo, pela HTTP (PF-14, PF-41, PF-65, PF-84).
 *
 * Adversarial de propósito: cada regra é provada pelo lado que recusa E pelo
 * lado que passa. Uma regra que só recusa pode estar recusando tudo; uma que
 * só passa pode não existir.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import { createHash } from 'node:crypto';
import { newId } from '@aurora/domain';
import { createTestDatabase, seedMember, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  assignRole,
  createCustomer,
  createWorkOrder,
  createTeam,
  addTeamMember,
} from '@aurora/db';
import { auth, criarOrganizacao, criarPessoa, ctxSistema, subirApi, type OrgDeTeste } from './apoio/cenario';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let A: OrgDeTeste;
let tecA: { mem: string; email: string };
let tecB: { mem: string; email: string };
let tecEquipe: { mem: string; email: string };
let coord: { mem: string; email: string };
const TEC_FORA = 'tec.fora@campo-a.test';

const minutos = (n: number) => n * 60 * 1000;
const haMinutos = (n: number) => new Date(Date.now() - minutos(n)).toISOString();

async function novaOs(titulo: string, opts: { responsavel?: string; equipe?: string } = {}): Promise<string> {
  return withTenant(t.db, ctxSistema(A.org), async (s) => {
    const { id } = await createWorkOrder(s, {
      customerId: A.cliente,
      locationId: A.setor,
      workOrderTypeId: A.natureza,
      title: titulo,
      assigneeMembershipId: opts.responsavel ?? null,
      publish: true,
    });
    if (opts.equipe) {
      await s.query(`UPDATE aurora.work_orders SET team_id = $2 WHERE id = $1`, [id, opts.equipe]);
    }
    return id;
  });
}

const mover = (email: string, os: string, corpo: Record<string, unknown>) =>
  http.post(`/v1/work-orders/${os}/transitions`).set(auth(email)).send(corpo);

const JUSTIFICATIVA = { justification: 'aparelho sem GPS no subsolo' };

beforeAll(async () => {
  t = await createTestDatabase();
  A = await criarOrganizacao(t, 'campo-a');
  tecA = await criarPessoa(t, A, 'tec.a', 'technician');
  tecB = await criarPessoa(t, A, 'tec.b', 'operator');
  tecEquipe = await criarPessoa(t, A, 'tec.equipe', 'technician');
  coord = await criarPessoa(t, A, 'coord', 'coordinator');

  // Um técnico restrito a OUTRO cliente da mesma organização (escopo).
  const outroCliente = await withTenant(t.db, ctxSistema(A.org), (s) =>
    createCustomer(s, { name: 'Hospital B', isInternal: false })
  );
  const memFora = newId();
  await seedMember(
    t,
    { organizationId: A.org, userId: newId(), membershipId: memFora },
    { email: TEC_FORA, userName: 'Técnico de fora', customerIds: [outroCliente] }
  );
  await withTenant(t.db, ctxSistema(A.org), async (s) => {
    await assignRole(s, memFora, A.papeis.get('technician')!);
  });

  ({ app, http } = await subirApi(t.db));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

/* ------------------------------------------------------------------------ */

describe('PF-14 · executar exige ser o responsável, da equipe, ou ter execute_any', () => {
  it('quem só tem work_order.execute NÃO executa a OS de outra pessoa (403 com o motivo)', async () => {
    const os = await novaOs('OS do técnico A', { responsavel: tecA.mem });

    const iniciar = await mover(tecB.email, os, { to: 'in_progress' });
    expect(iniciar.status).toBe(403);
    expect(iniciar.body.message).toMatch(/não está atribuída a você/);

    // Com a OS em execução (pelo responsável), as ações de execução do outro também são recusadas.
    expect((await mover(tecA.email, os, { to: 'in_progress' })).status).toBe(201);
    const recusas = await Promise.all([
      http.post(`/v1/work-orders/${os}/check-in`).set(auth(tecB.email)).send(JUSTIFICATIVA),
      http.post(`/v1/work-orders/${os}/timer/start`).set(auth(tecB.email)).send({}),
      http
        .post(`/v1/work-orders/${os}/time-entries`)
        .set(auth(tecB.email))
        .send({ started_at: haMinutos(60), ended_at: haMinutos(30) }),
      http.post(`/v1/work-orders/${os}/attachments`).set(auth(tecB.email)).send({
        purpose: 'before',
        file_name: 'a.jpg',
        content_type: 'image/jpeg',
        byte_size: 10,
      }),
      http
        .post(`/v1/work-orders/${os}/signatures`)
        .set(auth(tecB.email))
        .send({ signer_role: 'technician', signer_name: 'Bruno', method: 'drawn' }),
      http
        .patch(`/v1/work-orders/${os}/service-report`)
        .set(auth(tecB.email))
        .send({ service_description: 'tentativa' }),
      http
        .post(`/v1/work-orders/${os}/customer-parts`)
        .set(auth(tecB.email))
        .send({ description: 'Peça do cliente', quantity: 1 }),
      mover(tecB.email, os, { to: 'completed', resolution: 'feito por quem não devia' }),
    ]);
    for (const r of recusas) expect(r.status, JSON.stringify(r.body)).toBe(403);

    // Ler continua permitido: a regra é sobre executar.
    expect((await http.get(`/v1/work-orders/${os}`).set(auth(tecB.email))).status).toBe(200);
  });

  it('o responsável executa: check-in, cronômetro e check-out', async () => {
    const os = await novaOs('OS atribuída', { responsavel: tecA.mem });
    expect((await mover(tecA.email, os, { to: 'in_progress' })).status).toBe(201);
    const entrou = await http
      .post(`/v1/work-orders/${os}/check-in`)
      .set(auth(tecA.email))
      .send(JUSTIFICATIVA);
    expect(entrou.status, JSON.stringify(entrou.body)).toBe(201);
    const saiu = await http.post(`/v1/work-orders/${os}/check-out`).set(auth(tecA.email)).send(JUSTIFICATIVA);
    expect(saiu.status, JSON.stringify(saiu.body)).toBe(201);
  });

  it('quem é da EQUIPE da OS executa sem ser o responsável', async () => {
    const equipe = await withTenant(t.db, ctxSistema(A.org), async (s) => {
      const id = await createTeam(s, { name: 'Equipe UTI' });
      await addTeamMember(s, id, tecEquipe.mem);
      return id;
    });
    const os = await novaOs('OS da equipe', { responsavel: tecA.mem, equipe });
    const r = await mover(tecEquipe.email, os, { to: 'in_progress' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // E quem não é da equipe continua de fora.
    expect((await mover(tecB.email, os, { to: 'paused' })).status).toBe(403);
  });

  it('quem tem work_order.execute_any (coordenador, administrador) executa qualquer OS', async () => {
    const os = await novaOs('OS sem responsável');
    expect((await mover(A.email, os, { to: 'in_progress' })).status).toBe(201);
    const r = await http.post(`/v1/work-orders/${os}/check-in`).set(auth(coord.email)).send(JUSTIFICATIVA);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(
      (await http.post(`/v1/work-orders/${os}/check-out`).set(auth(coord.email)).send(JUSTIFICATIVA)).status
    ).toBe(201);
  });

  it('a OS mudou de responsável com o cronômetro correndo: o dono ainda PARA o próprio cronômetro', async () => {
    const os = await novaOs('OS reatribuída', { responsavel: tecA.mem });
    await mover(tecA.email, os, { to: 'in_progress' });
    const inicio = await http.post(`/v1/work-orders/${os}/timer/start`).set(auth(tecA.email)).send({});
    expect(inicio.status).toBe(201);
    await withTenant(t.db, ctxSistema(A.org), (s) =>
      s.query(`UPDATE aurora.work_orders SET assignee_membership_id = $2 WHERE id = $1`, [os, tecB.mem])
    );
    const parar = await http
      .post(`/v1/time-entries/${inicio.body.entry_id}/stop`)
      .set(auth(tecA.email))
      .send({});
    expect(parar.status, JSON.stringify(parar.body)).toBe(201);
  });
});

/* ------------------------------------------------------------------------ */

describe('PF-65 · cronômetro e check-in com a hora do aparelho', () => {
  let os: string;

  beforeAll(async () => {
    os = await novaOs('OS do cronômetro', { responsavel: tecA.mem });
    await mover(tecA.email, os, { to: 'in_progress' });
  });

  async function apontamento(id: string) {
    return withTenant(t.db, ctxSistema(A.org), async (s) => {
      const [r] = await s.query<{ started_at: Date; ended_at: Date | null }>(
        `SELECT started_at, ended_at FROM aurora.time_entries WHERE id = $1`,
        [id]
      );
      return r;
    });
  }

  it('hora do aparelho fora da janela é 422: no futuro, velha demais, ou malformada', async () => {
    for (const started_at of [
      new Date(Date.now() + minutos(10)).toISOString(),
      new Date(Date.now() - 49 * 60 * minutos(1)).toISOString(),
      'ontem às nove',
    ]) {
      const r = await http
        .post(`/v1/work-orders/${os}/timer/start`)
        .set(auth(tecA.email))
        .send({ id: newId(), started_at });
      expect(r.status, started_at).toBe(422);
    }
  });

  it('o aparelho gera o id e a hora; reenviar o mesmo id devolve o mesmo apontamento', async () => {
    const id = newId();
    const desde = haMinutos(30);
    const r = await http
      .post(`/v1/work-orders/${os}/timer/start`)
      .set(auth(tecA.email))
      .send({ id, started_at: desde });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.entry_id).toBe(id);
    expect((await apontamento(id))!.started_at.toISOString()).toBe(desde);

    // Reenvio SEM o cabeçalho de operação (outra tentativa da fila antiga): mesmo id, sem duplicar.
    const de_novo = await http
      .post(`/v1/work-orders/${os}/timer/start`)
      .set(auth(tecA.email))
      .send({ id, started_at: desde });
    expect(de_novo.status).toBe(201);
    expect(de_novo.body.entry_id).toBe(id);

    // Outro id com um aberto: 409, como sempre.
    const outro = await http.post(`/v1/work-orders/${os}/timer/start`).set(auth(tecA.email)).send({});
    expect(outro.status).toBe(409);

    // Parar com fim antes do início: 422, e o cronômetro continua aberto.
    const antes = await http
      .post(`/v1/time-entries/${id}/stop`)
      .set(auth(tecA.email))
      .send({ ended_at: haMinutos(45) });
    expect(antes.status).toBe(422);
    expect((await apontamento(id))!.ended_at).toBeNull();

    // Parar com a hora do aparelho: os minutos contam até ela, e não até a chegada.
    const fim = haMinutos(10);
    const parou = await http
      .post(`/v1/time-entries/${id}/stop`)
      .set(auth(tecA.email))
      .send({ ended_at: fim });
    expect(parou.status, JSON.stringify(parou.body)).toBe(201);
    expect(parou.body.minutes).toBe(20);
    expect((await apontamento(id))!.ended_at!.toISOString()).toBe(fim);
  });

  it('o id do apontamento de OUTRA pessoa não é reaproveitado (409)', async () => {
    const id = newId();
    const osDoB = await novaOs('OS do B', { responsavel: tecB.mem });
    await mover(tecB.email, osDoB, { to: 'in_progress' });
    expect(
      (await http.post(`/v1/work-orders/${osDoB}/timer/start`).set(auth(tecB.email)).send({ id })).status
    ).toBe(201);
    const colisao = await http.post(`/v1/work-orders/${os}/timer/start`).set(auth(tecA.email)).send({ id });
    expect(colisao.status).toBe(409);
    await http.post(`/v1/time-entries/${id}/stop`).set(auth(tecB.email)).send({});
  });

  it('reenvio com o mesmo x-aurora-client-operation devolve o desfecho da primeira vez', async () => {
    // Outra pessoa e outra OS: o banco recusa apontamentos sobrepostos da MESMA
    // pessoa (23P01), e os casos acima já ocuparam a última meia hora do técnico A.
    const osEquipe = await novaOs('OS do reenvio', { responsavel: tecEquipe.mem });
    await mover(tecEquipe.email, osEquipe, { to: 'in_progress' });
    const op = newId();
    const id = newId();
    const corpo = { id, started_at: haMinutos(5) };
    const um = await http
      .post(`/v1/work-orders/${osEquipe}/timer/start`)
      .set({ ...auth(tecEquipe.email), 'x-aurora-client-operation': op })
      .send(corpo);
    expect(um.status).toBe(201);
    const opParar = newId();
    // O MESMO corpo nas duas tentativas: é o que a fila reenvia (corpo diferente com o
    // mesmo identificador de operação é outra coisa, e o servidor recusa).
    const fimDoAparelho = haMinutos(1);
    const parar = () =>
      http
        .post(`/v1/time-entries/${id}/stop`)
        .set({ ...auth(tecEquipe.email), 'x-aurora-client-operation': opParar })
        .send({ ended_at: fimDoAparelho });
    const p1 = await parar();
    const p2 = await parar();
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
    expect(p2.body).toEqual(p1.body);

    // O "iniciar" reenviado depois do "parar" NÃO reabre nada.
    const dois = await http
      .post(`/v1/work-orders/${osEquipe}/timer/start`)
      .set({ ...auth(tecEquipe.email), 'x-aurora-client-operation': op })
      .send(corpo);
    expect(dois.status).toBe(201);
    expect(dois.body.entry_id).toBe(id);
    expect((await apontamento(id))!.ended_at).not.toBeNull();
  });

  it('o pacote do dia traz o cronômetro aberto da pessoa', async () => {
    const id = newId();
    await http.post(`/v1/work-orders/${os}/timer/start`).set(auth(tecA.email)).send({ id });
    const pacote = await http.get('/v1/field/sync').set(auth(tecA.email));
    expect(pacote.status).toBe(200);
    expect(pacote.body.open_timers).toEqual([expect.objectContaining({ id, work_order_id: os })]);
    await http.post(`/v1/time-entries/${id}/stop`).set(auth(tecA.email)).send({});
    const depois = await http.get('/v1/field/sync').set(auth(tecA.email));
    expect(depois.body.open_timers).toEqual([]);
  });

  it('check-in e check-out com a hora do aparelho; fora da janela ou fora de ordem → 422', async () => {
    const futuro = await http
      .post(`/v1/work-orders/${os}/check-in`)
      .set(auth(tecA.email))
      .send({ ...JUSTIFICATIVA, occurred_at: new Date(Date.now() + minutos(30)).toISOString() });
    expect(futuro.status).toBe(422);

    // Horas antes dos demais apontamentos do técnico: o banco recusa sobreposição.
    const chegada = haMinutos(240);
    const entrou = await http
      .post(`/v1/work-orders/${os}/check-in`)
      .set(auth(tecA.email))
      .send({ ...JUSTIFICATIVA, occurred_at: chegada });
    expect(entrou.status, JSON.stringify(entrou.body)).toBe(201);
    expect(new Date(entrou.body.occurred_at).toISOString()).toBe(chegada);
    expect((await apontamento(entrou.body.time_entry_id))!.started_at.toISOString()).toBe(chegada);

    const antesDaChegada = await http
      .post(`/v1/work-orders/${os}/check-out`)
      .set(auth(tecA.email))
      .send({ ...JUSTIFICATIVA, occurred_at: haMinutos(250) });
    expect(antesDaChegada.status).toBe(422);

    const saiu = await http
      .post(`/v1/work-orders/${os}/check-out`)
      .set(auth(tecA.email))
      .send({ ...JUSTIFICATIVA, occurred_at: haMinutos(210) });
    expect(saiu.status, JSON.stringify(saiu.body)).toBe(201);
    expect(saiu.body.minutes).toBe(30);
  });
});

/* ------------------------------------------------------------------------ */

describe('PF-84 · os bytes do anexo: quem envia e o que é enviado', () => {
  let os: string;

  beforeAll(async () => {
    os = await novaOs('OS das fotos', { responsavel: tecA.mem });
    await mover(tecA.email, os, { to: 'in_progress' });
  });

  const resumo = (b: Buffer) => createHash('sha256').update(b).digest('hex');

  async function registrar(bytes: Buffer): Promise<string> {
    const r = await http
      .post(`/v1/work-orders/${os}/attachments`)
      .set(auth(tecA.email))
      .send({
        purpose: 'before',
        file_name: 'foto.jpg',
        content_type: 'image/jpeg',
        byte_size: bytes.byteLength,
        sha256: resumo(bytes),
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.attachment_id as string;
  }

  const enviar = (id: string, bytes: Buffer, email: string) =>
    http
      .put(`/v1/field/attachments/${id}/bytes`)
      .set(auth(email))
      .set('content-type', 'application/octet-stream')
      .set('x-aurora-offset', '0')
      .set('x-aurora-sha256', resumo(bytes))
      .set('x-aurora-final', '1')
      .send(bytes);

  async function concluido(id: string): Promise<boolean> {
    return withTenant(t.db, ctxSistema(A.org), async (s) => {
      const [r] = await s.query<{ ok: boolean }>(
        `SELECT upload_completed_at IS NOT NULL AS ok FROM aurora.attachments WHERE id = $1`,
        [id]
      );
      return r!.ok;
    });
  }

  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]);

  it('quem não pode executar a OS do anexo não escreve nele (403); fora do escopo, 404', async () => {
    const id = await registrar(JPEG);
    expect((await enviar(id, JPEG, tecB.email)).status).toBe(403);
    expect((await enviar(id, JPEG, TEC_FORA)).status).toBe(404);
    expect(await concluido(id)).toBe(false);
  });

  it('conteúdo que não é do tipo declarado → 422, e o anexo NÃO fica concluído', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const id = await registrar(html);
    const r = await enviar(id, html, tecA.email);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.details.field).toBe('content_type');
    expect(await concluido(id)).toBe(false);
  });

  it('o responsável, com um JPEG de verdade, conclui', async () => {
    const id = await registrar(JPEG);
    const r = await enviar(id, JPEG, tecA.email);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.completed).toBe(true);
    expect(await concluido(id)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */

describe('PF-41 · parecer obrigatório na conclusão, por organização (desligado por padrão)', () => {
  it('desligado: conclui sem parecer, como sempre', async () => {
    const atual = await http.get('/v1/organizations/current').set(auth(A.email));
    expect(atual.body.require_operational_result).toBe(false);
    const os = await novaOs('Sem parecer, sem exigência', { responsavel: tecA.mem });
    await mover(tecA.email, os, { to: 'in_progress' });
    const r = await mover(tecA.email, os, { to: 'completed', resolution: 'Troca do sensor.' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('ligado: sem parecer é 422 nomeando o campo; com LIBERADO, conclui; desligar volta ao normal', async () => {
    const liga = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(A.email))
      .send({ require_operational_result: true });
    expect(liga.status, JSON.stringify(liga.body)).toBe(200);
    expect(liga.body.require_operational_result).toBe(true);

    // Só quem administra liga: o técnico não.
    const tecnico = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(tecA.email))
      .send({ require_operational_result: false });
    expect(tecnico.status).toBe(403);

    const os = await novaOs('Com exigência', { responsavel: tecA.mem });
    await mover(tecA.email, os, { to: 'in_progress' });
    const sem = await mover(tecA.email, os, { to: 'completed', resolution: 'Troca do sensor.' });
    expect(sem.status).toBe(422);
    expect(sem.body.details.field).toBe('operational_result');
    expect(sem.body.message).toMatch(/LIBERADO ou PARADO/);

    await http
      .patch(`/v1/work-orders/${os}/service-report`)
      .set(auth(tecA.email))
      .send({ operational_result: 'released' })
      .expect(200);
    const com = await mover(tecA.email, os, { to: 'completed', resolution: 'Troca do sensor.' });
    expect(com.status, JSON.stringify(com.body)).toBe(201);

    const desliga = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(A.email))
      .send({ require_operational_result: false });
    expect(desliga.body.require_operational_result).toBe(false);
    const outra = await novaOs('Depois de desligar', { responsavel: tecA.mem });
    await mover(tecA.email, outra, { to: 'in_progress' });
    expect((await mover(tecA.email, outra, { to: 'completed', resolution: 'ok' })).status).toBe(201);
  });

  it('ligar a exigência não apaga a marca nem o domínio guardados em settings', async () => {
    await withTenant(t.db, ctxSistema(A.org), (s) =>
      s.query(
        `UPDATE aurora.organizations SET settings = settings || '{"branding":{"accent":"#123456"}}'::jsonb`
      )
    );
    await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(A.email))
      .send({ require_operational_result: true })
      .expect(200);
    const atual = await http.get('/v1/organizations/current').set(auth(A.email));
    expect(atual.body.branding.accent).toBe('#123456');
    await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(A.email))
      .send({ require_operational_result: false })
      .expect(200);
  });
});
