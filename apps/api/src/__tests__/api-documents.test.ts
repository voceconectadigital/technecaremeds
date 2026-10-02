/**
 * Aurora — documentos pela HTTP (SPEC v0.2 §18 · EPIC-018).
 *
 * O que a borda precisa provar: emitir, assinar e liberar ao cliente são atos
 * com permissões diferentes, e a checagem sai do grafo — não de um decorador
 * fixo que daria tudo a quem pode uma coisa.
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
  createAssetCategory,
  createAsset,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const GESTOR_USER = newId(),
  GESTOR_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const EMAIL_GESTOR = 'gestor@doc.test';
const EMAIL_TEC = 'tec@doc.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let cliente: string, ativo: string;
let tipoRelatorio: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: GESTOR_USER, membershipId: GESTOR_MEM },
    { slug: 'docapi', name: 'Prestadora', email: EMAIL_GESTOR, userName: 'Gestor' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, GESTOR_MEM, roles.get('maintenance_manager')!);
    await assignRole(s, TEC_MEM, roles.get('technician')!);

    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: unidade,
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

describe('provisionamento e catálogo', () => {
  it('provisiona os tipos de fábrica', async () => {
    const r = await http.post('/v1/documents/types/provision').set(auth(EMAIL_GESTOR)).expect(201);
    expect(Object.keys(r.body.types)).toHaveLength(7); // seis da SPEC §18 + o termo de aceite (gap V2 P2.7)

    const tipos = await http.get('/v1/documents/types').set(auth(EMAIL_GESTOR)).expect(200);
    tipoRelatorio = tipos.body.items.find((x: { key: string }) => x.key === 'work_order_report').id;
    expect(tipoRelatorio).toBeTruthy();
  });
});

describe('ciclo de vida pela borda', () => {
  let doc: string;

  it('cria em rascunho', async () => {
    const r = await http
      .post('/v1/documents')
      .set(auth(EMAIL_GESTOR))
      .send({
        documentTypeId: tipoRelatorio,
        title: 'Relatório de atendimento',
        assetId: ativo,
        customerId: cliente,
        verdict: 'conforming',
      })
      .expect(201);
    doc = r.body.id;

    const detalhe = await http.get(`/v1/documents/${doc}`).set(auth(EMAIL_GESTOR)).expect(200);
    expect(detalhe.body.document.status).toBe('draft');
    expect(detalhe.body.transitions.map((x: { to: string }) => x.to).sort()).toEqual([
      'cancelled',
      'under_review',
    ]);
  });

  it('veredito desconhecido é recusado listando os válidos', async () => {
    const r = await http
      .post('/v1/documents')
      .set(auth(EMAIL_GESTOR))
      .send({ documentTypeId: tipoRelatorio, verdict: 'mais_ou_menos' })
      .expect(422);
    /*
     * A lista de válidos vai em `details.allowed`, e não concatenada na frase.
     *
     * O controller tinha uma cópia local de `oneOf` que montava
     * "verdict deve ser um de: conforming, ..." — texto. A versão
     * compartilhada devolve o campo estruturado, que é o que uma integração
     * consegue LER; a frase é para a pessoa, e a lista é para o programa.
     */
    expect(r.body.details.allowed).toContain('conforming');
    expect(r.body.details.field).toBe('verdict');
  });

  it('a checagem de emissão responde antes de tentar', async () => {
    const r = await http.get(`/v1/documents/${doc}/issue-check`).set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.ok).toBe(true);
  });

  it('o técnico nem envia para revisão nem emite — a permissão sai do grafo', async () => {
    // Duas transições, duas permissões diferentes, e o técnico não tem
    // nenhuma das duas. Se a checagem viesse de um decorador fixo na rota,
    // ou ele poderia as duas, ou não poderia nem abrir o documento.
    const revisao = await http
      .post(`/v1/documents/${doc}/transitions`)
      .set(auth(EMAIL_TEC))
      .send({ to: 'under_review' })
      .expect(403);
    expect(revisao.body.message).toMatch(/document.create/);

    await http
      .post(`/v1/documents/${doc}/transitions`)
      .set(auth(EMAIL_GESTOR))
      .send({ to: 'under_review' })
      .expect(201);

    const r = await http
      .post(`/v1/documents/${doc}/transitions`)
      .set(auth(EMAIL_TEC))
      .send({ to: 'issued' })
      .expect(403);
    expect(r.body.message).toMatch(/document\.issue/);
  });

  it('o gestor emite, e o número sai da série', async () => {
    await http
      .post(`/v1/documents/${doc}/transitions`)
      .set(auth(EMAIL_GESTOR))
      .send({ to: 'issued' })
      .expect(201);

    const r = await http.get(`/v1/documents/${doc}`).set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.document.number).toMatch(/^REL-\d{4}-000001$/);
    expect(r.body.document.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('assinar registra a evidência e a conferência confirma', async () => {
    await http
      .post(`/v1/documents/${doc}/signatures`)
      .set(auth(EMAIL_GESTOR))
      .send({
        signerName: 'Maria Cliente',
        signerRole: 'customer',
        method: 'portal',
        portalUserId: GESTOR_USER,
      })
      .expect(201);

    const r = await http.get(`/v1/documents/${doc}`).set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.signatures).toHaveLength(1);
    expect(r.body.signatures[0].valid).toBe(true);
  });

  it('assinatura sem prova de origem é recusada', async () => {
    const r = await http
      .post(`/v1/documents/${doc}/signatures`)
      .set(auth(EMAIL_GESTOR))
      .send({ signerName: 'Sem prova', signerRole: 'customer', method: 'email_code' })
      .expect(422);
    expect(r.body.message).toMatch(/e-mail/);
  });

  it('certificado digital é recusado enquanto a cadeia não for verificada', async () => {
    const r = await http
      .post(`/v1/documents/${doc}/signatures`)
      .set(auth(EMAIL_GESTOR))
      .send({
        signerName: 'Ana',
        signerRole: 'technical_manager',
        method: 'icp_brasil',
        certificateSubject: 'CN=Ana',
      })
      .expect(422);
    expect(r.body.message).toMatch(/ainda não é verificada/);
  });

  it('documento assinado não aceita edição de conteúdo', async () => {
    const r = await http
      .post(`/v1/documents/${doc}/content`)
      .set(auth(EMAIL_GESTOR))
      .send({ verdict: 'non_conforming' })
      .expect(409);
    expect(r.body.message).toMatch(/versão nova/);
  });

  it('liberar ao cliente é ato à parte', async () => {
    await http
      .post(`/v1/documents/${doc}/transitions`)
      .set(auth(EMAIL_GESTOR))
      .send({ to: 'released' })
      .expect(201);

    const r = await http.get(`/v1/documents/${doc}`).set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.document.status).toBe('released');
  });

  it('cancelar exige motivo, e o número fica queimado', async () => {
    const semMotivo = await http
      .post(`/v1/documents/${doc}/transitions`)
      .set(auth(EMAIL_GESTOR))
      .send({ to: 'cancelled', reason: 'erro' })
      .expect(422);
    expect(semMotivo.body.message).toMatch(/10 caracteres/);

    await http
      .post(`/v1/documents/${doc}/transitions`)
      .set(auth(EMAIL_GESTOR))
      .send({ to: 'cancelled', reason: 'emitido para o ativo errado, conferido com o solicitante' })
      .expect(201);

    const r = await http.get(`/v1/documents/${doc}`).set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.document.status).toBe('cancelled');
    expect(r.body.document.number).toMatch(/^REL-\d{4}-000001$/);
    expect(r.body.transitions).toEqual([]);
  });
});

