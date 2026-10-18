/**
 * Aurora — lacunas da rodada de pendências (PF-14 residual, equipe da OS, PF-41 no campo).
 *
 * Adversarial como a suíte do pente-fino: cada regra é provada pelo lado que
 * recusa E pelo lado que passa.
 *
 *   · peça de estoque lançada na OS segue a regra de execução — e o almoxarife,
 *     que não executa OS, não é afetado;
 *   · `PATCH /work-orders/:id/team`: permissão, organização, equipe ativa, OS
 *     encerrada, versão, escopo — e o efeito (o membro da equipe passa a
 *     executar; tirar a equipe tira o direito);
 *   · o pacote do dia traz as OS da equipe (no escopo), o parecer gravado e a
 *     exigência do parecer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import {
  withTenant,
  assignRole,
  createCustomer,
  createWorkOrder,
  createTeam,
  addTeamMember,
  createWarehouse,
  createItem,
  recordMovement,
  transitionWorkOrder,
} from '@aurora/db';
import { workOrderSetTeam, fieldSync } from '@aurora/contracts';
import { createTestDatabase, type TestDatabase } from '@aurora/db/testing/harness';
import { auth, criarOrganizacao, criarPessoa, ctxSistema, subirApi, type OrgDeTeste } from './apoio/cenario';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let A: OrgDeTeste;
let B: OrgDeTeste;
let tecA: { mem: string; email: string };
let tecB: { mem: string; email: string };
let tecEquipe: { mem: string; email: string };
let almox: { mem: string; email: string };
let almoxTecnico: { mem: string; email: string };
let coord: { mem: string; email: string };
let coordDeFora: { mem: string; email: string };
let tecDeFora: { mem: string; email: string };
let equipe = '';
let equipeB = '';
let central = '';
let filtro = '';

async function novaOs(titulo: string, responsavel: string | null = null): Promise<string> {
  return withTenant(t.db, ctxSistema(A.org), async (s) => {
    const { id } = await createWorkOrder(s, {
      customerId: A.cliente,
      locationId: A.setor,
      workOrderTypeId: A.natureza,
      title: titulo,
      assigneeMembershipId: responsavel,
      publish: true,
    });
    return id;
  });
}

const usar = (email: string, os: string, qty = 1) =>
  http
    .post(`/v1/inventory/work-orders/${os}/parts`)
    .set(auth(email))
    .send({ item_id: filtro, warehouse_id: central, qty });

const definirEquipe = (email: string, os: string, corpo: Record<string, unknown>) =>
  http.patch(`/v1/work-orders/${os}/team`).set(auth(email)).send(corpo);

async function movimentosDaOs(os: string): Promise<number> {
  const [r] = await t.raw(
    `SELECT count(*)::int AS c FROM aurora.stock_movements WHERE ref_type = 'work_order' AND ref_id = $1`,
    [os]
  );
  return Number(r!.c);
}

beforeAll(async () => {
  t = await createTestDatabase();
  A = await criarOrganizacao(t, 'lacunas-a');
  B = await criarOrganizacao(t, 'lacunas-b');
  tecA = await criarPessoa(t, A, 'tec.a', 'technician');
  tecB = await criarPessoa(t, A, 'tec.b', 'operator');
  tecEquipe = await criarPessoa(t, A, 'tec.equipe', 'technician');
  almox = await criarPessoa(t, A, 'almox', 'storekeeper');
  almoxTecnico = await criarPessoa(t, A, 'almox.tecnico', 'storekeeper');
  coord = await criarPessoa(t, A, 'coord', 'coordinator');

  // Escopo restrito a OUTRO cliente da mesma organização.
  const outroCliente = await withTenant(t.db, ctxSistema(A.org), (s) =>
    createCustomer(s, { name: 'Hospital de fora', isInternal: false })
  );
  coordDeFora = await criarPessoa(t, A, 'coord.fora', 'coordinator', { customerIds: [outroCliente] });
  tecDeFora = await criarPessoa(t, A, 'tec.fora', 'technician', { customerIds: [outroCliente] });

  await withTenant(t.db, ctxSistema(A.org), async (s) => {
    // Almoxarife que TAMBÉM é técnico: as permissões se somam.
    await assignRole(s, almoxTecnico.mem, A.papeis.get('technician')!);
    equipe = await createTeam(s, { name: 'Equipe UTI' });
    await addTeamMember(s, equipe, tecEquipe.mem);
    // O técnico de fora do escopo também é da equipe: a equipe é da organização.
    await addTeamMember(s, equipe, tecDeFora.mem);
    central = await createWarehouse(s, { name: 'Central' });
    filtro = await createItem(s, { sku: 'LAC-FLT', name: 'Filtro HEPA' });
    await recordMovement(s, {
      itemId: filtro,
      warehouseId: central,
      kind: 'receipt',
      qty: 100,
      unitCost: 10,
    });
  });
  equipeB = await withTenant(t.db, ctxSistema(B.org), (s) => createTeam(s, { name: 'Equipe de B' }));

  ({ app, http } = await subirApi(t.db));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

/* ------------------------------------------------------------------------ */

