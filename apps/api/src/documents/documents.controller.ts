/**
 * Aurora — documentos pela HTTP (SPEC v0.2 §18 · EPIC-018).
 *
 * Uma rota de transição, como nas OS e nos orçamentos, com a permissão saindo
 * do grafo declarado no domínio. Emitir, liberar ao cliente e cancelar pedem
 * permissões diferentes, e a tabela que diz qual é mora num lugar só.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
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
  documentForPdf,
  createDocumentFromSession,
  type Database,
} from '@aurora/db';
import { documentsFromSession } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { pdfDoDocumento, nomeDoArquivo } from './documento-pdf';
import {
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
// As três funções vêm de `common/params`, e não de cópias locais.
//
// Este arquivo tinha as suas próprias `uuidParam` e `oneOf` — restos das onze
// cópias que a consolidação da fase de segurança recolheu e que passaram
// batido aqui. Duas implementações da mesma validação divergem primeiro no
// caso raro, que é onde ninguém olha.
import { oneOf, optionalUuid, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import { escopoRestrito, filtroDeEscopoPor } from '../common/scope-sql';
import type { AuroraRequest } from '../common/context.middleware';

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

  /**
   * Os documentos, com o recorte que a operação usa: o que está vencendo.
   *
   * Havia `by-asset` e `by-id`, e nenhuma lista. A pergunta que se faz de
   * manhã não é "quais documentos deste equipamento?" — é "o que vence este
   * mês?", e sem ela o vencimento só é descoberto pela varredura, que avisa
   * quando já é tarde para providenciar.
   *
   * `expiring_within_days` é o recorte, e é sobre `valid_until`: documento sem
   * validade não vence, e por isso não aparece nesse recorte — mas continua na
   * lista sem recorte, porque "sem validade" é diferente de "não existe".
   */
  @Get()
  @RequirePermissions('document.read')
  async list(
    @Req() req: AuroraRequest,
    @Query('status') status?: string,
    @Query('asset') asset?: string,
    @Query('expiring_within_days') expiring?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;

    let dias: number | null = null;
    if (expiring !== undefined) {
      dias = Number.parseInt(expiring, 10);
      if (!Number.isFinite(dias) || dias < 0 || dias > 3650) {
        throw new ValidationError('expiring_within_days deve estar entre 0 e 3650', {
          field: 'expiring_within_days',
        });
      }
    }

    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT d.id, d.number, d.version, d.status::text AS status, d.title,
                d.verdict::text AS verdict,
                d.asset_id, a.name AS asset_name,
                d.work_order_id, d.customer_id,
                dt.key AS type_key, dt.label AS type_name,
                d.issued_at, d.valid_until::text AS valid_until,
                d.released_to_customer_at, d.cancelled_at,
                d.supersedes_id
           FROM aurora.documents d
           JOIN aurora.document_types dt ON dt.id = d.document_type_id
           LEFT JOIN aurora.assets a     ON a.id = d.asset_id
           LEFT JOIN aurora.work_orders w ON w.id = d.work_order_id
          WHERE ($1::text IS NULL OR d.status::text = $1)
            AND ($2::uuid IS NULL OR d.asset_id = $2)
            -- Sem validade não vence: fica de fora do recorte de vencimento, e
            -- dentro da lista sem recorte.
            AND ($3::int IS NULL
                 OR (d.valid_until IS NOT NULL
                     AND d.valid_until <= (current_date + ($3::int || ' days')::interval)))
            -- Escopo de quem é restrito (pente-fino 17/10): documento de outro
            -- cliente, ou sem cliente, fica de fora — a mesma regra do ScopeGuard.
            AND ($4::uuid IS NULL
                 OR ${filtroDeEscopoPor('d.customer_id', 'COALESCE(a.location_id, w.location_id)', 4)})
          ORDER BY d.valid_until NULLS LAST, d.issued_at DESC NULLS LAST
          LIMIT 500`,
        [status ?? null, optionalUuid(asset, 'asset'), dias, escopoRestrito(ctx) ? ctx.membershipId : null]
      )
    );
    return { items };
  }

  @Get('by-asset')
  @RequirePermissions('document.read')
  async byAsset(
    @Req() req: AuroraRequest,
    @Query('assetId') assetId?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) =>
      documentsForAsset(s, uuidParam(assetId, 'assetId'), escopoRestrito(ctx) ? ctx.membershipId : null)
    );
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

  /**
   * Rascunho a partir da sessão de medição (gap V2 P2.6).
   *
   * CÓPIA, não cálculo. O veredito do documento continua sendo ato humano na
   * revisão; nada aqui o deriva das leituras.
   */
  @Post('from-session/:sessionId')
  @RequirePermissions('document.create')
  async fromSession(
    @Req() req: AuroraRequest,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown
  ): Promise<{ id: string; document_type_key: string }> {
    const b = parseWith(documentsFromSession.body, body);
    const r = await withTenant(this.db, req.auroraContext!, (s) =>
      createDocumentFromSession(s, uuidParam(sessionId, 'sessionId'), {
        documentTypeKey: b.document_type_key,
        title: b.title ?? null,
        technicalManagerId: b.technical_manager_id ?? null,
      })
    );
    return { id: r.id, document_type_key: r.documentTypeKey };
  }

  /**
   * O documento em PDF (gap V2 P2.8).
   *
   * Gerado na hora, sem guardar arquivo: o conteúdo é o registro, e o PDF é
   * só a forma de entregá-lo. `no-store` porque um rascunho baixado hoje não
   * pode ser servido de cache amanhã como se fosse o emitido.
   */
  @Get(':id/pdf')
  @RequirePermissions('document.read')
  async pdf(@Req() req: AuroraRequest, @Res() res: Response, @Param('id') id: string): Promise<void> {
    const doc = await withTenant(this.db, req.auroraContext!, (s) => documentForPdf(s, uuidParam(id, 'id')));
    enviarPdf(res, doc);
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

/** Escreve o PDF com os cabeçalhos certos — usado pela rota interna e pela do portal. */
export function enviarPdf(res: Response, doc: Parameters<typeof pdfDoDocumento>[0]): void {
  const bytes = pdfDoDocumento(doc);
  res.status(200);
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${nomeDoArquivo(doc)}"`);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  if (doc.content_hash) res.setHeader('x-aurora-content-hash', doc.content_hash);
  res.end(bytes);
}
