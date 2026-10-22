/**
 * Aurora — Qualidade: o lugar dos certificados, pela HTTP (conversa com o cliente, 21/10/2026).
 *
 *   · cadastro dos quatro tipos, com as regras de cada um (treinamento é de pessoa);
 *   · vigência CALCULADA na consulta (vigente, vencendo, vencido, sem validade), vencidos primeiro;
 *   · o arquivo sobe e desce (PDF e imagem), com o mesmo conteúdo; outro tipo é recusado;
 *   · escopo por cliente e isolamento entre organizações.
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
  provisionOrganizationBaseline,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';
import { armazenamentoEmMemoria } from '../common/arquivos/memoria';

const ORG_A = newId();
const ORG_B = newId();
const GESTORA = 'gestora@qual-a.test';
const SOLICITANTE = 'solicitante@qual-a.test';
const ADMIN_B = 'admin@qual-b.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let hospital: string, outroHospital: string, ativo: string;

const hoje = new Date();
const dia = (deslocamentoEmDias: number) =>
  new Date(hoje.getTime() + deslocamentoEmDias * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await createTestDatabase();
  const idsA = { organizationId: ORG_A, userId: newId(), membershipId: newId() };
  const idsB = { organizationId: ORG_B, userId: newId(), membershipId: newId() };
  await seedOrganization(t, idsA, { slug: 'qual-a', name: 'Org A', email: GESTORA, userName: 'Gestora' });
  await seedOrganization(t, idsB, { slug: 'qual-b', name: 'Org B', email: ADMIN_B, userName: 'Admin B' });

  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, idsA.membershipId, base.roles.get('maintenance_manager')!);
      hospital = await createCustomer(s, { name: 'Hospital Alfa' });
      outroHospital = await createCustomer(s, { name: 'Hospital Beta' });
      const sede = await createLocation(s, {
        customerId: hospital,
        locationTypeId: base.locationTypes.get('unidade')!,
        name: 'Sede',
      });
      const uti = await createLocation(s, {
        customerId: hospital,
        parentId: sede,
        locationTypeId: base.locationTypes.get('setor')!,
        name: 'UTI',
      });
      const cat = await createAssetCategory(s, { name: 'Ventilador' });
      ativo = await createAsset(s, {
        name: 'Ventilador 01',
        customerId: hospital,
        assetCategoryId: cat,
        locationId: uti,
      });
    }
  );
  const memSol = newId();
  await seedMember(
    t,
    { organizationId: ORG_A, userId: newId(), membershipId: memSol },
    { email: SOLICITANTE, userName: 'Solicitante', seatType: 'portal', customerIds: [hospital] }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_A, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memSol, base.roles.get('requester')!);
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG_B, actorKind: 'system', requestId: 's3' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, idsB.membershipId, base.roles.get('admin')!);
    }
  );

  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);
  app = await createApp({ db: t.db, env, arquivos: armazenamentoEmMemoria() });
  await app.init();
  http = request(app.getHttpServer());
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

const criar = (quem: string, corpo: Record<string, unknown>) =>
  http.post('/v1/quality-records').set(auth(quem)).send(corpo);

describe('cadastro', () => {
  it('calibração de um equipamento: o cliente vem do equipamento', async () => {
    const r = await criar(GESTORA, {
      kind: 'calibration',
      title: 'Calibração do ventilador',
      asset_id: ativo,
      certificate_number: 'CAL-123',
      issuer: 'Lab Acreditado Ltda',
      issued_at: dia(-300),
      valid_until: dia(65),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('treinamento é de PESSOA: sem o nome de quem foi treinado, 422', async () => {
    const sem = await criar(GESTORA, {
      kind: 'training',
      title: 'Uso seguro de ventiladores',
      issued_at: dia(-10),
    });
    expect(sem.status).toBe(422);
    const com = await criar(GESTORA, {
      kind: 'training',
      title: 'Uso seguro de ventiladores',
      person_name: 'Marta Enfermeira',
      issued_at: dia(-10),
      valid_until: dia(355),
    });
    expect(com.status, JSON.stringify(com.body)).toBe(201);
  });

  it('os demais pedem equipamento ou cliente; validade anterior à emissão é recusada', async () => {
    expect((await criar(GESTORA, { kind: 'qualification', title: 'Q', issued_at: dia(-1) })).status).toBe(
      422
    );
    expect(
      (
        await criar(GESTORA, {
          kind: 'electrical_safety',
          title: 'TSE do ventilador',
          asset_id: ativo,
          issued_at: dia(-1),
          valid_until: dia(-30),
        })
      ).status
    ).toBe(422);
  });

  it('equipamento de um cliente com o cliente de outro: recusado', async () => {
    const r = await criar(GESTORA, {
      kind: 'electrical_safety',
      title: 'TSE',
      asset_id: ativo,
      customer_id: outroHospital,
      issued_at: dia(-1),
    });
    expect(r.status).toBe(422);
  });
});

describe('a vigência é calculada, e os vencidos vêm primeiro', () => {
  it('vencido, vencendo, vigente e sem validade', async () => {
    await criar(GESTORA, {
      kind: 'electrical_safety',
      title: 'TSE vencido',
      customer_id: hospital,
      issued_at: dia(-400),
      valid_until: dia(-5),
    });
    await criar(GESTORA, {
      kind: 'electrical_safety',
      title: 'TSE vencendo',
      customer_id: hospital,
      issued_at: dia(-350),
      valid_until: dia(10),
    });
    await criar(GESTORA, {
      kind: 'qualification',
      title: 'Qualificação sem validade',
      customer_id: hospital,
      issued_at: dia(-20),
    });

    const tse = await http.get('/v1/quality-records?kind=electrical_safety').set(auth(GESTORA));
    expect(tse.body.items.map((i: { title: string; status: string }) => [i.title, i.status])).toEqual([
      ['TSE vencido', 'expired'],
      ['TSE vencendo', 'expiring'],
    ]);

    const todos = await http.get('/v1/quality-records').set(auth(GESTORA));
    const porTitulo = Object.fromEntries(
      todos.body.items.map((i: { title: string; status: string }) => [i.title, i.status])
    );
    expect(porTitulo['Calibração do ventilador']).toBe('valid');
    expect(porTitulo['Qualificação sem validade']).toBe('no_validity');
    // Os vencidos abrem a lista.
    expect(todos.body.items[0].status).toBe('expired');

    const so = await http.get('/v1/quality-records?status=expiring').set(auth(GESTORA));
    expect(so.body.items.map((i: { title: string }) => i.title)).toEqual(['TSE vencendo']);
  });

  it('filtro por equipamento', async () => {
    const r = await http.get(`/v1/quality-records?asset=${ativo}`).set(auth(GESTORA));
    expect(r.body.items.map((i: { title: string }) => i.title)).toEqual(['Calibração do ventilador']);
  });
});

describe('o arquivo do certificado', () => {
  let id: string;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

  beforeAll(async () => {
    const r = await http.get('/v1/quality-records?kind=calibration').set(auth(GESTORA));
    id = r.body.items[0].id;
  });

  it('sem arquivo ainda: 404 ao baixar', async () => {
    expect((await http.get(`/v1/quality-records/${id}/file`).set(auth(GESTORA))).status).toBe(404);
  });

  it('só PDF e imagem sobem; outro tipo é recusado', async () => {
    const r = await http
      .put(`/v1/quality-records/${id}/file`)
      .set(auth(GESTORA))
      .set('content-type', 'text/html')
      .send('<script>alert(1)</script>');
    expect(r.status).toBe(422);
  });

  it('sobe o PDF e baixa os MESMOS bytes, com o nome que veio (acento incluso)', async () => {
    const sobe = await http
      .put(`/v1/quality-records/${id}/file`)
      .set(auth(GESTORA))
      .set('content-type', 'application/pdf')
      .set('x-aurora-file-name', encodeURIComponent('Certificado de calibração.pdf'))
      .send(pdf);
    expect(sobe.status, JSON.stringify(sobe.body)).toBe(200);
    expect(sobe.body).toEqual({ file_name: 'Certificado de calibração.pdf', file_size: pdf.byteLength });

    const baixa = await http
      .get(`/v1/quality-records/${id}/file`)
      .set(auth(GESTORA))
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
    expect(baixa.status).toBe(200);
    expect(baixa.headers['content-type']).toBe('application/pdf');
    expect(baixa.headers['x-content-type-options']).toBe('nosniff');
    expect(baixa.headers['content-disposition']).toContain("filename*=UTF-8''Certificado%20de%20calibra");
    expect(Buffer.compare(baixa.body as Buffer, pdf)).toBe(0);

    // A lista passa a mostrar o arquivo.
    const lista = await http.get('/v1/quality-records?kind=calibration').set(auth(GESTORA));
    expect(lista.body.items[0]).toMatchObject({
      file_name: 'Certificado de calibração.pdf',
      file_size: pdf.byteLength,
    });
  });

  it('enviar de novo substitui o arquivo', async () => {
    const outro = Buffer.from('%PDF-1.4\nsegunda versão\n%%EOF\n');
    const sobe = await http
      .put(`/v1/quality-records/${id}/file`)
      .set(auth(GESTORA))
      .set('content-type', 'application/pdf')
      .send(outro);
    expect(sobe.status).toBe(200);
    expect(sobe.body.file_size).toBe(outro.byteLength);
  });
});

describe('escopo e isolamento', () => {
  it('a solicitante enxerga os certificados do cliente dela e os da organização, não os de outro cliente', async () => {
    await criar(GESTORA, {
      kind: 'electrical_safety',
      title: 'TSE do outro hospital',
      customer_id: outroHospital,
      issued_at: dia(-1),
    });
    const r = await http.get('/v1/quality-records').set(auth(SOLICITANTE));
    expect(r.status).toBe(200);
    const titulos = r.body.items.map((i: { title: string }) => i.title);
    expect(titulos).toContain('Calibração do ventilador');
    expect(titulos).not.toContain('TSE do outro hospital');
  });

  it('quem só lê não cadastra (403)', async () => {
    const r = await criar(SOLICITANTE, {
      kind: 'qualification',
      title: 'Qualquer',
      customer_id: hospital,
      issued_at: dia(-1),
    });
    expect(r.status).toBe(403);
  });

  it('outra organização não vê nada, e o registro dela não é alcançável por id', async () => {
    const lista = await http.get('/v1/quality-records').set(auth(ADMIN_B));
    expect(lista.body.items).toEqual([]);
    const a = (await http.get('/v1/quality-records?kind=calibration').set(auth(GESTORA))).body.items[0].id;
    expect((await http.get(`/v1/quality-records/${a}/file`).set(auth(ADMIN_B))).status).toBe(404);
    expect((await http.delete(`/v1/quality-records/${a}`).set(auth(ADMIN_B))).status).toBe(404);
  });

  it('excluir tira o registro de cena', async () => {
    const a = (await http.get('/v1/quality-records?kind=training').set(auth(GESTORA))).body.items[0].id;
    expect((await http.delete(`/v1/quality-records/${a}`).set(auth(GESTORA))).status).toBe(200);
    expect((await http.get('/v1/quality-records?kind=training').set(auth(GESTORA))).body.items).toEqual([]);
  });
});
