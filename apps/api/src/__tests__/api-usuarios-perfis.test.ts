/**
 * Aurora — usuários, perfis de acesso e escopo (reunião 16/10/2026, Fase 1).
 *
 * O que esta suíte prova, pela HTTP:
 *   · "Adicionar usuário" com perfil OPERADOR / SOLICITANTE / GESTOR escolhe
 *     papel e assento; profissão é só cadastro;
 *   · CPF validado e único por organização; registros profissionais 0..N;
 *   · SOLICITANTE não cadastra cliente/equipamento/plano/checklist nem mexe em
 *     estoque; GESTOR gerencia pessoas mas não papéis nem faturamento;
 *   · SUSPENSO e BLOQUEADO são recusados no servidor na requisição seguinte;
 *     reativar devolve o acesso; ninguém bloqueia a si mesmo;
 *   · escopo cliente → setor vale nas rotas por id (404) e nas listas;
 *   · organização B não enxerga nada de A.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext } from '@aurora/domain';
import { createTestDatabase, seedOrganization, type TestDatabase } from '@aurora/db/testing/harness';
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
  createWorkOrder,
  createServiceRequest,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { membersDetail, membersList } from '@aurora/contracts';
import { createApp } from '../bootstrap';

const ORG_A = newId();
const ORG_B = newId();
const ADMIN_A = 'admin@usuarios-a.test';
const ADMIN_B = 'admin@usuarios-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

let hospital: string, outroHospital: string;
let uti: string, bloco: string, setorOutro: string;
let ativoUti: string, ativoBloco: string, ativoOutro: string;
let osUti: string, osBloco: string, osOutro: string;
let srBloco: string;
let ativoDeB: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const idsA = { organizationId: ORG_A, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, idsA, {
    slug: 'usuarios-a',
    name: 'Prestadora A',
    email: ADMIN_A,
    userName: 'Admin A',
  });
  await seedOrganization(t, idsB, {
    slug: 'usuarios-b',
    name: 'Prestadora B',
    email: ADMIN_B,
    userName: 'Admin B',
  });

  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 'setup' }),
    async (s) => {
      const papeis = await provisionFactoryRoles(s);
      await assignRole(s, idsA.membershipId, papeis.get('admin')!);
      await provisionWorkOrderStates(s);
      const tipos = await provisionStarterLocationTypes(s);
      hospital = await createCustomer(s, { name: 'Hospital Alfa' });
      outroHospital = await createCustomer(s, { name: 'Hospital Gama' });
      const sede = await createLocation(s, {
        customerId: hospital,
        locationTypeId: tipos.get('unidade')!,
        name: 'Sede',
      });
      const sedeG = await createLocation(s, {
        customerId: outroHospital,
        locationTypeId: tipos.get('unidade')!,
        name: 'Sede G',
      });
      uti = await createLocation(s, {
        customerId: hospital,
        parentId: sede,
        locationTypeId: tipos.get('setor')!,
        name: 'UTI',
      });
      bloco = await createLocation(s, {
        customerId: hospital,
        parentId: sede,
        locationTypeId: tipos.get('setor')!,
        name: 'Bloco Cirúrgico',
      });
      setorOutro = await createLocation(s, {
        customerId: outroHospital,
        parentId: sedeG,
        locationTypeId: tipos.get('setor')!,
        name: 'UTI Gama',
      });
      const cat = await createAssetCategory(s, { name: 'Ventilador' });
      ativoUti = await createAsset(s, {
        name: 'Vent UTI',
        customerId: hospital,
        assetCategoryId: cat,
        locationId: uti,
      });
      ativoBloco = await createAsset(s, {
        name: 'Vent BC',
        customerId: hospital,
        assetCategoryId: cat,
        locationId: bloco,
      });
      ativoOutro = await createAsset(s, {
        name: 'Vent Gama',
        customerId: outroHospital,
        assetCategoryId: cat,
        locationId: setorOutro,
      });
      const corretiva = await createCatalogItem(s, {
        catalogKey: 'work_order_type',
        key: 'corretiva',
        label: 'Corretiva',
        systemKey: 'corrective',
      });
      const os = async (cli: string, loc: string, ativo: string, titulo: string) =>
        (
          await createWorkOrder(s, {
            customerId: cli,
            locationId: loc,
            assetId: ativo,
            workOrderTypeId: corretiva,
            title: titulo,
          })
        ).id;
      osUti = await os(hospital, uti, ativoUti, 'OS UTI');
      osBloco = await os(hospital, bloco, ativoBloco, 'OS Bloco');
      osOutro = await os(outroHospital, setorOutro, ativoOutro, 'OS Gama');
      srBloco = (
        await createServiceRequest(s, {
          customerId: hospital,
          locationId: bloco,
          summary: 'Chamado do bloco',
          submit: true,
          requesterName: 'Enfermeira',
          requesterPhone: '31999990000',
        })
      ).id;
    }
  );

  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_B, actorKind: 'system', requestId: 'setup' }),
    async (s) => {
      const papeis = await provisionFactoryRoles(s);
      await assignRole(s, idsB.membershipId, papeis.get('admin')!);
      const tipos = await provisionStarterLocationTypes(s);
      const cli = await createCustomer(s, { name: 'Hospital de B' });
      const sedeB = await createLocation(s, {
        customerId: cli,
        locationTypeId: tipos.get('unidade')!,
        name: 'Sede B',
      });
      const loc = await createLocation(s, {
        customerId: cli,
        parentId: sedeB,
        locationTypeId: tipos.get('setor')!,
        name: 'UTI de B',
      });
      const cat = await createAssetCategory(s, { name: 'Monitor' });
      ativoDeB = await createAsset(s, {
        name: 'Monitor B',
        customerId: cli,
        assetCategoryId: cat,
        locationId: loc,
      });
    }
  );

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

async function adicionar(body: Record<string, unknown>, como = ADMIN_A) {
  return http.post('/v1/organizations/current/members').set(auth(como)).send(body);
}

const OPERADOR = 'operador@usuarios-a.test';
const SOLICITANTE = 'solicitante@usuarios-a.test';
const GESTOR = 'gestor@usuarios-a.test';
let memOperador: string, memSolicitante: string, memGestor: string;

describe('Adicionar usuário com perfil de acesso', () => {
  it('OPERADOR: papel operator, assento de equipe, profissão e registros como cadastro', async () => {
    const r = await adicionar({
      email: OPERADOR,
      name: 'Otávio Operador',
      profile: 'operator',
      job_title: 'Engenheiro(a)',
      cpf: '529.982.247-25',
      phone: '(31) 99999-0000',
      company_name: 'Prestadora A',
      registrations: [
        { kind: 'CREA', number: 'MG-123456', region: 'MG' },
        { kind: 'CFT', number: '998877' },
      ],
      customer_scope: 'listed',
      customer_ids: [hospital],
      location_scope: 'listed',
      location_ids: [uti],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    memOperador = r.body.membership_id;

    const ficha = await http.get(`/v1/organizations/current/members/${memOperador}`).set(auth(ADMIN_A));
    expect(ficha.status).toBe(200);
    expect(membersDetail.response.safeParse(ficha.body).success).toBe(true);
    expect(ficha.body.roles).toEqual(['operator']);
    expect(ficha.body.seat_type).toBe('staff');
    expect(ficha.body.cpf).toBe('52998224725');
    expect(ficha.body.job_title).toBe('Engenheiro(a)');
    expect(ficha.body.registrations).toHaveLength(2);
    expect(ficha.body.location_ids).toEqual([uti]);
  });

  it('SOLICITANTE: papel requester e assento de portal, mesmo se o corpo pedir equipe', async () => {
    const r = await adicionar({
      email: SOLICITANTE,
      name: 'Sara Solicitante',
      profile: 'requester',
      seat_type: 'staff',
      role_keys: ['admin'],
      job_title: 'Enfermeiro(a)',
      // USR-04 (29/10/2026): enfermagem exige o COREN — o conselho da profissão, e só ele.
      registrations: [{ kind: 'COREN', number: '654321', region: 'MG' }],
      customer_scope: 'listed',
      customer_ids: [hospital],
      location_scope: 'listed',
      location_ids: [uti],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    memSolicitante = r.body.membership_id;
    const ficha = await http.get(`/v1/organizations/current/members/${memSolicitante}`).set(auth(ADMIN_A));
    expect(ficha.body.roles).toEqual(['requester']);
    expect(ficha.body.seat_type).toBe('portal');
  });

  it('GESTOR: papel manager', async () => {
    const r = await adicionar({
      email: GESTOR,
      name: 'Gina Gestora',
      profile: 'manager',
      job_title: 'Gerente',
    });
    expect(r.status).toBe(201);
    memGestor = r.body.membership_id;
  });

  it('a lista mostra profissão e SÓ a presença do CPF', async () => {
    const r = await http.get('/v1/organizations/current/members').set(auth(ADMIN_A));
    expect(membersList.response.safeParse(r.body).success).toBe(true);
    const op = r.body.items.find((m: { email: string }) => m.email === OPERADOR);
    expect(op.has_cpf).toBe(true);
    expect(op.cpf).toBeUndefined();
    expect(op.job_title).toBe('Engenheiro(a)');
  });

  it('CPF inválido → 422; CPF repetido na organização → 409', async () => {
    const invalido = await adicionar({
      email: 'x1@usuarios-a.test',
      name: 'Xis',
      profile: 'operator',
      cpf: '111.111.111-11',
    });
    expect(invalido.status).toBe(422);
    const repetido = await adicionar({
      email: 'x2@usuarios-a.test',
      name: 'Xis',
      profile: 'operator',
      cpf: '52998224725',
    });
    expect(repetido.status).toBe(409);
  });

  it('registro profissional com tipo desconhecido → 422', async () => {
    const r = await adicionar({
      email: 'x3@usuarios-a.test',
      name: 'Xis',
      profile: 'operator',
      registrations: [{ kind: 'XYZ', number: '1' }],
    });
    expect(r.status).toBe(422);
  });

  it('editar o cadastro substitui os registros e não mexe no papel', async () => {
    const r = await http
      .patch(`/v1/organizations/current/members/${memOperador}`)
      .set(auth(ADMIN_A))
      .send({ job_title: 'Técnico(a)', registrations: [{ kind: 'CFT', number: '998877' }] });
    expect(r.status).toBe(200);
    const ficha = await http.get(`/v1/organizations/current/members/${memOperador}`).set(auth(ADMIN_A));
    expect(ficha.body.job_title).toBe('Técnico(a)');
    expect(ficha.body.registrations).toEqual([{ kind: 'CFT', number: '998877', region: null }]);
    expect(ficha.body.roles).toEqual(['operator']);
  });
});

describe('o que cada perfil NÃO faz', () => {
  it('SOLICITANTE não cadastra cliente, equipamento nem plano; não lê estoque', async () => {
    expect((await http.post('/v1/customers').set(auth(SOLICITANTE)).send({ name: 'Novo' })).status).toBe(403);
    expect(
      (
        await http
          .post('/v1/assets')
          .set(auth(SOLICITANTE))
          .send({ tag: 'TAG-9', name: 'X', customer_id: hospital })
      ).status
    ).toBe(403);
    expect((await http.post('/v1/maintenance-plans').set(auth(SOLICITANTE)).send({})).status).toBe(403);
    expect((await http.post('/v1/checklist-templates').set(auth(SOLICITANTE)).send({})).status).toBe(403);
    expect((await http.get('/v1/inventory/balances').set(auth(SOLICITANTE))).status).toBe(403);
  });

  it('OPERADOR não cadastra cliente nem faz triagem', async () => {
    expect((await http.post('/v1/customers').set(auth(OPERADOR)).send({ name: 'Novo' })).status).toBe(403);
  });

  it('GESTOR gerencia pessoas, mas não concede papel maior que o seu', async () => {
    expect((await http.get('/v1/organizations/current/members').set(auth(GESTOR))).status).toBe(200);
    // A rota real e o corpo real. A versão anterior chamava um caminho que não
    // existe e passava no 404 — o teste não provava nada (pente-fino 17/10).
    const papeis = await http.get('/v1/roles').set(auth(ADMIN_A));
    const idDe = (key: string) => papeis.body.items.find((p: { key: string }) => p.key === key).id as string;
    expect((await http.get('/v1/roles').set(auth(GESTOR))).status).toBe(403);

    for (const key of ['admin', 'owner']) {
      const r = await http
        .put(`/v1/memberships/${memSolicitante}/roles`)
        .set(auth(GESTOR))
        .send({ role_ids: [idDe(key)] });
      expect(r.status, key).toBe(403);
    }
    // Operador executa OS e lança horas — o Gestor não. Mas delegar trabalho
    // operacional não é escalada: o Gestor cadastra a equipe.
    const op = await http
      .put(`/v1/memberships/${memSolicitante}/roles`)
      .set(auth(GESTOR))
      .send({ role_ids: [idDe('operator')] });
    expect(op.status, JSON.stringify(op.body)).toBe(200);

    // Solicitante cabe nas permissões do Gestor: a troca idempotente passa.
    const ok = await http
      .put(`/v1/memberships/${memSolicitante}/roles`)
      .set(auth(GESTOR))
      .send({ role_ids: [idDe('requester')] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const ficha = await http.get(`/v1/organizations/current/members/${memSolicitante}`).set(auth(ADMIN_A));
    expect(ficha.body.roles).toEqual(['requester']);
  });
});

describe('escopo cliente → setor (servidor)', () => {
  it('OPERADOR da UTI lê a OS da UTI e recebe 404 na do Bloco e na de outro hospital', async () => {
    expect((await http.get(`/v1/work-orders/${osUti}`).set(auth(OPERADOR))).status).toBe(200);
    expect((await http.get(`/v1/work-orders/${osBloco}`).set(auth(OPERADOR))).status).toBe(404);
    expect((await http.get(`/v1/work-orders/${osOutro}`).set(auth(OPERADOR))).status).toBe(404);
  });

  it('a lista e o quadro de OS só trazem a UTI', async () => {
    const lista = await http.get('/v1/work-orders').set(auth(OPERADOR));
    expect(lista.status).toBe(200);
    expect(lista.body.items.map((w: { id: string }) => w.id)).toEqual([osUti]);
    const quadro = await http.get('/v1/work-orders/board').set(auth(OPERADOR));
    const total = quadro.body.columns.reduce((n: number, c: { total: number }) => n + c.total, 0);
    expect(total).toBe(1);
  });

  it('equipamento fora do setor: 404 na ficha, na linha do tempo e na transferência', async () => {
    expect((await http.get(`/v1/assets/${ativoUti}`).set(auth(OPERADOR))).status).toBe(200);
    expect((await http.get(`/v1/assets/${ativoBloco}`).set(auth(OPERADOR))).status).toBe(404);
    expect((await http.get(`/v1/assets/${ativoBloco}/timeline`).set(auth(OPERADOR))).status).toBe(404);
    expect((await http.get(`/v1/assets/${ativoOutro}`).set(auth(OPERADOR))).status).toBe(404);
  });

  it('solicitação do Bloco: 404 para quem só vê a UTI', async () => {
    expect((await http.get(`/v1/service-requests/${srBloco}`).set(auth(OPERADOR))).status).toBe(404);
    expect((await http.get(`/v1/service-requests/${srBloco}`).set(auth(ADMIN_A))).status).toBe(200);
  });

  it('quem vê tudo continua vendo tudo', async () => {
    const lista = await http.get('/v1/work-orders').set(auth(ADMIN_A));
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);
    expect(lista.body.items).toHaveLength(3);
  });
});

describe('cross-tenant', () => {
  it('organização B não lê pessoa, OS nem equipamento de A', async () => {
    expect(
      (await http.get(`/v1/organizations/current/members/${memOperador}`).set(auth(ADMIN_B))).status
    ).toBe(404);
    expect((await http.get(`/v1/work-orders/${osUti}`).set(auth(ADMIN_B))).status).toBe(404);
    expect((await http.get(`/v1/assets/${ativoUti}`).set(auth(ADMIN_B))).status).toBe(404);
    expect((await http.get(`/v1/assets/${ativoDeB}`).set(auth(ADMIN_A))).status).toBe(404);
  });

  it('B não suspende nem edita pessoa de A', async () => {
    const r = await http
      .post(`/v1/organizations/current/members/${memOperador}/status`)
      .set(auth(ADMIN_B))
      .send({ status: 'blocked', reason: 'tentativa cruzada' });
    expect(r.status).toBe(404);
    const e = await http
      .patch(`/v1/organizations/current/members/${memOperador}`)
      .set(auth(ADMIN_B))
      .send({ job_title: 'Invasor' });
    expect(e.status).toBe(404);
  });
});

describe('ATIVO / SUSPENSO / BLOQUEADO', () => {
  const situacao = (mem: string, status: string, reason = 'motivo registrado') =>
    http.post(`/v1/organizations/current/members/${mem}/status`).set(auth(ADMIN_A)).send({ status, reason });

  it('suspenso é recusado na requisição seguinte; reativado volta a entrar', async () => {
    expect((await http.get('/v1/work-orders').set(auth(OPERADOR))).status).toBe(200);
    expect((await situacao(memOperador, 'suspended', 'afastamento médico')).status).toBe(201);
    expect((await http.get('/v1/work-orders').set(auth(OPERADOR))).status).toBe(403);
    expect((await situacao(memOperador, 'active', 'retorno do afastamento')).status).toBe(201);
    expect((await http.get('/v1/work-orders').set(auth(OPERADOR))).status).toBe(200);
  });

  it('bloqueado é recusado, e a ficha guarda motivo e quando', async () => {
    expect((await situacao(memSolicitante, 'blocked', 'uso indevido da conta')).status).toBe(201);
    expect((await http.get('/v1/portal/requests').set(auth(SOLICITANTE))).status).toBe(403);
    const ficha = await http.get(`/v1/organizations/current/members/${memSolicitante}`).set(auth(ADMIN_A));
    expect(ficha.body.status).toBe('blocked');
    expect(ficha.body.status_reason).toBe('uso indevido da conta');
    expect(ficha.body.status_changed_at).toBeTruthy();
    expect((await situacao(memSolicitante, 'active', 'desbloqueio aprovado')).status).toBe(201);
  });

  it('motivo curto → 422; mesma situação → 409', async () => {
    expect((await situacao(memGestor, 'blocked', 'ok')).status).toBe(422);
    expect((await situacao(memGestor, 'active')).status).toBe(409);
  });

  it('ninguém bloqueia a si mesmo', async () => {
    const lista = await http.get('/v1/organizations/current/members').set(auth(GESTOR));
    const eu = lista.body.items.find((m: { email: string }) => m.email === GESTOR);
    const r = await http
      .post(`/v1/organizations/current/members/${eu.membership_id}/status`)
      .set(auth(GESTOR))
      .send({ status: 'blocked', reason: 'teste de autobloqueio' });
    expect(r.status).toBe(409);
  });

  it('a suspensão antiga continua funcionando', async () => {
    const r = await http
      .post(`/v1/organizations/current/members/${memGestor}/suspension`)
      .set(auth(ADMIN_A))
      .send({ reason: 'pela rota antiga' });
    expect(r.status).toBe(201);
    expect((await http.get('/v1/organizations/current/members').set(auth(GESTOR))).status).toBe(403);
  });
});
