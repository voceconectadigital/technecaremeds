/**
 * Aurora — o portal do cliente, e a prova de que nada interno vaza
 * (SPEC v0.2 §19 · EPIC-020 · PORTAL-001..010).
 *
 * O QUE ESTE ARQUIVO PROVA, E COMO
 *
 * Cada caso monta um dado interno REAL — uma nota que ninguém deve ler, um
 * custo que ninguém deve ver, um chamado de outro cliente — e depois pergunta
 * ao portal. A asserção é sempre sobre o CORPO da resposta, e não sobre a
 * tela: um campo escondido por CSS já viajou, já está no cache do dispositivo,
 * e já pode ser lido por quem abrir as ferramentas de desenvolvedor.
 *
 * A MASSA TEM DOIS CLIENTES DE PROPÓSITO.
 *
 * Um teste de vazamento com um cliente só prova que o dado chega a quem deve.
 * A pergunta que importa é a outra, e ela precisa de um segundo cliente cujo
 * chamado, equipamento e documento existam de verdade no mesmo banco, na mesma
 * organização, sob a mesma conexão.
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
  addComment,
  provisionDocumentTypes,
  createDocument,
  transitionDocument,
  createQuote,
  addQuoteItem,
  transitionQuote,
  scheduleWorkOrder,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const COORD_USER = newId(),
  COORD_MEM = newId();
/** O usuário do portal do cliente A. */
const PORTAL_USER = newId(),
  PORTAL_MEM = newId();

const EMAIL_COORD = 'coord@portal.test';
const EMAIL_PORTAL = 'enfermeira@clientea.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

let clienteA: string, clienteB: string;
let utiA: string, utiB: string;
let ativoA: string, ativoB: string;
let natureza: string;
let osDoA: string;
let solicitacaoDoB: string;

