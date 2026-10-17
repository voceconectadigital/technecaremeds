/**
 * Aurora — solicitação: Cliente → Equipamento → Detalhes → Urgência (reunião 16/10/2026, Fase 4).
 *
 *   · solicitante REAL (portal, restrito ao hospital A e à UTI) abre chamado
 *     com tipo e urgência; equipamento da UTI aceito, do Bloco e de outro
 *     hospital recusados NO SERVIDOR;
 *   · equipe com escopo restrito idem pela rota da equipe;
 *   · tipo fora da lista fechada → 422; ausente continua aceito (canais antigos);
 *   · o local da solicitação passa a ser o do equipamento;
 *   · "Pedir informação" exige a pergunta; recusa guarda a observação;
 *   · a lista de equipamentos do portal só traz os da UTI;
 *   · as sete naturezas de OS existem no ponto de partida.
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
  createCatalogItem,
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const ORG_B = newId();
const GESTORA = 'gestora@sol.test';
const SOLICITANTE = 'enfermeira@sol.test';
const OPERADOR = 'operador@sol.test';
const ADMIN_B = 'admin@sol-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospitalA: string, hospitalG: string;
let uti: string;
let ativoUti: string, ativoBloco: string, ativoGama: string, ativoDeB: string;
let motivoRecusa: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, ids, { slug: 'sol', name: 'Prestadora', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'sol-b', name: 'Org B', email: ADMIN_B, userName: 'Admin B' });

  let bloco = '';
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, ids.membershipId, base.roles.get('manager')!);
      hospitalA = await createCustomer(s, { name: 'Hospital A' });
      hospitalG = await createCustomer(s, { name: 'Hospital Gama' });
      const sede = await createLocation(s, {
        customerId: hospitalA,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'Sede',
      });
      const sedeG = await createLocation(s, {
        customerId: hospitalG,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'Sede G',
      });
      uti = await createLocation(s, {
        customerId: hospitalA,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI',
      });
      bloco = await createLocation(s, {
        customerId: hospitalA,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'Bloco',
      });
      const utiG = await createLocation(s, {
        customerId: hospitalG,
        parentId: sedeG,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI G',
      });
      const cat = await createAssetCategory(s, { name: 'Monitor', parentId: base.families.get('diagnosis') });
      ativoUti = await createAsset(s, {
        name: 'Monitor UTI',
        customerId: hospitalA,
        assetCategoryId: cat,
        locationId: uti,
      });
      ativoBloco = await createAsset(s, {
        name: 'Monitor Bloco',
        customerId: hospitalA,
        assetCategoryId: cat,
        locationId: bloco,
      });
      ativoGama = await createAsset(s, {
        name: 'Monitor Gama',
        customerId: hospitalG,
        assetCategoryId: cat,
        locationId: utiG,
      });
      motivoRecusa = await createCatalogItem(s, {
        catalogKey: 'rejection_reason',
        key: 'garantia',
        label: 'Em garantia',
      });
    }
  );
  const memSol = newId();
  const memOp = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memSol },
    {
      email: SOLICITANTE,
      userName: 'Enfermeira',
      seatType: 'portal',
      customerIds: [hospitalA],
      locationIds: [uti],
    }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memOp },
    {
      email: OPERADOR,
      userName: 'Operador',
      customerIds: [hospitalA],
      locationIds: [uti],
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memSol, base.roles.get('requester')!);
      await assignRole(s, memOp, base.roles.get('operator')!);
    }
  );
  void bloco;
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_B, actorKind: 'system', requestId: 's3' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, idsB.membershipId, base.roles.get('admin')!);
      const cli = await createCustomer(s, { name: 'Hospital B' });
      const sede = await createLocation(s, {
        customerId: cli,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'S',
      });
      const loc = await createLocation(s, {
        customerId: cli,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI B',
      });
      const cat = await createAssetCategory(s, { name: 'Bomba', parentId: base.families.get('therapy') });
      ativoDeB = await createAsset(s, {
        name: 'Bomba B',
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

describe('solicitante real (portal)', () => {
  it('só enxerga os equipamentos da UTI', async () => {
    const r = await http.get('/v1/portal/assets').set(auth(SOLICITANTE));
    expect(r.status).toBe(200);
    expect(r.body.items.map((a: { name: string }) => a.name)).toEqual(['Monitor UTI']);
  });

  let aberta: string;
  it('abre com equipamento da UTI, tipo e urgência; o local vira o do equipamento', async () => {
    const r = await http.post('/v1/portal/requests').set(auth(SOLICITANTE)).send({
      summary: 'Monitor sem curva de SpO2',
      description: 'Desde a troca do plantão.',
      asset_id: ativoUti,
      requested_type: 'corrective',
      requested_priority: 'urgent',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    aberta = r.body.id;
    const ficha = await http.get(`/v1/service-requests/${aberta}`).set(auth(GESTORA));
    expect(ficha.body.requested_type).toBe('corrective');
    expect(ficha.body.requested_priority).toBe('urgent');
    expect(ficha.body.location_id).toBe(uti);
  });

  it('equipamento do Bloco (outro setor) → 422 no campo asset_id', async () => {
    const r = await http
      .post('/v1/portal/requests')
      .set(auth(SOLICITANTE))
      .send({ summary: 'Tentativa fora do setor', asset_id: ativoBloco });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('asset_id');
  });

  it('equipamento de outro hospital e de outra organização → recusado', async () => {
    const g = await http
      .post('/v1/portal/requests')
      .set(auth(SOLICITANTE))
      .send({ summary: 'Outro hospital', asset_id: ativoGama });
    expect(g.status).toBe(422);
    const b = await http
      .post('/v1/portal/requests')
      .set(auth(SOLICITANTE))
      .send({ summary: 'Outra organização', asset_id: ativoDeB });
    expect(b.status).toBe(422);
  });

  it('cliente fora do escopo vindo do corpo é ignorado: nasce no hospital do vínculo', async () => {
    const r = await http
      .post('/v1/portal/requests')
      .set(auth(SOLICITANTE))
      .send({ summary: 'Cliente alheio', customer_id: hospitalG });
    expect(r.status).toBe(201);
    const ficha = await http.get(`/v1/service-requests/${r.body.id}`).set(auth(GESTORA));
    expect(ficha.body.customer_id).toBe(hospitalA);
  });

  it('tipo fora da lista → 422 (inclusive "movimentação")', async () => {
    const r = await http
      .post('/v1/portal/requests')
      .set(auth(SOLICITANTE))
      .send({ summary: 'Mudar o monitor de sala', requested_type: 'movimentacao' });
    expect(r.status).toBe(422);
  });

  it('o solicitante não transfere equipamento', async () => {
    const r = await http
      .post(`/v1/assets/${ativoUti}/transfer`)
      .set(auth(SOLICITANTE))
      .send({ to_location_id: uti, reason: 'quero mudar de sala' });
    expect(r.status).toBe(403);
  });

  it('o solicitante não vê "Assumir triagem" (a ficha não oferece a transição)', async () => {
    const r = await http.get(`/v1/portal/requests`).set(auth(SOLICITANTE));
    expect(r.status).toBe(200);
    const ficha = await http.get(`/v1/service-requests/${aberta}`).set(auth(SOLICITANTE));
    // Pode ou não ler pela rota da equipe; se ler, não há triagem a fazer.
    if (ficha.status === 200) {
      const destinos = ficha.body.available_transitions.map((x: { to: string }) => x.to);
      expect(destinos).not.toContain('triage');
      expect(destinos).not.toContain('accepted');
    }
  });
});

describe('equipe com escopo restrito', () => {
  it('abre para equipamento da UTI e recebe 422 no do Bloco', async () => {
    const ok = await http.post('/v1/service-requests').set(auth(OPERADOR)).send({
      customer_id: hospitalA,
      summary: 'Monitor travado',
      asset_id: ativoUti,
      requested_type: 'corrective',
      source: 'phone',
      requester_name: 'Ramal UTI',
      requester_phone: '3133330000',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const fora = await http.post('/v1/service-requests').set(auth(OPERADOR)).send({
      customer_id: hospitalA,
      summary: 'Monitor travado',
      asset_id: ativoBloco,
      source: 'phone',
      requester_name: 'Ramal',
      requester_phone: '3133330000',
    });
    expect(fora.status).toBe(422);
  });

  it('cliente fora do escopo → 404', async () => {
    const r = await http.post('/v1/service-requests').set(auth(OPERADOR)).send({
      customer_id: hospitalG,
      summary: 'Outro hospital',
      source: 'phone',
      requester_name: 'Ramal',
      requester_phone: '3133330000',
    });
    expect(r.status).toBe(404);
  });
});

describe('triagem', () => {
  let sr: string;
  it('sem tipo continua aceito (canais antigos)', async () => {
    const r = await http.post('/v1/service-requests').set(auth(GESTORA)).send({
      customer_id: hospitalA,
      summary: 'Pedido por telefone',
      source: 'phone',
      requester_name: 'Recepção',
      requester_phone: '3133330000',
    });
    expect(r.status).toBe(201);
    sr = r.body.id;
  });

  it('"Pedir informação" sem pergunta é recusado; com pergunta → 201', async () => {
    const triar = await http
      .post(`/v1/service-requests/${sr}/transitions`)
      .set(auth(GESTORA))
      .send({ to: 'triage' });
    expect(triar.status).toBe(201);
    const sem = await http
      .post(`/v1/service-requests/${sr}/transitions`)
      .set(auth(GESTORA))
      .send({ to: 'info_needed' });
    // O domínio recusa a aresta sem o requisito (409, nomeando o que falta).
    expect([409, 422]).toContain(sem.status);
    const com = await http
      .post(`/v1/service-requests/${sr}/transitions`)
      .set(auth(GESTORA))
      .send({ to: 'info_needed', info_request: 'Qual o número de série do equipamento?' });
    expect(com.status, JSON.stringify(com.body)).toBe(201);
  });

  it('recusa guarda a observação para o cliente', async () => {
    const nova = await http.post('/v1/service-requests').set(auth(GESTORA)).send({
      customer_id: hospitalA,
      summary: 'Equipamento em garantia',
      source: 'phone',
      requester_name: 'Recepção',
      requester_phone: '3133330000',
    });
    await http
      .post(`/v1/service-requests/${nova.body.id}/transitions`)
      .set(auth(GESTORA))
      .send({ to: 'triage' });
    const r = await http.post(`/v1/service-requests/${nova.body.id}/transitions`).set(auth(GESTORA)).send({
      to: 'rejected',
      rejection_reason_id: motivoRecusa,
      rejection_note: 'Acione a garantia do fabricante até 12/2026.',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [row] = await withTenant(
      t.db,
      buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'ver' }),
      (s) =>
        s.query<{ rejection_note: string }>(
          `SELECT rejection_note FROM aurora.service_requests WHERE id = $1`,
          [nova.body.id]
        )
    );
    expect(row!.rejection_note).toContain('garantia do fabricante');
  });

  it('as sete naturezas de OS existem, uma por tipo', async () => {
    const r = await http.get('/v1/catalogs/work_order_type/items').set(auth(GESTORA));
    expect(r.status).toBe(200);
    const chaves = r.body.items
      .map((i: { system_key: string | null }) => i.system_key)
      .filter(Boolean)
      .sort();
    for (const k of [
      'corrective',
      'preventive',
      'technical_instruction',
      'training',
      'calibration',
      'electrical_safety',
      'qualification',
    ]) {
      expect(chaves).toContain(k);
    }
  });
});
