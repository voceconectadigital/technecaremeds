/**
 * Aurora — o portal do cliente pela HTTP (SPEC v0.2 §19 · EPIC-020).
 *
 * TODAS AS ROTAS SÃO DE LEITURA, MENOS TRÊS.
 *
 * A SPEC §19 é explícita: o portal escreve em `service_requests`,
 * `quote_approvals` e `signatures` — e mais nada. Este controller expõe:
 * abrir solicitação, decidir sobre orçamento (a mesma transição interna, com
 * evidência de aceite) e avaliar um atendimento terminado (a nota já era
 * coluna de `service_requests`). Assinatura continua no seu próprio fluxo.
 *
 * A superfície mínima não é economia de trabalho: é o que torna a auditoria de
 * segurança do portal possível de fazer numa tarde. Na referência auditada o
 * portal escrevia nas mesmas tabelas que a equipe, com 21 permissões
 * decidindo o quê — e responder "o que um usuário de portal pode alterar?"
 * exigia ler o produto inteiro.
 *
 * O RECORTE NÃO É PARÂMETRO
 *
 * Nenhuma rota daqui aceita `customerId` ou `locationId` de quem chama. O
 * escopo vem do VÍNCULO, resolvido no servidor. Uma rota que aceitasse o
 * cliente como parâmetro seria uma rota em que trocar o número na barra de
 * endereço mostra o hospital do concorrente — e é assim que esse defeito
 * acontece, sempre.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  withTenant,
  portalRequests,
  portalWorkOrders,
  portalComments,
  portalAssets,
  portalDocuments,
  portalQuotes,
  portalSchedule,
  createServiceRequest,
  assertSemAvaliacaoPendente,
  documentForPdf,
  portalQuoteDecision,
  portalRejectionReasons,
  portalRateRequest,
  type Database,
} from '@aurora/db';
import {
  portalQuoteDecision as contratoDecisao,
  portalRateRequest as contratoAvaliacao,
} from '@aurora/contracts';
import { RequirePermissions } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { enviarPdf } from '../documents/documents.controller';
import {
  ForbiddenError,
  ValidationError,
  requestStatusForCustomer,
  isServiceRequestType,
  REQUEST_PRIORITIES,
  type RequestPriority,
} from '@aurora/domain';
import { conferirAlvoDaSolicitacao } from '../common/alvo-da-solicitacao';
import { optionalUuid, text, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

/**
 * O vínculo de quem está perguntando.
 *
 * Sem vínculo não há escopo, e sem escopo a consulta veria a organização
 * inteira. Recusar aqui é a diferença entre "não vejo nada" e "vejo tudo".
 */
function meuVinculo(req: AuroraRequest): string {
  const id = req.auroraContext?.membershipId;
  if (!id) {
    throw new ForbiddenError('portal.session');
  }
  return id;
}