describe('consultas', () => {
  it('a ficha do ativo lista os documentos dele', async () => {
    const r = await http.get(`/v1/documents/by-asset?assetId=${ativo}`).set(auth(EMAIL_GESTOR)).expect(200);
    expect(r.body.items.length).toBeGreaterThanOrEqual(1);
    expect(r.body.items[0].type_key).toBe('work_order_report');
  });

  it('a rota de consulta não colide com a de detalhe', async () => {
    /*
     * `types` e `by-asset` são caminhos literais e precisam ser declarados
     * ANTES de `:id` — desde o Express 5 não há mais regex no parâmetro para
     * desambiguar. A conferência de `npm run openapi` recusa a build se
     * alguém inverter a ordem; este teste prova o resultado.
     */
    await http.get('/v1/documents/types').set(auth(EMAIL_GESTOR)).expect(200);
    await http.get('/v1/documents/by-asset').set(auth(EMAIL_GESTOR)).expect(422);

    // Identificador malformado agora chega ao handler e recebe 422 dizendo
    // qual campo está errado — melhor que o 404 antigo, que mandava quem
    // integra procurar uma URL que estava certa.
    const r = await http.get('/v1/documents/nao-e-uuid').set(auth(EMAIL_GESTOR)).expect(422);
    expect(r.body.details.field).toBe('id');
  });

  it('a varredura de vencimento é POST e devolve os alertas', async () => {
    const r = await http.post('/v1/documents/expiry/sweep').set(auth(EMAIL_GESTOR)).expect(201);
    expect(Array.isArray(r.body.alerts)).toBe(true);
  });
});

describe('a lista e o recorte de vencimento', () => {
  it('responde, e satisfaz o contrato', async () => {
    // Este teste existe porque a consulta nova referenciou `dt.name` numa
    // tabela cuja coluna é `label` — 500 em produção, e nenhum teste de
    // unidade poderia ver, porque a coluna só é resolvida pelo PostgreSQL.
    const { documentsList } = await import('@aurora/contracts');
    const r = await http.get('/v1/documents').set(auth(EMAIL_GESTOR));
    expect(r.status).toBe(200);

    const conferido = documentsList.response.safeParse(r.body);
    if (!conferido.success) {
      throw new Error(conferido.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n'));
    }
  });

  it('o recorte de vencimento ignora quem não tem validade', async () => {
    // Sem validade não há o que vencer. Incluí-los faria a lista de "o que
    // vence este mês" trazer o acervo inteiro, e o recorte perderia a função.
    const r = await http.get('/v1/documents?expiring_within_days=3650').set(auth(EMAIL_GESTOR));
    expect(r.status).toBe(200);
    for (const d of r.body.items) {
      expect(d.valid_until, `${d.id} entrou no recorte sem validade`).not.toBeNull();
    }
  });

  it('janela fora do intervalo é recusada', async () => {
    for (const v of ['-1', '99999', 'ontem']) {
      const r = await http.get(`/v1/documents?expiring_within_days=${v}`).set(auth(EMAIL_GESTOR));
      expect(r.status, v).toBe(422);
    }
  });
});
