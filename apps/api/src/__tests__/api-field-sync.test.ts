/**
 * Aurora — a sincronização de campo pela HTTP (SPEC v0.2 §20 · EPIC-014).
 *
 * O ARQUIVO ANTERIOR PROVA A CAMADA DE DADOS; ESTE PROVA O CAMINHO INTEIRO.
 *
 * A diferença não é cerimônia. Entre a função e a rota existem o cabeçalho, o
 * corpo desserializado, o guarda de permissão, o filtro de erro e a
 * serialização da resposta — e é nesses cinco que uma garantia de banco
 * costuma se perder. O aparelho do técnico fala com a ROTA, então é a rota que
 * precisa ser provada.
 *
 * O CENÁRIO É O DA SPEC, LITERAL: o técnico executa sem rede, a coordenação
 * cancela a OS enquanto isso, e o comando chega depois. Nada pode sumir.
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
  createWorkOrder,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const COORD_USER = newId(),
  COORD_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();

const EMAIL_COORD = 'coord@campo.test';
const EMAIL_TEC = 'tecnico@campo.test';

const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });
/** O cabeçalho que o aparelho gera ANTES da primeira tentativa. */
const operacao = (id: string) => ({ 'x-aurora-client-operation': id });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;

let cliente: string, local: string, ativo: string, natureza: string;

const sysCtx = buildContext({
  organizationId: ORG,
  actorKind: 'system',
  requestId: 'setup',
  permissions: PERMISSION_KEYS,
});

/** Uma OS nova, pronta para ser executada — cada caso precisa da sua. */
async function novaOS(titulo: string): Promise<string> {
  return withTenant(t.db, sysCtx, async (s) => {
    const r = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: titulo,
      description: 'semeada para o teste de campo',
      locationId: local,
      assetId: ativo,
      assigneeMembershipId: TEC_MEM,
      publish: true,
    });
    return r.id;
  });
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: COORD_USER, membershipId: COORD_MEM },
    { slug: 'campo', name: 'Prestadora', email: EMAIL_COORD, userName: 'Coordenadora' }
  );

  await withTenant(t.db, sysCtx, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, COORD_MEM, papeis.get('coordinator')!);
    await provisionWorkOrderStates(s);

    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital de Campo', isInternal: true });
    local = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'UTI',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 1',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: local,
    });
    natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
  });

  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico de Campo' }
  );
  await withTenant(t.db, sysCtx, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, TEC_MEM, papeis.get('technician')!);
  });

  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  app = await createApp({ db: t.db, env });
  await app.init();
  http = request(app.getHttpServer());
}, 180_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('CAMPO-001 · o cronômetro não é iniciado duas vezes', () => {
  it('duas requisições idênticas produzem UM apontamento', async () => {
    /*
     * DOIS CRONÔMETROS ABERTOS SOMAM DOBRADO.
     *
     * A folha do dia passa a mostrar dezesseis horas para oito, e a correção é
     * manual — alguém precisa descobrir qual dos dois apontamentos é o
     * fantasma. É o defeito que a fila de saída de um aplicativo offline produz
     * com mais facilidade, porque a retentativa é o comportamento normal dela.
     */
    const os = await novaOS('Cronômetro');
    const op = newId();

    const um = await http
      .post(`/v1/work-orders/${os}/timer/start`)
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send({});
    expect(um.status).toBe(201);

    const dois = await http
      .post(`/v1/work-orders/${os}/timer/start`)
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send({});
    expect(dois.status).toBe(201);

    // O MESMO apontamento nas duas respostas, e um só no banco.
    expect(dois.body.entry_id).toBe(um.body.entry_id);

    const linhas = await t.raw(
      `SELECT count(*)::int AS total FROM aurora.time_entries WHERE work_order_id = $1`,
      [os]
    );
    expect(linhas[0]!.total).toBe(1);

    // Parar é obrigação do caso, e não limpeza cosmética: o banco só admite UM
    // cronômetro aberto por pessoa, e deixá-lo correndo faria o próximo caso
    // falhar por um motivo que não é o dele.
    await http.post(`/v1/time-entries/${um.body.entry_id}/stop`).set(auth(EMAIL_TEC)).send({}).expect(201);
  });

  it('sem o cabeçalho, a garantia não existe — e o produto não finge que existe', async () => {
    /*
     * Esta prova documenta o LIMITE, e é por isso que ela existe.
     *
     * O cabeçalho é opcional: quem está online não tem fila nem retentativa
     * cega. A consequência honesta é que, sem ele, dois envios são duas
     * operações — e é melhor que isso esteja escrito num teste do que
     * descoberto por alguém que achou que a proteção era automática.
     *
     * O segundo início é recusado aqui pelo DOMÍNIO (já há cronômetro aberto),
     * e não pela idempotência. São duas defesas diferentes, e confundi-las
     * levaria a remover a que parece redundante.
     */
    const os = await novaOS('Sem cabeçalho');

    const um = await http.post(`/v1/work-orders/${os}/timer/start`).set(auth(EMAIL_TEC)).send({});
    expect(um.status).toBe(201);

    const dois = await http.post(`/v1/work-orders/${os}/timer/start`).set(auth(EMAIL_TEC)).send({});
    expect(dois.status).toBeGreaterThanOrEqual(400);

    await http.post(`/v1/time-entries/${um.body.entry_id}/stop`).set(auth(EMAIL_TEC)).send({}).expect(201);
  });

  it('um identificador que não é UUID é recusado, e não ignorado em silêncio', async () => {
    /*
     * Ignorar seria o pior desfecho: a requisição seguiria sem garantia
     * nenhuma, e o cliente continuaria acreditando que tem uma. Nenhuma
     * proteção com a confiança de quem acha que está protegido.
     */
    const os = await novaOS('Cabeçalho torto');
    const r = await http
      .post(`/v1/work-orders/${os}/timer/start`)
      .set({ ...auth(EMAIL_TEC), 'x-aurora-client-operation': 'nao-e-uuid' })
      .send({});

    expect(r.status).toBe(422);
    expect(r.body.code).toBe('validation_failed');
    expect(r.body.details.header).toBe('x-aurora-client-operation');
  });
});

