/**
 * Aurora — importação rastreável pela HTTP (gap V2 P1.8 · PLAT §12).
 *
 * Abrir lote → carregar linhas → processar uma vez. O relatório e cada linha
 * ficam guardados; o arquivo original também. Nada aqui lê formato de sistema
 * de origem — o leitor do Arkmeds espera o arquivo real (BLOQUEADO — CLIENTE).
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  createImportBatch,
  stageImportRows,
  runImportBatch,
  listImportBatches,
  importBatchDetail,
  importBatchRows,
  type Database,
} from '@aurora/db';
import { importsCreate, importsStageRows, importsRows } from '@aurora/contracts';
import { RequirePermissions } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

@Controller('imports')
export class ImportsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('asset.import')
  async list(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const items = await withTenant(this.db, req.auroraContext!, (s) => listImportBatches(s));
    return { items };
  }

  @Post()
  @RequirePermissions('asset.import')
  async create(
    @Req() req: AuroraRequest,
    @Body() body: unknown
  ): Promise<{ id: string; attachment_id: string | null; storage_key: string | null }> {
    const b = parseWith(importsCreate.body, body);
    const r = await withTenant(this.db, req.auroraContext!, (s) =>
      createImportBatch(s, {
        kind: b.kind,
        mode: b.mode,
        externalSource: b.external_source,
        customerId: b.customer_id,
        description: b.description,
        file: b.file
          ? {
              fileName: b.file.file_name,
              contentType: b.file.content_type,
              byteSize: b.file.byte_size,
              sha256: b.file.sha256,
            }
          : null,
      })
    );
    return {
      id: r.id,
      attachment_id: r.attachment?.id ?? null,
      storage_key: r.attachment?.storageKey ?? null,
    };
  }

  @Post(':id/rows')
  @RequirePermissions('asset.import')
  async stage(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ staged: number; total: number }> {
    const b = parseWith(importsStageRows.body, body);
    return withTenant(this.db, req.auroraContext!, (s) => stageImportRows(s, uuidParam(id, 'id'), b.rows));
  }

  @Post(':id/run')
  @HttpCode(200)
  @RequirePermissions('asset.import')
  async run(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    return withTenant(this.db, req.auroraContext!, (s) => runImportBatch(s, uuidParam(id, 'id')));
  }

  @Get(':id')
  @RequirePermissions('asset.import')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    return withTenant(this.db, req.auroraContext!, (s) => importBatchDetail(s, uuidParam(id, 'id')));
  }

  @Get(':id/rows')
  @RequirePermissions('asset.import')
  async rows(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Query() query: unknown
  ): Promise<{ items: unknown[] }> {
    const q = parseWith(importsRows.query, query);
    const items = await withTenant(this.db, req.auroraContext!, (s) =>
      importBatchRows(s, uuidParam(id, 'id'), { status: q.status })
    );
    return { items };
  }
}
