/**
 * Aurora — registros de qualidade: os certificados (conversa com o cliente, 21/10/2026).
 *
 * A lista, o cadastro e a exclusão são JSON de sempre. O ARQUIVO é a exceção: sobe e desce como
 * corpo cru (`PUT/GET /quality-records/:id/file`), por rotas próprias — o interpretador de corpo
 * cru é montado só neste caminho, e só para os tipos que um certificado pode ter (PDF e imagem).
 *
 * ORDEM NA SUBIDA: primeiro confere que o registro existe E é visível a quem sobe (404 igual para
 * "não existe" e "não é seu"), depois grava os bytes, depois grava os metadados. O contrário deixaria
 * bytes órfãos no armazenamento de quem não podia nem ver o registro.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  withTenant,
  createQualityRecord,
  listQualityRecords,
  deleteQualityRecord,
  getQualityFile,
  setQualityFile,
  QUALITY_KINDS,
  QUALITY_STATUSES,
  type Database,
  type QualityKind,
  type QualityStatus,
} from '@aurora/db';
import { ForbiddenError, NotFoundError, ValidationError } from '@aurora/domain';
import { qualityCreate } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { RequirePermissions } from '../common/permissions.guard';
import { uuidParam } from '../common/params';
import { ARQUIVOS, DATABASE } from '../common/tokens';
import { sha256De } from '../common/arquivos/disco';
import type { ArmazenamentoDeObjetos } from '../common/arquivos/porta';
import type { AuroraRequest } from '../common/context.middleware';

/** O que um certificado pode ser: PDF ou imagem. */
export const TIPOS_DE_CERTIFICADO: Readonly<Record<string, string>> = Object.freeze({
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
});
/** 10 MB: certificado digitalizado, não vídeo. */
export const MAX_CERTIFICADO = 10 * 1024 * 1024;

function meuVinculo(req: AuroraRequest): string {
  const id = req.auroraContext?.membershipId;
  if (!id) throw new ForbiddenError('esta rota exige um vínculo com a organização');
  return id;
}

/** O nome do arquivo vem do cabeçalho: nunca vira caminho, só rótulo. */
function nomeSeguro(bruto: string | undefined, extensao: string): string {
  let nome = '';
  try {
    nome = decodeURIComponent(bruto ?? '');
  } catch {
    nome = '';
  }
  // Barra, aspas e caracteres de controle viram sublinhado: o nome é rótulo, nunca caminho.
  nome = [...nome]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/"'.includes(c) ? '_' : c))
    .join('')
    .trim()
    .slice(0, 120);
  return nome.length > 0 ? nome : `certificado${extensao}`;
}

