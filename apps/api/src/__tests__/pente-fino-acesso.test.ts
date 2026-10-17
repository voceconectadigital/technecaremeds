/**
 * Aurora — pente-fino de acesso (17/10/2026): as provas adversariais.
 *
 * Cada caso aqui foi um furo verificado na auditoria, e o teste é escrito do
 * lado de quem ataca:
 *   · o GESTOR (`organization.manage_members`) não concede papel com permissão
 *     que ele não tem — nem no convite, nem na troca de papéis;
 *   · ninguém alarga o próprio escopo, e quem é restrito não concede escopo
 *     maior que o seu;
 *   · o ScopeGuard não é contornado por maiúsculas, `%XX` ou barras repetidas;
 *   · documentos, contratos, linha do tempo e busca respeitam cliente e local;
 *   · o OPERADOR não cadastra equipamento.
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
  provisionOrganizationBaseline,
  provisionDocumentTypes,
  assignRole,
  createCustomer,
  createLocation,
  createAssetCategory,
  createAsset,
  createWorkOrder,
  createDocument,
  createContract,
  emitEvent,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';
import { entidadeDoCaminho, normalizarCaminho } from '../common/scope.guard';

const ORG = newId();
const ADMIN = 'admin@pente-fino.test';
const GESTOR = 'gestor@pente-fino.test';
const GESTOR_SETOR = 'gestor.setor@pente-fino.test';
const OPERADOR = 'operador@pente-fino.test';
const ALVO = 'alvo@pente-fino.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
const memGestor = newId();
const memGestorSetor = newId();
const memOperador = newId();
const memCoordenador = newId();
const COORDENADOR = 'coordenador@pente-fino.test';
const memAlvo = newId();

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

let hospital: string, outroHospital: string, uti: string;
let ativoUti: string, ativoOutro: string;
let osUti: string, osOutro: string;
let docA: string, docB: string, docInterno: string, docDerivado: string, tipoDocumento: string;
let ctA: string, ctB: string;
const papeis = new Map<string, string>();

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(t, ids, {
    slug: 'pente-fino',
    name: 'Prestadora PF',
    email: ADMIN,
    userName: 'Admin',
  });

  const sys = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  let sedeG = '';
  await withTenant(t.db, sys, async (s) => {
    const base = await provisionOrganizationBaseline(s);
    for (const [k, v] of base.roles) papeis.set(k, v);
    await assignRole(s, ids.membershipId, base.roles.get('admin')!);
    hospital = await createCustomer(s, { name: 'Hospital Alfa' });
    outroHospital = await createCustomer(s, { name: 'Hospital Gama' });
    const sede = await createLocation(s, {
      customerId: hospital,
      locationTypeId: base.locationTypes.get('unidade')!,
      name: 'Sede',
    });
    sedeG = await createLocation(s, {
      customerId: outroHospital,
      locationTypeId: base.locationTypes.get('unidade')!,
      name: 'Sede G',
    });
    uti = await createLocation(s, {
      customerId: hospital,
      parentId: sede,
      locationTypeId: base.locationTypes.get('setor')!,
      name: 'UTI',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativoUti = await createAsset(s, {
      name: 'Vent UTI',
      customerId: hospital,
      assetCategoryId: cat,
      locationId: uti,
    });
    ativoOutro = await createAsset(s, {
      name: 'Vent Gama',
      customerId: outroHospital,
      assetCategoryId: cat,
      locationId: sedeG,
    });
    // Mudança de campo financeiro: a linha do tempo não pode ser o atalho dela.
    await s.query(`UPDATE aurora.assets SET purchase_value = 123456.78 WHERE id = $1`, [ativoUti]);
    const [tipoOs] = await s.query<{ id: string }>(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND system_key = 'corrective'`
    );
    const corretiva = tipoOs!.id;
    osUti = (
      await createWorkOrder(s, {
        customerId: hospital,
        locationId: uti,
        assetId: ativoUti,
        workOrderTypeId: corretiva,
        title: 'OS UTI',
      })
    ).id;
    osOutro = (
      await createWorkOrder(s, {
        customerId: outroHospital,
        locationId: sedeG,
        assetId: ativoOutro,
        workOrderTypeId: corretiva,
        title: 'OS Gama',
      })
    ).id;
    const tipos = await provisionDocumentTypes(s);
    const tipo = [...tipos.values()][0]!;
    docA = await createDocument(s, {
      documentTypeId: tipo,
      title: 'Laudo Alfa',
      assetId: ativoUti,
      customerId: hospital,
    });
    docB = await createDocument(s, {
      documentTypeId: tipo,
      title: 'Laudo Gama',
      assetId: ativoOutro,
      customerId: outroHospital,
    });
    docInterno = await createDocument(s, { documentTypeId: tipo, title: 'Laudo Interno' });
    // Sem cliente informado: vem do equipamento.
    docDerivado = await createDocument(s, {
      documentTypeId: tipo,
      title: 'Laudo Derivado',
      assetId: ativoUti,
    });
    tipoDocumento = tipo;
    ctA = await createContract(s, { customerId: hospital, kind: 'full_service', startsOn: '2026-01-01' });
    ctB = await createContract(s, {
      customerId: outroHospital,
      kind: 'full_service',
      startsOn: '2026-01-01',
    });
  });

  const membro = (
    membershipId: string,
    email: string,
    escopo: { customerIds?: string[]; locationIds?: string[] }
  ) =>
    seedMember(
      t,
      { organizationId: ORG, userId: newId(), membershipId },
      { email, userName: email, ...escopo }
    );
  await membro(memGestor, GESTOR, {});
  await membro(memGestorSetor, GESTOR_SETOR, { customerIds: [hospital], locationIds: [uti] });
  await membro(memOperador, OPERADOR, { customerIds: [hospital], locationIds: [uti] });
  await membro(memAlvo, ALVO, { customerIds: [hospital], locationIds: [uti] });
  await membro(memCoordenador, COORDENADOR, {});
  await withTenant(t.db, sys, async (s) => {
    await assignRole(s, memGestor, papeis.get('manager')!);
    await assignRole(s, memGestorSetor, papeis.get('manager')!);
    await assignRole(s, memOperador, papeis.get('operator')!);
    await assignRole(s, memAlvo, papeis.get('requester')!);
    await assignRole(s, memCoordenador, papeis.get('coordinator')!);
    // Fechamento de período: o evento carrega excedente e multa em reais.
    await emitEvent(s, {
      type: 'contract.period_closed',
      aggregateType: 'contract',
      aggregateId: ctA,
      payload: { period: '2026-09', overageAmount: '1234.56', penaltyAmount: '78.90' },
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

const convidar = (como: string, body: Record<string, unknown>) =>
  http.post('/v1/organizations/current/members').set(auth(como)).send(body);

describe('P0 — escalada de papel pelo GESTOR', () => {
  it('convite com role_keys owner/admin → 403, e nada é criado', async () => {
    for (const papel of ['owner', 'admin']) {
      const r = await convidar(GESTOR, {
        email: `esc-${papel}@pente-fino.test`,
        name: 'Escalada',
        role_keys: [papel],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
    }
    const lista = await http.get('/v1/organizations/current/members').set(auth(ADMIN));
    expect(lista.body.items.map((m: { email: string }) => m.email)).not.toContain(
      'esc-admin@pente-fino.test'
    );
  });

  it('perfil OPERADOR: delegar trabalho operacional não é escalada → 201', async () => {
    // O Operador executa OS — o Gestor não. Mas cadastrar a equipe é o trabalho
    // do Gestor; escalada é conceder poder de ADMINISTRAR.
    const r = await convidar(GESTOR, {
      email: 'op-novo@pente-fino.test',
      name: 'Op Novo',
      profile: 'operator',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('perfil SOLICITANTE (subconjunto do Gestor) → 201', async () => {
    const r = await convidar(GESTOR, {
      email: 'sol-novo@pente-fino.test',
      name: 'Sol Novo',
      profile: 'requester',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('PUT /memberships/:id/roles: conceder admin/owner → 403; requester → 200', async () => {
    const admin = await http
      .put(`/v1/memberships/${memAlvo}/roles`)
      .set(auth(GESTOR))
      .send({ role_ids: [papeis.get('admin')] });
    expect(admin.status, JSON.stringify(admin.body)).toBe(403);
    const dono = await http
      .put(`/v1/memberships/${memAlvo}/roles`)
      .set(auth(GESTOR))
      .send({ role_ids: [papeis.get('requester'), papeis.get('owner')] });
    expect(dono.status).toBe(403);

    const ok = await http
      .put(`/v1/memberships/${memAlvo}/roles`)
      .set(auth(GESTOR))
      .send({ role_ids: [papeis.get('requester')] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('ninguém altera os próprios papéis', async () => {
    const r = await http
      .put(`/v1/memberships/${memGestor}/roles`)
      .set(auth(GESTOR))
      .send({ role_ids: [papeis.get('manager'), papeis.get('maintenance_manager')] });
    expect(r.status).toBe(403);
  });

  it('nem tirar o papel de Administrador de quem o tem', async () => {
    const r = await http
      .put(`/v1/memberships/${ids.membershipId}/roles`)
      .set(auth(GESTOR))
      .send({ role_ids: [] });
    expect(r.status).toBe(403);
    const ainda = await http.get('/v1/organizations/current/members').set(auth(ADMIN));
    expect(ainda.status).toBe(200);
  });

  it('exceção pontual que concede o que o administrador não tem → 403', async () => {
    const r = await http
      .put(`/v1/memberships/${memAlvo}/permissions/organization.manage_billing`)
      .set(auth(ADMIN))
      .send({ effect: 'grant', reason: 'tentativa de escalada' });
    expect(r.status).toBe(403);
  });
});

describe('P1 — escopo concedido', () => {
  it('ninguém ajusta o próprio escopo', async () => {
    const r = await http
      .patch(`/v1/organizations/current/members/${memGestorSetor}/scope`)
      .set(auth(GESTOR_SETOR))
      .send({ customer_scope: 'all', location_scope: 'all' });
    expect(r.status).toBe(403);
  });

  it('gestor restrito não concede "todos" nem cliente fora do seu escopo', async () => {
    const todos = await http
      .patch(`/v1/organizations/current/members/${memAlvo}/scope`)
      .set(auth(GESTOR_SETOR))
      .send({ customer_scope: 'all' });
    expect(todos.status).toBe(403);
    const fora = await http
      .patch(`/v1/organizations/current/members/${memAlvo}/scope`)
      .set(auth(GESTOR_SETOR))
      .send({ customer_scope: 'listed', customer_ids: [outroHospital] });
    expect(fora.status).toBe(404);
  });

  it('convite do gestor restrito: sem escopo (= todos) → 403; dentro do escopo → 201', async () => {
    const semEscopo = await convidar(GESTOR_SETOR, {
      email: 'x1@pente-fino.test',
      name: 'Xis',
      profile: 'requester',
    });
    expect(semEscopo.status).toBe(403);
    const dentro = await convidar(GESTOR_SETOR, {
      email: 'x2@pente-fino.test',
      name: 'Xis Dois',
      profile: 'requester',
      customer_scope: 'listed',
      customer_ids: [hospital],
      location_scope: 'listed',
      location_ids: [uti],
    });
    expect(dentro.status, JSON.stringify(dentro.body)).toBe(201);
  });
});

describe('P1 — ScopeGuard não é contornado pelo caminho', () => {
  const codificaPrimeiro = (id: string) => `%${id.charCodeAt(0).toString(16)}${id.slice(1)}`;

  it('maiúsculas, %XX e barras repetidas na OS de outro cliente → 404', async () => {
    const caminhos = [
      `/v1/Work-Orders/${osOutro}`,
      `/v1/WORK-ORDERS/${osOutro.toUpperCase()}`,
      `/v1/work-orders/${codificaPrimeiro(osOutro)}`,
      `/v1/work-orders//${osOutro}`,
    ];
    for (const c of caminhos) {
      const r = await http.get(c).set(auth(OPERADOR));
      expect(r.status, c).toBe(404);
    }
  });

  it('o mesmo truque na OS do próprio setor continua 200 (o roteador aceita a grafia)', async () => {
    expect((await http.get(`/v1/Work-Orders/${osUti}`).set(auth(OPERADOR))).status).toBe(200);
    expect((await http.get(`/v1/work-orders/${codificaPrimeiro(osUti)}`).set(auth(OPERADOR))).status).toBe(
      200
    );
  });

  it('codificação inválida não passa sem conferência', async () => {
    const r = await http.get(`/v1/work-orders/%zz${osOutro.slice(3)}`).set(auth(OPERADOR));
    expect([400, 404, 422]).toContain(r.status);
  });
});

describe('P1 — escopo nas rotas de equipe', () => {
  it('documentos: a lista e o detalhe só do escopo; PDF e por-ativo também', async () => {
    const lista = await http.get('/v1/documents').set(auth(OPERADOR));
    expect(lista.status).toBe(200);
    expect(lista.body.items.map((d: { id: string }) => d.id).sort()).toEqual([docA, docDerivado].sort());
    expect((await http.get(`/v1/documents/${docA}`).set(auth(OPERADOR))).status).toBe(200);
    expect((await http.get(`/v1/documents/${docB}`).set(auth(OPERADOR))).status).toBe(404);
    expect((await http.get(`/v1/documents/${docB}/pdf`).set(auth(OPERADOR))).status).toBe(404);
    expect((await http.get(`/v1/documents/${docInterno}`).set(auth(OPERADOR))).status).toBe(404);
    const porAtivo = await http.get(`/v1/documents/by-asset?assetId=${ativoOutro}`).set(auth(OPERADOR));
    expect(porAtivo.body.items).toEqual([]);

    const tudo = await http.get('/v1/documents').set(auth(ADMIN));
    expect(tudo.body.items).toHaveLength(4);
  });

  it('contratos: lista, detalhe e ativos só do cliente do escopo', async () => {
    const lista = await http.get('/v1/contracts').set(auth(GESTOR_SETOR));
    expect(lista.status).toBe(200);
    expect(lista.body.items.map((c: { id: string }) => c.id)).toEqual([ctA]);
    expect((await http.get(`/v1/contracts/${ctA}`).set(auth(GESTOR_SETOR))).status).toBe(200);
    expect((await http.get(`/v1/contracts/${ctB}`).set(auth(GESTOR_SETOR))).status).toBe(404);
    expect((await http.get(`/v1/contracts/${ctB}/assets`).set(auth(GESTOR_SETOR))).status).toBe(404);
  });

  it('linha do tempo: o escopo é o do registro', async () => {
    expect((await http.get(`/v1/audit/timeline/contracts/${ctA}`).set(auth(GESTOR_SETOR))).status).toBe(200);
    expect((await http.get(`/v1/audit/timeline/contracts/${ctB}`).set(auth(GESTOR_SETOR))).status).toBe(404);
    expect((await http.get(`/v1/audit/timeline/assets/${ativoOutro}`).set(auth(OPERADOR))).status).toBe(404);
    expect((await http.get(`/v1/audit/timeline/documents/${docB}`).set(auth(OPERADOR))).status).toBe(404);
  });

  it('linha do tempo não mostra o diff de campo financeiro a quem não pode lê-lo', async () => {
    const campos = (body: { items: { changes: Record<string, unknown> | null }[] }) =>
      body.items.flatMap((i) => Object.keys(i.changes ?? {}));
    const admin = await http.get(`/v1/audit/timeline/assets/${ativoUti}`).set(auth(ADMIN));
    expect(campos(admin.body)).toContain('purchase_value');
    const op = await http.get(`/v1/audit/timeline/assets/${ativoUti}`).set(auth(OPERADOR));
    expect(op.status).toBe(200);
    expect(campos(op.body)).not.toContain('purchase_value');
  });

  it('linha do tempo não mostra excedente e multa do contrato a quem não lê o financeiro', async () => {
    type Item = { payload: Record<string, unknown> | null };
    const chaves = (body: { items: Item[] }) => body.items.flatMap((i) => Object.keys(i.payload ?? {}));
    const admin = await http.get(`/v1/audit/timeline/contracts/${ctA}`).set(auth(ADMIN));
    expect(chaves(admin.body)).toContain('penaltyAmount');
    const coord = await http.get(`/v1/audit/timeline/contracts/${ctA}`).set(auth(COORDENADOR));
    expect(coord.status, JSON.stringify(coord.body)).toBe(200);
    expect(chaves(coord.body)).toContain('period');
    expect(chaves(coord.body)).not.toContain('penaltyAmount');
    expect(chaves(coord.body)).not.toContain('overageAmount');
  });

  it('documento sem cliente informado herda o do equipamento; divergente é recusado', async () => {
    const lista = await http.get('/v1/documents').set(auth(OPERADOR));
    expect(lista.status).toBe(200);
    expect(lista.body.items.map((d: { id: string }) => d.id)).toContain(docDerivado);
    const ctx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'doc-divergente' });
    await expect(
      withTenant(t.db, ctx, (s) =>
        createDocument(s, {
          documentTypeId: tipoDocumento,
          title: 'Laudo trocado',
          assetId: ativoUti,
          customerId: outroHospital,
        })
      )
    ).rejects.toThrow('não é o cliente da OS/equipamento');
  });

  it('busca: documento de outro cliente não aparece', async () => {
    const r = await http.get('/v1/search?q=laudo').set(auth(OPERADOR));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const docs = r.body.hits
      .filter((h: { scope: string }) => h.scope === 'document')
      .map((h: { id: string }) => h.id);
    expect([...docs].sort()).toEqual([docA, docDerivado].sort());
  });

  it('local novo com cliente fora do escopo → 404', async () => {
    const r = await http
      .post('/v1/locations')
      .set(auth(GESTOR_SETOR))
      .send({ customer_id: outroHospital, parent_id: null, location_type_id: newId(), name: 'Invasão' });
    expect(r.status).toBe(404);
  });
});

describe('P2 — Operador não cadastra equipamento', () => {
  it('POST /assets → 403', async () => {
    const r = await http.post('/v1/assets').set(auth(OPERADOR)).send({ name: 'X', customer_id: hospital });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('asset.create');
  });
});

describe('normalização do caminho (unidade)', () => {
  const id = '0193dd00-0001-7000-8000-00000000abcd';

  it('maiúsculas e %XX caem na mesma regra', () => {
    expect(entidadeDoCaminho(`/v1/Work-Orders/${id}`)).toEqual({ origem: 'work_order', id });
    expect(entidadeDoCaminho(`/v1/work-orders/${id.toUpperCase()}/close`)).toEqual({
      origem: 'work_order',
      id,
    });
    expect(entidadeDoCaminho(`/v1/work-orders/%30${id.slice(1)}`)).toEqual({ origem: 'work_order', id });
    expect(entidadeDoCaminho(`/v1/%77ork-orders/${id}`)).toEqual({ origem: 'work_order', id });
    expect(entidadeDoCaminho(`//v1//documents/${id}/pdf?x=1`)).toEqual({ origem: 'document', id });
    expect(entidadeDoCaminho(`/v1/audit/timeline/contracts/${id}`)).toEqual({ origem: 'contract', id });
    expect(entidadeDoCaminho(`/v1/maintenance-plans/cycle-items/${id}/skip`)).toEqual({
      origem: 'plan_cycle_item',
      id,
    });
  });

  it('codificação inválida não normaliza', () => {
    expect(normalizarCaminho(`/v1/work-orders/%zz${id}`)).toBeNull();
    expect(normalizarCaminho('/V1//Assets/%41b')).toBe('/v1/assets/ab');
  });

  it('caminho sem entidade continua sem regra', () => {
    expect(entidadeDoCaminho('/v1/work-orders')).toBeNull();
    expect(entidadeDoCaminho('/v1/documents/by-asset')).toBeNull();
  });
});
