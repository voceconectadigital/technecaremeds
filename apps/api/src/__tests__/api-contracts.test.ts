/**
 * Aurora — contratos pela HTTP (SPEC v0.2 §17 · EPIC-017).
 *
 * O que a borda precisa provar, além do caminho feliz: que a medição é
 * financeira e não sai para quem não tem permissão de ver dinheiro, e que
 * fechar o período é ato à parte, com permissão à parte.
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
  provisionWorkOrderStates,
  createCustomer,
  createLocation,
  createCatalogItem,
  createAssetCategory,
  createAsset,
  createSlaPolicy,
  setSlaTarget,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const FIN_USER = newId(),
  FIN_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const EMAIL_FIN = 'fin@ct.test';
const EMAIL_TEC = 'tec@ct.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let cliente: string, uti: string, ativo: string, categoria: string;
let politica: string;

const HOJE = new Date().toISOString().slice(0, 10);
const dia = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: FIN_USER, membershipId: FIN_MEM },
    { slug: 'ctapi', name: 'Prestadora', email: EMAIL_FIN, userName: 'Financeiro' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, FIN_MEM, roles.get('finance')!);
    await assignRole(s, TEC_MEM, roles.get('technician')!);

    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital Central', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede',
    });
    uti = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    categoria = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: categoria,
      locationId: uti,
    });
    await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    politica = await createSlaPolicy(s, { name: 'Contrato', isDefault: true });
    await setSlaTarget(s, politica, 'none', 'resolution', 480, false);
    await setSlaTarget(s, politica, 'none', 'onsite', 240, false);
    await s.query(`UPDATE aurora.organizations SET default_sla_policy_id = $1 WHERE id = $2`, [
      politica,
      ORG,
    ]);
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

let contrato: string;

describe('cadastro e escopo', () => {
  it('cria o contrato e devolve o identificador', async () => {
    const r = await http
      .post('/v1/contracts')
      .set(auth(EMAIL_FIN))
      .send({
        customerId: cliente,
        kind: 'full_service',
        title: 'Full service UTI',
        startsOn: dia(-10),
        endsOn: dia(355),
        slaPolicyId: politica,
        monthlyValue: 12000,
        includedCalls: 5,
        overageCallRate: 300,
        slaTargetPercent: 95,
      })
      .expect(201);
    contrato = r.body.id;
    expect(contrato).toBeTruthy();
  });

  it('recusa espécie de contrato desconhecida, listando as válidas', async () => {
    const r = await http
      .post('/v1/contracts')
      .set(auth(EMAIL_FIN))
      .send({ customerId: cliente, kind: 'vitalicio', startsOn: HOJE })
      .expect(422);
    expect(r.body.message).toMatch(/full_service/);
  });

  it('recusa data fora do formato', async () => {
    await http
      .post('/v1/contracts')
      .set(auth(EMAIL_FIN))
      .send({ customerId: cliente, kind: 'on_demand', startsOn: '10/03/2025' })
      .expect(422);
  });

  it('define a cobertura e lista os ativos alcançados', async () => {
    await http
      .post(`/v1/contracts/${contrato}/coverages`)
      .set(auth(EMAIL_FIN))
      .send({ kind: 'location_subtree', locationId: uti })
      .expect(201);

    const r = await http.get(`/v1/contracts/${contrato}/assets`).set(auth(EMAIL_FIN)).expect(200);
    expect(r.body.items.map((a: { id: string }) => a.id)).toEqual([ativo]);
  });

  it('recusa ativar contrato sem cobertura', async () => {
    const vazio = await http
      .post('/v1/contracts')
      .set(auth(EMAIL_FIN))
      .send({ customerId: cliente, kind: 'on_demand', startsOn: HOJE })
      .expect(201);

    const r = await http.post(`/v1/contracts/${vazio.body.id}/activate`).set(auth(EMAIL_FIN)).expect(422);
    expect(r.body.message).toMatch(/sem cobertura/);
  });

  it('ativa e passa a responder pelo ativo', async () => {
    await http.post(`/v1/contracts/${contrato}/activate`).set(auth(EMAIL_FIN)).expect(201);

    const r = await http.get(`/v1/assets/${ativo}/contract`).set(auth(EMAIL_FIN)).expect(200);
    expect(r.body.contract.id).toBe(contrato);
    expect(r.body.contract.status).toBe('active');
  });

  it('numa data anterior à vigência, nenhum contrato responde', async () => {
    const r = await http
      .get(`/v1/assets/${ativo}/contract?on=${dia(-90)}`)
      .set(auth(EMAIL_FIN))
      .expect(200);
    expect(r.body.contract).toBeNull();
  });

  it('a cobertura que duplicaria o ativo é recusada com 409', async () => {
    const outro = await http
      .post('/v1/contracts')
      .set(auth(EMAIL_FIN))
      .send({ customerId: cliente, kind: 'preventive_only', startsOn: dia(-5), endsOn: dia(100) })
      .expect(201);

    const r = await http
      .post(`/v1/contracts/${outro.body.id}/coverages`)
      .set(auth(EMAIL_FIN))
      .send({ kind: 'asset_category', assetCategoryId: categoria })
      .expect(409);
    expect(r.body.message).toMatch(/dois contratos ao mesmo tempo/);
  });
});

describe('medição', () => {
  it('mede sem gravar — abrir a tela não muda o estado do sistema', async () => {
    const competencia = HOJE.slice(0, 7);
    const r = await http
      .get(`/v1/contracts/${contrato}/periods/${competencia}`)
      .set(auth(EMAIL_FIN))
      .expect(200);
    expect(r.body.period).toBe(competencia);
    expect(r.body.slaRate).toBeNull();

    const linhas = await withTenant(
      t.db,
      buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'check' }),
      (s) => s.query(`SELECT id FROM aurora.contract_periods WHERE contract_id = $1`, [contrato])
    );
    expect(linhas).toHaveLength(0);
  });

  it('o técnico não vê a medição — é informação financeira', async () => {
    await http
      .get(`/v1/contracts/${contrato}/periods/${HOJE.slice(0, 7)}`)
      .set(auth(EMAIL_TEC))
      .expect(403);
  });

  it('não se fecha um mês que ainda está acontecendo', async () => {
    const r = await http
      .post(`/v1/contracts/${contrato}/periods/${HOJE.slice(0, 7)}/close`)
      .set(auth(EMAIL_FIN))
      .expect(422);
    expect(r.body.message).toMatch(/só pode ser fechada depois/);
  });

  it('fecha um mês passado e recusa recalcular depois', async () => {
    await http.post(`/v1/contracts/${contrato}/periods/2024-03/close`).set(auth(EMAIL_FIN)).expect(201);

    await http.post(`/v1/contracts/${contrato}/periods/2024-03`).set(auth(EMAIL_FIN)).expect(422);
  });

  it('competência fora do formato não casa com a rota', async () => {
    await http.get(`/v1/contracts/${contrato}/periods/marco`).set(auth(EMAIL_FIN)).expect(404);
  });
});

describe('varredura de alertas', () => {
  it('é POST porque muda estado, e devolve os alertas do dia', async () => {
    const r = await http.post('/v1/contracts/alerts/sweep').set(auth(EMAIL_FIN)).send({}).expect(201);
    expect(Array.isArray(r.body.alerts)).toBe(true);
  });

  it('a rota de varredura não colide com a rota de detalhe', async () => {
    // `alerts` não é uuid: a restrição no parâmetro é o que garante que a
    // resolução não dependa da ordem em que os métodos foram declarados.
    const r = await http.get(`/v1/contracts/${contrato}`).set(auth(EMAIL_FIN)).expect(200);
    expect(r.body.contract.id).toBe(contrato);
    expect(r.body.coverages).toHaveLength(1);
  });
});

describe('encerramento', () => {
  it('exige justificativa', async () => {
    await http.post(`/v1/contracts/${contrato}/terminate`).set(auth(EMAIL_FIN)).send({}).expect(422);
  });

  it('encerra e deixa de responder pelo ativo', async () => {
    await http
      .post(`/v1/contracts/${contrato}/terminate`)
      .set(auth(EMAIL_FIN))
      .send({ reason: 'rescisão negociada com o cliente na reunião de março' })
      .expect(201);

    const r = await http.get(`/v1/assets/${ativo}/contract`).set(auth(EMAIL_FIN)).expect(200);
    expect(r.body.contract).toBeNull();
  });
});