describe('CAMPO-002 · o mesmo identificador com outro conteúdo é recusado', () => {
  it('a resposta guardada NÃO é devolvida para um comando diferente', async () => {
    const os = await novaOS('Horas');
    const op = newId();
    const base = {
      started_at: '2026-08-20T13:00:00.000Z',
      ended_at: '2026-08-20T15:00:00.000Z',
    };

    const um = await http
      .post(`/v1/work-orders/${os}/time-entries`)
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send(base);
    expect(um.status).toBe(201);

    /*
     * Devolver o desfecho da primeira aqui faria o aparelho concluir que as
     * QUATRO horas foram lançadas, apagar da fila e seguir. Duas horas de
     * trabalho sumiriam sem ninguém ver — perda silenciosa com aparência de
     * sucesso, que é a pior forma dela.
     */
    const dois = await http
      .post(`/v1/work-orders/${os}/time-entries`)
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send({ ...base, ended_at: '2026-08-20T17:00:00.000Z' });

    expect(dois.status).toBe(409);
    expect(dois.body.details.reason).toBe('digest_mismatch');

    const linhas = await t.raw(
      `SELECT count(*)::int AS total FROM aurora.time_entries WHERE work_order_id = $1`,
      [os]
    );
    expect(linhas[0]!.total).toBe(1);
  });

  it('a ordem dos campos do corpo não transforma retentativa em operação nova', async () => {
    const os = await novaOS('Ordem dos campos');
    const op = newId();

    const um = await http
      .post(`/v1/work-orders/${os}/time-entries`)
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send({ started_at: '2026-08-21T13:00:00.000Z', ended_at: '2026-08-21T14:00:00.000Z' });
    expect(um.status).toBe(201);

    // O MESMO comando, serializado ao contrário. Um cliente reescrito monta o
    // objeto noutra ordem, e a retentativa dele continua sendo retentativa.
    const dois = await http
      .post(`/v1/work-orders/${os}/time-entries`)
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send({ ended_at: '2026-08-21T14:00:00.000Z', started_at: '2026-08-21T13:00:00.000Z' });

    expect(dois.status).toBe(201);
    expect(dois.body.entry_id).toBe(um.body.entry_id);
  });
});

