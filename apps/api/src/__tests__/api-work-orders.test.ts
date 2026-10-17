/**
 * Aurora — ordens de serviço pela HTTP (SPEC v0.2 §10 · EPIC-008).
 *
 * O critério de aceite do épico, na borda: "transição não declarada é recusada
 * na API, no Kanban e no PWA, com mensagem que nomeia as transições possíveis".
 * E o desenho do ADR-004 aparecendo na tela: o quadro traz a quebra por motivo
 * de espera, e não só um número dentro da coluna "Aguardando".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
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
  createServiceRequest,
  transitionRequest,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const COORD_USER = newId(),
  COORD_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const EMAIL_COORD = 'coord@wo.test';
const EMAIL_TEC = 'tec@wo.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let cliente: string, setor: string, ativo: string, ativoDois: string;
let natureza: string, sintoma: string;
let motivoPeca: string, motivoOrcamento: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: COORD_USER, membershipId: COORD_MEM },
    { slug: 'wo', name: 'Rede Hospitalar', email: EMAIL_COORD, userName: 'Coordenadora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    const roles = await provisionFactoryRoles(s);
    await assignRole(s, COORD_MEM, roles.get('coordinator')!);
    await assignRole(s, TEC_MEM, roles.get('technician')!);

    const estados = await provisionWorkOrderStates(s);
    motivoPeca = estados.waitReasons.get('parts')!;
    motivoOrcamento = estados.waitReasons.get('quote_approval')!;

    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Rede Hospitalar', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade Norte',
    });
    setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador Pulmonar' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });
    ativoDois = await createAsset(s, {
      name: 'Ventilador 02',
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
    sintoma = await createCatalogItem(s, {
      catalogKey: 'failure_symptom',
      key: 'nao_liga',
      label: 'Não liga',
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

async function criar(over: Record<string, unknown> = {}) {
  return http
    .post('/v1/work-orders')
    .set(auth(EMAIL_COORD))
    .send({
      customer_id: cliente,
      work_order_type_id: natureza,
      location_id: setor,
      asset_id: ativo,
      reported_failure_code_id: sintoma,
      title: 'Ventilador não liga',
      priority: 'urgent',
      ...over,
    });
}

const mover = (email: string, id: string, body: Record<string, unknown>) =>
  http.post(`/v1/work-orders/${id}/transitions`).set(auth(email)).send(body);

describe('situações e quadro', () => {
  it('as situações vêm com categoria — é o que o Kanban usa como coluna', async () => {
    const r = await http.get('/v1/work-orders/statuses').set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(12);
    const aguardando = r.body.items.find((x: { key: string }) => x.key === 'waiting');
    const pausada = r.body.items.find((x: { key: string }) => x.key === 'paused');
    expect(aguardando.category).toBe('waiting');
    expect(pausada.category).toBe('waiting');
    expect(aguardando.requires_wait_reason).toBe(true);
    expect(pausada.requires_wait_reason).toBe(false);
    const emAnalise = r.body.items.find((x: { key: string }) => x.key === 'in_analysis');
    expect(emAnalise).toMatchObject({ label: 'Em análise', category: 'open' });
  });

  it('os motivos de espera dizem quais pausam o prazo', async () => {
    // Sem `pauses_sla` na resposta, a tela pede uma escolha cujo efeito ela
    // não sabe explicar — e "aguardando peça" e "aguardando técnico" viram a
    // mesma coisa aos olhos de quem escolhe, apesar de uma custar SLA e a
    // outra não.
    const r = await http.get('/v1/work-orders/wait-reasons').set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    for (const m of r.body.items) {
      expect(typeof m.pauses_sla).toBe('boolean');
      expect(typeof m.label).toBe('string');
    }
    // Vêm ordenados: a lista aparece num seletor, e ordem instável entre
    // aberturas do diálogo faz a pessoa clicar no item errado por memória
    // muscular.
    const posicoes = r.body.items.map((m: { position: number }) => m.position);
    expect([...posicoes].sort((a: number, b: number) => a - b)).toEqual(posicoes);
  });

  it('a rota /wait-reasons não é engolida pela rota /:id', async () => {
    const r = await http.get('/v1/work-orders/wait-reasons').set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('items');
  });

  it('a rota /board não é engolida pela rota /:id', async () => {
    // Desde o Express 5 a rota não carrega mais a regex de uuid — o
    // path-to-regexp 8 a rejeita — e por isso a resolução PASSOU a depender da
    // ordem de declaração. Quem garante a ordem hoje é a checagem de
    // sombreamento do gerador de OpenAPI; este teste é a prova pela borda.
    const r = await http.get('/v1/work-orders/board').set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.columns)).toBe(true);
  });
});

describe('ciclo de vida pela API', () => {
  let os = '';

  it('criar publica e devolve número', async () => {
    const r = await criar();
    expect(r.status).toBe(201);
    expect(r.body.number).toMatch(/^WO-\d{4}-\d{4}$/);
    os = r.body.id;
  });

  it('a ficha oferece só as transições que esta pessoa pode fazer', async () => {
    const doTecnico = await http.get(`/v1/work-orders/${os}`).set(auth(EMAIL_TEC));
    const doCoordenador = await http.get(`/v1/work-orders/${os}`).set(auth(EMAIL_COORD));
    const alvosTec = doTecnico.body.available_transitions.map((x: { to: string }) => x.to);
    const alvosCoord = doCoordenador.body.available_transitions.map((x: { to: string }) => x.to);
    expect(alvosTec).toContain('in_progress');
    expect(alvosTec).not.toContain('cancelled');
    expect(alvosCoord).toContain('cancelled');
  });

  it('a ficha diz o que cada transição exige antes de tentar', async () => {
    const r = await http.get(`/v1/work-orders/${os}`).set(auth(EMAIL_COORD));
    const agendar = r.body.available_transitions.find((x: { to: string }) => x.to === 'scheduled');
    expect(agendar.requires).toEqual(expect.arrayContaining(['assignee', 'scheduled_start']));
  });

  it('transição não declarada é 409 nomeando as possíveis', async () => {
    const r = await mover(EMAIL_COORD, os, { to: 'closed' });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Não é possível ir de "Aberta" para "Fechada"/);
    expect(r.body.details.allowed.length).toBeGreaterThan(0);
  });

  it('o técnico inicia; ir para Aguardando sem motivo é 409', async () => {
    expect((await mover(EMAIL_TEC, os, { to: 'in_progress' })).status).toBe(201);
    const semMotivo = await mover(EMAIL_TEC, os, { to: 'waiting' });
    expect(semMotivo.status).toBe(409);
    expect(JSON.stringify(semMotivo.body)).toMatch(/Aguardando/);
  });

  it('com motivo, bloqueia; e o desbloqueio limpa o motivo', async () => {
    expect((await mover(EMAIL_TEC, os, { to: 'waiting', wait_reason_id: motivoPeca })).status).toBe(201);
    const bloqueada = await http.get(`/v1/work-orders/${os}`).set(auth(EMAIL_COORD));
    expect(bloqueada.body.wait_reason_key).toBe('parts');
    expect(bloqueada.body.pauses_sla).toBe(false);

    expect((await mover(EMAIL_TEC, os, { to: 'in_progress' })).status).toBe(201);
    const solta = await http.get(`/v1/work-orders/${os}`).set(auth(EMAIL_COORD));
    expect(solta.body.wait_reason_id).toBeNull();
  });

  it('concluir sem resolução é recusado; com resolução, passa', async () => {
    const sem = await mover(EMAIL_TEC, os, { to: 'completed' });
    expect(sem.status).toBe(409);
    const com = await mover(EMAIL_TEC, os, {
      to: 'completed',
      resolution: 'Trocada a fonte de alimentação e testado',
    });
    expect(com.status).toBe(201);
    expect(com.body.category).toBe('review');
  });

  it('o técnico não valida — é outra permissão', async () => {
    const r = await mover(EMAIL_TEC, os, { to: 'validated' });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/validated|Validada/);
  });

  it('o histórico vem na ordem certa, com duração e motivo', async () => {
    const r = await http.get(`/v1/work-orders/${os}`).set(auth(EMAIL_COORD));
    const trilha = r.body.history.map((h: { to_label: string }) => h.to_label);
    expect(trilha).toEqual(['Aberta', 'Em execução', 'Aguardando', 'Em execução', 'Concluída']);
    const desbloqueio = r.body.history[3];
    expect(desbloqueio.wait_reason_label).toBe('Aguardando peça');
  });
});

describe('o quadro mostra por que cada OS está parada', () => {
  beforeAll(async () => {
    // duas paradas por motivos diferentes, para o agrupamento ter o que mostrar
    for (const [assetId, motivo] of [
      [ativo, motivoPeca],
      [ativoDois, motivoOrcamento],
    ] as const) {
      const r = await criar({ asset_id: assetId, title: `Parada por ${motivo}` });
      await mover(EMAIL_TEC, r.body.id, { to: 'in_progress' });
      await mover(EMAIL_TEC, r.body.id, { to: 'waiting', wait_reason_id: motivo });
    }
  });

  it('a coluna Aguardando traz a quebra por motivo, não só um número', async () => {
    const r = await http.get('/v1/work-orders/board').set(auth(EMAIL_COORD));
    const aguardando = r.body.columns.find((c: { key: string }) => c.key === 'waiting');
    expect(aguardando.total).toBe(2);
    const motivos = aguardando.by_wait_reason.map((x: { key: string }) => x.key).sort();
    expect(motivos).toEqual(['parts', 'quote_approval']);
    const orcamento = aguardando.by_wait_reason.find((x: { key: string }) => x.key === 'quote_approval');
    expect(orcamento.pauses_sla).toBe(true);
    expect(orcamento.total).toBe(1);
  });

  it('colunas sem OS aparecem zeradas, não somem do quadro', async () => {
    const r = await http.get('/v1/work-orders/board').set(auth(EMAIL_COORD));
    const cancelada = r.body.columns.find((c: { key: string }) => c.key === 'cancelled');
    expect(cancelada.total).toBe(0);
    expect(cancelada.by_wait_reason).toEqual([]);
  });
});

describe('tempo perdido por motivo', () => {
  it('a rota de indicador soma por motivo e diz quais pausam o SLA', async () => {
    const r = await http.get('/v1/work-orders/insights/wait-time').set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    const porChave = new Map(r.body.items.map((x: { wait_reason_key: string }) => [x.wait_reason_key, x]));
    expect(porChave.has('parts')).toBe(true);
    expect((porChave.get('parts') as { pauses_sla: boolean }).pauses_sla).toBe(false);
  });

  /**
   * O técnico VÊ este indicador, e isso é deliberado.
   *
   * `insight.read` está no papel de técnico; o que fica de fora é
   * `insight.read_financial_metrics`. Tempo perdido esperando peça é
   * informação operacional de quem executa — esconder dela quem passa o dia
   * parado esperando peça seria esconder o próprio problema de quem o sofre.
   * O que é sensível é custo, e custo tem permissão própria.
   */
  it('o técnico vê o indicador operacional, mas não tem a permissão financeira', async () => {
    const r = await http.get('/v1/work-orders/insights/wait-time').set(auth(EMAIL_TEC));
    expect(r.status).toBe(200);

    const semCusto = await http.get('/v1/work-orders?limit=1').set(auth(EMAIL_TEC));
    expect(semCusto.status).toBe(200);
    expect(JSON.stringify(semCusto.body)).not.toContain('cost');
  });

  it('data inválida é 422', async () => {
    const r = await http.get('/v1/work-orders/insights/wait-time?from=ontem').set(auth(EMAIL_COORD));
    expect(r.status).toBe(422);
  });
});

