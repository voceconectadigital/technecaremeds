/**
 * Aurora — planos de manutenção na camada de dados (SPEC v0.2 §12 · EPIC-013).
 */
import {
  newId,
  addFrequency,
  shouldOpenCycle,
  summarizeCompliance,
  complianceState,
  ValidationError,
  NotFoundError,
  ConflictError,
  type FrequencyUnit,
  type PlanTargetKind,
  type ItemFacts,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';
import { createWorkOrder, transitionWorkOrder } from './work-orders';

export interface PlanInput {
  name: string;
  customerId: string;
  description?: string;
  teamId?: string | null;
  autoGenerate?: boolean;
  includeLateAssets?: boolean;
  anchorDate: Date;
}

export async function createPlan(session: TenantSession, input: PlanInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.maintenance_plans
       (id, organization_id, name, description, customer_id, team_id, auto_generate,
        include_late_assets, anchor_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      session.context.organizationId,
      input.name,
      input.description ?? '',
      input.customerId,
      input.teamId ?? null,
      input.autoGenerate ?? true,
      input.includeLateAssets ?? false,
      input.anchorDate.toISOString().slice(0, 10),
      session.context.actorId,
    ]
  );
  return id;
}

export interface PlanTaskInput {
  planId: string;
  name: string;
  targetKind: PlanTargetKind;
  targetAssetId?: string | null;
  targetCategoryId?: string | null;
  targetLocationId?: string | null;
  workOrderTypeId: string;
  frequencyUnit: FrequencyUnit;
  frequencyInterval?: number;
  leadTimeDays?: number;
  toleranceDays?: number;
  checklistTemplateKey?: string | null;
  defaultTeamId?: string | null;
  estimatedDurationMin?: number | null;
}

/**
 * Acrescenta uma tarefa ao plano.
 *
 * Cada tarefa tem a sua frequência — é a correção nº 1. Preventiva semestral e
 * calibração anual do mesmo equipamento são duas tarefas do MESMO plano, e não
 * dois planos que alguém precisa lembrar de manter em sincronia.
 */
