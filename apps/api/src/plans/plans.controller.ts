/**
 * Aurora — planos de manutenção preventiva pela HTTP (SPEC v0.2 §13 · EPIC-013).
 *
 * O MODELO INTEIRO JÁ EXISTIA em `packages/db/src/maintenance-plans.ts`: plano,
 * tarefa com expressão de alvo, ciclo ancorado no FIM do anterior, itens
 * materializados em ordens de serviço, pulo com motivo, poda de equipamento
 * baixado, e cálculo de cumprimento com tolerância. Rota: nenhuma.
 *
 * A PERGUNTA QUE ESTAS ROTAS RESPONDEM
 *
 * "A preventiva está em dia?" — e ela não se responde com uma lista de planos.
 * Responde-se com o CICLO ABERTO de cada tarefa e o estado de cada item dentro
 * dele: feito, atrasado, dentro da tolerância, pulado com motivo.
 *
 * Por isso a rota de cumprimento devolve o resumo E os itens. Só o resumo
 * ("83%") não deixa ninguém agir; só os itens obrigam a contar na mão.
 *
 * O QUE NÃO ESTÁ AQUI, E POR QUÊ
 *
 * A varredura que ABRE os ciclos roda no publicador, não numa requisição.
 * Uma preventiva que só é gerada quando alguém abre a tela é uma preventiva
 * que depende de alguém abrir a tela — e o valor inteiro do plano é
 * justamente não depender disso.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  generateCycle,
  materializeCycle,
  skipCycleItem,
  cycleCompliance,
  resolveTargetAssets,
  membershipScope,
  assertCustomerInScope,
  createGuidedPlan,
  planBoard,
  executePlanItem,
  planSchedule,
  PLAN_KINDS,
  type MembershipScope,
  type TenantSession,
  type Database,
} from '@aurora/db';
import { ForbiddenError, NotFoundError, ValidationError } from '@aurora/domain';
import { plansBoard, plansCreate, plansSchedule } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { PermissionsCheckedInHandler, RequirePermissions } from '../common/permissions.guard';
import { optionalUuid, text, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import { escopoRestrito } from '../common/scope-sql';
import type { AuroraRequest } from '../common/context.middleware';

/** O período do painel/cronograma: datas ISO, no máximo dois anos. */
function periodo(q: { from: string; to: string }): { from: Date; to: Date } {
  const from = new Date(q.from);
  const to = new Date(q.to);
  if (Number.isNaN(from.getTime()))
    throw new ValidationError('from não é uma data válida', { field: 'from' });
  if (Number.isNaN(to.getTime())) throw new ValidationError('to não é uma data válida', { field: 'to' });
  if (to <= from) throw new ValidationError('"to" precisa ser depois de "from"', { field: 'to' });
  if (to.getTime() - from.getTime() > 732 * 86_400_000) {
    throw new ValidationError('o período do cronograma é de no máximo dois anos', { field: 'to' });
  }
  return { from, to };
}

/**
 * O plano está dentro do escopo de quem pergunta? Fora dele é 404, como
 * qualquer cliente fora do escopo — o plano é sempre DE um cliente.
 */
async function planoNoEscopo(s: TenantSession, escopo: MembershipScope, planId: string): Promise<void> {
  if (escopo.customerIds === null) return;
  const [p] = await s.query<{ customer_id: string }>(
    `SELECT customer_id FROM aurora.maintenance_plans WHERE id = $1`,
    [planId]
  );
  if (p && !escopo.customerIds.includes(p.customer_id))
    throw new NotFoundError('Plano de manutenção', planId);
}

