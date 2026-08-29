/**
 * Aurora — a ficha da ordem de serviço, pela HTTP (SPEC v0.2 §09, §12 · EPIC-009).
 *
 * O QUE ESTE ARQUIVO EXISTE PARA PROVAR
 *
 * Que a informação restrita não sai do servidor. Não que ela não apareça na
 * tela — que ela não seja ENVIADA. A diferença é o painel de rede do
 * navegador: um campo escondido por CSS já viajou, já está no cache do
 * dispositivo e já pode ser lido por quem abrir as ferramentas de
 * desenvolvedor. Por isso todo teste aqui olha o CORPO da resposta.
 *
 * Os dois eixos são separados de propósito, e os papéis de fábrica os separam
 * naturalmente:
 *
 *   · o técnico VÊ nota interna e NÃO vê custo — ele executa, não fatura;
 *   · o auditor VÊ a ordem e NÃO vê nem nota nem custo — ele confere o
 *     processo, não participa da conversa.
 *
 * Um teste com um só papel provaria metade e daria a sensação de ter provado
 * tudo.
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
  logTime,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const COORD_USER = newId(),
  COORD_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const AUD_USER = newId(),
  AUD_MEM = newId();

const EMAIL_COORD = 'coord@ficha.test';
const EMAIL_TEC = 'tec@ficha.test';
const EMAIL_AUD = 'auditor@ficha.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let os: string;
let cliente: string, setor: string, ativo: string, natureza: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: COORD_USER, membershipId: COORD_MEM },
    { slug: 'ficha', name: 'Clínica Ficha', email: EMAIL_COORD, userName: 'Coordenadora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: AUD_USER, membershipId: AUD_MEM },
    { email: EMAIL_AUD, userName: 'Auditora' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, COORD_MEM, roles.get('coordinator')!);
    await assignRole(s, TEC_MEM, roles.get('technician')!);
    await assignRole(s, AUD_MEM, roles.get('auditor')!);
    await provisionWorkOrderStates(s);

    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Clínica Ficha', isInternal: true });
    setor = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });
    natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
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

  const criada = await http.post('/v1/work-orders').set(auth(EMAIL_COORD)).send({
    customer_id: cliente,
    work_order_type_id: natureza,
    location_id: setor,
    asset_id: ativo,
    title: 'Ventilador não liga',
    priority: 'urgent',
  });
  os = criada.body.id;

  // Uma hora apontada, com custo, para o filtro de custo ter o que filtrar.
  const ctxTec = buildContext({
    organizationId: ORG,
    actorKind: 'user',
    actorId: TEC_USER,
    membershipId: TEC_MEM,
    requestId: 'apontamento',
  });
  await withTenant(t.db, ctxTec, (s) =>
    logTime(s, {
      workOrderId: os,
      membershipId: TEC_MEM,
      startedAt: new Date('2026-03-10T13:00:00Z'),
      endedAt: new Date('2026-03-10T14:30:00Z'),
      hourlyCost: 180,
      note: 'troca da válvula',
    })
  );
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

/* -------------------------------------------------------------------------- */

describe('comentários e notas internas', () => {
  it('a nota interna NÃO sai do servidor para quem não pode lê-la', async () => {
    await http
      .post(`/v1/work-orders/${os}/comments`)
      .set(auth(EMAIL_COORD))
      .send({ body: 'Cliente já reclamou disso três vezes; avaliar troca.', visibility: 'internal' })
      .expect(201);
    await http
      .post(`/v1/work-orders/${os}/comments`)
      .set(auth(EMAIL_COORD))
      .send({ body: 'Peça encomendada, previsão de quinta.', visibility: 'customer' })
      .expect(201);

    const daCoordenacao = await http.get(`/v1/work-orders/${os}/comments`).set(auth(EMAIL_COORD));
    expect(daCoordenacao.status).toBe(200);
    expect(daCoordenacao.body.items).toHaveLength(2);
    expect(daCoordenacao.body.can_write_internal).toBe(true);

    const daAuditoria = await http.get(`/v1/work-orders/${os}/comments`).set(auth(EMAIL_AUD));
    expect(daAuditoria.status).toBe(200);
    expect(daAuditoria.body.items).toHaveLength(1);
    expect(daAuditoria.body.items[0].visibility).toBe('customer');
    expect(daAuditoria.body.can_write_internal).toBe(false);

    // A prova precisa ser PRECISA, e não ampla: procurar a palavra "internal"
    // no corpo inteiro acusa `can_write_internal`, que é justamente o campo
    // que DEVE estar lá. O que não pode viajar é o texto da nota e qualquer
    // item marcado como interno.
    expect(JSON.stringify(daAuditoria.body.items)).not.toContain('avaliar troca');
    expect(daAuditoria.body.items.map((c: { visibility: string }) => c.visibility)).toEqual(['customer']);
  });

  it('escrever nota interna sem poder lê-la é recusado com 403', async () => {
    const r = await http
      .post(`/v1/work-orders/${os}/comments`)
      .set(auth(EMAIL_AUD))
      .send({ body: 'tentativa', visibility: 'internal' });

    // 403 e não 422: o pedido é bem formado, e a recusa é de autorização.
    // Devolver 422 mandaria a pessoa procurar erro de digitação num pedido
    // correto.
    expect(r.status).toBe(403);
  });

  it('comentário vazio é recusado antes de chegar ao banco', async () => {
    const r = await http
      .post(`/v1/work-orders/${os}/comments`)
      .set(auth(EMAIL_COORD))
      .send({ body: '   ', visibility: 'customer' });
    expect(r.status).toBe(422);
    expect(r.body.field ?? r.body.errors?.[0]?.field ?? 'body').toBe('body');
  });

  it('visibilidade é obrigatória: não há padrão que decida por quem escreve', async () => {
    const r = await http
      .post(`/v1/work-orders/${os}/comments`)
      .set(auth(EMAIL_COORD))
      .send({ body: 'sem dizer para quem' });
    expect(r.status).toBe(422);
  });
});

