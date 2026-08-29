/**
 * Aurora — catálogos e campos personalizados pela HTTP (EPIC-004).
 *
 * O cenário é o da auditoria: uma lista que já nasceu suja, e duas pessoas com
 * poderes diferentes sobre ela. O gestor de manutenção cura a taxonomia —
 * porque é quem entende do domínio — e o campo personalizado, que muda a
 * estrutura do formulário para todo mundo, fica com o administrador.
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
import { withTenant, provisionFactoryRoles, assignRole, createCatalogItem } from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const ADMIN_USER = newId(),
  ADMIN_MEM = newId();
const GESTOR_USER = newId(),
  GESTOR_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const EMAIL_ADMIN = 'admin@cat.test';
const EMAIL_GESTOR = 'gestor@cat.test';
const EMAIL_TEC = 'tecnico@cat.test';
const tokenFor = (email: string) => `local:${email}:${email}`;
const auth = (email: string) => ({ authorization: `Bearer ${tokenFor(email)}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: ADMIN_USER, membershipId: ADMIN_MEM },
    { slug: 'cat', name: 'Rede', email: EMAIL_ADMIN, userName: 'Admin' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: GESTOR_USER, membershipId: GESTOR_MEM },
    { email: EMAIL_GESTOR, userName: 'Gestor' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, ADMIN_MEM, roles.get('admin')!);
    await assignRole(s, GESTOR_MEM, roles.get('maintenance_manager')!);
    await assignRole(s, TEC_MEM, roles.get('technician')!);

    // a lista suja que a auditoria descreveu
    await createCatalogItem(s, { catalogKey: 'failure_symptom', key: 'emprestimo', label: 'Empréstimo' });
    await createCatalogItem(s, { catalogKey: 'failure_symptom', key: 'nao_liga', label: 'Não liga' });
    await createCatalogItem(s, {
      catalogKey: 'failure_symptom',
      key: 'emprestimo_equip',
      label: 'Empréstimo de equipamento',
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

describe('quais catálogos existem', () => {
  it('a lista de catálogos vem do código e diz o que cada um significa', async () => {
    const r = await http.get('/v1/catalogs').set(auth(EMAIL_ADMIN));
    expect(r.status).toBe(200);
    const tipos = r.body.items.find((c: { key: string }) => c.key === 'work_order_type');
    expect(tipos.system_keys).toContain('preventive');
    const sintoma = r.body.items.find((c: { key: string }) => c.key === 'failure_symptom');
    expect(sintoma.is_hierarchical).toBe(true);
  });

  it('catálogo inexistente é 422 listando os conhecidos, não 404 mudo', async () => {
    const r = await http.get('/v1/catalogs/inventado/items').set(auth(EMAIL_ADMIN));
    expect(r.status).toBe(422);
    expect(r.body.details.known).toContain('failure_symptom');
  });
});

describe('governança por papel', () => {
  it('o técnico lê o catálogo mas não o edita', async () => {
    expect((await http.get('/v1/catalogs/failure_symptom/items').set(auth(EMAIL_TEC))).status).toBe(200);
    const r = await http
      .post('/v1/catalogs/failure_symptom/items')
      .set(auth(EMAIL_TEC))
      .send({ key: 'pirata', label: 'Pirata' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('organization.manage_catalogs');
  });

  it('o gestor de manutenção cura a taxonomia — é quem entende do domínio', async () => {
    const r = await http
      .post('/v1/catalogs/failure_symptom/items')
      .set(auth(EMAIL_GESTOR))
      .send({ key: 'superaquecimento', label: 'Superaquecimento' });
    expect(r.status).toBe(201);
  });

  it('mas campo personalizado, que muda o formulário de todos, é do administrador', async () => {
    const negado = await http
      .post('/v1/custom-fields/customer')
      .set(auth(EMAIL_GESTOR))
      .send({ key: 'centro_custo', label: 'Centro de custo', kind: 'text' });
    expect(negado.status).toBe(403);
    expect(JSON.stringify(negado.body)).toContain('organization.manage_custom_fields');

    const ok = await http
      .post('/v1/custom-fields/customer')
      .set(auth(EMAIL_ADMIN))
      .send({ key: 'centro_custo', label: 'Centro de custo', kind: 'text', required: true, max: 20 });
    expect(ok.status).toBe(201);
  });
});

describe('duplicidade e mesclagem assistida', () => {
  it('o rótulo que colide é recusado na criação', async () => {
    const r = await http
      .post('/v1/catalogs/failure_symptom/items')
      .set(auth(EMAIL_GESTOR))
      .send({ key: 'nao_liga_2', label: 'NÃO LIGA' });
    expect(r.status).toBe(409);
  });

  it('a sugestão aponta o par provável e diz por quê', async () => {
    const r = await http.get('/v1/catalogs/failure_symptom/merge-suggestions').set(auth(EMAIL_GESTOR));
    expect(r.status).toBe(200);
    expect(r.body.suggestions).toHaveLength(1);
    const [par] = r.body.suggestions;
    expect(par.reason).toBe('um_contem_o_outro');
    expect([par.a.label, par.b.label].sort()).toEqual(['Empréstimo', 'Empréstimo de equipamento']);
    // "Não liga" e "Superaquecimento" não têm nada com isso
    expect(JSON.stringify(r.body.suggestions)).not.toContain('Superaquecimento');
  });

  it('mesclar tira a duplicata da lista, preservando-a apontando para o vencedor', async () => {
    const lista = await http.get('/v1/catalogs/failure_symptom/items').set(auth(EMAIL_GESTOR));
    const antes = lista.body.items.length;
    const curto = lista.body.items.find((i: { key: string }) => i.key === 'emprestimo');
    const completo = lista.body.items.find((i: { key: string }) => i.key === 'emprestimo_equip');

    const r = await http
      .post(`/v1/catalog-items/${curto.id}/merge`)
      .set(auth(EMAIL_GESTOR))
      .send({ into: completo.id });
    expect(r.status).toBe(201);

    const depois = await http.get('/v1/catalogs/failure_symptom/items').set(auth(EMAIL_GESTOR));
    expect(depois.body.items).toHaveLength(antes - 1);
    expect(depois.body.items.map((i: { key: string }) => i.key)).not.toContain('emprestimo');

    // preservada, não apagada: o histórico continua legível
    const comArquivados = await http
      .get('/v1/catalogs/failure_symptom/items?include_archived=true')
      .set(auth(EMAIL_GESTOR));
    const arquivado = comArquivados.body.items.find((i: { key: string }) => i.key === 'emprestimo');
    expect(arquivado.merged_into_id).toBe(completo.id);
  });

  it('depois da mesclagem não sobram sugestões', async () => {
    const r = await http.get('/v1/catalogs/failure_symptom/merge-suggestions').set(auth(EMAIL_GESTOR));
    expect(r.body.suggestions).toEqual([]);
  });
});

describe('campos personalizados pela HTTP', () => {
  it('a definição inválida é 422 explicando o problema, não 500', async () => {
    const r = await http
      .post('/v1/custom-fields/customer')
      .set(auth(EMAIL_ADMIN))
      .send({ key: 'classe', label: 'Classe', kind: 'select' });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/ao menos uma opção/);
  });

  it('entidade desconhecida é 422 listando as aceitas', async () => {
    const r = await http.get('/v1/custom-fields/planeta').set(auth(EMAIL_ADMIN));
    expect(r.status).toBe(422);
    expect(r.body.details.known).toContain('work_order');
  });

  it('a definição criada aparece tipada para o formulário montar sozinho', async () => {
    const r = await http.get('/v1/custom-fields/customer').set(auth(EMAIL_ADMIN));
    expect(r.status).toBe(200);
    const campo = r.body.items.find((i: { key: string }) => i.key === 'centro_custo');
    expect(campo.kind).toBe('text');
    expect(campo.required).toBe(true);
    expect(campo.max).toBe(20);
  });
});

/**
 * A mesma lista mora em dois lugares, e isso é uma decisão — não um descuido.
 *
 * `@aurora/contracts` não depende de nenhum outro pacote da Aurora: é ele que o
 * navegador carrega, e arrastar as regras de negócio junto engordaria o pacote
 * do cliente com código que ele nunca executa. O preço dessa independência é a
 * duplicação da lista de catálogos; este teste é quem cobra o preço.
 *
 * Sem ele, alguém acrescenta um catálogo no domínio, o contrato não sabe, e a
 * união literal passa a REJEITAR uma chave válida — o erro exatamente inverso
 * do que a união foi criada para impedir.
 */
