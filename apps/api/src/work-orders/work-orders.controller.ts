/**
 * Aurora — ordens de serviço pela HTTP (SPEC v0.2 §09, §10 · EPIC-008).
 *
 * A rota de Kanban devolve as colunas já montadas, com o agrupamento secundário
 * por motivo de espera. Não é conveniência de front-end: é o desenho do ADR-004
 * aparecendo na tela. Um quadro com uma coluna "Aguardando" e um número dentro
 * esconde exatamente a informação que o produto existe para revelar — quantas
 * estão paradas por peça, quantas por aprovação do cliente, quantas por
 * liberação da unidade.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  listWaitReasons,
  createWorkOrder,
  transitionWorkOrder,
  acceptServiceRequest,
  loadStatuses,
  loadTransitionGraph,
  workOrderHistory,
  waitTimeByReason,
  slaStatus,
  type Database,
} from '@aurora/db';
import {
  STATUS_CATEGORIES,
  type StatusCategory,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  evaluateTransition,
  REQUEST_PRIORITIES,
  type RequestPriority,
} from '@aurora/domain';
import { RequirePermissions, PermissionsCheckedInHandler } from '../common/permissions.guard';
import { optionalUuid, text, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

@Controller('work-orders')
export class WorkOrdersController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** As situações da organização, com categoria — o que o Kanban usa como colunas. */
  /**
   * Motivos de espera.
   *
   * Rota própria e não parte de `/catalogs`: motivo de espera não é item de
   * catálogo genérico — ele carrega `pauses_sla`, que decide se o relógio do
   * SLA continua correndo, e `requires_note`, que decide se a tela pede
   * explicação. Empurrá-lo para o catálogo genérico perderia as duas coisas.
   */
  @Get('wait-reasons')
  @RequirePermissions('work_order.read')
  async waitReasons(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) => listWaitReasons(s));
    return { items };
  }

  @Get('statuses')
  @RequirePermissions('work_order.read')
  async statuses(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) => loadStatuses(s));
    return { items };
  }

  /**
   * Quadro Kanban.
   *
   * Cada coluna é uma situação; as de espera trazem a quebra por motivo. O
   * agrupamento é feito no banco, com um `GROUP BY`, e não trazendo as OS todas
   * para contar em memória: com cem mil ordens a segunda opção não termina.
   */
  @Get('board')
  @RequirePermissions('work_order.read')
  async board(
    @Req() req: AuroraRequest,
    @Query('customer') customer?: string
  ): Promise<{ columns: unknown[] }> {
    const ctx = req.auroraContext!;
    const customerId = customer === undefined ? null : uuidParam(customer, 'customer');

    const columns = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT st.id, st.key, st.label, st.category::text AS category, st.color, st.position,
                count(w.id)::int AS total,
                COALESCE(
                  (SELECT json_agg(json_build_object('key', wr.key, 'label', wr.label,
                                                     'pauses_sla', wr.pauses_sla, 'total', sub.total)
                                   ORDER BY sub.total DESC)
                     FROM (SELECT w2.wait_reason_id, count(*)::int AS total
                             FROM aurora.work_orders w2
                            WHERE w2.status_id = st.id
                              AND w2.wait_reason_id IS NOT NULL
                              AND ($1::uuid IS NULL OR w2.customer_id = $1)
                            GROUP BY w2.wait_reason_id) sub
                     JOIN aurora.wait_reasons wr ON wr.id = sub.wait_reason_id),
                  '[]'::json
                ) AS by_wait_reason
           FROM aurora.work_order_statuses st
           LEFT JOIN aurora.work_orders w
                  ON w.status_id = st.id AND ($1::uuid IS NULL OR w.customer_id = $1)
          WHERE st.archived_at IS NULL AND st.visible_on_board
          GROUP BY st.id, st.key, st.label, st.category, st.color, st.position
          ORDER BY st.position`,
        [customerId]
      )
    );
    return { columns };
  }

  /**
   * A lista de ordens de serviço.
   *
   * O FILTRO AUSENTE NÃO VIRA `IS NULL OR`.
   *
   * A primeira versão desta rota usava o padrão `($1 IS NULL OR coluna = $1)`
   * para todos os filtros. É cômodo — uma consulta só serve a todas as
   * combinações — e é caro de um jeito que só aparece com volume: o planejador
   * não consegue estimar a seletividade através do `OR`, erra a contagem por
   * duas ordens de grandeza e escolhe um plano que varre o índice inteiro
   * filtrando linha a linha.
   *
   * A medição com 100 mil OS (`tools/bench/run.mjs`) mostrou p50 de 55 ms e
   * p95 de 1.086 ms nessa forma — a mediana escondia uma cauda de mais de um
   * segundo, e a cauda é o que a pessoa sente.
   *
   * Aqui as condições são montadas a partir de uma lista FECHADA de fragmentos
   * escritos no código. Só os VALORES são parametrizados; nada vindo do
   * cliente entra no texto da consulta.
   */
  @Get()
  @RequirePermissions('work_order.read')
  async list(
    @Req() req: AuroraRequest,
    @Query('customer') customer?: string,
    @Query('category') category?: string,
    @Query('assignee') assignee?: string,
    @Query('limit') limit?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const max = Math.min(Number.parseInt(limit ?? '100', 10) || 100, 500);

    const condicoes: string[] = [];
    const params: unknown[] = [];

    if (customer !== undefined) {
      params.push(uuidParam(customer, 'customer'));
      condicoes.push(`w.customer_id = $${params.length}`);
    }
    if (category !== undefined) {
      // Comparação no PRÓPRIO tipo, e não `status_category::text = $n`: a
      // conversão para texto torna o índice inútil e cega as estatísticas.
      if (!(STATUS_CATEGORIES as readonly string[]).includes(category)) {
        throw new ValidationError('category inválida', {
          field: 'category',
          allowed: STATUS_CATEGORIES,
        });
      }
      params.push(category as StatusCategory);
      condicoes.push(`w.status_category = $${params.length}::aurora.status_category`);
    }
    if (assignee !== undefined) {
      params.push(uuidParam(assignee, 'assignee'));
      condicoes.push(`w.assignee_membership_id = $${params.length}`);
    }

    params.push(max);
    const limite = `$${params.length}`;

    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT w.id, w.number, w.title, w.status_category::text AS category, w.priority::text AS priority,
                w.customer_id, w.asset_id, w.location_name_snapshot, w.asset_name_snapshot,
                w.scheduled_start, w.created_at, w.version,
                st.key AS status_key, st.label AS status_label, st.color AS status_color,
                wr.key AS wait_reason_key, wr.label AS wait_reason_label
           FROM aurora.work_orders w
           JOIN aurora.work_order_statuses st ON st.id = w.status_id
           LEFT JOIN aurora.wait_reasons wr   ON wr.id = w.wait_reason_id
          ${condicoes.length > 0 ? 'WHERE ' + condicoes.join(' AND ') : ''}
          ORDER BY w.created_at DESC
          LIMIT ${limite}`,
        params
      )
    );
    return { items };
  }

  /**
   * Ficha da OS, com as transições que ESTA pessoa pode fazer agora.
   *
   * Vem com `requires` de cada uma, para o formulário saber o que pedir antes de
   * enviar. Descobrir tentando e lendo o erro era o comportamento da referência.
   */
  /**
   * O parâmetro é restrito ao formato de uuid na própria rota.
   *
   * Sem isso, `GET /work-orders/board` casaria com `:id` e qual das duas
   * ganharia dependeria da ordem em que os métodos foram declarados. Rota cuja
   * resolução depende de ordem de declaração quebra na próxima refatoração —
   * a restrição põe a decisão no caminho, onde ela é visível.
   */
  @Get(':id')
  @RequirePermissions('work_order.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<Record<string, unknown>> {
    const ctx = req.auroraContext!;
    const woId = uuidParam(id, 'id');
    return withTenant(this.db, ctx, async (s) => {
      const [row] = await s.query<Record<string, unknown>>(
        `SELECT w.*, st.key AS status_key, st.label AS status_label,
                st.requires_wait_reason,
                wr.key AS wait_reason_key, wr.label AS wait_reason_label, wr.pauses_sla,
                nat.label AS work_order_type_label,
                c.name AS customer_name
           FROM aurora.work_orders w
           JOIN aurora.work_order_statuses st ON st.id = w.status_id
           JOIN aurora.catalog_items nat      ON nat.id = w.work_order_type_id
           JOIN aurora.customers c            ON c.id = w.customer_id
           LEFT JOIN aurora.wait_reasons wr   ON wr.id = w.wait_reason_id
          WHERE w.id = $1`,
        [woId]
      );
      if (!row) throw new NotFoundError('Ordem de serviço', woId);

      const graph = await loadTransitionGraph(s);
      const statuses = await loadStatuses(s);
      const atual = statuses.find((x) => x.key === row.status_key)!;

      const disponiveis = graph
        .filter((t) => t.from === atual.key)
        .map((t) => {
          const destino = statuses.find((x) => x.key === t.to)!;
          const avaliacao = evaluateTransition({
            from: { key: atual.key, label: atual.label, category: atual.category },
            to: {
              key: destino.key,
              label: destino.label,
              category: destino.category,
              requiresWaitReason: destino.requires_wait_reason,
            },
            graph,
            permissions: ctx.permissions,
            fields: {},
          });
          return {
            to: destino.key,
            label: destino.label,
            category: destino.category,
            permission: t.permission,
            allowed: ctx.permissions.has(t.permission),
            requires: avaliacao.missing ?? t.requires ?? [],
            note: t.note,
          };
        })
        .filter((x) => x.allowed);

      return {
        ...row,
        history: await workOrderHistory(s, woId),
        // O SLA vem na ficha porque é o que decide a ordem do dia de quem
        // atende. Numa consulta à parte, a informação chegaria depois da
        // decisão que ela deveria orientar.
        sla: await slaStatus(s, 'work_order', woId),
        available_transitions: disponiveis,
      };
    });
  }

  @Post()
  @RequirePermissions('work_order.create')
  async create(
    @Req() req: AuroraRequest,
    @Body() body: Record<string, unknown>
  ): Promise<{ id: string; number: string | null }> {
    const ctx = req.auroraContext!;
    const title = text(body.title);
    if (!title || title.length < 3) {
      throw new ValidationError('title precisa de ao menos 3 caracteres', { field: 'title' });
    }
    return withTenant(this.db, ctx, (s) =>
      createWorkOrder(s, {
        customerId: uuidParam(body.customer_id, 'customer_id'),
        workOrderTypeId: uuidParam(body.work_order_type_id, 'work_order_type_id'),
        title,
        description: typeof body.description === 'string' ? body.description : '',
        locationId: optionalUuid(body.location_id, 'location_id'),
        assetId: optionalUuid(body.asset_id, 'asset_id'),
        reportedFailureCodeId: optionalUuid(body.reported_failure_code_id, 'reported_failure_code_id'),
        criticalityId: optionalUuid(body.criticality_id, 'criticality_id'),
        assigneeMembershipId: optionalUuid(body.assignee_membership_id, 'assignee_membership_id'),
        priority:
          body.priority === undefined
            ? 'none'
            : (REQUEST_PRIORITIES as readonly string[]).includes(body.priority as string)
              ? (body.priority as RequestPriority)
              : (() => {
                  throw new ValidationError('priority inválida', {
                    field: 'priority',
                    allowed: REQUEST_PRIORITIES,
                  });
                })(),
        publish: body.publish !== false,
      })
    );
  }

  /** Uma rota para todas as transições — o grafo é a fonte de verdade. */
  @Post(':id/transitions')
  @RequirePermissions('work_order.read')
  @PermissionsCheckedInHandler(
    'cada aresta do grafo tem a sua permissão (work_order.assign, .execute, .complete, .validate, .close, .reopen); o guard aqui é o piso'
  )
  async transition(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ status: string; category: string; version: number }> {
    const ctx = req.auroraContext!;
    const to = text(body.to);
    if (!to) throw new ValidationError('to é obrigatório', { field: 'to' });

    return withTenant(this.db, ctx, (s) =>
      transitionWorkOrder(s, uuidParam(id, 'id'), to, {
        waitReasonId: optionalUuid(body.wait_reason_id, 'wait_reason_id'),
        waitNote: text(body.wait_note),
        resolution: text(body.resolution),
        cancellationReason: text(body.cancellation_reason),
        reworkReason: text(body.rework_reason),
        reopenReason: text(body.reopen_reason),
        causeFailureCodeId: optionalUuid(body.cause_failure_code_id, 'cause_failure_code_id'),
        actionCodeId: optionalUuid(body.action_code_id, 'action_code_id'),
        assigneeMembershipId: optionalUuid(body.assignee_membership_id, 'assignee_membership_id'),
        scheduledStart: typeof body.scheduled_start === 'string' ? new Date(body.scheduled_start) : null,
        scheduledEnd: typeof body.scheduled_end === 'string' ? new Date(body.scheduled_end) : null,
        expectedVersion: typeof body.version === 'number' ? body.version : undefined,
      })
    );
  }

  /**
   * Aceita uma solicitação gerando 1..N ordens.
   *
   * Fica sob `/work-orders` e não sob `/service-requests` porque o que a rota
   * produz é ordem de serviço — e porque a permissão que ela exige é a de
   * aceitar solicitação, verificada dentro da transição, junto com o estado.
   */
  @Post('from-request/:requestId')
  @RequirePermissions('work_order.create')
  async fromRequest(
    @Req() req: AuroraRequest,
    @Param('requestId') requestId: string,
    @Body() body: { targets?: unknown }
  ): Promise<{ work_orders: unknown[] }> {
    const ctx = req.auroraContext!;
    if (!ctx.membershipId) throw new ForbiddenError('esta rota exige um vínculo com a organização');
    if (!Array.isArray(body.targets) || body.targets.length === 0) {
      throw new ValidationError('targets deve listar ao menos uma ordem a gerar', { field: 'targets' });
    }
    if (body.targets.length > 50) {
      throw new ValidationError('no máximo 50 ordens por aceite', { field: 'targets', max: 50 });
    }

    const targets = body.targets.map((t, i) => {
      const alvo = t as Record<string, unknown>;
      return {
        assetId: optionalUuid(alvo.asset_id, `targets[${i}].asset_id`),
        locationId: optionalUuid(alvo.location_id, `targets[${i}].location_id`),
        workOrderTypeId: uuidParam(alvo.work_order_type_id, `targets[${i}].work_order_type_id`),
        title: text(alvo.title) ?? undefined,
        assigneeMembershipId: optionalUuid(
          alvo.assignee_membership_id,
          `targets[${i}].assignee_membership_id`
        ),
      };
    });

    const r = await withTenant(this.db, ctx, (s) =>
      acceptServiceRequest(s, uuidParam(requestId, 'requestId'), targets)
    );
    return { work_orders: r.workOrders };
  }

  /**
   * Tempo perdido por motivo de espera.
   *
   * É a pergunta que o ADR-004 destravou e que a referência não conseguia
   * responder — lá, "aguardando peça" estava escrito de quatro formas em quatro
   * estados diferentes, e somá-los exigia adivinhar quais eram os mesmos.
   */
  @Get('insights/wait-time')
  @RequirePermissions('insight.read')
  async waitTime(
    @Req() req: AuroraRequest,
    @Query('from') from?: string,
    @Query('to') to?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const inicio = from ? new Date(from) : new Date(Date.now() - 90 * 86_400_000);
    const fim = to ? new Date(to) : new Date();
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      throw new ValidationError('from e to devem ser datas válidas', { field: 'from' });
    }
    const items = await withTenant(this.db, ctx, (s) => waitTimeByReason(s, inicio, fim));
    return { items };
  }
}
