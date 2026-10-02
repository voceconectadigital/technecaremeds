/**
 * Aurora — importação rastreável (0058 · gap V2 P1.8 · PLAT §12 · critério 8).
 *
 * O ciclo de um lote:
 *
 *   1. ABRIR — origem, amostra ou oficial, cliente de destino, e o arquivo
 *      original registrado como anexo (SHA-256 obrigatório);
 *   2. CARREGAR — as linhas, cruas, como chegaram; cada uma com o número da
 *      linha no arquivo e o identificador externo;
 *   3. PROCESSAR — uma vez. Amostra valida sem gravar no destino; oficial
 *      grava. Cada linha recebe desfecho, erro com campo, e o registro criado;
 *      o relatório fica no lote.
 *
 * Errou? Abre outro lote. O lote processado não se reprocessa e não se apaga:
 * ele É o arquivo histórico da migração.
 *
 * O LEITOR DO ARQUIVO DO ARKMEDS NÃO ESTÁ AQUI (BLOQUEADO — CLIENTE): as linhas
 * entram já no formato de importação de ativos (`AssetImportRow`).
 */
import {
  newId,
  normalizeExternalRef,
  NotFoundError,
  ConflictError,
  ValidationError,
  type AssetImportRow,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { importAssets } from './assets';
import { attachFile } from './execution';

export const MAX_ROWS_PER_CALL = 5000;

export interface ImportBatchInput {
  kind: 'assets';
  mode: 'sample' | 'official';
  externalSource: string;
  customerId: string;
  description?: string;
  /** O arquivo original, como recebido do sistema de origem. */
  file?: { fileName: string; contentType: string; byteSize: number; sha256: string } | null;
}

export async function createImportBatch(
  session: TenantSession,
  input: ImportBatchInput
): Promise<{ id: string; attachment: { id: string; storageKey: string } | null }> {
  const ref = normalizeExternalRef(input.externalSource, 'lote');
  const [cliente] = await session.query(`SELECT 1 FROM aurora.customers WHERE id = $1`, [input.customerId]);
  if (!cliente) throw new NotFoundError('Cliente', input.customerId);

  const id = newId();
  await session.query(
    `INSERT INTO aurora.import_batches
       (id, organization_id, kind, mode, external_source, customer_id, description, created_by)
     VALUES ($1, $2, $3::aurora.import_kind, $4::aurora.import_mode, $5, $6, $7, $8)`,
    [
      id,
      session.context.organizationId,
      input.kind,
      input.mode,
      ref!.source,
      input.customerId,
      input.description ?? '',
      session.context.actorId,
    ]
  );

  const attachment = input.file
    ? await attachFile(session, { importBatchId: id, purpose: 'import_source', ...input.file })
    : null;
  return { id, attachment };
}

/** Carrega linhas cruas. Só em lote ainda não processado. */
export async function stageImportRows(
  session: TenantSession,
  batchId: string,
  rows: ReadonlyArray<{ line: number; raw: Record<string, unknown> }>
): Promise<{ staged: number; total: number }> {
  if (rows.length === 0) throw new ValidationError('nenhuma linha enviada', { field: 'rows' });
  if (rows.length > MAX_ROWS_PER_CALL) {
    throw new ValidationError(`no máximo ${MAX_ROWS_PER_CALL} linhas por envio`, { field: 'rows' });
  }
  const [lote] = await session.query<{ status: string; kind: string }>(
    `SELECT status::text AS status, kind::text AS kind FROM aurora.import_batches WHERE id = $1 FOR UPDATE`,
    [batchId]
  );
  if (!lote) throw new NotFoundError('Lote de importação', batchId);
  if (lote.status !== 'draft')
    throw new ConflictError('lote já processado não recebe linhas; abra outro lote');

  const vistas = new Set<number>();
  for (const r of rows) {
    if (!Number.isSafeInteger(r.line) || r.line < 1) {
      throw new ValidationError(`número de linha inválido: ${String(r.line)}`, { field: 'line' });
    }
    if (vistas.has(r.line)) throw new ValidationError(`linha ${r.line} repetida no envio`, { field: 'line' });
    vistas.add(r.line);
    if (!r.raw || typeof r.raw !== 'object' || Array.isArray(r.raw)) {
      throw new ValidationError(`linha ${r.line}: o conteúdo precisa ser um objeto`, { field: 'raw' });
    }
  }

  const [ja] = await session.query<{ line: number }>(
    `SELECT line FROM aurora.import_rows WHERE batch_id = $1 AND line = ANY($2::int[]) LIMIT 1`,
    [batchId, [...vistas]]
  );
  if (ja) throw new ConflictError(`a linha ${ja.line} já foi carregada neste lote`);

  for (const r of rows) {
    const externo = r.raw.external_id;
    await session.query(
      `INSERT INTO aurora.import_rows (id, organization_id, batch_id, line, raw, external_id, target_entity)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        newId(),
        session.context.organizationId,
        batchId,
        r.line,
        JSON.stringify(r.raw),
        externo === undefined || externo === null || externo === '' ? null : String(externo).trim(),
        lote.kind === 'assets' ? 'asset' : lote.kind,
      ]
    );
  }

  const [{ total }] = (await session.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM aurora.import_rows WHERE batch_id = $1`,
    [batchId]
  )) as [{ total: number }];
  await session.query(`UPDATE aurora.import_batches SET row_count = $2 WHERE id = $1`, [batchId, total]);
  return { staged: rows.length, total };
}

const texto = (v: unknown): string | null =>
  v === undefined || v === null || v === '' ? null : typeof v === 'string' ? v : String(v);

/** A linha crua no formato do importador de ativos. Só lê as chaves que ele conhece. */
function comoLinhaDeAtivo(line: number, raw: Record<string, unknown>): AssetImportRow {
  return {
    line,
    name: texto(raw.name) ?? undefined,
    tag: texto(raw.tag),
    serial_number: texto(raw.serial_number),
    asset_number: texto(raw.asset_number),
    category: texto(raw.category) ?? undefined,
    manufacturer: texto(raw.manufacturer),
    model: texto(raw.model),
    location_code: texto(raw.location_code),
    acquired_at: texto(raw.acquired_at),
    purchase_value:
      typeof raw.purchase_value === 'number' ? raw.purchase_value : (texto(raw.purchase_value) ?? null),
    external_id: texto(raw.external_id),
  };
}

export interface ImportRunReport {
  mode: 'sample' | 'official';
  rows: number;
  succeeded: number;
  failed: number;
  created_manufacturers: number;
  created_models: number;
  elapsed_ms: number;
}

/**
 * Processa o lote — uma vez.
 *
 * AMOSTRA: tudo acontece dentro de um savepoint que volta atrás no fim. A
 * linha fica "validada" ou "falhou", e nada entra no destino — nem o ativo,
 * nem o fabricante que a planilha criaria. É o passo 4 do PLAT §12: importar
 * amostra, validar, corrigir, e só então a carga oficial.
 */
export async function runImportBatch(session: TenantSession, batchId: string): Promise<ImportRunReport> {
  const [lote] = await session.query<{
    status: string;
    mode: 'sample' | 'official';
    customer_id: string;
    external_source: string;
  }>(
    `SELECT status::text AS status, mode::text AS mode, customer_id, external_source
       FROM aurora.import_batches WHERE id = $1 FOR UPDATE`,
    [batchId]
  );
  if (!lote) throw new NotFoundError('Lote de importação', batchId);
  if (lote.status !== 'draft') throw new ConflictError('lote já processado; abra outro lote');

  const linhas = await session.query<{ id: string; line: number; raw: unknown }>(
    `SELECT id, line, raw FROM aurora.import_rows WHERE batch_id = $1 AND status = 'pending' ORDER BY line`,
    [batchId]
  );
  if (linhas.length === 0) throw new ConflictError('o lote não tem linhas a processar');

  await session.query(`UPDATE aurora.import_batches SET started_at = now() WHERE id = $1`, [batchId]);

  const entrada = linhas.map((l) =>
    comoLinhaDeAtivo(
      l.line,
      (typeof l.raw === 'string' ? JSON.parse(l.raw) : l.raw) as Record<string, unknown>
    )
  );

  const amostra = lote.mode === 'sample';
  if (amostra) await session.query(`SAVEPOINT imp_amostra`);
  const r = await importAssets(session, entrada, {
    customerId: lote.customer_id,
    externalSource: lote.external_source,
  });
  if (amostra) {
    await session.query(`ROLLBACK TO SAVEPOINT imp_amostra`);
    await session.query(`RELEASE SAVEPOINT imp_amostra`);
  }

  const criadas = new Map(r.created.map((c) => [c.line, c.id]));
  const erros = new Map<number, { field: string | null; message: string }>();
  for (const i of r.issues) {
    const ja = erros.get(i.line);
    erros.set(
      i.line,
      ja
        ? { field: ja.field ?? i.field, message: `${ja.message}; ${i.message}` }
        : { field: i.field, message: i.message }
    );
  }

  let ok = 0;
  let falhas = 0;
  for (const l of linhas) {
    const criada = criadas.get(l.line);
    const erro = erros.get(l.line);
    if (criada && !erro) {
      ok++;
      await session.query(
        `UPDATE aurora.import_rows
            SET status = $2::aurora.import_row_status, created_entity_id = $3, processed_at = now()
          WHERE id = $1`,
        [l.id, amostra ? 'validated' : 'imported', amostra ? null : criada]
      );
    } else {
      falhas++;
      await session.query(
        `UPDATE aurora.import_rows
            SET status = 'failed', error_field = $2, error_message = $3, processed_at = now()
          WHERE id = $1`,
        [l.id, erro?.field ?? null, erro?.message ?? 'linha não processada']
      );
    }
  }

  const relatorio: ImportRunReport = {
    mode: lote.mode,
    rows: linhas.length,
    succeeded: ok,
    failed: falhas,
    created_manufacturers: r.createdManufacturers,
    created_models: r.createdModels,
    elapsed_ms: r.elapsedMs,
  };
  await session.query(
    `UPDATE aurora.import_batches
        SET status = 'completed', succeeded_count = $2, failed_count = $3, report = $4::jsonb, finished_at = now()
      WHERE id = $1`,
    [batchId, ok, falhas, JSON.stringify(relatorio)]
  );
  return relatorio;
}

export interface ImportBatchRow {
  id: string;
  kind: string;
  mode: string;
  external_source: string;
  customer_id: string;
  customer_name: string;
  description: string;
  status: string;
  row_count: number;
  succeeded_count: number;
  failed_count: number;
  report: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  original_file: { id: string; file_name: string; sha256: string | null; upload_completed: boolean } | null;
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

function linhaDoLote(r: Record<string, unknown>): ImportBatchRow {
  return {
    id: r.id as string,
    kind: r.kind as string,
    mode: r.mode as string,
    external_source: r.external_source as string,
    customer_id: r.customer_id as string,
    customer_name: r.customer_name as string,
    description: r.description as string,
    status: r.status as string,
    row_count: Number(r.row_count),
    succeeded_count: Number(r.succeeded_count),
    failed_count: Number(r.failed_count),
    report: (typeof r.report === 'string' ? JSON.parse(r.report) : r.report) as Record<string, unknown>,
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at),
    created_at: iso(r.created_at)!,
    original_file: r.file_id
      ? {
          id: r.file_id as string,
          file_name: r.file_name as string,
          sha256: (r.file_sha256 as string | null) ?? null,
          upload_completed: r.file_completed !== null && r.file_completed !== undefined,
        }
      : null,
  };
}

const SELECAO_LOTE = `SELECT b.id, b.kind::text AS kind, b.mode::text AS mode, b.external_source, b.customer_id,
            c.name AS customer_name, b.description, b.status::text AS status, b.row_count,
            b.succeeded_count, b.failed_count, b.report, b.started_at, b.finished_at, b.created_at,
            f.id AS file_id, f.file_name, f.sha256 AS file_sha256, f.upload_completed_at AS file_completed
       FROM aurora.import_batches b
       JOIN aurora.customers c ON c.id = b.customer_id
       LEFT JOIN LATERAL (
         SELECT id, file_name, sha256, upload_completed_at FROM aurora.attachments
          WHERE import_batch_id = b.id ORDER BY uploaded_at LIMIT 1
       ) f ON true`;

export async function listImportBatches(session: TenantSession): Promise<ImportBatchRow[]> {
  const rows = await session.query<Record<string, unknown>>(
    `${SELECAO_LOTE} ORDER BY b.created_at DESC LIMIT 200`
  );
  return rows.map(linhaDoLote);
}

export async function importBatchDetail(session: TenantSession, id: string): Promise<ImportBatchRow> {
  const [r] = await session.query<Record<string, unknown>>(`${SELECAO_LOTE} WHERE b.id = $1`, [id]);
  if (!r) throw new NotFoundError('Lote de importação', id);
  return linhaDoLote(r);
}

export async function importBatchRows(
  session: TenantSession,
  batchId: string,
  filtro: { status?: string } = {}
): Promise<
  Array<{
    line: number;
    raw: Record<string, unknown>;
    external_id: string | null;
    status: string;
    created_entity_id: string | null;
    error_field: string | null;
    error_message: string | null;
  }>
> {
  await importBatchDetail(session, batchId);
  const rows = await session.query<Record<string, unknown>>(
    `SELECT line, raw, external_id, status::text AS status, created_entity_id, error_field, error_message
       FROM aurora.import_rows
      WHERE batch_id = $1 AND ($2::text IS NULL OR status::text = $2)
      ORDER BY line LIMIT 5000`,
    [batchId, filtro.status ?? null]
  );
  return rows.map((r) => ({
    line: Number(r.line),
    raw: (typeof r.raw === 'string' ? JSON.parse(r.raw) : r.raw) as Record<string, unknown>,
    external_id: (r.external_id as string | null) ?? null,
    status: r.status as string,
    created_entity_id: (r.created_entity_id as string | null) ?? null,
    error_field: (r.error_field as string | null) ?? null,
    error_message: (r.error_message as string | null) ?? null,
  }));
}