export async function addPlanTask(session: TenantSession, input: PlanTaskInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.plan_tasks
       (id, organization_id, plan_id, name, target_kind, target_asset_id, target_category_id,
        target_location_id, work_order_type_id, checklist_template_key, frequency_unit,
        frequency_interval, lead_time_days, tolerance_days, estimated_duration_min, default_team_id)
     VALUES ($1, $2, $3, $4, $5::aurora.plan_target_kind, $6, $7, $8, $9, $10,
             $11::aurora.frequency_unit, $12, $13, $14, $15, $16)`,
    [
      id,
      session.context.organizationId,
      input.planId,
      input.name,
      input.targetKind,
      input.targetAssetId ?? null,
      input.targetCategoryId ?? null,
      input.targetLocationId ?? null,
      input.workOrderTypeId,
      input.checklistTemplateKey ?? null,
      input.frequencyUnit,
      input.frequencyInterval ?? 1,
      input.leadTimeDays ?? 7,
      input.toleranceDays ?? 3,
      input.estimatedDurationMin ?? null,
      input.defaultTeamId ?? null,
    ]
  );
  return id;
}

/** Ativos que o alvo da tarefa alcança HOJE. */
export async function resolveTargetAssets(session: TenantSession, taskId: string): Promise<string[]> {
  const rows = await session.query<{ asset_id: string }>(
    `SELECT asset_id FROM aurora.resolve_plan_task_assets($1)`,
    [taskId]
  );
  return rows.map((r) => r.asset_id);
}

export interface CycleResult {
  cycleId: string;
  seq: number;
  startsAt: Date;
  endsAt: Date;
  items: number;
  workOrders: number;
}

/**
 * Abre o próximo ciclo de uma tarefa e, se o plano for automático, materializa
 * as ordens de serviço.
 *
 * A âncora do ciclo é o fim do anterior, nunca "hoje". Ancorar em hoje faria a
 * data escorregar a cada geração atrasada, e em dois anos a preventiva de
 * janeiro estaria acontecendo em março — sem que ninguém tivesse decidido isso.
 */
export async function generateCycle(
  session: TenantSession,
  taskId: string,
  now: Date = new Date()
): Promise<CycleResult | null> {
  const [task] = await session.query<{
    plan_id: string;
    name: string;
    frequency_unit: FrequencyUnit;
    frequency_interval: number;
    lead_time_days: number;
    work_order_type_id: string;
    default_team_id: string | null;
    auto_generate: boolean;
    is_active: boolean;
    anchor_date: string;
    customer_id: string;
    plan_name: string;
  }>(
    `SELECT t.plan_id, t.name, t.frequency_unit::text AS frequency_unit, t.frequency_interval,
            t.lead_time_days, t.work_order_type_id, t.default_team_id,
            p.auto_generate, p.is_active, p.anchor_date::text, p.customer_id, p.name AS plan_name
       FROM aurora.plan_tasks t
       JOIN aurora.maintenance_plans p ON p.id = t.plan_id
      WHERE t.id = $1 AND t.archived_at IS NULL AND p.archived_at IS NULL`,
    [taskId]
  );
  if (!task) throw new NotFoundError('Tarefa de plano', taskId);
  if (!task.is_active) return null;

  const [ultimo] = await session.query<{ seq: number; ends_at: string }>(
    `SELECT seq, ends_at FROM aurora.plan_cycles WHERE task_id = $1 ORDER BY seq DESC LIMIT 1`,
    [taskId]
  );

  const inicio = ultimo ? new Date(ultimo.ends_at) : new Date(`${task.anchor_date}T00:00:00Z`);
  const fim = addFrequency(inicio, task.frequency_unit, Number(task.frequency_interval));
  const seq = Number(ultimo?.seq ?? 0) + 1;

  if (!shouldOpenCycle(inicio, Number(task.lead_time_days), now)) return null;

  const ativos = await resolveTargetAssets(session, taskId);
  const cycleId = newId();

  await session.query(
    `INSERT INTO aurora.plan_cycles
       (id, organization_id, plan_id, task_id, seq, starts_at, ends_at, status, expected_count, opened_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, now())`,
    [
      cycleId,
      session.context.organizationId,
      task.plan_id,
      taskId,
      seq,
      inicio.toISOString(),
      fim.toISOString(),
      ativos.length,
    ]
  );

  let ordens = 0;
  for (const assetId of ativos) {
    const itemId = newId();
    // O vencimento é o fim da janela: a preventiva do ciclo precisa acontecer
    // dentro do ciclo, e é contra essa data que a tolerância é medida.
    await session.query(
      `INSERT INTO aurora.plan_cycle_items
         (id, organization_id, cycle_id, task_id, asset_id, due_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [itemId, session.context.organizationId, cycleId, taskId, assetId, fim.toISOString()]
    );

    if (task.auto_generate) {
      const [ativo] = await session.query<{ name: string; location_id: string | null }>(
        `SELECT name, location_id FROM aurora.assets WHERE id = $1`,
        [assetId]
      );
      const os = await createWorkOrder(session, {
        customerId: task.customer_id,
        workOrderTypeId: task.work_order_type_id,
        title: `${task.name} — ${ativo?.name ?? 'ativo'}`,
        description: `Gerada pelo plano "${task.plan_name}", ciclo ${seq}.`,
        assetId,
        locationId: ativo?.location_id ?? null,
        source: 'plan',
      });
      await session.query(
        `UPDATE aurora.plan_cycle_items SET status = 'generated', work_order_id = $2 WHERE id = $1`,
        [itemId, os.id]
      );
      ordens++;
    }
  }

  await emitEvent(session, {
    type: 'plan.cycle_started',
    aggregateId: task.plan_id,
    payload: { task_id: taskId, seq, expected: ativos.length, work_orders: ordens },
  });

  return { cycleId, seq, startsAt: inicio, endsAt: fim, items: ativos.length, workOrders: ordens };
}

