/**
 * Aurora — regressão da auditoria corretiva de segurança de 23/11/2026
 * (docs/auditoria/RELATORIO_SEGURANCA_PERFORMANCE.md).
 *
 *   · SEG-01  corpo compactado não é descompactado (era amplificação de memória sem login);
 *             JSON acima de 2 MB fora das rotas que recebem base64 → 413;
 *   · SEG-02  Qualidade: criar/excluir respeita o escopo de CLIENTE de quem age;
 *   · SEG-03  Qualidade: leitura respeita o SETOR do equipamento;
 *   · SEG-04  arquivo de certificado precisa ter os bytes do tipo declarado;
 *   · SEG-05  `x-request-id` com a marca de automação não chega ao banco nem ao corpo;
 *   · SEG-06  erro de integridade não devolve SQLSTATE, tabela nem mensagem crua do banco;
 *   · SEG-09  cabeçalhos de segurança na API e sem `x-powered-by`;
 *   · SEG-10  rotas caras (relatório, exportação, importação) com teto de concorrência → 429.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { gzipSync } from 'node:zlib';
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
import { requestIdDoCliente } from '../common/context.resolver';
import { retirarDiagnosticoDeBanco } from '../common/error.filter';
import { emailPseudonimizado } from '../auth/auth.controller';
import { LimiteDeConcorrencia, LIMITE_DE_ROTAS_PESADAS } from '../common/limite-de-carga';

const ORG = newId();
const GESTORA = 'gestora@seg-1123.test';
const GESTOR_ALFA = 'gestor-alfa@seg-1123.test';
const SOLICITANTE_CC = 'solicitante-cc@seg-1123.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let alfa: string, beta: string, ativoUtiAlfa: string, ativoBeta: string;
let registroBeta: string, registroUti: string;
let memGestora: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const ids = { organizationId: ORG, userId: newId(), membershipId: newId() };
  memGestora = ids.membershipId;
  await seedOrganization(t, ids, { slug: 'seg-1123', name: 'Org', email: GESTORA, userName: 'Gestora' });

  let centroCirurgico = '';
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, ids.membershipId, base.roles.get('maintenance_manager')!);
      alfa = await createCustomer(s, { name: 'Hospital Alfa' });
      beta = await createCustomer(s, { name: 'Hospital Beta' });
      const unidade = (cliente: string, nome: string) =>
        createLocation(s, {
          customerId: cliente,
          locationTypeId: base.locationTypes.get('unidade')!,
          name: nome,
        });
      const setor = (cliente: string, pai: string, nome: string) =>
        createLocation(s, {
          customerId: cliente,
          parentId: pai,
          locationTypeId: base.locationTypes.get('setor')!,
          name: nome,
        });
      const sedeAlfa = await unidade(alfa, 'Sede Alfa');
      const uti = await setor(alfa, sedeAlfa, 'UTI');
      centroCirurgico = await setor(alfa, sedeAlfa, 'Centro Cirúrgico');
      const sedeBeta = await unidade(beta, 'Sede Beta');
      const setorBeta = await setor(beta, sedeBeta, 'Emergência');
      const cat = await createAssetCategory(s, { name: 'Ventilador' });
      ativoUtiAlfa = await createAsset(s, {
        name: 'Vent UTI',
        customerId: alfa,
        assetCategoryId: cat,
        locationId: uti,
      });
      ativoBeta = await createAsset(s, {
        name: 'Vent Beta',
        customerId: beta,
        assetCategoryId: cat,
        locationId: setorBeta,
      });
    }
  );

  const memGestorAlfa = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memGestorAlfa },
    { email: GESTOR_ALFA, userName: 'Gestor Alfa', customerIds: [alfa] }
  );
  const memSol = newId();
  await seedMember(
    t,
    { organizationId: ORG, userId: newId(), membershipId: memSol },
    {
      email: SOLICITANTE_CC,
      userName: 'Solicitante CC',
      seatType: 'portal',
      customerIds: [alfa],
      locationIds: [centroCirurgico],
    }
  );
  await withTenant(
    t.db,
    buildContext({ organizationId: ORG, actorKind: 'system', requestId: 's2' }),
    async (s) => {
      const base = await provisionOrganizationBaseline(s);
      await assignRole(s, memGestorAlfa, base.roles.get('maintenance_manager')!);
      await assignRole(s, memSol, base.roles.get('requester')!);
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

  const criar = async (corpo: Record<string, unknown>) => {
    const r = await http.post('/v1/quality-records').set(auth(GESTORA)).send(corpo);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  registroBeta = await criar({
    kind: 'calibration',
    title: 'Calibração Beta',
    asset_id: ativoBeta,
    issued_at: '2026-01-10',
  });
  registroUti = await criar({
    kind: 'calibration',
    title: 'Calibração UTI',
    asset_id: ativoUtiAlfa,
    issued_at: '2026-01-10',
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('SEG-01 · corpo da requisição', () => {
  it('corpo compactado é recusado (415) e não descompactado — inclusive no login, sem sessão', async () => {
    const enorme = JSON.stringify({ email: 'x@y.z', password: 'a'.repeat(5_000_000) });
    const r = await http
      .post('/v1/auth/login')
      .set('content-type', 'application/json')
      .set('content-encoding', 'gzip')
      .send(gzipSync(enorme));
    expect(r.status).toBe(415);
  });

  it('JSON acima de 2 MB numa rota comum → 413; as rotas de base64 seguem aceitando corpo grande', async () => {
    const grande = {
      kind: 'calibration',
      title: 'x'.repeat(2_200_000),
      asset_id: ativoBeta,
      issued_at: '2026-01-10',
    };
    const r = await http.post('/v1/quality-records').set(auth(GESTORA)).send(grande);
    expect(r.status).toBe(413);
    // /v1/assets aceita a foto em base64 (até ~11 MB): 2,2 MB não pode ser barrado pelo tamanho.
    const foto = await http
      .put(`/v1/assets/${ativoBeta}/photo`)
      .set(auth(GESTORA))
      .send({ content_type: 'image/png', data_base64: 'A'.repeat(2_200_000) });
    expect(foto.status).not.toBe(413);
  });
});

describe('SEG-02 · Qualidade: escrita dentro do escopo de cliente', () => {
  it('gestor restrito ao Hospital Alfa NÃO exclui certificado do Hospital Beta (404) e o registro fica', async () => {
    const r = await http.delete(`/v1/quality-records/${registroBeta}`).set(auth(GESTOR_ALFA));
    expect(r.status).toBe(404);
    const lista = await http.get('/v1/quality-records').set(auth(GESTORA));
    expect(lista.body.items.map((i: { id: string }) => i.id)).toContain(registroBeta);
  });

  it('gestor restrito NÃO cria certificado para equipamento nem cliente de fora (404, sem revelar)', async () => {
    const peloAtivo = await http
      .post('/v1/quality-records')
      .set(auth(GESTOR_ALFA))
      .send({
        kind: 'calibration',
        title: 'Falso',
        asset_id: ativoBeta,
        issued_at: '2026-01-10',
        valid_until: '2030-01-01',
      });
    expect(peloAtivo.status).toBe(404);
    const inexistente = await http
      .post('/v1/quality-records')
      .set(auth(GESTOR_ALFA))
      .send({ kind: 'calibration', title: 'Falso', asset_id: newId(), issued_at: '2026-01-10' });
    expect(inexistente.status).toBe(404);
    const peloCliente = await http
      .post('/v1/quality-records')
      .set(auth(GESTOR_ALFA))
      .send({ kind: 'qualification', title: 'Falso', customer_id: beta, issued_at: '2026-01-10' });
    expect(peloCliente.status).toBe(404);
  });

  it('dentro do próprio escopo continua funcionando', async () => {
    const r = await http
      .post('/v1/quality-records')
      .set(auth(GESTOR_ALFA))
      .send({ kind: 'calibration', title: 'Alfa ok', asset_id: ativoUtiAlfa, issued_at: '2026-01-10' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const apaga = await http.delete(`/v1/quality-records/${r.body.id}`).set(auth(GESTOR_ALFA));
    expect(apaga.status).toBe(200);
  });
});

describe('SEG-03 · Qualidade: leitura respeita o setor do equipamento', () => {
  it('solicitante do Centro Cirúrgico não vê nem baixa o certificado do equipamento da UTI', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
    const sobe = await http
      .put(`/v1/quality-records/${registroUti}/file`)
      .set(auth(GESTORA))
      .set('content-type', 'application/pdf')
      .send(pdf);
    expect(sobe.status, JSON.stringify(sobe.body)).toBe(200);

    const lista = await http.get('/v1/quality-records').set(auth(SOLICITANTE_CC));
    expect(lista.status).toBe(200);
    const ids = lista.body.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(registroUti);
    expect(ids).not.toContain(registroBeta);
    const baixa = await http.get(`/v1/quality-records/${registroUti}/file`).set(auth(SOLICITANTE_CC));
    expect(baixa.status).toBe(404);
    // quem enxerga a UTI continua baixando
    const gestora = await http.get(`/v1/quality-records/${registroUti}/file`).set(auth(GESTORA));
    expect(gestora.status).toBe(200);
  });
});

describe('SEG-04 · bytes do arquivo conferidos', () => {
  it('HTML declarado como PDF é recusado (422)', async () => {
    const r = await http
      .put(`/v1/quality-records/${registroBeta}/file`)
      .set(auth(GESTORA))
      .set('content-type', 'application/pdf')
      .send(Buffer.from('<html><script>alert(1)</script></html>'));
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('content-type');
  });
});

describe('SEG-05 · x-request-id', () => {
  it('a marca de automação é descartada; um identificador comum continua propagado', async () => {
    expect(requestIdDoCliente(`automacao:${newId()}:3`)).toBeNull();
    expect(requestIdDoCliente('trace-123')).toBe('trace-123');
    expect(requestIdDoCliente('a'.repeat(65))).toBeNull();
    const r = await http
      .get('/v1/organizations/current')
      .set('authorization', 'Bearer invalido')
      .set('x-request-id', `automacao:${newId()}:3`);
    expect(r.body.request_id).not.toMatch(/^automacao:/);
  });
});

describe('SEG-06 · erro de banco sem diagnóstico na resposta', () => {
  it('retira SQLSTATE, tabela e mensagem crua; mantém o campo e a regra', () => {
    const d: Record<string, unknown> = {
      sqlstate: '23505',
      table: 'customers',
      pg_message: 'x',
      constraint: 'c',
      field: 'f',
    };
    expect(retirarDiagnosticoDeBanco(d)).toEqual({ sqlstate: '23505', table: 'customers', pg_message: 'x' });
    expect(d).toEqual({ constraint: 'c', field: 'f' });
  });

  it('nome repetido de cliente: 409 sem SQLSTATE/tabela na resposta', async () => {
    const dup = await http.post('/v1/customers').set(auth(GESTORA)).send({ name: 'Hospital Alfa' });
    expect([409, 422]).toContain(dup.status);
    expect(dup.body.details ?? {}).not.toHaveProperty('sqlstate');
    expect(dup.body.details ?? {}).not.toHaveProperty('table');
    expect(dup.body.details ?? {}).not.toHaveProperty('pg_message');
  });
});

describe('SEG-07 · e-mail no log é pseudonimizado', () => {
  it('domínio e resumo estável, sem o endereço', () => {
    const a = emailPseudonimizado(' Pessoa@Hospital.com.br ');
    expect(a).toEqual(emailPseudonimizado('pessoa@hospital.com.br'));
    expect(a.email_dominio).toBe('hospital.com.br');
    expect(a.email_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(a)).not.toContain('pessoa');
  });
});

describe('SEG-09 · cabeçalhos da API', () => {
  it('sem x-powered-by; nosniff, no-store e sem moldura', async () => {
    const r = await http.get('/v1/organizations/current').set(auth(GESTORA));
    expect(r.status).toBe(200);
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

describe('SEG-10 · teto de concorrência das rotas caras', () => {
  it('por pessoa e no processo; liberar devolve a vaga (e liberar duas vezes não conta duas)', () => {
    const l = new LimiteDeConcorrencia(2, 3);
    const a1 = l.reservar('a')!;
    const a2 = l.reservar('a')!;
    expect(l.reservar('a')).toBeNull(); // 3ª da mesma pessoa
    const b1 = l.reservar('b')!;
    expect(l.reservar('c')).toBeNull(); // processo cheio (3)
    a1();
    a1();
    expect(l.emAndamento).toBe(2);
    expect(l.reservar('c')).not.toBeNull();
    a2();
    b1();
  });

  it('com as vagas da pessoa ocupadas, gerar relatório devolve 429; liberadas, volta a responder', async () => {
    const corpo = { tier: 'basic', from: '2026-01-01', to: '2026-01-31' };
    const ocupadas = [
      LIMITE_DE_ROTAS_PESADAS.reservar(memGestora)!,
      LIMITE_DE_ROTAS_PESADAS.reservar(memGestora)!,
    ];
    try {
      const r = await http.post('/v1/reports/generate').set(auth(GESTORA)).send(corpo);
      expect(r.status).toBe(429);
      expect(r.body.details.retry_after_seconds).toBeGreaterThan(0);
    } finally {
      ocupadas.forEach((liberar) => liberar());
    }
    const depois = await http.post('/v1/reports/generate').set(auth(GESTORA)).send(corpo);
    expect(depois.status).not.toBe(429);
    expect(LIMITE_DE_ROTAS_PESADAS.emAndamento).toBe(0);
  });
});
