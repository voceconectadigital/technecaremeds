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
  type Database,
} from '@aurora/db';
import { NotFoundError, ValidationError } from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { optionalUuid, text, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

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

    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
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
          ORDER BY p.name`,
        [customerId]
      )
    );
    return { items };
  }

  /** O plano, com as tarefas e o ciclo aberto de cada uma. */
  @Get(':id')
  @RequirePermissions('maintenance_plan.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    const planId = uuidParam(id, 'id');

    return withTenant(this.db, ctx, async (s) => {
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
      return s.query(
        `SELECT id, name, location_path FROM aurora.assets
          WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY name`,
        [ids]
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