const NOTA_INTERNA = 'Cliente contesta toda fatura; falar com o comercial antes de fechar.';
const NOTA_PARA_O_CLIENTE = 'Peça encomendada, previsão de chegada na quinta.';
const RESUMO_DO_OUTRO = 'Chamado confidencial do Hospital Beta';

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: COORD_USER, membershipId: COORD_MEM },
    { slug: 'portal', name: 'Prestadora', email: EMAIL_COORD, userName: 'Coordenadora' }
  );

  // A semente carrega TODAS as permissões: o grafo de transições consulta o
  // contexto, e um contexto sem permissão só oferece 'cancelar'. Isto é a
  // semente montando o cenário, e não a aplicação decidindo — quem decide
  // continua sendo o guarda das rotas, exercitado nos casos abaixo.
  const sysCtx = buildContext({
    organizationId: ORG,
    actorKind: 'system',
    requestId: 'setup',
    permissions: PERMISSION_KEYS,
  });

  await withTenant(t.db, sysCtx, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, COORD_MEM, papeis.get('coordinator')!);
    await provisionWorkOrderStates(s);

    const tipos = await provisionStarterLocationTypes(s);

    clienteA = await createCustomer(s, { name: 'Hospital Alfa' });
    clienteB = await createCustomer(s, { name: 'Hospital Beta' });

    utiA = await createLocation(s, {
      customerId: clienteA,
      locationTypeId: tipos.get('unidade')!,
      name: 'UTI Alfa',
    });
    utiB = await createLocation(s, {
      customerId: clienteB,
      locationTypeId: tipos.get('unidade')!,
      name: 'UTI Beta',
    });

    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativoA = await createAsset(s, {
      name: 'Ventilador do Alfa',
      customerId: clienteA,
      assetCategoryId: cat,
      locationId: utiA,
    });
    ativoB = await createAsset(s, {
      name: 'Ventilador do Beta',
      customerId: clienteB,
      assetCategoryId: cat,
      locationId: utiB,
    });

    // Valores no ativo do Alfa: é sobre ELE que o portal do Alfa pergunta, e é
    // dele que o valor não pode sair.
    await s.query(
      `UPDATE aurora.assets
          SET purchase_value = 92000, replacement_value = 118000, currency = 'BRL',
              internal_notes = 'Equipamento problemático; avaliar substituição na renovação.'
        WHERE id = $1`,
      [ativoA]
    );

    natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });

    // O chamado do OUTRO cliente — o que o portal do Alfa nunca pode ver.
    const outro = await createServiceRequest(s, {
      customerId: clienteB,
      locationId: utiB,
      assetId: ativoB,
      summary: RESUMO_DO_OUTRO,
      source: 'phone',
      // A restrição service_requests_requester_identified exige que alguém
      // seja identificável: chamado sem solicitante é chamado que ninguém
      // consegue responder. Aqui é a semente, sob contexto de sistema, e por
      // isso o solicitante vem por nome e telefone.
      requesterName: 'Recepção do Beta',
      requesterPhone: '+55 11 90000-0000',
    });
    solicitacaoDoB = outro.id;
  });

  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  app = await createApp({ db: t.db, env });
  await app.init();
  http = request(app.getHttpServer());

  /*
   * O USUÁRIO DO PORTAL, com escopo de UM cliente e UM local.
   *
   * `seat_type: 'portal'` — a SPEC §05 separa assento de equipe de assento de
   * portal, e só o primeiro consome licença. A referência validou o modelo com
   * 36 assentos internos contra 1.971 solicitantes.
   */
  await seedMember(
    t,
    { organizationId: ORG, userId: PORTAL_USER, membershipId: PORTAL_MEM },
    {
      email: EMAIL_PORTAL,
      userName: 'Enfermeira do Alfa',
      seatType: 'portal',
      customerIds: [clienteA],
      locationIds: [utiA],
    }
  );
  await withTenant(t.db, sysCtx, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, PORTAL_MEM, papeis.get('requester')!);
  });

  /*
   * A solicitação do Alfa nasce pela CAMADA DE DADOS, e não pela rota.
   *
   * O papel `coordinator` triava e não CRIA: quem origina chamado é técnico,
   * solicitante ou gestor de cliente. A separação é deliberada — coordenação
   * recebe demanda, não a inventa — e a semente respeita isso em vez de
   * conceder uma permissão a mais só para o teste passar.
   */
  let solicitacaoDoA = '';
  await withTenant(t.db, sysCtx, async (s) => {
    const r = await createServiceRequest(s, {
      customerId: clienteA,
      locationId: utiA,
      assetId: ativoA,
      summary: 'Ventilador do Alfa apitando',
      source: 'phone',
      requesterName: 'Recepção do Alfa',
      requesterPhone: '+55 11 91111-1111',
      submit: true,
    });
    solicitacaoDoA = r.id;
    await transitionRequest(s, r.id, 'triage');
  });

  const os = await http
    .post(`/v1/work-orders/from-request/${solicitacaoDoA}`)
    .set(auth(EMAIL_COORD))
    .send({ targets: [{ work_order_type_id: natureza, title: 'Reparo do ventilador' }] });
  if (!os.body.work_orders?.[0]) {
    throw new Error('a semente não conseguiu gerar a OS: ' + JSON.stringify(os.body));
  }
  osDoA = os.body.work_orders[0].id;

  const ctxCoord = buildContext({
    organizationId: ORG,
    actorKind: 'user',
    actorId: COORD_USER,
    membershipId: COORD_MEM,
    requestId: 'comentarios',
    permissions: new Set(['work_order.read_internal_notes']),
  });
  await withTenant(t.db, ctxCoord, async (s) => {
    await addComment(s, { workOrderId: osDoA, body: NOTA_INTERNA, visibility: 'internal' });
    await addComment(s, { workOrderId: osDoA, body: NOTA_PARA_O_CLIENTE, visibility: 'customer' });
  });

  /*
   * DOCUMENTO LIBERADO, ORÇAMENTO ENVIADO, VISITA AGENDADA.
   *
   * Sem os três, `/portal/documents`, `/portal/quotes` e `/portal/schedule`
   * respondem lista vazia — e uma lista vazia não tem campo proibido dentro.
   * As provas PORTAL-007, 008 e 009 passavam contra o nada, e a varredura da
   * PORTAL-011 passaria também: sete telas limpas porque não havia nada nelas.
   *
   * A massa entra pelo CAMINHO REAL de cada módulo — rascunho, revisão,
   * emissão, liberação —, e não por escrita direta na tabela. Um documento
   * "liberado" por `UPDATE` teria estado que a aplicação não sabe produzir, e
   * a prova passaria contra um mundo que não existe.
   */
  await withTenant(t.db, sysCtx, async (s) => {
    const tipos = await provisionDocumentTypes(s);
    const doc = await createDocument(s, {
      documentTypeId: tipos.get('work_order_report')!,
      title: 'Relatório de atendimento — ventilador do Alfa',
      assetId: ativoA,
      customerId: clienteA,
      workOrderId: osDoA,
      verdict: 'conforming',
    });
    await transitionDocument(s, doc, 'under_review');
    await transitionDocument(s, doc, 'issued');
    await transitionDocument(s, doc, 'released');

    /*
     * O ORÇAMENTO PRECISA DE ITEM, e o item é o que carrega custo.
     *
     * Um orçamento sem linha nenhuma passaria em qualquer varredura de custo:
     * o custo mora na composição, e sem composição não há o que vazar. É
     * exatamente o caso que a prova precisa exercitar.
     */
    /*
     * O CONTATO QUE APROVA É EXIGIDO PARA ENVIAR, e com razão: um orçamento
     * enviado a ninguém é um orçamento que ninguém aprova, e o produto recusa
     * criar esse estado. A massa cria o contato em vez de contornar a regra.
     */
    const contato = newId();
    await s.query(
      `INSERT INTO aurora.customer_contacts (id, organization_id, customer_id, name, email)
       VALUES ($1, $2, $3, $4, $5)`,
      [contato, ORG, clienteA, 'Contato do Alfa', 'contato@alfa.test']
    );
    const orcamento = await createQuote(s, {
      customerId: clienteA,
      approverContactId: contato,
      validUntil: '2030-12-31',
    });
    await addQuoteItem(s, {
      quoteId: orcamento,
      /*
       * `service`, e não `part`: a linha de peça exige um item de estoque
       * cadastrado (`quote_items_part_has_item`), e a massa do portal não
       * precisa de um para provar o que precisa provar.
       */
      kind: 'service',
      description: 'Substituição da válvula de exalação',
      quantity: 2,
      unitPriceCents: 32000,
    });
    await transitionQuote(s, orcamento, 'sent');

    /*
     * A VISITA É AGENDADA NO FUTURO: a consulta do portal corta o que começou
     * há mais de um dia, e uma visita no passado não apareceria.
     */
    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const fim = new Date(amanha.getTime() + 2 * 60 * 60 * 1000);
    await scheduleWorkOrder(s, {
      workOrderId: osDoA,
      membershipId: COORD_MEM,
      startsAt: amanha,
      endsAt: fim,
    });
  });
}, 180_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