describe('PF-14 · peça de estoque lançada na OS segue a regra de execução', () => {
  it('técnico/operador sem ser o responsável nem da equipe: 403 com o motivo, e nada sai do estoque', async () => {
    const os = await novaOs('Peça na OS do técnico A', tecA.mem);
    const r = await usar(tecB.email, os);
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.message).toMatch(/não está atribuída a você/);
    expect(await movimentosDaOs(os)).toBe(0);
  });

  it('o responsável lança a peça (201) e o movimento fica ligado à OS', async () => {
    const os = await novaOs('Peça do responsável', tecA.mem);
    const r = await usar(tecA.email, os);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await movimentosDaOs(os)).toBe(1);
  });

  it('o almoxarife, que não executa OS, lança em qualquer OS — inclusive sem responsável', async () => {
    const deOutro = await novaOs('Balcão: OS do técnico A', tecA.mem);
    const semNinguem = await novaOs('Balcão: OS sem responsável');
    expect((await usar(almox.email, deOutro)).status).toBe(201);
    expect((await usar(almox.email, semNinguem)).status).toBe(201);
  });

  it('quem acumula almoxarife e técnico fica com a regra mais estreita (403 na OS de outro)', async () => {
    const os = await novaOs('OS do técnico A, almoxarife-técnico tenta', tecA.mem);
    const r = await usar(almoxTecnico.email, os);
    expect(r.status).toBe(403);
    // Na própria OS, lança normalmente.
    const minha = await novaOs('OS do almoxarife-técnico', almoxTecnico.mem);
    expect((await usar(almoxTecnico.email, minha)).status).toBe(201);
  });

  it('fora do escopo é 404 antes da regra, mesmo sendo da equipe da OS', async () => {
    const os = await novaOs('OS da equipe, cliente A');
    await withTenant(t.db, ctxSistema(A.org), (s) =>
      s.query(`UPDATE aurora.work_orders SET team_id = $2 WHERE id = $1`, [os, equipe])
    );
    expect((await usar(tecDeFora.email, os)).status).toBe(404);
  });

  it('a recusa pela fila de campo é preservada: o reenvio com a mesma operação devolve o mesmo 403', async () => {
    const os = await novaOs('Fila: OS de outro', tecA.mem);
    const op = '0193dd00-1111-7000-8000-0000000000a1';
    const corpo = { item_id: filtro, warehouse_id: central, qty: 1 };
    const r1 = await http
      .post(`/v1/inventory/work-orders/${os}/parts`)
      .set({ ...auth(tecB.email), 'x-aurora-client-operation': op })
      .send(corpo);
    const r2 = await http
      .post(`/v1/inventory/work-orders/${os}/parts`)
      .set({ ...auth(tecB.email), 'x-aurora-client-operation': op })
      .send(corpo);
    expect(r1.status).toBe(403);
    expect(r2.status).toBe(403);
    expect(await movimentosDaOs(os)).toBe(0);
  });
});

/* ------------------------------------------------------------------------ */

