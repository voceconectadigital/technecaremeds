/**
 * Aurora — documentos pela HTTP (SPEC v0.2 §18 · EPIC-018).
 *
 * Uma rota de transição, como nas OS e nos orçamentos, com a permissão saindo
 * do grafo declarado no domínio. Emitir, liberar ao cliente e cancelar pedem
 * permissões diferentes, e a tabela que diz qual é mora num lugar só.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  provisionDocumentTypes,
  createDocument,
  loadDocument,
  updateDocumentContent,
  documentIssueCheck,
  transitionDocument,
  superseDocument,
  signDocument,
  verifyDocumentSignatures,
  sweepDocumentExpiry,
  documentsForAsset,
  type Database,
} from '@aurora/db';
import {
  isUuid,
  ValidationError,
  ForbiddenError,
  canTransitionDocument,
  allowedDocumentTransitions,
  DOCUMENT_STATUSES,
  DOCUMENT_VERDICTS,
  SIGNATURE_METHODS,
  type DocumentStatus,
  type DocumentVerdict,
  type SignatureMethod,
} from '@aurora/domain';
import { RequirePermissions, PermissionsCheckedInHandler } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

function uuidParam(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new ValidationError(`${field} deve ser um identificador válido`, { field });
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} deve ser um de: ${allowed.join(', ')}`, { field });
  }
  return value as T;
}

@Controller('documents')
export class DocumentsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Cria os tipos de fábrica e as séries — chamado no onboarding da organização. */
  @Post('types/provision')
  @RequirePermissions('organization.manage_catalogs')
  async provision(@Req() req: AuroraRequest): Promise<{ types: Record<string, string> }> {
    const ctx = req.auroraContext!;
    const mapa = await withTenant(this.db, ctx, (s) => provisionDocumentTypes(s));
    return { types: Object.fromEntries(mapa) };
  }

  @Get('types')
  @RequirePermissions('document.read')
  async types(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT id, key, label, series, default_validity_days,
                requires_technical_manager, requires_signature
           FROM aurora.document_types WHERE archived_at IS NULL ORDER BY label`
      )
    );
    return { items };
  }

  @Post()
  @RequirePermissions('document.create')
  async create(
    @Req() req: AuroraRequest,
    @Body()
    body: {
      documentTypeId?: unknown;
      title?: unknown;
      assetId?: unknown;
      workOrderId?: unknown;
      customerId?: unknown;
      technicalManagerId?: unknown;
      verdict?: unknown;
      payload?: unknown;
    }
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const id = await withTenant(this.db, ctx, (s) =>
      createDocument(s, {
        documentTypeId: uuidParam(body.documentTypeId, 'documentTypeId'),
        title: typeof body.title === 'string' ? body.title : null,
        assetId: body.assetId ? uuidParam(body.assetId, 'assetId') : null,
        workOrderId: body.workOrderId ? uuidParam(body.workOrderId, 'workOrderId') : null,
        customerId: body.customerId ? uuidParam(body.customerId, 'customerId') : null,
        technicalManagerId: body.technicalManagerId
          ? uuidParam(body.technicalManagerId, 'technicalManagerId')
          : null,
        verdict: body.verdict ? oneOf<DocumentVerdict>(body.verdict, DOCUMENT_VERDICTS, 'verdict') : null,
        payload:
          body.payload && typeof body.payload === 'object' ? (body.payload as Record<string, unknown>) : {},
      })
    );
    return { id };
  }

  @Get('by-asset')
  @RequirePermissions('document.read')
  async byAsset(
    @Req() req: AuroraRequest,
    @Query('assetId') assetId?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) => documentsForAsset(s, uuidParam(assetId, 'assetId')));
    return { items };
  }

  /**
   * Varredura de vencimento.
   *
   * POST porque muda estado: carimba os vencidos e grava o marco avisado. Um
   * GET que faz isso é armadilha para qualquer pré-carregamento de link.
   */
  @Post('expiry/sweep')
  @RequirePermissions('document.issue')
  async sweep(@Req() req: AuroraRequest): Promise<{ alerts: unknown[] }> {
    const ctx = req.auroraContext!;
    const alerts = await withTenant(this.db, ctx, (s) => sweepDocumentExpiry(s));
    return { alerts };
  }

  @Get(':id')
  @RequirePermissions('document.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    const docId = uuidParam(id, 'id');
    return withTenant(this.db, ctx, async (s) => {
      const doc = await loadDocument(s, docId);
      return {
        document: doc,
        signatures: await verifyDocumentSignatures(s, docId),
        transitions: allowedDocumentTransitions(doc.status).map((t) => ({
          to: t.to,
          label: t.label,
          permission: t.permission,
        })),
      };
    });
  }

  /** O que falta para emitir — a pergunta que a tela faz antes de tentar. */
  @Get(':id/issue-check')
  @RequirePermissions('document.read')
  async issueCheck(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => documentIssueCheck(s, uuidParam(id, 'id')));
  }

  @Post(':id/content')
  @RequirePermissions('document.create')
  async content(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { payload?: unknown; verdict?: unknown; title?: unknown }
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    const docId = uuidParam(id, 'id');
    return withTenant(this.db, ctx, async (s) => {
      await updateDocumentContent(s, docId, {
        payload:
          body.payload && typeof body.payload === 'object'
            ? (body.payload as Record<string, unknown>)
            : undefined,
        verdict: body.verdict ? oneOf<DocumentVerdict>(body.verdict, DOCUMENT_VERDICTS, 'verdict') : null,
        title: typeof body.title === 'string' ? body.title : null,
      });
      return loadDocument(s, docId);
    });
  }

  @Post(':id/transitions')
  @RequirePermissions('document.read')
  @PermissionsCheckedInHandler(
    'cada aresta tem a sua permissão (document.create, .issue, .release); o guard aqui é o piso'
  )
  async transition(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { to?: unknown; reason?: unknown }
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    const docId = uuidParam(id, 'id');
    const destino = oneOf<DocumentStatus>(body.to, DOCUMENT_STATUSES, 'to');

    return withTenant(this.db, ctx, async (s) => {
      const doc = await loadDocument(s, docId);
      const transicao = canTransitionDocument(doc.status, destino);

      if (transicao && !ctx.permissions.has(transicao.permission)) {
        throw new ForbiddenError(transicao.permission);
      }

      await transitionDocument(s, docId, destino, {
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      });
      return loadDocument(s, docId);
    });
  }

  @Post(':id/versions')
  @RequirePermissions('document.issue')
  async supersede(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const novo = await withTenant(this.db, ctx, (s) => superseDocument(s, uuidParam(id, 'id')));
    return { id: novo };
  }

  @Post(':id/signatures')
  @RequirePermissions('document.sign')
  async sign(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body()
    body: {
      signerName?: unknown;
      signerRole?: unknown;
      method?: unknown;
      signerDocument?: unknown;
      signerEmail?: unknown;
      attachmentId?: unknown;
      portalUserId?: unknown;
      certificateSubject?: unknown;
    }
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    if (typeof body.signerName !== 'string' || typeof body.signerRole !== 'string') {
      throw new ValidationError('nome e papel de quem assina são obrigatórios', {
        field: 'signerName',
      });
    }

    const sigId = await withTenant(this.db, ctx, (s) =>
      signDocument(s, {
        documentId: uuidParam(id, 'id'),
        signerName: body.signerName as string,
        signerRole: body.signerRole as string,
        method: oneOf<SignatureMethod>(body.method, SIGNATURE_METHODS, 'method'),
        signerDocument: typeof body.signerDocument === 'string' ? body.signerDocument : null,
        signerEmail: typeof body.signerEmail === 'string' ? body.signerEmail : null,
        attachmentId: body.attachmentId ? uuidParam(body.attachmentId, 'attachmentId') : null,
        portalUserId: body.portalUserId ? uuidParam(body.portalUserId, 'portalUserId') : null,
        certificateSubject: typeof body.certificateSubject === 'string' ? body.certificateSubject : null,
        // Do soquete, nunca de cabeçalho que o chamador escreve: prova que o
        // próprio interessado pode forjar não é prova.
        clientIp: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      })
    );
    return { id: sigId };
  }
}