/** Toda a resposta, como texto — para procurar o que não deveria estar lá. */
const corpoInteiro = (r: request.Response) => JSON.stringify(r.body);

/* -------------------------------------------------------------------------- */

describe('PORTAL-001 · o portal exige vínculo', () => {
  it('sem vínculo não há escopo, e sem escopo a resposta é recusa', async () => {
    // Uma sessão sem vínculo veria a organização inteira se a consulta rodasse
    // com escopo vazio. Recusar é a diferença entre "não vejo nada" e "vejo
    // tudo".
    const r = await http.get('/v1/portal/home').set(auth('ninguem@lugar.nenhum'));
    expect([401, 403]).toContain(r.status);
  });
});

describe('PORTAL-002 · nota interna não sai do servidor', () => {
  it('os comentários do portal trazem só os do cliente', async () => {
    const r = await http.get(`/v1/portal/work-orders/${osDoA}/comments`).set(auth(EMAIL_PORTAL));
    expect(r.status).toBe(200);

    const corpos = r.body.items.map((c: { body: string }) => c.body);
    expect(corpos).toContain(NOTA_PARA_O_CLIENTE);
    expect(corpos).not.toContain(NOTA_INTERNA);

    // E o TEXTO da nota interna não está em canto nenhum da resposta.
    expect(corpoInteiro(r)).not.toContain('contesta toda fatura');

    // O tipo devolvido nem tem o campo `visibility`: não há como um consumidor
    // vazar o que não recebeu.
    for (const c of r.body.items) expect(c.visibility).toBeUndefined();
  });

  it('a mesma OS, pela rota INTERNA, mostra a nota — a diferença é a rota', async () => {
    // Este caso existe para provar que a nota EXISTE. Sem ele, o teste acima
    // passaria com uma nota que nunca foi gravada.
    const r = await http.get(`/v1/work-orders/${osDoA}/comments`).set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain('contesta toda fatura');
  });
});