@Controller('portal')
export class PortalController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * O início: o que precisa de mim, e o que está em andamento.
   *
   * Uma consulta só de rota, e quatro no banco. A alternativa — a tela pedir
   * quatro rotas — faria a primeira dobra do portal depender de quatro idas de
   * rede numa conexão de hospital, que é a pior que existe.
   */
  @Get('home')
  @RequirePermissions('service_request.read')
  async home(@Req() req: AuroraRequest): Promise<Record<string, unknown>> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);

    return withTenant(this.db, ctx, async (s) => {
      /*
       * SEQUENCIAL, e não `Promise.all`.
       *
       * As quatro consultas rodam na MESMA sessão de banco — a mesma conexão,
       * dentro da mesma transação, com o contexto do tenant fixado por
       * `set_config`. O driver `pg` não multiplexa: disparar quatro consultas
       * de uma vez na mesma conexão faz uma atropelar a outra, e o aviso de
       * depreciação do driver é literal sobre isso.
       *
       * O sintoma que isso produziu aqui foi 403 no portal — o contexto do
       * tenant se perdia no meio, a política de RLS não encontrava a
       * organização, e a recusa parecia de permissão.
       *
       * O paralelismo que valeria a pena seria em quatro CONEXÕES, e o preço
       * é abrir quatro transações com o mesmo contexto. Não vale: as quatro
       * consultas somam poucos milissegundos, e a ida de rede que a tela
       * economiza continua sendo uma só.
       */
      const solicitacoes = await portalRequests(s, eu, { openOnly: true, limit: 20 });
      const ordens = await portalWorkOrders(s, eu, { limit: 20 });
      const orcamentos = await portalQuotes(s, eu);
      const visitas = await portalSchedule(s, eu);

      /*
       * O QUE PRECISA DE MIM vem separado do que está em andamento.
       *
       * São duas perguntas diferentes, e juntá-las numa lista só é o que faz a
       * pendência de aprovação ficar entre dez chamados em atendimento e
       * ninguém aprovar nada.
       */
      const pendencias = [
        ...orcamentos
          .filter((q) => q.awaiting_decision)
          .map((q) => ({
            kind: 'quote' as const,
            id: q.id,
            label: `Orçamento ${q.number} aguarda sua decisão`,
            total_cents: q.total_cents,
          })),
        ...ordens
          .filter((w) => w.waiting_on_customer)
          .map((w) => ({
            kind: 'work_order' as const,
            id: w.id,
            label: `${w.title} — ${w.wait_label ?? 'aguardando você'}`,
            total_cents: null,
          })),
      ];

      return {
        pending_actions: pendencias,
        open_requests: solicitacoes.map((r) => ({
          ...r,
          status_label: requestStatusForCustomer(r.status),
        })),
        next_visits: visitas.slice(0, 10),
      };
    });
  }

  /** As minhas solicitações, com o vocabulário do cliente. */
  @Get('requests')
  @RequirePermissions('service_request.read')
  async requests(@Req() req: AuroraRequest, @Query('open') open?: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    const linhas = await withTenant(this.db, ctx, (s) =>
      portalRequests(s, eu, { openOnly: open === 'true', limit: 100 })
    );
    return {
      items: linhas.map((r) => ({ ...r, status_label: requestStatusForCustomer(r.status) })),
    };
  }

  /**
   * Uma solicitação, com as ordens que nasceram dela.
   *
   * O detalhe reusa a MESMA consulta da lista, filtrada — e não uma consulta
   * própria. Duas consultas para a mesma entidade divergem, e a que diverge é
   * sempre a menos usada: a do detalhe passaria a devolver um campo a mais sem
   * ninguém notar.
   */
  @Get('requests/:id')
  @RequirePermissions('service_request.read')
  async request(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    const requestId = uuidParam(id, 'id');

    return withTenant(this.db, ctx, async (s) => {
      const todas = await portalRequests(s, eu, { limit: 200 });
      const r = todas.find((x) => x.id === requestId);
      /*
       * NÃO EXISTE, E FORA DO ESCOPO, DEVOLVEM A MESMA COISA.
       *
       * Um 404 para "não existe" e um 403 para "existe e não é seu" contam ao
       * cliente que a solicitação de outro cliente existe — e o número dela.
       * É enumeração, e o custo é vazar o volume de chamados do concorrente.
       */
      if (!r) throw new ForbiddenError('portal.request');

      return {
        request: { ...r, status_label: requestStatusForCustomer(r.status) },
        work_orders: await portalWorkOrders(s, eu, { requestId }),
      };
    });
  }

  /**
   * Abrir solicitação — a primeira das três escritas deste controller.
   *
   * O cliente não escolhe cliente: o vínculo já diz de quem ele é. Aceitar
   * `customer_id` do corpo seria deixar alguém abrir chamado em nome de outro.
   */
  @Post('requests')
  @RequirePermissions('service_request.create')
  async abrir(
    @Req() req: AuroraRequest,
    @Body() body: Record<string, unknown>
  ): Promise<{ id: string; number: string }> {
    const ctx = req.auroraContext!;
    meuVinculo(req);

    const resumo = text(body.summary);
    if (resumo === null || resumo.length < 3) {
      throw new ValidationError('descreva em poucas palavras o que está acontecendo', {
        field: 'summary',
      });
    }

    return withTenant(this.db, ctx, async (s) => {
      // O cliente vem do VÍNCULO. Quem alcança mais de um hospital escolhe —
      // mas só entre os do próprio escopo: o cliente de outro, vindo do corpo,
      // é IGNORADO (PORTAL-010), e o chamado nasce no cliente do vínculo.
      const pedido = optionalUuid(body.customer_id, 'customer_id');
      const [meu] = await s.query<{ customer_id: string }>(
        `SELECT customer_id FROM aurora.accessible_customer_ids($1)
          ORDER BY (customer_id = $2) DESC NULLS LAST, customer_id LIMIT 1`,
        [ctx.membershipId, pedido]
      );
      if (!meu) throw new ForbiddenError('portal.customer');

      // Avaliar e assinar as OS concluídas vem ANTES de abrir um chamado novo (cliente, 21/10/2026).
      await assertSemAvaliacaoPendente(s, ctx.membershipId!);

      const alvo = await conferirAlvoDaSolicitacao(s, ctx.membershipId!, {
        customerId: meu.customer_id,
        assetId: optionalUuid(body.asset_id, 'asset_id'),
        locationId: optionalUuid(body.location_id, 'location_id'),
      });
      const prioridade =
        typeof body.requested_priority === 'string' &&
        (REQUEST_PRIORITIES as readonly string[]).includes(body.requested_priority)
          ? (body.requested_priority as RequestPriority)
          : undefined;
      const tipo = body.requested_type;
      if (tipo !== undefined && tipo !== null && !isServiceRequestType(tipo)) {
        throw new ValidationError('tipo de solicitação fora da lista', { field: 'requested_type' });
      }

      const r = await createServiceRequest(s, {
        customerId: meu.customer_id,
        summary: resumo,
        description: text(body.description) ?? undefined,
        // A origem é `portal`, sempre. Deixá-la vir do corpo permitiria a um
        // chamado do portal se apresentar como aberto por telefone — e o
        // indicador de autoatendimento passaria a medir ficção.
        source: 'portal',
        assetId: optionalUuid(body.asset_id, 'asset_id') ?? undefined,
        locationId: alvo.locationId ?? undefined,
        requestedPriority: prioridade,
        requestedType: (tipo as string | null | undefined) ?? null,
      });
      return { id: r.id, number: r.number };
    });
  }

  /** As ordens de serviço do meu escopo, no vocabulário do cliente. */
  @Get('work-orders')
  @RequirePermissions('work_order.read')
  async workOrders(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    const items = await withTenant(this.db, ctx, (s) => portalWorkOrders(s, eu, { limit: 100 }));
    return { items };
  }

  /**
   * Os comentários que o cliente vê.
   *
   * A consulta filtra por `visibility = 'customer'` na cláusula WHERE. A nota
   * interna não é escondida: ela não é lida, e o tipo devolvido nem tem o
   * campo `visibility` para vazar.
   */
  @Get('work-orders/:id/comments')
  @RequirePermissions('work_order.read')
  async comments(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    const woId = uuidParam(id, 'id');
    const items = await withTenant(this.db, ctx, (s) => portalComments(s, eu, woId));
    return { items };
  }

  /** Os equipamentos do escopo. Nenhum valor financeiro. */
  @Get('assets')
  @RequirePermissions('asset.read')
  async assets(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    const items = await withTenant(this.db, ctx, (s) => portalAssets(s, eu));
    return { items };
  }

  /** Os documentos LIBERADOS. Emitido e não liberado ainda é conferência nossa. */
  @Get('documents')
  @RequirePermissions('document.read')
  async documents(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    const items = await withTenant(this.db, ctx, (s) => portalDocuments(s, eu));
    return { items };
  }

  /**
   * Um documento liberado, em PDF.
   *
   * O recorte é o MESMO da lista: liberado, não cancelado, do cliente e dos
   * locais do vínculo. Emitido-e-não-liberado é 404 aqui, como é ausente lá.
   */
  @Get('documents/:id/pdf')
  @RequirePermissions('document.read')
  async documentPdf(@Req() req: AuroraRequest, @Res() res: Response, @Param('id') id: string): Promise<void> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    const doc = await withTenant(this.db, ctx, (s) =>
      documentForPdf(s, uuidParam(id, 'id'), { portalMembershipId: eu })
    );
    enviarPdf(res, doc);
  }

  /** Os motivos de recusa que o cliente pode escolher. */
  @Get('quotes/rejection-reasons')
  @RequirePermissions('quote.read')
  async rejectionReasons(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    meuVinculo(req);
    const items = await withTenant(this.db, req.auroraContext!, (s) => portalRejectionReasons(s));
    return { items };
  }

  /**
   * O cliente decide sobre o orçamento (gap V2 P1.1).
   *
   * Segunda escrita do portal, e a SPEC §19 já a previa (`quote_approvals`).
   * O orçamento é o do VÍNCULO — o id vem da URL, mas só vale se cair no
   * recorte; a transição é a mesma do lado interno, com a evidência de aceite
   * tirada do soquete, nunca de cabeçalho que o cliente escreve.
   */
  @Post('quotes/:id/decision')
  @HttpCode(200)
  @RequirePermissions('quote.approve')
  async quoteDecision(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ status: string }> {
    const eu = meuVinculo(req);
    const b = parseWith(contratoDecisao.body, body);
    return withTenant(this.db, req.auroraContext!, (s) =>
      portalQuoteDecision(s, eu, uuidParam(id, 'id'), {
        decision: b.decision,
        note: b.note ?? null,
        rejectionReasonId: b.rejection_reason_id ?? null,
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      })
    );
  }

  /** O cliente avalia o atendimento de uma solicitação atendida (gap V2 P1.2). */
  @Post('requests/:id/rating')
  @HttpCode(200)
  @RequirePermissions('service_request.create')
  async rate(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const eu = meuVinculo(req);
    const b = parseWith(contratoAvaliacao.body, body);
    await withTenant(this.db, req.auroraContext!, (s) =>
      portalRateRequest(s, eu, uuidParam(id, 'id'), b.rating, b.comment ?? null)
    );
    return { ok: true };
  }

  /** Os orçamentos que chegaram. O total sai; a composição de custo não. */
  @Get('quotes')
  @RequirePermissions('quote.read')
  async quotes(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    const items = await withTenant(this.db, ctx, (s) => portalQuotes(s, eu));
    return { items };
  }

  /** As visitas programadas. Não diz QUEM vai. */
  @Get('schedule')
  @RequirePermissions('maintenance_plan.read')
  async schedule(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    const items = await withTenant(this.db, ctx, (s) => portalSchedule(s, eu));
    return { items };
  }
}
