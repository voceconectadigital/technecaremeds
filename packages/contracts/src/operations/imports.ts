/**
 * Aurora — importação rastreável (gap V2 P1.8 · PLAT §12 · critério 8).
 *
 * Lote (origem, amostra/oficial, arquivo original com SHA-256, relatório) e
 * linha (crua, identificador externo, desfecho, erro, registro criado).
 *
 * Todas as rotas pedem `asset.import`, inclusive as de leitura: a linha crua de
 * uma planilha de patrimônio carrega valor de compra, e quem não importa não
 * precisa ver o arquivo de quem importou.
 *
 * O leitor do formato do Arkmeds não existe (BLOQUEADO — CLIENTE): as linhas
 * chegam já no formato de importação de ativos.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const ImportBatchRow = z.object({
  id: Uuid,
  kind: z.enum(['assets']),
  mode: z.enum(['sample', 'official']),
  external_source: z.string(),
  customer_id: Uuid,
  customer_name: z.string(),
  description: z.string(),
  status: z.enum(['draft', 'completed']),
  row_count: z.number().int(),
  succeeded_count: z.number().int(),
  failed_count: z.number().int(),
  /** O relatório persistido: contagens, fabricantes e modelos criados, duração. */
  report: z.record(z.string(), z.unknown()),
  started_at: Timestamp.nullable(),
  finished_at: Timestamp.nullable(),
  created_at: Timestamp,
  original_file: z
    .object({ id: Uuid, file_name: z.string(), sha256: z.string().nullable(), upload_completed: z.boolean() })
    .nullable(),
});
export type ImportBatchRow = z.infer<typeof ImportBatchRow>;

export const importsList = defineOperation({
  operationId: 'imports.list',
  method: 'GET',
  path: '/imports',
  summary: 'Lotes de importação, do mais recente',
  permissions: ['asset.import'],
  response: z.object({ items: z.array(ImportBatchRow) }),
});

export const importsCreate = defineOperation({
  operationId: 'imports.create',
  method: 'POST',
  path: '/imports',
  summary: 'Abre um lote de importação (amostra ou oficial), com o arquivo original',
  description:
    'O arquivo original entra como anexo `import_source`, com SHA-256 obrigatório; os bytes seguem ' +
    'pelo envio retomável (`PUT /field/attachments/{id}/bytes`).',
  permissions: ['asset.import'],
  body: z
    .object({
      kind: z.enum(['assets']),
      mode: z.enum(['sample', 'official']),
      external_source: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z][a-z0-9_.-]{1,40}$/),
      customer_id: Uuid,
      description: z.string().max(2000).optional(),
      file: z
        .object({
          file_name: z.string().min(1).max(400),
          content_type: z.string().min(1).max(200),
          byte_size: z.number().int().positive(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict()
        .optional(),
    })
    .strict(),
  response: z.object({ id: Uuid, attachment_id: Uuid.nullable(), storage_key: z.string().nullable() }),
  errors: ['not_found'],
});

export const importsStageRows = defineOperation({
  operationId: 'imports.stageRows',
  method: 'POST',
  path: '/imports/:id/rows',
  summary: 'Carrega linhas cruas no lote (até 5000 por envio)',
  permissions: ['asset.import'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      rows: z
        .array(z.object({ line: z.number().int().min(1), raw: z.record(z.string(), z.unknown()) }).strict())
        .min(1)
        .max(5000),
    })
    .strict(),
  response: z.object({ staged: z.number().int(), total: z.number().int() }),
  errors: ['not_found', 'conflict'],
});

export const importsRun = defineOperation({
  operationId: 'imports.run',
  method: 'POST',
  path: '/imports/:id/run',
  summary: 'Processa o lote, uma vez: amostra valida sem gravar; oficial grava',
  permissions: ['asset.import'],
  params: z.object({ id: Uuid }),
  response: z.object({
    mode: z.enum(['sample', 'official']),
    rows: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    created_manufacturers: z.number().int(),
    created_models: z.number().int(),
    elapsed_ms: z.number().int(),
  }),
  status: 200,
  errors: ['not_found', 'conflict'],
});

export const importsDetail = defineOperation({
  operationId: 'imports.detail',
  method: 'GET',
  path: '/imports/:id',
  summary: 'Um lote e o relatório dele',
  permissions: ['asset.import'],
  params: z.object({ id: Uuid }),
  response: ImportBatchRow,
  errors: ['not_found'],
});

export const importsRows = defineOperation({
  operationId: 'imports.rows',
  method: 'GET',
  path: '/imports/:id/rows',
  summary: 'As linhas do lote, com desfecho e erro — o relatório de inconsistências',
  permissions: ['asset.import'],
  params: z.object({ id: Uuid }),
  query: z.object({ status: z.enum(['pending', 'validated', 'imported', 'failed']).optional() }),
  response: z.object({
    items: z.array(
      z.object({
        line: z.number().int(),
        raw: z.record(z.string(), z.unknown()),
        external_id: z.string().nullable(),
        status: z.string(),
        created_entity_id: Uuid.nullable(),
        error_field: z.string().nullable(),
        error_message: z.string().nullable(),
      })
    ),
  }),
  errors: ['not_found'],
});