/**
 * Materializa as OS de um ciclo criado sem geração automática.
 *
 * O plano manual cria apenas a previsão; o coordenador materializa em lote
 * quando quiser. É o que permite planejar o ano inteiro em janeiro sem encher a
 * fila de janeiro com o trabalho de dezembro.
 */
export async function materializeCycle(session: TenantSession, cycleId: string): Promise<number> {
  const pendentes = await session.query<{
    id: string;
    asset_id: string;
    task_name: string;
    work_order_type_id: string;
    customer_id: string;
    plan_name: string;
    seq: number;
  }>(
    `SELECT i.id, i.asset_id, t.name AS task_name, t.work_order_type_id,
            p.customer_id, p.name AS plan_name, c.seq
       FROM aurora.plan_cycle_items i
       JOIN aurora.plan_cycles c ON c.id = i.cycle_id
       JOIN aurora.plan_tasks t  ON t.id = i.task_id
       JOIN aurora.maintenance_plans p ON p.id = c.plan_id
      WHERE i.cycle_id = $1 AND i.status = 'pending'`,
    [cycleId]
  );

  let criadas = 0;
  for (const item of pendentes) {
    const [ativo] = await session.query<{ name: string; location_id: string | null }>(
      `SELECT name, location_id FROM aurora.assets WHERE id = $1`,
      [item.asset_id]
    );
    const os = await createWorkOrder(session, {
      customerId: item.customer_id,
      workOrderTypeId: item.work_order_type_id,
      title: `${item.task_name} — ${ativo?.name ?? 'ativo'}`,
      description: `Gerada pelo plano "${item.plan_name}", ciclo ${item.seq}.`,
      assetId: item.asset_id,
      locationId: ativo?.location_id ?? null,
      source: 'plan',
    });
    await session.query(
      `UPDATE aurora.plan_cycle_items SET status = 'generated', work_order_id = $2 WHERE id = $1`,
      [item.id, os.id]
    );
    criadas++;
  }
  return criadas;
}

/**
 * Dispensa um item do ciclo, com justificativa obrigatória.
 *
 * Um ativo emprestado a outro hospital não podia receber a preventiva, e
 * contá-lo como falha puniria a equipe por algo que ela não podia fazer. A
 * justificativa é o que impede a dispensa de virar a saída fácil para melhorar
 * o indicador: ela fica registrada, com autor e data.
 */
export async function skipCycleItem(session: TenantSession, itemId: string, reason: string): Promise<void> {
  if (reason.trim().length < 10) {
    throw new ValidationError('dispensar exige justificativa de ao menos 10 caracteres', {
      field: 'reason',
    });
  }
  const [item] = await session.query<{ work_order_id: string | null; status: string }>(
    `SELECT work_order_id, status::text FROM aurora.plan_cycle_items WHERE id = $1`,
    [itemId]
  );
  if (!item) throw new NotFoundError('Item de ciclo', itemId);
  if (item.status === 'done') {
    throw new ConflictError('item já concluído não é dispensável');
  }

  // A OS já materializada é cancelada junto: deixá-la aberta produziria
  // trabalho que ninguém vai executar e que ficaria atrasando o painel.
  if (item.work_order_id) {
    await transitionWorkOrder(session, item.work_order_id, 'cancelled', {
      cancellationReason: `Item do plano dispensado: ${reason.trim()}`,
    });
  }

  await session.query(
    `UPDATE aurora.plan_cycle_items
        SET status = 'skipped', skip_reason = $2, skipped_by = $3, skipped_at = now()
      WHERE id = $1`,
    [itemId, reason.trim(), session.context.actorId]
  );
}