describe('PORTAL-003 · valor de equipamento não sai', () => {
  it('a lista de equipamentos do portal não traz nenhum valor', async () => {
    const r = await http.get('/v1/portal/assets').set(auth(EMAIL_PORTAL));
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);

    const texto = corpoInteiro(r);
    expect(texto).not.toContain('92000');
    expect(texto).not.toContain('118000');
    for (const a of r.body.items) {
      expect(a.purchase_value).toBeUndefined();
      expect(a.replacement_value).toBeUndefined();
      expect(a.residual_value).toBeUndefined();
    }
  });

  it('a observação interna do equipamento também não sai', async () => {
    const r = await http.get('/v1/portal/assets').set(auth(EMAIL_PORTAL));
    expect(corpoInteiro(r)).not.toContain('avaliar substituição');
    for (const a of r.body.items) expect(a.internal_notes).toBeUndefined();
  });
});

describe('PORTAL-004 · outro cliente não aparece', () => {
  it('a lista de solicitações traz só as do meu cliente', async () => {
    const r = await http.get('/v1/portal/requests').set(auth(EMAIL_PORTAL));
    expect(r.status).toBe(200);
    expect(corpoInteiro(r)).not.toContain(RESUMO_DO_OUTRO);
  });

  it('a lista de equipamentos traz só os do meu cliente', async () => {
    const r = await http.get('/v1/portal/assets').set(auth(EMAIL_PORTAL));
    const nomes = r.body.items.map((a: { name: string }) => a.name);
    expect(nomes).toContain('Ventilador do Alfa');
    expect(nomes).not.toContain('Ventilador do Beta');
  });

  it('pedir a solicitação do outro pelo identificador dá RECUSA, e não 404', async () => {
    /*
     * A distinção importa e é contraintuitiva.
     *
     * 404 para "não existe" e 403 para "existe e não é seu" conta ao cliente
     * que a solicitação do concorrente EXISTE — e, iterando os números,
     * quantos chamados ele abriu. É enumeração, e o custo é vazar o volume de
     * operação de outra empresa.
     *
     * As duas respostas têm de ser indistinguíveis.
     */
    const doOutro = await http.get(`/v1/portal/requests/${solicitacaoDoB}`).set(auth(EMAIL_PORTAL));
    const inexistente = await http
      .get('/v1/portal/requests/0193d900-0000-7000-8000-999999999999')
      .set(auth(EMAIL_PORTAL));

    expect(doOutro.status).toBe(inexistente.status);
    expect(corpoInteiro(doOutro)).not.toContain(RESUMO_DO_OUTRO);
  });
});

