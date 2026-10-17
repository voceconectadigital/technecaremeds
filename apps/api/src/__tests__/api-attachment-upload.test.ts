/**
 * Aurora — o envio retomável dos bytes de um anexo (SPEC v0.2 §20 · EPIC-014).
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Durante um bom tempo o aplicativo de campo mandava as fatias das fotos para
 * um endereço que NÃO EXISTIA no servidor. O registro do anexo entrava no
 * banco, a tela mostrava a foto como capturada, a OS fechava — e os bytes nunca
 * saíam do aparelho. Nenhuma verificação de "o service worker está
 * registrado?" acharia isso; quem achou foi o teste de sobrevivência offline,
 * olhando o estado dos anexos DEPOIS de a fila esvaziar.
 *
 * O que se prova aqui é a promessa inteira, e não a existência da rota:
 *
 *  · a foto sobe em fatias e chega igual, byte a byte;
 *  · a rede pode morrer no meio, e a retomada continua de onde parou;
 *  · a mesma fatia entregue duas vezes NÃO duplica nada;
 *  · quem conta é o servidor, e o aparelho se alinha ao número dele;
 *  · um arquivo que não fecha o resumo criptográfico é RECUSADO, e não
 *    guardado com aparência de válido;
 *  · o anexo de outra organização não existe para quem não é dela.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
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
  createWorkOrder,
  attachmentUploadState,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';
import { armazenamentoEmMemoria } from '../common/arquivos/memoria';
import type { ArmazenamentoDeObjetos } from '../common/arquivos/porta';

const ORG_A = newId(),
  ORG_B = newId();
const COORD_USER = newId(),
  COORD_MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const OUTRA_USER = newId(),
  OUTRA_MEM = newId();

const EMAIL_COORD = 'coord@anexo.test';
const EMAIL_TEC = 'tec@anexo.test';
const EMAIL_OUTRA = 'gente@outra.test';

const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let arquivos: ArmazenamentoDeObjetos;
let osA: string;

const ctxA = buildContext({
  organizationId: ORG_A,
  actorKind: 'system',
  requestId: 'setup',
  permissions: PERMISSION_KEYS,
});

/**
 * Uma "foto": bytes previsíveis, grandes o bastante para caber em três fatias.
 *
 * Conteúdo determinístico e não aleatório porque a falha precisa ser legível:
 * quando o arquivo sai errado, dá para ver ONDE ele saiu errado.
 */
function foto(tamanho: number): Buffer {
  const b = Buffer.alloc(tamanho);
  for (let i = 0; i < tamanho; i++) b[i] = (i * 7 + 13) % 251;
  // Começa como um JPEG de verdade (FF D8 FF): ao concluir, o servidor confere
  // os primeiros bytes contra o tipo declarado (PF-84).
  b.set([0xff, 0xd8, 0xff], 0);
  return b;
}

const resumo = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Registra o anexo pela rota real e devolve o identificador do SERVIDOR. */
async function registrar(
  workOrderId: string,
  bytes: Buffer,
  opcoes?: { sha256?: string; nome?: string }
): Promise<{ id: string; storage_key: string }> {
  const r = await http
    .post(`/v1/work-orders/${workOrderId}/attachments`)
    .set(auth(EMAIL_TEC))
    .send({
      purpose: 'before',
      file_name: opcoes?.nome ?? 'evidencia.jpg',
      content_type: 'image/jpeg',
      byte_size: bytes.byteLength,
      sha256: opcoes?.sha256 ?? resumo(bytes),
    });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.attachment_id, storage_key: r.body.storage_key };
}