@Controller('maintenance-plans')
export class PlansController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Os planos, com quantas tarefas cada um tem e quando o próximo ciclo vence.
   *
   * A contagem de tarefas vem junto porque plano sem tarefa não gera nada — e
   * é o erro de cadastro mais comum: alguém cria o plano, salva, e descobre
   * três meses depois que nenhuma preventiva foi aberta.
   */
  @Get()
  @RequirePermissions('maintenance_plan.read')
  async list(@Req() req: AuroraRequest, @Query('customer') customer?: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const customerId = optionalUuid(customer, 'customer');

    const items = await withTenant(this.db, ctx, async (s) => {
      const escopo = await membershipScope(s, ctx.membershipId);
      await assertCustomerInScope(s, escopo, customerId);
      return s.query(
        `SELECT p.id, p.name, p.description, p.customer_id, c.name AS customer_name,
                p.team_id, p.is_active, p.auto_generate, p.include_late_assets,
                p.anchor_date::text AS anchor_date,
                (SELECT count(*)::int FROM aurora.plan_tasks t
                  WHERE t.plan_id = p.id AND t.archived_at IS NULL) AS task_count,
                -- Quando vence o ciclo corrente mais próximo.
                --
                -- min() sobre o ciclo CORRENTE de cada tarefa, e não sobre
                -- todos os ciclos não fechados: como nada fecha ciclo hoje, a
                -- segunda forma devolveria o vencimento do PRIMEIRO ciclo de
                -- todos os tempos — uma data no passado, apresentada como "a
                -- próxima".
                (SELECT min(corrente.ends_at)
                   FROM aurora.plan_tasks t2
                   CROSS JOIN LATERAL (
                     SELECT c3.ends_at FROM aurora.plan_cycles c3
                      WHERE c3.task_id = t2.id AND c3.status <> 'closed'
                      ORDER BY c3.seq DESC LIMIT 1
                   ) corrente
                  WHERE t2.plan_id = p.id AND t2.archived_at IS NULL)
                  AS next_cycle_ends_at
           FROM aurora.maintenance_plans p
           JOIN aurora.customers c ON c.id = p.customer_id
          WHERE p.archived_at IS NULL
            AND ($1::uuid IS NULL OR p.customer_id = $1)
            AND ($2::uuid[] IS NULL OR p.customer_id = ANY($2::uuid[]))
          ORDER BY p.name`,
        [customerId, escopo.customerIds]
      );
    });
    return { items };
  }

  /**
   * O que o formulário de plano oferece.
   *
   * Um tipo só fica disponível quando a natureza de OS dele existe no catálogo
   * DESTA organização: oferecer "Calibração" e recusar ao salvar é a pior
   * forma de descobrir que falta cadastro.
   */
  @Get('form-options')
  @RequirePermissions('maintenance_plan.read')
  async formOptions(@Req() req: AuroraRequest): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => {
      const naturezas = await s.query<{ system_key: string }>(
        `SELECT DISTINCT system_key FROM aurora.catalog_items
          WHERE catalog_key = 'work_order_type' AND system_key IS NOT NULL AND archived_at IS NULL`
      );
      const existentes = new Set(naturezas.map((n) => n.system_key));
      const templates = await s.query(
        `SELECT DISTINCT ON (t.key) t.key, t.title, t.version, t.procedure_kind::text AS procedure_kind,
                (SELECT count(*)::int FROM aurora.checklist_items i WHERE i.template_id = t.id) AS item_count
           FROM aurora.checklist_templates t
          WHERE t.status = 'published'
          ORDER BY t.key, t.version DESC`
      );
      return {
        kinds: Object.entries(PLAN_KINDS).map(([key, v]) => ({
          key,
          available: existentes.has(v.workOrderType) || (v.fallback !== null && existentes.has(v.fallback)),
          work_order_type: v.workOrderType,
          procedure_kind: v.procedureKind,
        })),
        templates,
      };
    });
  }

  /** Painel dos planos: programados, realizados, pendentes, vencidos — por tipo, cliente, setor, mês. */
  @Get('board')
  @RequirePermissions('maintenance_plan.read')
  async board(@Req() req: AuroraRequest, @Query() query: unknown): Promise<unknown> {
    const ctx = req.auroraContext!;
    const q = parseWith(plansBoard.query, query);
    const p = periodo(q);
    return withTenant(this.db, ctx, async (s) => {
      const escopo = await membershipScope(s, ctx.membershipId);
      await assertCustomerInScope(s, escopo, q.customer);
      return planBoard(
        s,
        { ...p, customerId: q.customer ?? null, sectorId: q.sector ?? null, kind: q.kind ?? null },
        escopo
      );
    });
  }

  /** Cronograma: atividades reais e as previstas pela frequência, com cliente, setor e equipamento. */
  @Get('schedule')
  @RequirePermissions('maintenance_plan.read')
  async schedule(@Req() req: AuroraRequest, @Query() query: unknown): Promise<unknown> {
    const ctx = req.auroraContext!;
    const q = parseWith(plansSchedule.query, query);
    const p = periodo(q);
    return withTenant(this.db, ctx, async (s) => {
      const escopo = await membershipScope(s, ctx.membershipId);
      await assertCustomerInScope(s, escopo, q.customer);
      return planSchedule(
        s,
        { ...p, customerId: q.customer ?? null, sectorId: q.sector ?? null, kind: q.kind ?? null },
        escopo
      );
    });
  }

  /**
   * Cria o plano pelo fluxo orientado. Toda conferência de pertença (setor do
   * cliente, equipamento do setor, escopo de quem cadastra) é do servidor.
   */
  @Post()
  @RequirePermissions('maintenance_plan.create')
  async create(
    @Req() req: AuroraRequest,
    @Body() body: unknown
  ): Promise<{ id: string; task_count: number }> {
    const ctx = req.auroraContext!;
    const b = parseWith(plansCreate.body, body);
    const anchor = new Date(`${b.anchor_date}T00:00:00Z`);
    if (Number.isNaN(anchor.getTime())) {
      throw new ValidationError('data de início inválida', { field: 'anchor_date' });
    }
    return withTenant(this.db, ctx, async (s) => {
      const escopo = await membershipScope(s, ctx.membershipId);
      const r = await createGuidedPlan(
        s,
        {
          name: b.name,
          description: b.description,
          customerId: b.customer_id,
          sectorId: b.sector_id,
          assetIds: b.asset_ids,
          kind: b.kind,
          checklistTemplateKey: b.checklist_template_key ?? null,
          frequencyUnit: b.frequency_unit,
          frequencyInterval: b.frequency_interval,
          anchorDate: anchor,
          leadTimeDays: b.lead_time_days,
          toleranceDays: b.tolerance_days,
          autoGenerate: b.auto_generate,
          estimatedDurationMin: b.estimated_duration_min ?? null,
        },
        escopo
      );
      return { id: r.planId, task_count: r.taskIds.length };
    });
  }

  /** O plano, com as tarefas e o ciclo aberto de cada uma. */
  @Get(':id')
  @RequirePermissions('maintenance_plan.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    const planId = uuidParam(id, 'id');

    return withTenant(this.db, ctx, async (s) => {
      await planoNoEscopo(s, await membershipScope(s, ctx.membershipId), planId);
      const [plano] = await s.query<Record<string, unknown>>(
        `SELECT p.id, p.name, p.description, p.customer_id, c.name AS customer_name,
                p.team_id, p.is_active, p.auto_generate, p.include_late_assets,
                p.anchor_date::text AS anchor_date, p.created_at, p.updated_at
           FROM aurora.maintenance_plans p
           JOIN aurora.customers c ON c.id = p.customer_id
          WHERE p.id = $1 AND p.archived_at IS NULL`,
        [planId]
      );
      if (!plano) throw new NotFoundError('Plano de manutenção', planId);

      const tarefas = await s.query(
        `SELECT t.id, t.name, t.target_kind::text AS target_kind,
                t.target_asset_id, t.target_category_id, t.target_location_id,
                t.work_order_type_id, t.checklist_template_key,
                t.filter_asset_model_id, t.filter_manufacturer_id, t.filter_criticality_id,
                t.trigger::text AS trigger,
                t.frequency_unit::text AS frequency_unit, t.frequency_interval,
                t.lead_time_days, t.tolerance_days, t.estimated_duration_min,
                t.default_team_id, t.default_assignee_id, t.position,
                -- O ciclo CORRENTE: o de maior sequência, e não "um aberto".
                --
                -- Nada no sistema fecha um ciclo hoje: status fica em
                -- 'open' indefinidamente (lacuna registrada em PROGRESS).
                -- Uma junção por status = open devolveria
                -- N linhas por tarefa assim que o segundo ciclo nascesse, e a
                -- tarefa apareceria duplicada na resposta — o indicador
                -- passaria a contar cada equipamento duas vezes.
                --
                -- O ciclo de maior seq é o corrente por construção: cada um
                -- nasce ancorado no fim do anterior.
                cy.id AS open_cycle_id, cy.seq AS open_cycle_seq,
                cy.starts_at AS open_cycle_starts_at, cy.ends_at AS open_cycle_ends_at,
                cy.expected_count, cy.done_count
           FROM aurora.plan_tasks t
           LEFT JOIN LATERAL (
                  SELECT c2.id, c2.seq, c2.starts_at, c2.ends_at,
                         c2.expected_count, c2.done_count
                    FROM aurora.plan_cycles c2
                   WHERE c2.task_id = t.id AND c2.status <> 'closed'
                   ORDER BY c2.seq DESC
                   LIMIT 1
                ) cy ON true
          WHERE t.plan_id = $1 AND t.archived_at IS NULL
          ORDER BY t.position, t.name`,
        [planId]
      );

      return { plan: plano, tasks: tarefas };
    });
  }

  /**
   * Os ativos que a expressão da tarefa alcança HOJE.
   *
   * A mesma pergunta que a cobertura de contrato responde, e pela mesma razão:
   * o alvo é EXPRESSÃO ("todos os ventiladores da UTI"), e uma lista marcada a
   * mão envelheceria no dia seguinte. Quem cadastra precisa ver quantos
   * equipamentos a expressão pega antes de ligar a geração automática.
   */
  @Get('tasks/:taskId/assets')
  @RequirePermissions('maintenance_plan.read')
  async targets(@Req() req: AuroraRequest, @Param('taskId') taskId: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const id = uuidParam(taskId, 'taskId');
    const items = await withTenant(this.db, ctx, async (s) => {
      const ids = await resolveTargetAssets(s, id);
      if (ids.length === 0) return [];
      // O plano é do cliente (o ScopeGuard confere a tarefa); o equipamento
      // num setor fora do escopo de quem pergunta fica de fora da lista.
      return s.query(
        `SELECT id, name, location_path FROM aurora.assets
          WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
            AND ($2::uuid IS NULL
                 OR location_id IS NULL
                 OR location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2)))
          ORDER BY name`,
        [ids, escopoRestrito(ctx) ? ctx.membershipId : null]
      );
    });
    return { items };
  }

  /**
   * O cumprimento de um ciclo: o resumo E os itens.
   *
   * Só o resumo ("83% em dia") não deixa ninguém agir — não diz QUAL
   * equipamento ficou para trás. Só os itens obrigam quem olha a contar na
   * mão, e a conta com tolerância é justamente a que se erra contando na mão.
   */
  @Get('cycles/:cycleId/compliance')
  @RequirePermissions('maintenance_plan.read')
  async compliance(@Req() req: AuroraRequest, @Param('cycleId') cycleId: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    const id = uuidParam(cycleId, 'cycleId');
    return withTenant(this.db, ctx, (s) => cycleCompliance(s, id));
  }

  /**
   * Abre o próximo ciclo de uma tarefa, à mão.
   *
   * A varredura faz isso sozinha na antecedência configurada. Esta rota existe
   * para o caso em que alguém precisa antecipar — e é por isso que ela é
   * `POST` numa tarefa, e não um "gerar tudo": gerar o plano inteiro à mão é
   * como se produz cinquenta ordens duplicadas num clique.
   */
  @Post('tasks/:taskId/cycles')
  @RequirePermissions('maintenance_plan.generate_cycle')
  async generate(@Req() req: AuroraRequest, @Param('taskId') taskId: string): Promise<{ cycle: unknown }> {
    const ctx = req.auroraContext!;
    const id = uuidParam(taskId, 'taskId');
    const r = await withTenant(this.db, ctx, (s) => generateCycle(s, id));
    if (r === null) {
      // Nulo não é falha: significa que ainda não chegou a antecedência, ou
      // que já existe ciclo aberto. Dizer isso é melhor do que devolver um
      // erro que a pessoa vai interpretar como defeito.
      throw new ValidationError(
        'não há ciclo a abrir agora: ou já existe um aberto, ou ainda não chegou a antecedência',
        { field: 'taskId' }
      );
    }
    return {
      cycle: {
        id: r.cycleId,
        seq: r.seq,
        starts_at: r.startsAt,
        ends_at: r.endsAt,
        items: r.items,
        work_orders: r.workOrders,
      },
    };
  }

  /**
   * Materializa as ordens de serviço de um ciclo já aberto.
   *
   * Separado de abrir o ciclo porque são decisões diferentes: um plano manual
   * abre o ciclo e deixa alguém revisar a lista antes de criar cinquenta OS.
   */
  /**
   * ▶ Executar um item do cronograma (reunião 16/10/2026). Quem executa o
   * trabalho (operador) também pode disparar, além de quem gera ciclos.
   */
  @Post('cycle-items/:itemId/execute')
  @RequirePermissions('maintenance_plan.read')
  @PermissionsCheckedInHandler('aceita maintenance_plan.generate_cycle ou work_order.execute')
  async executar(
    @Req() req: AuroraRequest,
    @Param('itemId') itemId: string
  ): Promise<{ work_order_id: string; created: boolean }> {
    const ctx = req.auroraContext!;
    if (
      !ctx.permissions.has('maintenance_plan.generate_cycle') &&
      !ctx.permissions.has('work_order.execute')
    ) {
      throw new ForbiddenError('maintenance_plan.generate_cycle');
    }
    const id = uuidParam(itemId, 'itemId');
    const r = await withTenant(this.db, ctx, async (s) =>
      executePlanItem(s, id, await membershipScope(s, ctx.membershipId))
    );
    return { work_order_id: r.workOrderId, created: r.created };
  }

  @Post('cycles/:cycleId/materialize')
  @RequirePermissions('maintenance_plan.generate_cycle')
  async materialize(
    @Req() req: AuroraRequest,
    @Param('cycleId') cycleId: string
  ): Promise<{ work_orders: number }> {
    const ctx = req.auroraContext!;
    const id = uuidParam(cycleId, 'cycleId');
    const n = await withTenant(this.db, ctx, (s) => materializeCycle(s, id));
    return { work_orders: n };
  }

  /**
   * Pula um item do ciclo, com motivo obrigatório.
   *
   * Pular sem motivo transforma o indicador de cumprimento numa medida do que
   * alguém teve vontade de fazer. Com motivo, "equipamento em comodato
   * devolvido" e "não deu tempo" são coisas distinguíveis — e é a distinção
   * que faz o número significar algo.
   */
  @Post('cycle-items/:itemId/skip')
  @RequirePermissions('maintenance_plan.skip_item')
  async skip(
    @Req() req: AuroraRequest,
    @Param('itemId') itemId: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const id = uuidParam(itemId, 'itemId');
    const motivo = text(body.reason);
    if (motivo === null || motivo.length < 5) {
      throw new ValidationError(
        'pular exige motivo — sem ele, o indicador de cumprimento vira uma medida de vontade',
        { field: 'reason' }
      );
    }
    await withTenant(this.db, ctx, (s) => skipCycleItem(s, id, motivo));
    return { ok: true };
  }
}