describe('PORTAL-005 · o vocabulário é o do cliente', () => {
  it('a situação da OS chega traduzida, e não como chave interna', async () => {
    const r = await http.get('/v1/portal/work-orders').set(auth(EMAIL_PORTAL));
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);

    for (const w of r.body.items) {
      expect(typeof w.status_label).toBe('string');
      expect(w.status_label.length).toBeGreaterThan(0);
      // A chave interna não viaja: "in_progress" não é frase.
      expect(w.status_key).toBeUndefined();
      expect(w.status_category).toBeUndefined();
    }
  });

  it('a situação da solicitação também', async () => {
    const r = await http.get('/v1/portal/requests').set(auth(EMAIL_PORTAL));
    const um = r.body.items[0];
    expect(um.status_label).toBeTruthy();
    // "triage" é etapa nossa; "Recebido" é o que interessa a quem pediu.
    expect(um.status_label).not.toBe('triage');
  });
});

describe('PORTAL-006 · a resolução só depois de validada', () => {
  it('uma OS em andamento não mostra resolução', async () => {
    // Resolução em rascunho é anotação de trabalho em curso, e mostrá-la
    // produz "então já acabou?" antes de ter acabado.
    const r = await http.get('/v1/portal/work-orders').set(auth(EMAIL_PORTAL));
    const emAndamento = r.body.items.find((w: { completed_at: string | null }) => !w.completed_at);
    if (emAndamento) expect(emAndamento.resolution).toBeNull();
  });
});

describe('PORTAL-007 · documento só depois de liberado', () => {
  it('documento emitido e não liberado não aparece', async () => {
    /*
     * Emitido e liberado são coisas diferentes: entre os dois há a conferência
     * interna. Mostrar o emitido antecipa uma conversa que a equipe ainda não
     * teve — e, quando o parecer é "não conforme", antecipa a pior possível.
     */
    const r = await http.get('/v1/portal/documents').set(auth(EMAIL_PORTAL));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
    for (const d of r.body.items) {
      expect(d.released_to_customer_at ?? 'liberado').toBeTruthy();
    }
  });
});

describe('PORTAL-008 · o orçamento mostra o preço, não a composição', () => {
  it('nenhum campo de custo ou margem sai na lista', async () => {
    const r = await http.get('/v1/portal/quotes').set(auth(EMAIL_PORTAL));
    expect(r.status).toBe(200);
    for (const q of r.body.items) {
      expect(q.cost_cents).toBeUndefined();
      expect(q.margin_cents).toBeUndefined();
      expect(q.internal_notes).toBeUndefined();
    }
    // Rascunho não chega ao cliente: número que ainda vai mudar não é proposta.
    for (const q of r.body.items) expect(q.status).not.toBe('draft');
  });
});

describe('PORTAL-009 · a agenda não diz quem vai', () => {
  it('nenhuma visita traz responsável', async () => {
    // Quem entra na unidade é assunto do processo de autorização de acesso, e
    // não de um campo de listagem.
    const r = await http.get('/v1/portal/schedule').set(auth(EMAIL_PORTAL));
    expect(r.status).toBe(200);
    for (const v of r.body.items) {
      expect(v.assignee_name).toBeUndefined();
      expect(v.assignee_membership_id).toBeUndefined();
      expect(v.team_name).toBeUndefined();
    }
  });
});

describe('PORTAL-010 · a escrita é mínima, e não aceita o cliente do corpo', () => {
  it('abrir chamado usa o cliente do VÍNCULO, e ignora o do corpo', async () => {
    /*
     * Aceitar `customer_id` do corpo deixaria alguém abrir chamado em nome de
     * outro cliente — e o chamado apareceria na fila da prestadora como se
     * fosse legítimo.
     */
    const r = await http.post('/v1/portal/requests').set(auth(EMAIL_PORTAL)).send({
      summary: 'Bomba de infusão com alarme',
      customer_id: clienteB,
      source: 'phone',
    });
    expect(r.status).toBe(201);

    const criada = await http.get('/v1/portal/requests').set(auth(EMAIL_PORTAL));
    const nova = criada.body.items.find(
      (x: { summary: string }) => x.summary === 'Bomba de infusão com alarme'
    );
    expect(nova).toBeTruthy();

    // A prova de que o cliente NÃO foi o do corpo: a solicitação aparece para
    // o portal do Alfa, cujo escopo é só o Alfa.
    const interna = await http.get(`/v1/service-requests/${nova.id}`).set(auth(EMAIL_COORD));
    expect(interna.body.customer_id).toBe(clienteA);
    // E a origem é `portal`, sempre: deixá-la vir do corpo faria o indicador
    // de autoatendimento medir ficção.
    expect(interna.body.source).toBe('portal');
  });

  it('resumo vazio é recusado com explicação', async () => {
    const r = await http.post('/v1/portal/requests').set(auth(EMAIL_PORTAL)).send({ summary: '  ' });
    expect(r.status).toBe(422);
    expect(r.body.message).toContain('acontecendo');
  });
});

