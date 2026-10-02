/**
 * Aurora — importação rastreável (0058 · gap V2 P1.8 · critério 8 do PLAT §14).
 *
 * O que a migração do sistema legado precisa provar:
 *   · o arquivo original fica guardado, com resumo;
 *   · a AMOSTRA valida sem gravar NADA no destino;
 *   · o lote OFICIAL grava, e cada ativo carrega o identificador de origem;
 *   · cada linha tem desfecho e erro com campo, e o relatório fica no lote;
 *   · reimportar o mesmo registro de origem é recusado na linha, não duplicado;
 *   · lote processado não se reprocessa, linha crua não se reescreve;
 *   · outra organização não vê nada.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import { ImportBatchRow } from '@aurora/contracts';
import { createTestDatabase, type TestDatabase } from '@aurora/db/testing/harness';
import { withTenant } from '@aurora/db';
import { auth, criarOrganizacao, criarPessoa, ctxSistema, subirApi, type OrgDeTeste } from './apoio/cenario';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let A: OrgDeTeste;
let B: OrgDeTeste;
let tecnico: { email: string };

const CSV = Buffer.from(
  'id;nome;categoria;fabricante;modelo;serie\n1042;Ventilador UTI 1;Ventilador Pulmonar;Dräger;Evita;S1\n'
);
const resumo = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const LINHAS = [
  {
    line: 2,
    raw: {
      external_id: '1042',
      name: 'Ventilador UTI 1',
      category: 'Ventilador Pulmonar',
      manufacturer: 'Dräger',
      model: 'Evita V300',
      serial_number: 'S-1',
    },
  },
  {
    line: 3,
    raw: {
      external_id: '1043',
      name: 'Ventilador UTI 2',
      category: 'Ventilador Pulmonar',
      manufacturer: 'Dräger',
      model: 'Evita V300',
      serial_number: 'S-2',
    },
  },
  {
    line: 4,
    raw: {
      external_id: '1044',
      name: 'Ventilador UTI 3',
      category: 'Ventilador Pulmonar',
      serial_number: 'S-3',
      coluna_legada: 'xyz',
    },
  },
  { line: 5, raw: { external_id: '1045', category: 'Ventilador Pulmonar' } },
  { line: 6, raw: { external_id: '1046', name: 'Bomba', category: 'Categoria que não existe' } },
];

async function contarAtivosEFabricantes() {
  return withTenant(t.db, ctxSistema(A.org), async (s) => {
    const [a] = await s.query<{ c: number }>(`SELECT count(*)::int AS c FROM aurora.assets`);
    const [m] = await s.query<{ c: number }>(`SELECT count(*)::int AS c FROM aurora.manufacturers`);
    return { ativos: a!.c, fabricantes: m!.c };
  });
}

beforeAll(async () => {
  t = await createTestDatabase();
  A = await criarOrganizacao(t, 'imp-a');
  B = await criarOrganizacao(t, 'imp-b');
  tecnico = await criarPessoa(t, A, 'tecnico', 'technician');
  ({ app, http } = await subirApi(t.db));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

let amostra = '';
let oficial = '';

describe('amostra', () => {
  it('abre o lote com o arquivo original, que exige SHA-256', async () => {
    const sem = await http
      .post('/v1/imports')
      .set(auth(A.email))
      .send({
        kind: 'assets',
        mode: 'sample',
        external_source: 'arkmeds',
        customer_id: A.cliente,
        file: { file_name: 'export.csv', content_type: 'text/csv', byte_size: CSV.byteLength },
      });
    expect(sem.status).toBe(422);

    const r = await http
      .post('/v1/imports')
      .set(auth(A.email))
      .send({
        kind: 'assets',
        mode: 'sample',
        external_source: 'Arkmeds',
        customer_id: A.cliente,
        description: 'amostra do parque da UTI',
        file: {
          file_name: 'export.csv',
          content_type: 'text/csv',
          byte_size: CSV.byteLength,
          sha256: resumo(CSV),
        },
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    amostra = r.body.id;
    expect(r.body.storage_key).toMatch(/\/import-batches\//);

    const bytes = await http
      .put(`/v1/field/attachments/${r.body.attachment_id}/bytes`)
      .set(auth(A.email))
      .set('content-type', 'application/octet-stream')
      .set('x-aurora-offset', '0')
      .set('x-aurora-sha256', resumo(CSV))
      .set('x-aurora-final', '1')
      .send(CSV);
    expect(bytes.body.completed).toBe(true);
  });

  it('carrega as linhas cruas; linha repetida é recusada', async () => {
    const r = await http.post(`/v1/imports/${amostra}/rows`).set(auth(A.email)).send({ rows: LINHAS });
    expect(r.body).toEqual({ staged: 5, total: 5 });
    const rep = await http
      .post(`/v1/imports/${amostra}/rows`)
      .set(auth(A.email))
      .send({ rows: [LINHAS[0]] });
    expect(rep.status).toBe(409);
  });

  it('processar a amostra valida, relata — e NÃO grava nada no destino', async () => {
    const antes = await contarAtivosEFabricantes();
    const r = await http.post(`/v1/imports/${amostra}/run`).set(auth(A.email));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      mode: 'sample',
      rows: 5,
      succeeded: 3,
      failed: 2,
      created_manufacturers: 1,
    });
    expect(await contarAtivosEFabricantes()).toEqual(antes);

    const d = await http.get(`/v1/imports/${amostra}`).set(auth(A.email));
    const lote = ImportBatchRow.parse(d.body);
    expect(lote).toMatchObject({
      status: 'completed',
      external_source: 'arkmeds',
      succeeded_count: 3,
      failed_count: 2,
    });
    expect(lote.report).toMatchObject({ mode: 'sample', failed: 2 });
    expect(lote.original_file).toMatchObject({
      file_name: 'export.csv',
      sha256: resumo(CSV),
      upload_completed: true,
    });
  });

  it('o relatório de inconsistências diz a linha, o campo e o motivo', async () => {
    const r = await http.get(`/v1/imports/${amostra}/rows?status=failed`).set(auth(A.email));
    expect(r.body.items.map((i: { line: number; error_field: string }) => [i.line, i.error_field])).toEqual([
      [5, 'name'],
      [6, 'category'],
    ]);
    const validadas = await http.get(`/v1/imports/${amostra}/rows?status=validated`).set(auth(A.email));
    expect(validadas.body.items).toHaveLength(3);
    // a linha crua fica como chegou, inclusive a coluna que o importador não usa
    expect(validadas.body.items[2].raw.coluna_legada).toBe('xyz');
  });

  it('lote processado não se reprocessa nem recebe linhas', async () => {
    expect((await http.post(`/v1/imports/${amostra}/run`).set(auth(A.email))).status).toBe(409);
    expect(
      (
        await http
          .post(`/v1/imports/${amostra}/rows`)
          .set(auth(A.email))
          .send({ rows: [{ line: 99, raw: { name: 'x' } }] })
      ).status
    ).toBe(409);
  });
});

describe('oficial', () => {
  it('grava os ativos, com origem e identificador externo', async () => {
    const r = await http
      .post('/v1/imports')
      .set(auth(A.email))
      .send({ kind: 'assets', mode: 'official', external_source: 'arkmeds', customer_id: A.cliente });
    oficial = r.body.id;
    await http.post(`/v1/imports/${oficial}/rows`).set(auth(A.email)).send({ rows: LINHAS });
    const run = await http.post(`/v1/imports/${oficial}/run`).set(auth(A.email));
    expect(run.body).toMatchObject({ mode: 'official', succeeded: 3, failed: 2 });

    const importadas = await http.get(`/v1/imports/${oficial}/rows?status=imported`).set(auth(A.email));
    expect(importadas.body.items).toHaveLength(3);
    const ids = importadas.body.items.map((i: { created_entity_id: string }) => i.created_entity_id);
    const ativos = await t.raw(
      `SELECT external_source, external_id FROM aurora.assets WHERE id = ANY($1::uuid[]) ORDER BY external_id`,
      [ids]
    );
    expect(ativos).toEqual([
      { external_source: 'arkmeds', external_id: '1042' },
      { external_source: 'arkmeds', external_id: '1043' },
      { external_source: 'arkmeds', external_id: '1044' },
    ]);
  });

  it('reimportar o mesmo registro de origem falha NA LINHA, sem duplicar o ativo', async () => {
    const r = await http
      .post('/v1/imports')
      .set(auth(A.email))
      .send({ kind: 'assets', mode: 'official', external_source: 'arkmeds', customer_id: A.cliente });
    await http
      .post(`/v1/imports/${r.body.id}/rows`)
      .set(auth(A.email))
      .send({ rows: [LINHAS[0]] });
    const run = await http.post(`/v1/imports/${r.body.id}/run`).set(auth(A.email));
    expect(run.body).toMatchObject({ succeeded: 0, failed: 1 });
    const [c] = await t.raw(
      `SELECT count(*)::int AS c FROM aurora.assets WHERE organization_id = $1 AND external_id = '1042'`,
      [A.org]
    );
    expect(c!.c).toBe(1);
  });
});

describe('o arquivo histórico não se reescreve', () => {
  it('a linha crua e o lote concluído não mudam', async () => {
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        s.query(`UPDATE aurora.import_rows SET raw = '{"name":"forjado"}'::jsonb WHERE batch_id = $1`, [
          oficial,
        ])
      )
    ).rejects.toThrow(/não se reescreve/);
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        s.query(`UPDATE aurora.import_batches SET description = 'outra' WHERE id = $1`, [oficial])
      )
    ).rejects.toThrow(/concluído não muda/);
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        s.query(`DELETE FROM aurora.import_rows WHERE batch_id = $1`, [oficial])
      )
    ).rejects.toThrow(/permission denied|permissão negada/i);
  });
});

describe('permissão e isolamento', () => {
  it('quem não importa não vê nem abre lote (403 nomeando asset.import)', async () => {
    const r = await http.get('/v1/imports').set(auth(tecnico.email));
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('asset.import');
  });

  it('outra organização: lista vazia, 404 no lote, nas linhas e no processamento', async () => {
    expect((await http.get('/v1/imports').set(auth(B.email))).body.items).toEqual([]);
    expect((await http.get(`/v1/imports/${oficial}`).set(auth(B.email))).status).toBe(404);
    expect((await http.get(`/v1/imports/${oficial}/rows`).set(auth(B.email))).status).toBe(404);
    expect((await http.post(`/v1/imports/${oficial}/run`).set(auth(B.email))).status).toBe(404);
  });

  it('lote para cliente de OUTRA organização é recusado', async () => {
    const r = await http
      .post('/v1/imports')
      .set(auth(A.email))
      .send({ kind: 'assets', mode: 'sample', external_source: 'arkmeds', customer_id: B.cliente });
    expect(r.status).toBe(404);
  });
});