describe('CAMPO-003 · a OS cancelada durante a execução offline', () => {
  it('o comando é recusado, o trabalho fica guardado, e aparece na tela de atenção', async () => {
    /*
     * O CRITÉRIO DE ACEITE DO EPIC-014, ENCENADO.
     *
     * O técnico executa no subsolo. A coordenação cancela a OS às 14h. Às 16h,
     * no estacionamento, o aparelho reencontra sinal e manda "concluir" com o
     * diagnóstico e a resolução que ele escreveu.
     */
    const os = await novaOS('Cancelada no meio');

    await http
      .post(`/v1/work-orders/${os}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'cancelled', cancellation_reason: 'Equipamento foi devolvido ao fabricante.' })
      .expect(201);

    const op = newId();
    const trabalho = {
      to: 'completed',
      resolution: 'Trocada a válvula de exalação; teste de estanqueidade aprovado às 15h40.',
    };

    const r = await http
      .post(`/v1/work-orders/${os}/transitions`)
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send(trabalho);

    // RECUSADO — e não aceito "para não perder".
    expect(r.status).toBe(409);

    // E o trabalho está guardado, INTEIRO.
    const atencao = await http.get('/v1/field/attention').set(auth(EMAIL_TEC)).expect(200);
    const item = atencao.body.items.find(
      (i: { client_operation_id: string }) => i.client_operation_id === op
    );

    expect(item).toBeDefined();
    expect(item.route).toBe('POST /work-orders/:id/transitions');
    // A resolução que ele digitou, palavra por palavra: é dela que ele vai
    // recuperar o trabalho, e um resumo obrigaria a lembrar o que escreveu.
    expect(item.request_body).toEqual(trabalho);
    expect(item.conflict_message).toBeTruthy();
  });

  it('reenviar o mesmo comando volta a ser recusa, e não vira sucesso com o tempo', async () => {
    const os = await novaOS('Recusa que persiste');
    await http
      .post(`/v1/work-orders/${os}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'cancelled', cancellation_reason: 'Contrato encerrado.' })
      .expect(201);

    const op = newId();
    const corpo = { to: 'completed', resolution: 'Concluída em campo.' };

    const um = await http
      .post(`/v1/work-orders/${os}/transitions`)
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send(corpo);
    expect(um.status).toBe(409);

    /*
     * O REENVIO É O PONTO. Um aparelho offline reenvia por horas, e se em
     * alguma dessas vezes a resposta virasse 2xx — porque "essa operação já foi
     * processada" — ele apagaria da fila um trabalho que o servidor recusou.
     */
    const dois = await http
      .post(`/v1/work-orders/${os}/transitions`)
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send(corpo);
    expect(dois.status).toBe(409);
    expect(dois.body.details.replayed).toBe(true);

    const linhas = await t.raw(`SELECT status_id FROM aurora.work_orders WHERE id = $1`, [os]);
    expect(linhas).toHaveLength(1);
  });

  it('a tela de atenção é de quem trabalhou: a coordenação não vê o conflito do técnico', async () => {
    const daCoordenacao = await http.get('/v1/field/attention').set(auth(EMAIL_COORD)).expect(200);
    const doTecnico = await http.get('/v1/field/attention').set(auth(EMAIL_TEC)).expect(200);

    expect(doTecnico.body.items.length).toBeGreaterThan(0);
    expect(daCoordenacao.body.items).toEqual([]);
  });

  it('tratar o conflito o tira da lista, e a segunda vez diz que não havia o que tratar', async () => {
    const os = await novaOS('Para tratar');
    await http
      .post(`/v1/work-orders/${os}/transitions`)
      .set(auth(EMAIL_COORD))
      .send({ to: 'cancelled', cancellation_reason: 'Duplicada.' })
      .expect(201);

    const op = newId();
    await http
      .post(`/v1/work-orders/${os}/transitions`)
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send({ to: 'completed', resolution: 'x' })
      .expect(409);

    const nova = newId();
    await http
      .post(`/v1/field/attention/${op}/resolve`)
      .set(auth(EMAIL_TEC))
      .send({ superseded_by: nova })
      .expect(201);

    const depois = await http.get('/v1/field/attention').set(auth(EMAIL_TEC)).expect(200);
    expect(
      depois.body.items.map((i: { client_operation_id: string }) => i.client_operation_id)
    ).not.toContain(op);

    // 404 e não 200: tratar o que já foi tratado não é uma operação bem
    // sucedida, e responder 200 esconderia uma tela desatualizada do técnico.
    await http.post(`/v1/field/attention/${op}/resolve`).set(auth(EMAIL_TEC)).send({}).expect(404);

    // O rastro fica: a pergunta "o que aconteceu com aquele trabalho?" tem
    // resposta seis meses depois.
    const linhas = await t.raw(
      `SELECT superseded_by::text AS nova FROM aurora.client_operations WHERE client_operation_id = $1`,
      [op]
    );
    expect(linhas[0]!.nova).toBe(nova);
  });
});