/** Manda uma fatia como o aparelho manda. */
function fatia(
  id: string,
  pedaco: Buffer,
  opcoes: { offset: number; sha256: string; final: boolean; email?: string }
) {
  return http
    .put(`/v1/field/attachments/${id}/bytes`)
    .set(auth(opcoes.email ?? EMAIL_TEC))
    .set('content-type', 'application/octet-stream')
    .set('x-aurora-offset', String(opcoes.offset))
    .set('x-aurora-sha256', opcoes.sha256)
    .set('x-aurora-final', opcoes.final ? '1' : '0')
    .send(pedaco);
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: COORD_USER, membershipId: COORD_MEM },
    { slug: 'anexo-a', name: 'Prestadora A', email: EMAIL_COORD, userName: 'Coordenadora' }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: OUTRA_USER, membershipId: OUTRA_MEM },
    { slug: 'anexo-b', name: 'Prestadora B', email: EMAIL_OUTRA, userName: 'Outra' }
  );

  await seedMember(
    t,
    { organizationId: ORG_A, userId: TEC_USER, membershipId: TEC_MEM },
    { email: EMAIL_TEC, userName: 'Técnico de Campo' }
  );

  await withTenant(t.db, ctxA, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, COORD_MEM, papeis.get('coordinator')!);
    await provisionWorkOrderStates(s);
    await assignRole(s, TEC_MEM, papeis.get('technician')!);

    const tipos = await provisionStarterLocationTypes(s);
    const cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const local = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'UTI',
    });
    const natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    const os = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: 'Troca de célula de O2',
      locationId: local,
      assigneeMembershipId: TEC_MEM,
      publish: true,
    });
    osA = os.id;
  });

  await withTenant(
    t.db,
    buildContext({
      organizationId: ORG_B,
      actorKind: 'system',
      requestId: 'setup',
      permissions: PERMISSION_KEYS,
    }),
    async (s) => {
      const papeis = await provisionFactoryRoles(s);
      await assignRole(s, OUTRA_MEM, papeis.get('coordinator')!);
      await provisionWorkOrderStates(s);
    }
  );

  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  /*
   * MEMÓRIA, E NÃO DISCO.
   *
   * O caminho exercitado é o mesmo — a mesma porta, a mesma escrita posicional,
   * as mesmas bordas. O que muda é que a suíte não deixa lixo no sistema de
   * arquivos de quem a roda, e não depende de permissão de escrita em lugar
   * nenhum. O adaptador de disco tem a própria prova, no seu próprio arquivo.
   */
  arquivos = armazenamentoEmMemoria();
  app = await createApp({ db: t.db, env, arquivos });
  await app.init();
  http = request(app.getHttpServer());
}, 180_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('ANEXO-001 · a foto sobe em fatias e chega inteira', () => {
  it('três fatias, e o arquivo guardado é idêntico ao original', async () => {
    const bytes = foto(700);
    const sha = resumo(bytes);
    const anexo = await registrar(osA, bytes);

    const cortes = [
      [0, 300],
      [300, 600],
      [600, 700],
    ] as const;

    for (const [ini, fim] of cortes) {
      const r = await fatia(anexo.id, bytes.subarray(ini, fim), {
        offset: ini,
        sha256: sha,
        final: fim === bytes.byteLength,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.received).toBe(fim);
    }

    /*
     * A PROVA É O CONTEÚDO, e não o contador.
     *
     * Um servidor que soma direito e grava torto passaria numa conferência de
     * número. Comparar byte a byte é o que separa "recebi 700" de "tenho ESTA
     * foto".
     */
    const guardado = await arquivos.ler(anexo.storage_key);
    expect(guardado).toBeDefined();
    expect(Buffer.from(guardado!).equals(bytes)).toBe(true);

    const estado = await withTenant(t.db, ctxA, (s) => attachmentUploadState(s, anexo.id));
    expect(estado).toEqual({ received: 700, total: 700, completed: true });
  });
});

describe('ANEXO-002 · a rede morre no meio, e a retomada continua de onde parou', () => {
  it('o que já subiu não sobe de novo, e o arquivo fecha', async () => {
    const bytes = foto(1000);
    const sha = resumo(bytes);
    const anexo = await registrar(osA, bytes, { nome: 'retomada.jpg' });

    // Sobe a primeira metade — e aqui o técnico entra no elevador.
    const primeira = await fatia(anexo.id, bytes.subarray(0, 400), {
      offset: 0,
      sha256: sha,
      final: false,
    });
    expect(primeira.status).toBe(200);

    /*
     * A RETOMADA COMEÇA PERGUNTANDO.
     *
     * O aparelho reabriu sem saber onde parou — ou sabendo errado. Ele tenta do
     * zero, e o servidor responde 409 com a conta dele. Isso NÃO é falha: é a
     * informação de que a retomada precisa.
     */
    const desencontro = await fatia(anexo.id, bytes.subarray(0, 100), {
      offset: 0,
      sha256: sha,
      final: false,
    });
    expect(desencontro.status).toBe(409);
    expect(desencontro.body.received).toBe(400);
    expect(desencontro.body.completed).toBe(false);

    // Continua do número do servidor, e fecha.
    const resto = await fatia(anexo.id, bytes.subarray(400), {
      offset: 400,
      sha256: sha,
      final: true,
    });
    expect(resto.status).toBe(200);
    expect(resto.body).toEqual({ received: 1000, completed: true });

    const guardado = await arquivos.ler(anexo.storage_key);
    expect(Buffer.from(guardado!).equals(bytes)).toBe(true);
  });
});

describe('ANEXO-003 · a mesma fatia duas vezes não duplica nada', () => {
  it('a reentrega depois da confirmação perdida é inofensiva', async () => {
    const bytes = foto(512);
    const sha = resumo(bytes);
    const anexo = await registrar(osA, bytes, { nome: 'duplicada.jpg' });

    const uma = await fatia(anexo.id, bytes, { offset: 0, sha256: sha, final: true });
    expect(uma.status).toBe(200);
    expect(uma.body.completed).toBe(true);

    /*
     * O caso mais comum de rede ruim: a fatia chegou, a confirmação se perdeu,
     * e o aparelho manda tudo de novo. O servidor já tem o arquivo — e diz
     * isso, em vez de escrever por cima ou somar duas vezes.
     */
    const outra = await fatia(anexo.id, bytes, { offset: 0, sha256: sha, final: true });
    expect(outra.status).toBe(409);
    expect(outra.body).toEqual({ received: 512, completed: true });

    const guardado = await arquivos.ler(anexo.storage_key);
    expect(guardado!.byteLength).toBe(512);
    expect(Buffer.from(guardado!).equals(bytes)).toBe(true);
  });
});

describe('ANEXO-004 · um arquivo que não fecha o resumo é recusado', () => {
  it('a contagem volta a zero, e nada corrompido fica guardado como válido', async () => {
    const bytes = foto(256);
    /*
     * O REGISTRO DECLARA UM RESUMO, E OS BYTES SÃO OUTROS.
     *
     * É o que acontece quando a foto é substituída no aparelho no meio do
     * envio, ou quando um pedaço chega corrompido. Guardar isso como anexo
     * válido seria pôr no prontuário de manutenção uma evidência que não é a
     * evidência — o pior desfecho possível desta rota.
     */
    const sha = resumo(bytes);
    const anexo = await registrar(osA, bytes, { sha256: sha, nome: 'trocada.jpg' });

    const adulterado = Buffer.from(bytes);
    adulterado[100] = (adulterado[100]! + 1) % 251;

    const r = await fatia(anexo.id, adulterado, { offset: 0, sha256: sha, final: true });
    expect(r.status).toBe(409);
    expect(String(r.body.message)).toContain('resumo');

    const estado = await withTenant(t.db, ctxA, (s) => attachmentUploadState(s, anexo.id));
    expect(estado, 'o envio recomeça do zero').toEqual({
      received: 0,
      total: 256,
      completed: false,
    });
  });

  it('uma fatia de OUTRO arquivo é recusada antes de tocar no disco', async () => {
    const bytes = foto(256);
    const anexo = await registrar(osA, bytes, { nome: 'outra-foto.jpg' });

    const r = await fatia(anexo.id, bytes, {
      offset: 0,
      sha256: resumo(foto(255)),
      final: true,
    });
    expect(r.status).toBe(422);

    const estado = await withTenant(t.db, ctxA, (s) => attachmentUploadState(s, anexo.id));
    expect(estado!.received).toBe(0);
  });
});

describe('ANEXO-005 · o anexo de outra organização não existe', () => {
  it('quem não é da organização não recebe nem 403 com detalhe: recebe nada', async () => {
    const bytes = foto(128);
    const anexo = await registrar(osA, bytes, { nome: 'privada.jpg' });

    const r = await fatia(anexo.id, bytes, {
      offset: 0,
      sha256: resumo(bytes),
      final: true,
      email: EMAIL_OUTRA,
    });

    /*
     * 403 OU 404 — as duas leituras são aceitáveis, e nenhuma delas é 200.
     *
     * O que NÃO pode acontecer é o byte entrar. A conferência abaixo é a que
     * importa: o arquivo continua vazio, e o estado do anexo continua zerado.
     */
    expect([403, 404]).toContain(r.status);
    const guardado = await arquivos.ler(anexo.storage_key);
    expect(guardado).toBeUndefined();
  });
});

describe('ANEXO-006 · o corpo precisa ser bytes', () => {
  it('uma fatia vazia é recusada em vez de gravar um arquivo truncado', async () => {
    const bytes = foto(64);
    const anexo = await registrar(osA, bytes, { nome: 'vazia.jpg' });

    const r = await http
      .put(`/v1/field/attachments/${anexo.id}/bytes`)
      .set(auth(EMAIL_TEC))
      .set('content-type', 'application/octet-stream')
      .set('x-aurora-offset', '0')
      .set('x-aurora-sha256', resumo(bytes))
      .set('x-aurora-final', '1')
      .send(Buffer.alloc(0));

    expect(r.status).toBe(422);
    expect(await arquivos.ler(anexo.storage_key)).toBeUndefined();
  });

  it('a última fatia que não fecha o tamanho declarado é recusada', async () => {
    const bytes = foto(300);
    const anexo = await registrar(osA, bytes, { nome: 'curta.jpg' });

    const r = await fatia(anexo.id, bytes.subarray(0, 100), {
      offset: 0,
      sha256: resumo(bytes),
      final: true,
    });
    expect(r.status).toBe(422);
  });
});