describe('catálogos: contrato e domínio dizem a mesma coisa', () => {
  it('as chaves de catálogo do contrato são exatamente as do domínio', async () => {
    const contratos = await import('@aurora/contracts');
    const dominio = await import('@aurora/domain');
    expect([...contratos.CATALOG_KEYS].sort()).toEqual([...dominio.CATALOG_KEYS].sort());
  });

  it('as categorias de situação do contrato são exatamente as do domínio', async () => {
    // A do contrato tinha CINCO das nove: faltavam draft, scheduled, review e
    // closed. Como o cliente confere a resposta contra o contrato em
    // desenvolvimento, a primeira OS agendada faria a tela inteira falhar.
    const contratos = await import('@aurora/contracts');
    const dominio = await import('@aurora/domain');
    expect([...contratos.STATUS_CATEGORIES].sort()).toEqual([...dominio.STATUS_CATEGORIES].sort());
  });

  it('a escala de urgência do contrato é exatamente a do domínio, na mesma ordem', async () => {
    // Aqui a ORDEM também é conteúdo: a lista é decrescente de gravidade e a
    // fila de triagem ordena por ela. Comparar só os conjuntos deixaria passar
    // uma reordenação que muda a ordem de atendimento sem mudar lógica
    // nenhuma.
    const contratos = await import('@aurora/contracts');
    const dominio = await import('@aurora/domain');
    expect([...contratos.REQUEST_PRIORITIES]).toEqual([...dominio.REQUEST_PRIORITIES]);
    expect([...contratos.WORK_ORDER_PRIORITIES].sort()).toEqual([...dominio.REQUEST_PRIORITIES].sort());
  });
});