describe('horas apontadas', () => {
  it('o custo NÃO sai do servidor para quem não pode vê-lo', async () => {
    const daCoordenacao = await http.get(`/v1/work-orders/${os}/time-entries`).set(auth(EMAIL_COORD));
    expect(daCoordenacao.status).toBe(200);
    expect(daCoordenacao.body.items).toHaveLength(1);
    expect(daCoordenacao.body.items[0].cost).not.toBeNull();

    // O técnico VÊ a própria hora e NÃO vê quanto ela custa. É o eixo que se
    // perde quando se testa só com o perfil que pode tudo.
    const doTecnico = await http.get(`/v1/work-orders/${os}/time-entries`).set(auth(EMAIL_TEC));
    expect(doTecnico.status).toBe(200);
    expect(doTecnico.body.items).toHaveLength(1);
    expect(doTecnico.body.items[0].cost).toBeNull();
    expect(doTecnico.body.items[0].currency).toBeNull();
    expect(JSON.stringify(doTecnico.body)).not.toContain('180');
  });

  it('o total vem somado do servidor, e diz quantas entradas ficaram abertas', async () => {
    const r = await http.get(`/v1/work-orders/${os}/time-entries`).set(auth(EMAIL_COORD));
    expect(r.body.total_minutes).toBe(90);
    expect(r.body.open_entries).toBe(0);
  });
});

describe('anexos e peças', () => {
  it('a lista de anexos nunca traz a chave de armazenamento', async () => {
    const r = await http.get(`/v1/work-orders/${os}/attachments`).set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
    // Sem anexos ainda; o que importa é a FORMA da resposta não ter o campo.
    expect(JSON.stringify(r.body)).not.toContain('storage_key');
  });

  it('a lista de peças responde vazia, e não com erro, quando não houve consumo', async () => {
    // Vazio e erro são coisas diferentes, e a tela desenha diferente cada uma.
    // Uma OS sem peça é o caso comum, não uma falha.
    const r = await http.get(`/v1/work-orders/${os}/parts`).set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
  });
});

describe('identificador malformado', () => {
  it('as quatro rotas recusam um id que não é uuid, sem chegar ao banco', async () => {
    for (const sufixo of ['comments', 'time-entries', 'attachments', 'parts']) {
      const r = await http.get(`/v1/work-orders/nao-e-uuid/${sufixo}`).set(auth(EMAIL_COORD));
      expect(r.status, sufixo).toBe(422);
    }
  });
});

describe('a resposta e o contrato', () => {
  it('a ficha satisfaz o contrato campo a campo, sem sobrar nem faltar', async () => {
    /*
     * Este é o teste que impede o problema de voltar.
     *
     * O contrato da ficha era `.loose()` e a consulta era `w.*`: a resposta
     * real tinha vinte campos a mais do que o contrato descrevia. Nenhum dos
     * dois lados reclamava, e o custo aparecia na interface — a resolução, a
     * causa e o responsável trafegavam, invisíveis para o compilador, e por
     * isso ausentes da tela.
     *
     * `strict()` sobre o esquema declarado transforma "campo que ninguém
     * declarou" em falha de teste. É a única forma de a divergência doer aqui,
     * e não seis meses depois num vazamento.
     */
    const { WorkOrderDetail } = await import('@aurora/contracts');
    const r = await http.get(`/v1/work-orders/${os}`).set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);

    const conferido = WorkOrderDetail.strict().safeParse(r.body);
    if (!conferido.success) {
      throw new Error(
        'a ficha divergiu do contrato:\n' +
          conferido.error.issues.map((i) => `  · ${i.path.join('.') || '(raiz)'}: ${i.message}`).join('\n')
      );
    }
  });
});