describe('CAMPO-004 · o identificador é de quem o criou', () => {
  it('a mesma operação enviada por outra pessoa é recusada', async () => {
    /*
     * O identificador nasce no aparelho, e um aparelho pode ser de qualquer
     * um. Devolver a resposta de A para B entregaria o resultado do trabalho de
     * outra pessoa — e, do lado de B, confirmaria algo que ele não fez.
     */
    const os = await novaOS('Dono da operação');
    const op = newId();

    await http
      .post(`/v1/work-orders/${os}/timer/start`)
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send({})
      .expect(201);

    const outro = await http
      .post(`/v1/work-orders/${os}/timer/start`)
      .set({ ...auth(EMAIL_COORD), ...operacao(op) })
      .send({});

    expect(outro.status).toBe(409);
    expect(outro.body.details.reason).toBe('membership_mismatch');
  });

  it('e o técnico continua com UM cronômetro só depois da tentativa alheia', async () => {
    const abertos = await t.raw(
      `SELECT count(*)::int AS total FROM aurora.time_entries
        WHERE membership_id = $1 AND ended_at IS NULL`,
      [TEC_MEM]
    );
    expect(abertos[0]!.total).toBe(1);
  });
});

describe('CAMPO-005 · a demanda encontrada em campo', () => {
  it('a retentativa devolve a MESMA solicitação, com o mesmo número', async () => {
    /*
     * O TÉCNICO ABRE SOLICITAÇÃO, E NÃO ORDEM DE SERVIÇO.
     *
     * O papel de fábrica `technician` tem `service_request.create` e não
     * `work_order.create`, e a separação é do produto: quem encontra o problema
     * registra a demanda; quem decide que ela vira trabalho é a triagem. Testar
     * a criação de OS aqui exigiria conceder ao técnico uma permissão que ele
     * não tem — e o teste passaria provando um sistema que não é este.
     *
     * Duas solicitações para o mesmo problema viram duas triagens, e alguém
     * precisa descobrir qual fechar. A numeração nunca é gerada no cliente
     * (§20), então a única defesa possível está no servidor.
     */
    const op = newId();
    const corpo = {
      customer_id: cliente,
      summary: 'Bomba de infusão apitando no leito 3',
      location_id: local,
      asset_id: ativo,
      // `qr_code`: o técnico leu a etiqueta do equipamento. `mobile` existe,
      // mas é vocabulário de ORIGEM DE OS (§10), e não de origem de
      // solicitação — são duas listas, e trocá-las é o tipo de invenção que
      // faz um indicador medir ficção.
      source: 'qr_code',
      requester_name: 'Técnico de Campo',
      requester_phone: '+55 11 90000-0000',
    };

    const um = await http
      .post('/v1/service-requests')
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send(corpo);
    expect(um.status).toBe(201);

    const dois = await http
      .post('/v1/service-requests')
      .set({ ...auth(EMAIL_TEC), ...operacao(op) })
      .send(corpo);
    expect(dois.status).toBe(201);

    expect(dois.body.id).toBe(um.body.id);
    expect(dois.body.number).toBe(um.body.number);

    const linhas = await t.raw(
      `SELECT count(*)::int AS total FROM aurora.service_requests WHERE summary = $1`,
      [corpo.summary]
    );
    expect(linhas[0]!.total).toBe(1);
  });
});

describe('CAMPO-006 · a tela de atenção satisfaz o contrato', () => {
  it('campo a campo, sem sobrar nem faltar', async () => {
    /*
     * O CONTRATO É O QUE O APARELHO ACREDITA.
     *
     * Em campo, a divergência entre o que o servidor manda e o que o cliente
     * espera não aparece como erro na tela: aparece como um campo vazio no
     * meio de um conflito que a pessoa precisa entender para decidir. Com
     * `strict()`, um campo a mais no controller falha aqui, e não lá.
     *
     * Foi assim que a divergência de nomenclatura deste próprio contrato
     * apareceu: ele nasceu em `camelCase` enquanto o resto da API fala
     * `snake_case`, e nenhuma das duas partes tinha como saber da outra.
     */
    const { FieldConflict } = await import('@aurora/contracts');
    const r = await http.get('/v1/field/attention').set(auth(EMAIL_TEC)).expect(200);

    expect(r.body.items.length).toBeGreaterThan(0);
    for (const item of r.body.items) {
      const conferido = FieldConflict.strict().safeParse(item);
      if (!conferido.success) {
        throw new Error(
          'o conflito divergiu do contrato:\n' +
            conferido.error.issues.map((i) => `  · ${i.path.join('.') || '(raiz)'}: ${i.message}`).join('\n')
        );
      }
    }
  });
});