@Controller('quality-records')
export class QualityController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ARQUIVOS) private readonly arquivos: ArmazenamentoDeObjetos
  ) {}

  @Get()
  @RequirePermissions('document.read')
  async list(
    @Req() req: AuroraRequest,
    @Query('kind') kind?: string,
    @Query('customer') customer?: string,
    @Query('asset') asset?: string,
    @Query('status') status?: string
  ): Promise<{ items: unknown[] }> {
    const eu = meuVinculo(req);
    if (kind !== undefined && !(QUALITY_KINDS as readonly string[]).includes(kind)) {
      throw new ValidationError('tipo de certificado desconhecido', { field: 'kind' });
    }
    if (status !== undefined && !(QUALITY_STATUSES as readonly string[]).includes(status)) {
      throw new ValidationError('situação desconhecida', { field: 'status' });
    }
    const items = await withTenant(this.db, req.auroraContext!, (s) =>
      listQualityRecords(s, {
        kind: (kind as QualityKind | undefined) ?? null,
        status: (status as QualityStatus | undefined) ?? null,
        customerId: customer === undefined ? null : uuidParam(customer, 'customer'),
        assetId: asset === undefined ? null : uuidParam(asset, 'asset'),
        scopeMembershipId: eu,
      })
    );
    return { items };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('document.create')
  async create(@Req() req: AuroraRequest, @Body() body: unknown): Promise<{ id: string }> {
    meuVinculo(req);
    const b = parseWith(qualityCreate.body, body);
    const id = await withTenant(this.db, req.auroraContext!, (s) =>
      createQualityRecord(s, {
        kind: b.kind,
        title: b.title,
        customerId: b.customer_id ?? null,
        assetId: b.asset_id ?? null,
        procedureTemplateId: b.procedure_template_id ?? null,
        personName: b.person_name ?? null,
        certificateNumber: b.certificate_number ?? null,
        issuer: b.issuer ?? null,
        issuedAt: b.issued_at,
        validUntil: b.valid_until ?? null,
        note: b.note ?? null,
      })
    );
    return { id };
  }

  @Delete(':id')
  @RequirePermissions('document.create')
  async remove(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ ok: true }> {
    meuVinculo(req);
    await withTenant(this.db, req.auroraContext!, (s) => deleteQualityRecord(s, uuidParam(id, 'id')));
    return { ok: true };
  }

  /** Sobe o arquivo do certificado (corpo cru: PDF ou imagem, até 10 MB). Substitui o anterior. */
  @Put(':id/file')
  @RequirePermissions('document.create')
  async upload(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Headers('content-type') tipoCru: string | undefined,
    @Headers('x-aurora-file-name') nomeCru: string | undefined
  ): Promise<{ file_name: string; file_size: number }> {
    const eu = meuVinculo(req);
    const recordId = uuidParam(id, 'id');
    const tipo = (tipoCru ?? '').split(';')[0]!.trim().toLowerCase();
    const extensao = TIPOS_DE_CERTIFICADO[tipo];
    if (!extensao) {
      throw new ValidationError('o certificado precisa ser PDF, PNG, JPEG ou WebP', {
        field: 'content-type',
      });
    }
    const corpo = (req as unknown as { body?: unknown }).body;
    if (!Buffer.isBuffer(corpo) || corpo.byteLength === 0) {
      throw new ValidationError('o corpo precisa ser o arquivo, em bytes', { field: 'body' });
    }
    if (corpo.byteLength > MAX_CERTIFICADO) {
      throw new ValidationError('arquivo grande demais (até 10 MB)', {
        field: 'body',
        maximo: MAX_CERTIFICADO,
      });
    }

    const bytes = new Uint8Array(corpo);
    const sha256 = sha256De(bytes);
    const nome = nomeSeguro(nomeCru, extensao);
    const ctx = req.auroraContext!;
    const chave = `orgs/${ctx.organizationId}/qualidade/${recordId}/${sha256.slice(0, 16)}${extensao}`;

    // 1) o registro existe e é visível a quem sobe; 2) os bytes; 3) os metadados.
    const anterior = await withTenant(this.db, ctx, (s) => getQualityFile(s, recordId, eu));
    await this.arquivos.escrever(chave, 0, bytes);
    await withTenant(this.db, ctx, (s) =>
      setQualityFile(
        s,
        recordId,
        { file_key: chave, file_name: nome, file_content_type: tipo, file_size: bytes.byteLength, sha256 },
        eu
      )
    );
    // O arquivo substituído sai do armazenamento (a chave leva o resumo: nunca é a mesma do novo).
    if (anterior && anterior.file_key !== chave)
      await this.arquivos.apagar(anterior.file_key).catch(() => undefined);
    return { file_name: nome, file_size: bytes.byteLength };
  }

  @Get(':id/file')
  @RequirePermissions('document.read')
  async download(@Req() req: AuroraRequest, @Res() res: Response, @Param('id') id: string): Promise<void> {
    const eu = meuVinculo(req);
    const recordId = uuidParam(id, 'id');
    const meta = await withTenant(this.db, req.auroraContext!, (s) => getQualityFile(s, recordId, eu));
    if (!meta) throw new NotFoundError('Arquivo do certificado', recordId);
    const bytes = await this.arquivos.ler(meta.file_key);
    if (!bytes) throw new NotFoundError('Arquivo do certificado', recordId);
    res.setHeader('content-type', meta.file_content_type ?? 'application/octet-stream');
    res.setHeader('content-length', String(bytes.byteLength));
    // O nome vai codificado (RFC 5987): acento e espaço não quebram o cabeçalho.
    res.setHeader(
      'content-disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(meta.file_name)}`
    );
    // O navegador não adivinha o tipo: um "PDF" que é HTML não executa.
    res.setHeader('x-content-type-options', 'nosniff');
    res.status(200).end(Buffer.from(bytes));
  }
}