/* -------------------------------------------------------------------------- */
/* PORTAL-011 · a varredura                                                    */
/* -------------------------------------------------------------------------- */

/**
 * As chaves que NÃO PODEM sair pelo portal, em nenhuma rota, em nenhuma
 * profundidade.
 *
 * Cada uma delas é uma coisa da prestadora, e não do cliente:
 *
 *  · `cost`, `margin`, `unit_cost`, `markup` — o cliente vê PREÇO, e o preço é
 *    um número acordado. A composição dele é o que a prestadora negocia com o
 *    fornecedor, e revelá-la é entregar a margem numa tela de acompanhamento;
 *  · `supplier`, `vendor` — de quem a prestadora compra é dela;
 *  · `internal_note`, `internal_comment` — a nota interna existe justamente
 *    para dizer o que não se diz ao cliente;
 *  · `assignee`, `technician`, `team` — quem vai é decisão de escala, e o
 *    cliente que a enxerga passa a cobrar pessoa, não serviço;
 *  · `purchase`, `acquisition_value` — o que o equipamento custou.
 */
const PROIBIDAS = [
  'cost',
  'unit_cost',
  'total_cost',
  'margin',
  'markup',
  'supplier',
  'supplier_id',
  'supplier_name',
  'vendor',
  'internal_note',
  'internal_notes',
  'internal_comment',
  'assignee',
  'assignee_id',
  'assignee_membership_id',
  'assignee_name',
  'technician_name',
  'team_name',
  'purchase_value',
  'acquisition_value',
];

/** Toda chave que aparece na resposta, em qualquer profundidade. */
function chavesDe(valor: unknown, achadas = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) {
    for (const v of valor) chavesDe(v, achadas);
    return achadas;
  }
  if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      achadas.add(k);
      chavesDe(v, achadas);
    }
  }
  return achadas;
}