describe('aceite de solicitação gerando várias OS', () => {
  it('uma solicitação com 2 ativos gera 2 OS vinculadas', async () => {
    const pedido = await withTenant(
      t.db,
      // Com vínculo: solicitação sem solicitante identificável é recusada pelo
      // banco, e é o que a suíte do EPIC-007 garante.
      buildContext({
        organizationId: ORG,
        actorId: COORD_USER,
        membershipId: COORD_MEM,
        requestId: 'sr',
        permissions: PERMISSION_KEYS,
      }),
      async (s) => {
        const r = await createServiceRequest(s, {
          customerId: cliente,
          summary: 'Dois ventiladores com o mesmo defeito',
          locationId: setor,
        });
        await transitionRequest(s, r.id, 'triage');
        return r.id;
      }
    );

    const r = await http
      .post(`/v1/work-orders/from-request/${pedido}`)
      .set(auth(EMAIL_COORD))
      .send({
        targets: [
          { asset_id: ativo, work_order_type_id: natureza },
          { asset_id: ativoDois, work_order_type_id: natureza },
        ],
      });

    expect(r.status).toBe(201);
    expect(r.body.work_orders).toHaveLength(2);

    const lista = await http.get('/v1/work-orders?limit=200').set(auth(EMAIL_COORD));
    const vinculadas = lista.body.items.filter((w: { title: string }) =>
      w.title.includes('Dois ventiladores')
    );
    expect(vinculadas).toHaveLength(2);
  });

  it('lista de alvos vazia é 422', async () => {
    const r = await http
      .post(`/v1/work-orders/from-request/${newId()}`)
      .set(auth(EMAIL_COORD))
      .send({ targets: [] });
    expect(r.status).toBe(422);
  });

  it('acima de 50 alvos é 422 com o limite', async () => {
    const r = await http
      .post(`/v1/work-orders/from-request/${newId()}`)
      .set(auth(EMAIL_COORD))
      .send({ targets: Array.from({ length: 51 }, () => ({ work_order_type_id: natureza })) });
    expect(r.status).toBe(422);
    expect(r.body.details.max).toBe(50);
  });
});

