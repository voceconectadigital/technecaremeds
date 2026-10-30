/**
 * Aurora — cadastros de pessoa e de cliente, setor na solicitação e o que o Operador não altera
 * (rodada 29/10/2026).
 *
 *   · USR-04  telefone brasileiro com DDD; conselho exigido conforme a profissão (só ele);
 *   · USR-05  CNPJ da empresa da pessoa, opcional, pelos dígitos verificadores;
 *   · CLI-02  "Outro EAS"/"Outra empresa" fora do cadastro NOVO; o cliente antigo segue editável;
 *   · CLI-03  "Criar setores padrão" provisiona Pronto Atendimento, Bloco Cirúrgico, UTI e
 *             Enfermaria, e o cliente continua criando setores;
 *   · SOL-01  cliente → setor → equipamento, conferido no servidor e no escopo;
 *   · USR-09/USR-11  o RBAC do servidor recusa ao Operador as alterações de cadastro gerencial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import { newId } from '@aurora/domain';
import { createTestDatabase, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  createAsset,
  createCustomer,
  createLocation,
  provisionStarterLocationTypes,
} from '@aurora/db';
import { customersCreate, membersDetail } from '@aurora/contracts';
import { auth, criarOrganizacao, criarPessoa, ctxSistema, subirApi, type OrgDeTeste } from './apoio/cenario';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let A: OrgDeTeste;
let B: OrgDeTeste;
let operador: { email: string; mem: string };
let restrito: { email: string; mem: string };
let blocoA = '';
let salaDaUti = '';
let ventiladorUti = '';
let bisturiBloco = '';
let monitorNaSala = '';
let clienteAntigo = '';
let setorDeB = '';

beforeAll(async () => {
  t = await createTestDatabase();
  A = await criarOrganizacao(t, 'cad-a');
  B = await criarOrganizacao(t, 'cad-b');

  await withTenant(t.db, ctxSistema(A.org), async (s) => {
    const tipos = await provisionStarterLocationTypes(s);
    blocoA = await createLocation(s, {
      customerId: A.cliente,
      parentId: A.unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'Bloco Cirúrgico',
    });
    salaDaUti = await createLocation(s, {
      customerId: A.cliente,
      parentId: A.setor,
      locationTypeId: tipos.get('sala')!,
      name: 'Leito 3',
    });
    ventiladorUti = await createAsset(s, {
      name: 'Ventilador UTI',
      tag: 'VNT-UTI',
      customerId: A.cliente,
      assetCategoryId: A.categoria,
      locationId: A.setor,
    });
    bisturiBloco = await createAsset(s, {
      name: 'Bisturi do Bloco',
      tag: 'BIS-BLC',
      customerId: A.cliente,
      assetCategoryId: A.categoria,
      locationId: blocoA,
    });
    monitorNaSala = await createAsset(s, {
      name: 'Monitor do Leito 3',
      tag: 'MON-L3',
      customerId: A.cliente,
      assetCategoryId: A.categoria,
      locationId: salaDaUti,
    });
    // Cliente cadastrado ANTES da CLI-02, com o segmento que saiu das opções.
    clienteAntigo = await createCustomer(s, { name: 'Clínica Antiga', kind: 'eas', subtype: 'outro_eas' });
  });
  setorDeB = B.setor;

  operador = await criarPessoa(t, A, 'operador', 'operator');
  // Restrito ao hospital de A, e só à UTI.
  restrito = await criarPessoa(t, A, 'restrito', 'technician', { customerIds: [A.cliente] });
  await t.raw(
    `UPDATE aurora.membership_scopes SET location_scope = 'listed', location_ids = ARRAY[$2]::uuid[]
      WHERE membership_id = $1`,
    [restrito.mem, A.setor]
  );
  ({ app, http } = await subirApi(t.db));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

const convidar = (body: Record<string, unknown>) =>
  http.post('/v1/organizations/current/members').set(auth(A.email)).send(body);

describe('USR-04 · telefone e conselho conforme a profissão', () => {
  it('telefone sem DDD, com DDD inexistente ou celular sem o 9 → 422 no campo phone', async () => {
    for (const phone of ['99999-0000', '(20) 99999-0000', '(31) 89999-0000']) {
      const r = await convidar({
        email: `tel${phone.length}${newId().slice(0, 4)}@cad-a.test`,
        name: 'Teo Telefone',
        profile: 'operator',
        phone,
      });
      expect(r.status, phone).toBe(422);
      expect(r.body.details.field).toBe('phone');
    }
  });

  it('telefone válido (fixo ou celular) é gravado num formato só', async () => {
    const r = await convidar({
      email: 'fixo@cad-a.test',
      name: 'Fábio Fixo',
      profile: 'requester',
      phone: '+55 31 3333 0000',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const ficha = await http
      .get(`/v1/organizations/current/members/${r.body.membership_id}`)
      .set(auth(A.email));
    expect(ficha.body.phone).toBe('(31) 3333-0000');
  });

  it('Engenheiro sem CREA → 422; com CREA → 201 (e não precisa de CRM, COREN…)', async () => {
    const sem = await convidar({
      email: 'eng@cad-a.test',
      name: 'Érica Engenheira',
      profile: 'operator',
      job_title: 'Engenheiro(a)',
      registrations: [{ kind: 'CRM', number: '12345' }],
    });
    expect(sem.status).toBe(422);
    expect(sem.body.details.field).toBe('registrations');
    expect(sem.body.message).toMatch(/CREA/);

    const com = await convidar({
      email: 'eng@cad-a.test',
      name: 'Érica Engenheira',
      profile: 'operator',
      job_title: 'Engenheiro(a)',
      phone: '(31) 99999-0000',
      registrations: [{ kind: 'CREA', number: 'MG-123456', region: 'MG' }],
    });
    expect(com.status, JSON.stringify(com.body)).toBe(201);
  });

  it('profissão sem conselho obrigatório (Gerente) não exige registro', async () => {
    const r = await convidar({
      email: 'gerente@cad-a.test',
      name: 'Gil Gerente',
      profile: 'manager',
      job_title: 'Gerente',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('na edição vale o estado que FICA: virar Médico sem CRM é recusado, e nada muda', async () => {
    const r = await convidar({
      email: 'tec@cad-a.test',
      name: 'Tito Técnico',
      profile: 'operator',
      job_title: 'Técnico(a)',
      registrations: [{ kind: 'CFT', number: '998877' }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const mem = r.body.membership_id as string;
    const url = `/v1/organizations/current/members/${mem}`;

    const medico = await http.patch(url).set(auth(A.email)).send({ job_title: 'Médico(a)' });
    expect(medico.status).toBe(422);
    expect((await http.get(url).set(auth(A.email))).body.job_title).toBe('Técnico(a)');

    // Tirar o CFT de um técnico também é recusado.
    expect((await http.patch(url).set(auth(A.email)).send({ registrations: [] })).status).toBe(422);
    // Profissão e registro juntos: passa.
    const ok = await http
      .patch(url)
      .set(auth(A.email))
      .send({ job_title: 'Médico(a)', registrations: [{ kind: 'CRM', number: '55555', region: 'MG' }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});

describe('USR-05 · CNPJ da empresa da pessoa', () => {
  it('opcional; quando vem, é conferido pelos dígitos verificadores e gravado sem pontuação', async () => {
    const r = await convidar({
      email: 'cnpj@cad-a.test',
      name: 'Carla CNPJ',
      profile: 'operator',
      company_name: 'Prestadora Exemplo',
      company_tax_id: '11.222.333/0001-81',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const url = `/v1/organizations/current/members/${r.body.membership_id}`;
    const ficha = await http.get(url).set(auth(A.email));
    expect(membersDetail.response.safeParse(ficha.body).success).toBe(true);
    expect(ficha.body.company_name).toBe('Prestadora Exemplo');
    expect(ficha.body.company_tax_id).toBe('11222333000181');

    // O alfanumérico da Receita também vale; vazio limpa.
    expect(
      (await http.patch(url).set(auth(A.email)).send({ company_tax_id: '12.ABC.345/01DE-35' })).status
    ).toBe(200);
    expect((await http.get(url).set(auth(A.email))).body.company_tax_id).toBe('12ABC34501DE35');
    expect((await http.patch(url).set(auth(A.email)).send({ company_tax_id: '' })).status).toBe(200);
    expect((await http.get(url).set(auth(A.email))).body.company_tax_id).toBeNull();
  });

  it('dígito verificador errado → 422 no campo company_tax_id', async () => {
    const r = await convidar({
      email: 'cnpj2@cad-a.test',
      name: 'Carlos CNPJ',
      profile: 'operator',
      company_tax_id: '11.222.333/0001-82',
    });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('company_tax_id');
  });
});

describe('CLI-02 · "Outro EAS"/"Outra empresa" só para o cliente antigo', () => {
  it('cadastro NOVO com o segmento retirado → 422 no campo subtype', async () => {
    for (const [kind, subtype] of [
      ['eas', 'outro_eas'],
      ['corporate', 'outro_corporativo'],
    ]) {
      const r = await http
        .post('/v1/customers')
        .set(auth(A.email))
        .send({ name: `Novo ${subtype}`, kind, subtype });
      expect(r.status, subtype).toBe(422);
      expect(r.body.details.field).toBe('subtype');
    }
  });

  it('o cliente antigo continua exibido com o segmento e editável sem trocá-lo', async () => {
    const ficha = await http.get(`/v1/customers/${clienteAntigo}`).set(auth(A.email));
    expect(ficha.body.customer.subtype).toBe('outro_eas');
    const nome = await http
      .patch(`/v1/customers/${clienteAntigo}`)
      .set(auth(A.email))
      .send({ name: 'Clínica Antiga Ltda' });
    expect(nome.status, JSON.stringify(nome.body)).toBe(200);
    expect(nome.body.subtype).toBe('outro_eas');
    // Reenviar o mesmo segmento (o formulário manda tudo) também passa.
    const mesmo = await http
      .patch(`/v1/customers/${clienteAntigo}`)
      .set(auth(A.email))
      .send({ subtype: 'outro_eas' });
    expect(mesmo.status).toBe(200);
    // E pode sair dele para um segmento da lista.
    const sai = await http
      .patch(`/v1/customers/${clienteAntigo}`)
      .set(auth(A.email))
      .send({ subtype: 'clinica' });
    expect(sai.status).toBe(200);
  });

  it('um cliente com segmento da lista não passa PARA o segmento retirado', async () => {
    const r = await http
      .patch(`/v1/customers/${A.cliente}`)
      .set(auth(A.email))
      .send({ kind: 'eas', subtype: 'outro_eas' });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('subtype');
  });
});

describe('CLI-03 · setores padrão do EAS', () => {
  it('EAS com "Criar setores padrão" nasce com a unidade e os quatro setores', async () => {
    const r = await http
      .post('/v1/customers')
      .set(auth(A.email))
      .send({ name: 'Hospital Novo', kind: 'eas', subtype: 'hospital', create_default_sectors: true });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(customersCreate.response.safeParse(r.body).success).toBe(true);
    expect(r.body.default_sectors_created).toBe(4);
    expect(r.body.location_count).toBe(5);

    const ficha = await http.get(`/v1/customers/${r.body.id}`).set(auth(A.email));
    const setores = ficha.body.locations
      .filter((l: { location_type_key: string }) => l.location_type_key === 'setor')
      .map((l: { name: string }) => l.name)
      .sort();
    expect(setores).toEqual(['Bloco Cirúrgico', 'Enfermaria', 'Pronto Atendimento', 'UTI']);
    const unidade = ficha.body.locations.find(
      (l: { location_type_key: string }) => l.location_type_key === 'unidade'
    );
    expect(unidade.name).toBe('Hospital Novo');
    expect(
      ficha.body.locations
        .filter((l: { location_type_key: string }) => l.location_type_key === 'setor')
        .every(
          (l: { parent_id: string; allows_assets: boolean }) => l.parent_id === unidade.id && l.allows_assets
        )
    ).toBe(true);

    // A inclusão de setor novo continua.
    const tipos = await http.get('/v1/location-types').set(auth(A.email));
    const tipoSetor = tipos.body.items.find((x: { key: string }) => x.key === 'setor').id;
    const novo = await http.post('/v1/locations').set(auth(A.email)).send({
      customer_id: r.body.id,
      parent_id: unidade.id,
      location_type_id: tipoSetor,
      name: 'Hemodiálise',
    });
    expect(novo.status, JSON.stringify(novo.body)).toBe(201);
  });

  it('sem a opção, ou para empresa corporativa, nenhum local nasce', async () => {
    const sem = await http
      .post('/v1/customers')
      .set(auth(A.email))
      .send({ name: 'Clínica Sem Setores', kind: 'eas' });
    expect(sem.status).toBe(201);
    expect(sem.body.default_sectors_created).toBe(0);
    expect(sem.body.location_count).toBe(0);
    const corp = await http
      .post('/v1/customers')
      .set(auth(A.email))
      .send({ name: 'Engenharia Parceira', kind: 'corporate', create_default_sectors: true });
    expect(corp.status).toBe(201);
    expect(corp.body.default_sectors_created).toBe(0);
  });

  it('quem não cria local não pede os setores padrão (403); o cliente não fica pela metade', async () => {
    await t.raw(
      `INSERT INTO aurora.membership_permission_overrides (organization_id, membership_id, permission_key, effect, reason)
       VALUES ($1, $2, 'location.create', 'deny', 'prova de recorte')`,
      [A.org, A.mem]
    );
    try {
      const r = await http
        .post('/v1/customers')
        .set(auth(A.email))
        .send({ name: 'Hospital Sem Permissão', kind: 'eas', create_default_sectors: true });
      expect(r.status).toBe(403);
      const lista = await http.get('/v1/customers').set(auth(A.email));
      expect(lista.body.items.map((c: { name: string }) => c.name)).not.toContain('Hospital Sem Permissão');
    } finally {
      await t.raw(`DELETE FROM aurora.membership_permission_overrides WHERE membership_id = $1`, [A.mem]);
    }
  });
});

describe('SOL-01 · cliente → setor → equipamento, conferido no servidor', () => {
  const abrir = (email: string, over: Record<string, unknown>) =>
    http
      .post('/v1/service-requests')
      .set(auth(email))
      .send({
        customer_id: A.cliente,
        summary: 'Equipamento alarmando',
        requested_type: 'corrective',
        source: 'phone',
        requester_name: 'Ramal UTI',
        requester_phone: '3133330000',
        ...over,
      });

  it('a lista do setor tem só os equipamentos dele (inclusive os das salas dentro dele)', async () => {
    const r = await http.get(`/v1/assets?customer=${A.cliente}&location=${A.setor}`).set(auth(A.email));
    expect(r.body.items.map((a: { name: string }) => a.name).sort()).toEqual([
      'Monitor do Leito 3',
      'Ventilador UTI',
    ]);
  });

  it('equipamento do setor escolhido: aceito, e a solicitação nasce no local exato do equipamento', async () => {
    const r = await abrir(A.email, { location_id: A.setor, asset_id: monitorNaSala });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const ficha = await http.get(`/v1/service-requests/${r.body.id}`).set(auth(A.email));
    expect(ficha.body.location_id).toBe(salaDaUti);
    const direto = await abrir(A.email, { location_id: A.setor, asset_id: ventiladorUti });
    expect(direto.status).toBe(201);
  });

  it('equipamento de OUTRO setor do mesmo cliente → 422 no campo asset_id', async () => {
    const r = await abrir(A.email, { location_id: A.setor, asset_id: bisturiBloco });
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('asset_id');
  });

  it('setor de outro cliente/organização, ou fora do escopo de quem abre → 422 no campo location_id', async () => {
    const deB = await abrir(A.email, { location_id: setorDeB, asset_id: ventiladorUti });
    expect(deB.status).toBe(422);
    expect(deB.body.details.field).toBe('location_id');
    // O restrito só alcança a UTI: o Bloco é fora do escopo, com ou sem equipamento.
    const fora = await abrir(restrito.email, { location_id: blocoA });
    expect(fora.status).toBe(422);
    expect(fora.body.details.field).toBe('location_id');
    const foraComAtivo = await abrir(restrito.email, { location_id: blocoA, asset_id: bisturiBloco });
    expect(foraComAtivo.status).toBe(422);
    const dentro = await abrir(restrito.email, { location_id: A.setor, asset_id: ventiladorUti });
    expect(dentro.status, JSON.stringify(dentro.body)).toBe(201);
  });
});

describe('USR-09 / USR-11 · o RBAC do servidor recusa ao Operador as alterações gerenciais', () => {
  it('cadastro gerencial: cliente, local, equipamento, catálogo, plano, procedimento e pessoas → 403', async () => {
    const id = newId();
    const tentativas: Array<[string, () => PromiseLike<{ status: number }>]> = [
      ['POST /customers', () => http.post('/v1/customers').set(auth(operador.email)).send({ name: 'X' })],
      [
        'PATCH /customers/:id',
        () => http.patch(`/v1/customers/${A.cliente}`).set(auth(operador.email)).send({ name: 'Y' }),
      ],
      [
        'POST /locations',
        () =>
          http.post('/v1/locations').set(auth(operador.email)).send({ customer_id: A.cliente, name: 'Z' }),
      ],
      [
        'PATCH /locations/:id',
        () => http.patch(`/v1/locations/${A.setor}`).set(auth(operador.email)).send({ name: 'W' }),
      ],
      [
        'PATCH /assets/:id',
        () => http.patch(`/v1/assets/${ventiladorUti}`).set(auth(operador.email)).send({ name: 'Renomeado' }),
      ],
      [
        'POST /assets/:id/transfer',
        () =>
          http
            .post(`/v1/assets/${ventiladorUti}/transfer`)
            .set(auth(operador.email))
            .send({ to_location_id: blocoA, reason: 'mudança' }),
      ],
      [
        'POST /assets/:id/decommission',
        () =>
          http
            .post(`/v1/assets/${ventiladorUti}/decommission`)
            .set(auth(operador.email))
            .send({ reason: 'fim da vida útil declarado' }),
      ],
      [
        'POST /asset-categories',
        () => http.post('/v1/asset-categories').set(auth(operador.email)).send({ name: 'Tipo' }),
      ],
      [
        'POST /maintenance-plans',
        () => http.post('/v1/maintenance-plans').set(auth(operador.email)).send({}),
      ],
      [
        'POST /checklist-templates',
        () => http.post('/v1/checklist-templates').set(auth(operador.email)).send({}),
      ],
      [
        'POST /members',
        () =>
          http
            .post('/v1/organizations/current/members')
            .set(auth(operador.email))
            .send({ email: 'x@cad-a.test', name: 'X' }),
      ],
      [
        'PATCH /members/:id',
        () =>
          http
            .patch(`/v1/organizations/current/members/${operador.mem}`)
            .set(auth(operador.email))
            .send({ job_title: 'Gerente' }),
      ],
      [
        'PUT /memberships/:id/roles',
        () =>
          http
            .put(`/v1/memberships/${operador.mem}/roles`)
            .set(auth(operador.email))
            .send({ role_ids: [id] }),
      ],
    ];
    for (const [rota, chamar] of tentativas) {
      const r = await chamar();
      expect(r.status, rota).toBe(403);
    }
  });

  it('a recusa é do servidor, não da tela: o equipamento continua igual', async () => {
    const ficha = await http.get(`/v1/assets/${ventiladorUti}`).set(auth(operador.email));
    expect(ficha.status).toBe(200);
    expect(ficha.body.name).toBe('Ventilador UTI');
    expect(ficha.body.location_id).toBe(A.setor);
  });
});