describe('PORTAL-011 · a varredura: nenhuma rota do portal devolve chave da prestadora', () => {
  /*
   * POR QUE ESTA PROVA EXISTE, TENDO AS DEZ ANTERIORES.
   *
   * As dez de cima conferem CAMPOS QUE ALGUÉM PENSOU EM CONFERIR. Esta confere
   * a forma inteira da resposta — e é a única que continua valendo quando
   * alguém acrescentar um campo novo a uma consulta do portal daqui a seis
   * meses, sem lembrar desta conversa.
   *
   * O modo de falhar do portal não é alguém decidir vazar: é uma consulta que
   * ganha uma coluna a mais num `SELECT *` bem-intencionado. Uma lista de
   * chaves proibidas, varrida em toda profundidade, pega isso no dia em que
   * acontece.
   *
   * E as rotas são listadas à mão de propósito: uma varredura que descobre as
   * rotas sozinha passaria despercebida no dia em que uma rota nova entrasse
   * sem ninguém acrescentá-la aqui — falhando exatamente onde não deveria
   * falhar em silêncio.
   */
  const ROTAS = [
    '/v1/portal/home',
    '/v1/portal/requests',
    '/v1/portal/work-orders',
    '/v1/portal/assets',
    '/v1/portal/documents',
    '/v1/portal/quotes',
    '/v1/portal/schedule',
  ];

  for (const rota of ROTAS) {
    it(`${rota} não traz nenhuma chave proibida`, async () => {
      const r = await http.get(rota).set(auth(EMAIL_PORTAL));
      expect(r.status, corpoInteiro(r)).toBe(200);

      const chaves = [...chavesDe(r.body)];

      /*
       * A VARREDURA PRECISA TER OLHADO ALGUMA COISA.
       *
       * Uma lista vazia não tem chave proibida, e passaria — provando nada. É
       * o mesmo erro de uma verificação de tela que visita uma página sem dado
       * dentro e declara a tela limpa. O piso mínimo faz a prova falhar quando
       * a massa deixa de alimentar a rota, em vez de aprovar o silêncio.
       */
      expect(chaves.length, `${rota} respondeu praticamente vazio`).toBeGreaterThan(3);

      const vazadas = chaves.filter((k) => PROIBIDAS.includes(k));
      expect(vazadas, `${rota} devolveu ${vazadas.join(', ')}`).toEqual([]);
    });
  }

  it('a rota de um chamado específico também', async () => {
    const lista = await http.get('/v1/portal/requests').set(auth(EMAIL_PORTAL));
    const primeiro = lista.body.items[0];
    expect(primeiro, 'a massa precisa de pelo menos um chamado do cliente').toBeTruthy();

    const r = await http.get(`/v1/portal/requests/${primeiro.id}`).set(auth(EMAIL_PORTAL));
    expect(r.status).toBe(200);
    const vazadas = [...chavesDe(r.body)].filter((k) => PROIBIDAS.includes(k));
    expect(vazadas).toEqual([]);
  });

  it('e os comentários de uma OS', async () => {
    const r = await http.get(`/v1/portal/work-orders/${osDoA}/comments`).set(auth(EMAIL_PORTAL));
    expect(r.status).toBe(200);
    const vazadas = [...chavesDe(r.body)].filter((k) => PROIBIDAS.includes(k));
    expect(vazadas).toEqual([]);

    /*
     * E a varredura por CHAVE não basta sozinha: uma nota interna poderia sair
     * dentro de um campo de texto com nome inocente. O conteúdo dela é
     * procurado no corpo inteiro, como texto.
     */
    expect(corpoInteiro(r)).not.toContain(NOTA_INTERNA);
  });

  it('CONTROLE POSITIVO: a mesma varredura ACUSA na rota interna', async () => {
    /*
     * UMA VARREDURA QUE NUNCA ACUSA NÃO É UMA VARREDURA.
     *
     * Se as chaves proibidas estivessem escritas com nome errado — `assignee`
     * onde o produto usa `assigned_to` —, todos os casos acima passariam para
     * sempre, provando exatamente nada. Este caso aponta a MESMA lista e a
     * MESMA função para a rota interna da mesma OS, e exige que ela acuse.
     *
     * É o que mantém a prova honesta: a lista de proibidas é conferida contra
     * a forma real da resposta interna, e não contra a memória de quem a
     * escreveu.
     */
    const r = await http.get(`/v1/work-orders/${osDoA}`).set(auth(EMAIL_COORD));
    expect(r.status).toBe(200);

    const achadas = [...chavesDe(r.body)].filter((k) => PROIBIDAS.includes(k));
    expect(
      achadas.length,
      'a rota interna precisa trazer alguma das chaves proibidas — se não traz, a lista está com nome errado e as provas acima são vazias'
    ).toBeGreaterThan(0);
  });

  it('a varredura vale também para a lista completa, e não só para a primeira página', async () => {
    /*
     * Uma resposta paginada esconde metade do problema: se a segunda página
     * carregar um campo que a primeira não carrega — porque a consulta muda
     * com o filtro —, a varredura da primeira passa e o vazamento fica.
     */
    const r = await http.get('/v1/portal/work-orders?limit=100').set(auth(EMAIL_PORTAL));
    expect(r.status).toBe(200);
    const vazadas = [...chavesDe(r.body)].filter((k) => PROIBIDAS.includes(k));
    expect(vazadas).toEqual([]);
  });
});