/**
 * Cancela as OS de itens cujo ativo saiu do escopo.
 *
 * "Ativos descomissionados ou arquivados são excluídos da resolução do alvo. Se
 * já havia OS gerada, ela é cancelada automaticamente" (§12). Sem isto, a fila
 * do técnico teria preventivas de equipamentos que não existem mais.
 */
export async function pruneDecommissioned(session: TenantSession, cycleId: string): Promise<number> {
  const fora = await session.query<{ id: string; work_order_id: string | null; asset_name: string }>(
    `SELECT i.id, i.work_order_id, a.name AS asset_name
       FROM aurora.plan_cycle_items i
       JOIN aurora.assets a ON a.id = i.asset_id
      WHERE i.cycle_id = $1
        AND i.status IN ('pending', 'generated')
        AND (a.deleted_at IS NOT NULL OR a.status IN ('decommissioned', 'disposed'))`,
    [cycleId]
  );

  for (const item of fora) {
    if (item.work_order_id) {
      await transitionWorkOrder(session, item.work_order_id, 'cancelled', {
        cancellationReason: `Ativo descomissionado: ${item.asset_name}`,
      });
    }
    await session.query(
      `UPDATE aurora.plan_cycle_items
          SET status = 'skipped', skip_reason = 'Ativo descomissionado ou arquivado',
              skipped_at = now()
        WHERE id = $1`,
      [item.id]
    );
  }
  return fora.length;
}

/** Conformidade de um ciclo, com a taxa e o detalhe por item. */
export async function cycleCompliance(session: TenantSession, cycleId: string, now = new Date()) {
  const rows = await session.query<{
    id: string;
    due_at: string;
    status: string;
    tolerance_days: number;
    wo_category: string | null;
    asset_name: string;
  }>(
    `SELECT i.id, i.due_at, i.status::text AS status, t.tolerance_days,
            w.status_category::text AS wo_category, a.name AS asset_name
       FROM aurora.plan_cycle_items i
       JOIN aurora.plan_tasks t ON t.id = i.task_id
       JOIN aurora.assets a     ON a.id = i.asset_id
       LEFT JOIN aurora.work_orders w ON w.id = i.work_order_id
      WHERE i.cycle_id = $1
      ORDER BY a.name`,
    [cycleId]
  );

  const facts: ItemFacts[] = rows.map((r) => ({
    dueAt: r.due_at,
    toleranceDays: Number(r.tolerance_days),
    status: r.status as ItemFacts['status'],
    workOrderCategory: r.wo_category,
  }));

  return {
    summary: summarizeCompliance(facts, now),
    items: rows.map((r, i) => ({
      id: r.id,
      asset_name: r.asset_name,
      due_at: r.due_at,
      state: complianceState(facts[i]!, now),
    })),
  };
}

/**
 * Varredura: abre os ciclos que chegaram na antecedência.
 *
 * Roda no publicador, não numa requisição. Uma preventiva que só é gerada
 * quando alguém abre a tela é uma preventiva que depende de alguém abrir a
 * tela — e o valor inteiro do plano é justamente não depender disso.
 */
export async function sweepPlans(
  session: TenantSession,
  now: Date = new Date()
): Promise<{ cyclesOpened: number; workOrders: number }> {
  const tarefas = await session.query<{ id: string }>(
    `SELECT t.id
       FROM aurora.plan_tasks t
       JOIN aurora.maintenance_plans p ON p.id = t.plan_id
      WHERE t.archived_at IS NULL AND p.archived_at IS NULL
        AND p.is_active AND t.trigger = 'calendar'`
  );

  let cyclesOpened = 0;
  let workOrders = 0;
  for (const t of tarefas) {
    const r = await generateCycle(session, t.id, now);
    if (r) {
      cyclesOpened++;
      workOrders += r.workOrders;
    }
  }
  return { cyclesOpened, workOrders };
}