describe('PATCH /work-orders/:id/team · a equipe da OS', () => {
  it('quem não atribui OS (técnico) não define equipe: 403 nomeando work_order.assign', async () => {
    const os = await novaOs('Equipe: técnico tenta', tecA.mem);
    const r = await definirEquipe(tecA.email, os, { team_id: equipe });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('work_order.assign');
  });

  it('o coordenador define; a resposta cabe no contrato e a ficha mostra a equipe', async () => {
    const os = await novaOs('Equipe: coordenador define', tecA.mem);
    const r = await definirEquipe(coord.email, os, { team_id: equipe });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const corpo = workOrderSetTeam.response.parse(r.body);
    expect(corpo.team_id).toBe(equipe);

    const ficha = await http.get(`/v1/work-orders/${os}`).set(auth(coord.email));
    expect(ficha.body.team_id).toBe(equipe);
    expect(ficha.body.team_name).toBe('Equipe UTI');
    // O responsável individual não foi tocado.
    expect(ficha.body.assignee_membership_id).toBe(tecA.mem);
  });

  it('o efeito: o membro da equipe passa a executar; tirar a equipe (null) tira o direito', async () => {
    const os = await novaOs('Equipe: efeito na execução', tecA.mem);
    expect((await usar(tecEquipe.email, os)).status).toBe(403);
    expect(
      (
        await http
          .post(`/v1/work-orders/${os}/transitions`)
          .set(auth(tecEquipe.email))
          .send({ to: 'in_progress' })
      ).status
    ).toBe(403);

    expect((await definirEquipe(coord.email, os, { team_id: equipe })).status).toBe(200);
    expect((await usar(tecEquipe.email, os)).status).toBe(201);
    expect(
      (
        await http
          .post(`/v1/work-orders/${os}/transitions`)
          .set(auth(tecEquipe.email))
          .send({ to: 'in_progress' })
      ).status
    ).toBe(201);

    const tirar = await definirEquipe(coord.email, os, { team_id: null });
    expect(tirar.status).toBe(200);
    expect(tirar.body.team_id).toBeNull();
    expect((await usar(tecEquipe.email, os)).status).toBe(403);
  });

  it('equipe de OUTRA organização é 404 (não existe aqui), e a OS não muda', async () => {
    const os = await novaOs('Equipe: de outra organização');
    const r = await definirEquipe(coord.email, os, { team_id: equipeB });
    expect(r.status).toBe(404);
    const [w] = await t.raw(`SELECT team_id FROM aurora.work_orders WHERE id = $1`, [os]);
    expect(w!.team_id).toBeNull();
  });

  it('equipe inativa ou apagada não recebe ordem nova (422 em team_id)', async () => {
    const os = await novaOs('Equipe: inativa');
    const [inativa, apagada] = await withTenant(t.db, ctxSistema(A.org), async (s) => {
      const i = await createTeam(s, { name: 'Equipe desativada' });
      const a = await createTeam(s, { name: 'Equipe apagada' });
      await s.query(`UPDATE aurora.teams SET status = 'inactive' WHERE id = $1`, [i]);
      await s.query(`UPDATE aurora.teams SET deleted_at = now() WHERE id = $1`, [a]);
      return [i, a];
    });
    for (const id of [inativa, apagada]) {
      const r = await definirEquipe(coord.email, os, { team_id: id });
      expect(r.status, JSON.stringify(r.body)).toBe(422);
      expect(JSON.stringify(r.body)).toContain('team_id');
    }
  });

  it('OS cancelada não muda de equipe (409)', async () => {
    const os = await novaOs('Equipe: cancelada');
    await withTenant(t.db, ctxSistema(A.org), (s) =>
      transitionWorkOrder(s, os, 'cancelled', { cancellationReason: 'aberta por engano' })
    );
    const r = await definirEquipe(coord.email, os, { team_id: equipe });
    expect(r.status).toBe(409);
  });

  it('versão desatualizada (a OS mudou de situação no meio do caminho) é 409; a certa passa', async () => {
    const os = await novaOs('Equipe: versão', tecA.mem);
    const ficha = await http.get(`/v1/work-orders/${os}`).set(auth(coord.email));
    const versao = ficha.body.version as number;
    // O técnico inicia a OS enquanto o coordenador olha a ficha carregada antes.
    expect(
      (await http.post(`/v1/work-orders/${os}/transitions`).set(auth(tecA.email)).send({ to: 'in_progress' }))
        .status
    ).toBe(201);
    const velha = await definirEquipe(coord.email, os, { team_id: equipe, version: versao });
    expect(velha.status).toBe(409);
    expect(velha.body.details).toMatchObject({ expected_version: versao, current_version: versao + 1 });

    const certa = await definirEquipe(coord.email, os, { team_id: equipe, version: versao + 1 });
    expect(certa.status, JSON.stringify(certa.body)).toBe(200);
    // A versão é a da SITUAÇÃO (sobe só em transição, gatilho da 0022): trocar a
    // equipe não a mexe, e um arrastar de cartão concorrente não vira conflito falso.
    expect(certa.body.version).toBe(versao + 1);
  });

  it('corpo fora do contrato é 422: sem team_id, id malformado, campo a mais', async () => {
    const os = await novaOs('Equipe: corpo inválido');
    for (const corpo of [
      {},
      { team_id: 'nao-e-uuid' },
      { team_id: equipe, assignee_membership_id: tecA.mem },
    ]) {
      const r = await definirEquipe(coord.email, os, corpo);
      expect(r.status, JSON.stringify(corpo)).toBe(422);
    }
  });

  it('coordenador de outro escopo: a OS "não existe" para ele (404)', async () => {
    const os = await novaOs('Equipe: fora do escopo do coordenador');
    expect((await definirEquipe(coordDeFora.email, os, { team_id: equipe })).status).toBe(404);
  });

  it('a troca de equipe fica na trilha de auditoria da OS', async () => {
    const os = await novaOs('Equipe: auditoria');
    await definirEquipe(coord.email, os, { team_id: equipe });
    const linhas = await t.raw(
      `SELECT count(*)::int AS c FROM aurora.audit_logs
        WHERE entity_type = 'work_orders' AND entity_id = $1 AND action = 'update'
          AND changes ? 'team_id'`,
      [os]
    );
    expect(Number(linhas[0]!.c)).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------ */

describe('pacote do dia · OS da equipe e o parecer (PF-14, PF-41)', () => {
  it('o membro da equipe recebe a OS da equipe; quem é da equipe mas está fora do escopo, não', async () => {
    const os = await novaOs('Pacote: OS da equipe');
    expect((await definirEquipe(coord.email, os, { team_id: equipe })).status).toBe(200);

    const doMembro = await http.get('/v1/field/sync').set(auth(tecEquipe.email));
    expect(doMembro.status).toBe(200);
    expect(doMembro.body.work_orders.map((o: { id: string }) => o.id)).toContain(os);

    const deFora = await http.get('/v1/field/sync').set(auth(tecDeFora.email));
    expect(deFora.status).toBe(200);
    expect(deFora.body.work_orders.map((o: { id: string }) => o.id)).not.toContain(os);

    // Quem não é da equipe nem responsável, não recebe.
    const outro = await http.get('/v1/field/sync').set(auth(tecB.email));
    expect(outro.body.work_orders.map((o: { id: string }) => o.id)).not.toContain(os);
  });

  it('a exigência do parecer e o parecer gravado descem no pacote, que cabe no contrato', async () => {
    const os = await novaOs('Pacote: parecer', tecA.mem);
    const antes = await http.get('/v1/field/sync').set(auth(tecA.email));
    expect(fieldSync.response.parse(antes.body).settings).toEqual({ require_operational_result: false });
    expect(antes.body.work_orders.find((o: { id: string }) => o.id === os).operational_result).toBeNull();

    const ligar = await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(A.email))
      .send({ require_operational_result: true });
    expect(ligar.status).toBe(200);
    try {
      await http.post(`/v1/work-orders/${os}/transitions`).set(auth(tecA.email)).send({ to: 'in_progress' });
      const parecer = await http
        .patch(`/v1/work-orders/${os}/service-report`)
        .set(auth(tecA.email))
        .send({ operational_result: 'released' });
      expect(parecer.status).toBe(200);

      // Incremental também traz a regra: mudar a configuração não altera OS nenhuma.
      const depois = await http
        .get('/v1/field/sync')
        .query({ since: antes.body.synced_at })
        .set(auth(tecA.email));
      const pacote = fieldSync.response.parse(depois.body);
      expect(pacote.incremental).toBe(true);
      expect(pacote.settings.require_operational_result).toBe(true);
      expect(pacote.work_orders.find((o) => o.id === os)?.operational_result).toBe('released');
    } finally {
      await http
        .patch('/v1/organizations/current/configuration')
        .set(auth(A.email))
        .send({ require_operational_result: false });
    }
  });

  it('o fluxo do aparelho com a exigência ligada: parecer (PATCH) e depois concluir, na ordem da fila', async () => {
    const os = await novaOs('Pacote: concluir com parecer', tecA.mem);
    await http
      .patch('/v1/organizations/current/configuration')
      .set(auth(A.email))
      .send({ require_operational_result: true });
    try {
      expect(
        (
          await http
            .post(`/v1/work-orders/${os}/transitions`)
            .set(auth(tecA.email))
            .send({ to: 'in_progress' })
        ).status
      ).toBe(201);
      const sem = await http
        .post(`/v1/work-orders/${os}/transitions`)
        .set(auth(tecA.email))
        .send({ to: 'completed', resolution: 'trocado o filtro' });
      expect(sem.status).toBe(422);

      // Os dois comandos que o aparelho enfileira, na ordem em que a fila os manda.
      const parecer = await http
        .patch(`/v1/work-orders/${os}/service-report`)
        .set({ ...auth(tecA.email), 'x-aurora-client-operation': '0193dd00-1111-7000-8000-0000000000b1' })
        .send({ operational_result: 'stopped' });
      expect(parecer.status).toBe(200);
      const concluir = await http
        .post(`/v1/work-orders/${os}/transitions`)
        .set({ ...auth(tecA.email), 'x-aurora-client-operation': '0193dd00-1111-7000-8000-0000000000b2' })
        .send({ to: 'completed', resolution: 'trocado o filtro' });
      expect(concluir.status, JSON.stringify(concluir.body)).toBe(201);
    } finally {
      await http
        .patch('/v1/organizations/current/configuration')
        .set(auth(A.email))
        .send({ require_operational_result: false });
    }
  });
});