describe('permissões e isolamento na borda', () => {
  it('sem credencial é 401', async () => {
    expect((await http.get('/v1/work-orders')).status).toBe(401);
  });

  it('o técnico não cria OS: 403 nomeando a permissão', async () => {
    const r = await http
      .post('/v1/work-orders')
      .set(auth(EMAIL_TEC))
      .send({ customer_id: cliente, work_order_type_id: natureza, title: 'Não deveria criar' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('work_order.create');
  });

  it('OS inexistente é 404', async () => {
    expect((await http.get(`/v1/work-orders/${newId()}`).set(auth(EMAIL_COORD))).status).toBe(404);
  });

  it('id malformado é recusado nomeando o campo', async () => {
    // 422 e não 404: a rota existe, o identificador é que não presta. Dizer
    // "não encontrado" mandaria quem integra procurar a URL errada.
    const r = await http.get('/v1/work-orders/nao-e-uuid').set(auth(EMAIL_COORD));
    expect(r.status).toBe(422);
    expect(r.body.details.field).toBe('id');
  });

  it('as rotas literais não são engolidas pela rota de detalhe', async () => {
    // `board` e `statuses` casariam com `:id` se fossem declaradas depois.
    await http.get('/v1/work-orders/board').set(auth(EMAIL_COORD)).expect(200);
    await http.get('/v1/work-orders/statuses').set(auth(EMAIL_COORD)).expect(200);
  });
});

describe('os filtros da lista', () => {
  /*
   * ESTE BLOCO EXISTE PORQUE EU QUEBREI UM DELES E NADA RECLAMOU.
   *
   * Ao acrescentar o filtro por ativo, um `$` se perdeu no marcador do
   * parâmetro e a condição virou `w.assignee_membership_id = 4` — comparação
   * de uuid com inteiro, 500 na cara de quem filtrasse por responsável. Nada
   * acusou: dos quatro filtros da rota, só `limit` tinha teste.
   *
   * Um filtro sem teste é uma cláusula de SQL montada por concatenação que
   * ninguém executa. Os quatro passam a ter.
   */
  it('filtra por cliente', async () => {
    const r = await http.get(`/v1/work-orders?customer=${cliente}`).set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    for (const os of r.body.items) expect(os.customer_id).toBe(cliente);

    // Um cliente que não existe devolve lista VAZIA, e não erro: a pergunta é
    // legítima e a resposta é "nenhuma".
    const vazio = await http
      .get('/v1/work-orders?customer=0193d900-0000-7000-8000-999999999999')
      .set(auth(EMAIL_COORD));
    expect(vazio.status).toBe(200);
    expect(vazio.body.items).toEqual([]);
  });

  it('filtra por responsável', async () => {
    const r = await http.get(`/v1/work-orders?assignee=${TEC_MEM}`).set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    for (const os of r.body.items) expect(os.assignee_membership_id ?? TEC_MEM).toBe(TEC_MEM);
  });

  it('filtra por equipamento — é o histórico que a ficha do ativo mostra', async () => {
    const r = await http.get(`/v1/work-orders?asset=${ativo}`).set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    for (const os of r.body.items) expect(os.asset_id).toBe(ativo);

    // E o outro equipamento não aparece: sem isso, o teste passaria com um
    // filtro que não filtra nada.
    const outro = await http.get(`/v1/work-orders?asset=${ativoDois}`).set(auth(EMAIL_COORD));
    expect(outro.status).toBe(200);
    for (const os of outro.body.items) expect(os.asset_id).toBe(ativoDois);
    const ids = new Set(r.body.items.map((o: { id: string }) => o.id));
    for (const os of outro.body.items) expect(ids.has(os.id)).toBe(false);
  });

  it('filtra por categoria, e recusa categoria inventada', async () => {
    const r = await http.get('/v1/work-orders?category=open').set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    for (const os of r.body.items) expect(os.category).toBe('open');

    const ruim = await http.get('/v1/work-orders?category=inventada').set(auth(EMAIL_COORD));
    expect(ruim.status).toBe(422);
  });

  it('identificador malformado nos filtros é recusado antes de chegar ao banco', async () => {
    for (const filtro of ['customer', 'assignee', 'asset']) {
      const r = await http.get(`/v1/work-orders?${filtro}=nao-e-uuid`).set(auth(EMAIL_COORD));
      expect(r.status, filtro).toBe(422);
    }
  });
});
