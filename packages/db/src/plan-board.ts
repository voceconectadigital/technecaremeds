/**
 * Aurora — planos de manutenção: criação orientada, painel e cronograma.
 *
 * O MOTOR É O DE SEMPRE (`maintenance-plans.ts`, migrations 0029/0055).
 *
 * Nada aqui cria segunda forma de plano, de tarefa ou de ciclo. A criação
 * orientada é `createPlan` + `addPlanTask` com as conferências que a tela não
 * pode fazer sozinha; o painel lê `plan_cycle_items` com a regra de
 * conformidade do domínio (`complianceState`, com tolerância); o cronograma
 * mostra os itens reais e PROJETA os ciclos futuros pela própria frequência da
 * tarefa — marcados como previstos, nunca gravados.
 *
 * O TIPO DO PLANO NÃO É COLUNA NOVA.
 *
 * Preventiva, calibração, TSE e qualificação já existem no domínio em dois
 * lugares: a natureza da OS (`work_order_type`, catálogo) e o tipo de
 * procedimento do checklist (`procedure_kind`, 0052). O tipo exibido é
 * derivado deles — `procedure_kind` do checklist da tarefa quando houver, a
 * natureza da OS quando não. Educação continuada NÃO existe no domínio e não é
 * oferecida (registrado em NOVAS-SOLICITACOES).
 */
import {
  addFrequency,
  complianceState,
  NotFoundError,
  ValidationError,
  type ComplianceState,
  type CycleItemStatus,
  type FrequencyUnit,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { addPlanTask, createPlan } from './maintenance-plans';
import { scopeSql } from './metrics';
import type { MembershipScope } from './painel';

/* -------------------------------------------------------------------------- */
/* tipo de plano                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Os tipos que o domínio suporta HOJE, e como cada um se apoia nele.
 *
 * `workOrderType`: a chave de sistema da natureza da OS gerada. Desde a 0064
 * (reunião 16/10/2026) TSE e qualificação têm natureza PRÓPRIA — o cliente as
 * listou como tipos. `fallback` cobre a organização que ainda só tem
 * `inspection`: o plano continua sendo criado, e o `procedure_kind` do
 * protocolo continua distinguindo os dois.
 */
export const PLAN_KINDS = {
  preventive: { workOrderType: 'preventive', procedureKind: null, fallback: null },
  calibration: { workOrderType: 'calibration', procedureKind: 'calibration', fallback: null },
  electrical_safety: {
    workOrderType: 'electrical_safety',
    procedureKind: 'electrical_safety',
    fallback: 'inspection',
  },
  qualification: { workOrderType: 'qualification', procedureKind: 'qualification', fallback: 'inspection' },
} as const;
export type PlanKind = keyof typeof PLAN_KINDS;

/** O tipo exibido de uma tarefa: o procedimento manda; sem ele, a natureza. */
const TIPO_DA_TAREFA_SQL = `COALESCE(
  (SELECT ct.procedure_kind::text FROM aurora.checklist_templates ct
    WHERE ct.key = t.checklist_template_key AND ct.status <> 'draft'
    ORDER BY ct.version DESC LIMIT 1),
  (SELECT ci.system_key FROM aurora.catalog_items ci WHERE ci.id = t.work_order_type_id),
  'other')`;

/* -------------------------------------------------------------------------- */
/* criação orientada                                                           */
/* -------------------------------------------------------------------------- */

export interface GuidedPlanInput {
  name: string;
  description?: string;
  customerId: string;
  sectorId: string;
  /** Vazio = TODOS os equipamentos do setor, como expressão (inclui os que chegarem). */
  assetIds: string[];
  kind: PlanKind;
  checklistTemplateKey: string | null;
  frequencyUnit: FrequencyUnit;
  frequencyInterval: number;
  anchorDate: Date;
  leadTimeDays: number;
  toleranceDays: number;
  autoGenerate: boolean;
  estimatedDurationMin?: number | null;
}

/**
 * Cria o plano a partir do fluxo Cliente → Setor → Equipamentos → Tipo →
 * Procedimento → Periodicidade.
 *
 * Toda conferência é feita AQUI, no servidor, contra o escopo do vínculo:
 * identificador de outro cliente, de outro setor ou fora do alcance de quem
 * cadastra é recusado com o campo nomeado. Identificador de outra organização
 * nem chega a ser visto (RLS) — vira "não encontrado".
 */
export async function createGuidedPlan(
  session: TenantSession,
  input: GuidedPlanInput,
  scope: MembershipScope
): Promise<{ planId: string; taskIds: string[] }> {
  const [cliente] = await session.query<{ id: string }>(
    `SELECT id FROM aurora.customers WHERE id = $1 AND deleted_at IS NULL
        AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
    [input.customerId, scope.customerIds]
  );
  if (!cliente) throw new NotFoundError('cliente', input.customerId);

  const [setor] = await session.query<{ id: string; path: string; customer_id: string; tipo: string }>(
    `SELECT l.id, l.path, l.customer_id, t.key AS tipo
       FROM aurora.locations l JOIN aurora.location_types t ON t.id = l.location_type_id
      WHERE l.id = $1 AND l.deleted_at IS NULL
        AND ${scopeSql('l.customer_id', 'l.path', 2)}`,
    [input.sectorId, scope.customerIds, scope.locationPaths]
  );
  if (!setor) throw new ValidationError('setor não encontrado', { field: 'sector_id' });
  if (setor.customer_id !== input.customerId) {
    throw new ValidationError('o setor pertence a outro cliente', { field: 'sector_id' });
  }

  const ativos: Array<{ id: string; name: string }> = [];
  if (input.assetIds.length > 0) {
    const unicos = [...new Set(input.assetIds)];
    const rows = await session.query<{
      id: string;
      name: string;
      customer_id: string;
      location_path: string;
      status: string;
    }>(
      `SELECT id, name, customer_id, location_path, status::text AS status
         FROM aurora.assets WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [unicos]
    );
    for (const id of unicos) {
      const a = rows.find((r) => r.id === id);
      if (!a) throw new ValidationError('equipamento não encontrado', { field: 'asset_ids', id });
      if (a.customer_id !== input.customerId) {
        throw new ValidationError('o equipamento pertence a outro cliente', { field: 'asset_ids', id });
      }
      if (!a.location_path.startsWith(setor.path)) {
        throw new ValidationError('o equipamento não está no setor escolhido', { field: 'asset_ids', id });
      }
      if (a.status === 'decommissioned' || a.status === 'disposed') {
        throw new ValidationError('equipamento baixado não entra em plano', { field: 'asset_ids', id });
      }
      ativos.push({ id: a.id, name: a.name });
    }
  }

  const tipo = PLAN_KINDS[input.kind];
  const [natureza] = await session.query<{ id: string }>(
    `SELECT id FROM aurora.catalog_items
      WHERE catalog_key = 'work_order_type' AND archived_at IS NULL
        AND (system_key = $1 OR system_key = $2)
      ORDER BY (system_key = $1) DESC, position LIMIT 1`,
    [tipo.workOrderType, tipo.fallback]
  );
  if (!natureza) {
    throw new ValidationError(
      `a natureza de OS "${tipo.workOrderType}" não está no catálogo desta organização`,
      { field: 'kind' }
    );
  }

  if (input.checklistTemplateKey) {
    const [modelo] = await session.query<{ procedure_kind: string | null }>(
      `SELECT procedure_kind::text AS procedure_kind FROM aurora.checklist_templates
        WHERE key = $1 AND status = 'published' ORDER BY version DESC LIMIT 1`,
      [input.checklistTemplateKey]
    );
    if (!modelo) {
      throw new ValidationError('o checklist escolhido não tem versão publicada', {
        field: 'checklist_template_key',
      });
    }
    if ((modelo.procedure_kind ?? null) !== tipo.procedureKind) {
      throw new ValidationError('o procedimento escolhido é de outro tipo de plano', {
        field: 'checklist_template_key',
      });
    }
  }

  const planId = await createPlan(session, {
    name: input.name,
    description: input.description ?? '',
    customerId: input.customerId,
    autoGenerate: input.autoGenerate,
    anchorDate: input.anchorDate,
  });

  const comum = {
    planId,
    workOrderTypeId: natureza.id,
    frequencyUnit: input.frequencyUnit,
    frequencyInterval: input.frequencyInterval,
    leadTimeDays: input.leadTimeDays,
    toleranceDays: input.toleranceDays,
    checklistTemplateKey: input.checklistTemplateKey,
    estimatedDurationMin: input.estimatedDurationMin ?? null,
  };
  const taskIds: string[] = [];
  if (ativos.length === 0) {
    taskIds.push(
      await addPlanTask(session, {
        ...comum,
        name: input.name,
        targetKind: 'location_subtree',
        targetLocationId: setor.id,
      })
    );
  } else {
    for (const a of ativos) {
      taskIds.push(
        await addPlanTask(session, {
          ...comum,
          name: `${input.name} — ${a.name}`,
          targetKind: 'asset',
          targetAssetId: a.id,
        })
      );
    }
  }
  return { planId, taskIds };
}

/* -------------------------------------------------------------------------- */
/* painel dos planos                                                           */
/* -------------------------------------------------------------------------- */

export type BoardState = 'done' | 'pending' | 'late' | 'skipped';

/** As seis situações do domínio, dobradas nas quatro que o painel desenha. */
export function boardState(s: ComplianceState): BoardState {
  if (s === 'done') return 'done';
  if (s === 'skipped') return 'skipped';
  if (s === 'late_started' || s === 'late_not_started') return 'late';
  return 'pending';
}

export interface PlanBoardFilters {
  from: Date;
  to: Date;
  customerId?: string | null;
  sectorId?: string | null;
}

interface ItemRow {
  id: string;
  due_at: Date;
  status: CycleItemStatus;
  tolerance_days: number;
  wo_category: string | null;
  work_order_id: string | null;
  work_order_number: string | null;
  plan_id: string;
  plan_name: string;
  task_id: string;
  task_name: string;
  kind: string;
  customer_id: string;
  customer_name: string;
  asset_id: string;
  asset_name: string;
  sector_id: string | null;
  sector_name: string | null;
}

async function sectorPath(
  session: TenantSession,
  sectorId: string | null | undefined
): Promise<string | null> {
  if (!sectorId) return null;
  const [s] = await session.query<{ path: string }>(
    `SELECT path FROM aurora.locations WHERE id = $1 AND deleted_at IS NULL`,
    [sectorId]
  );
  if (!s) throw new NotFoundError('setor', sectorId);
  return s.path;
}

/** Itens reais (gerados) com vencimento no período, já recortados pelo escopo. */
async function realItems(
  session: TenantSession,
  f: PlanBoardFilters,
  scope: MembershipScope,
  limit = 5000
): Promise<ItemRow[]> {
  const caminho = await sectorPath(session, f.sectorId);
  return session.query<ItemRow>(
    `SELECT i.id, i.due_at, i.status::text AS status, t.tolerance_days,
            st.category::text AS wo_category, i.work_order_id, w.number AS work_order_number,
            p.id AS plan_id, p.name AS plan_name, t.id AS task_id, t.name AS task_name,
            ${TIPO_DA_TAREFA_SQL} AS kind,
            c.id AS customer_id, c.name AS customer_name,
            a.id AS asset_id, a.name AS asset_name,
            se.id AS sector_id, se.name AS sector_name
       FROM aurora.plan_cycle_items i
       JOIN aurora.plan_tasks t ON t.id = i.task_id
       JOIN aurora.maintenance_plans p ON p.id = t.plan_id
       JOIN aurora.customers c ON c.id = p.customer_id
       JOIN aurora.assets a ON a.id = i.asset_id
       LEFT JOIN aurora.work_orders w ON w.id = i.work_order_id
       LEFT JOIN aurora.work_order_statuses st ON st.id = w.status_id
       LEFT JOIN LATERAL (
         SELECT s.id, s.name FROM aurora.locations s
           JOIN aurora.location_types lt ON lt.id = s.location_type_id AND lt.key = 'setor'
          WHERE a.location_path LIKE s.path || '%' AND s.deleted_at IS NULL
          ORDER BY s.depth DESC LIMIT 1
       ) se ON true
      WHERE p.archived_at IS NULL
        AND i.due_at >= $1 AND i.due_at < $2
        AND ($3::uuid IS NULL OR p.customer_id = $3)
        AND ($4::text IS NULL OR a.location_path LIKE $4 || '%')
        AND ${scopeSql('a.customer_id', 'a.location_path', 5)}
      ORDER BY i.due_at, a.name
      LIMIT ${limit}`,
    [f.from, f.to, f.customerId ?? null, caminho, scope.customerIds, scope.locationPaths]
  );
}

export interface PlanBoard {
  totals: Record<BoardState, number> & { scheduled: number };
  rate: number | null;
  byKind: Array<{ key: string } & Record<BoardState, number>>;
  byCustomer: Array<{ key: string; label: string } & Record<BoardState, number>>;
  bySector: Array<{ key: string; label: string } & Record<BoardState, number>>;
  byMonth: Array<{ key: string } & Record<BoardState, number>>;
  plans: { active: number; tasks: number };
}

function vazio(): Record<BoardState, number> {
  return { done: 0, pending: 0, late: 0, skipped: 0 };
}

/**
 * Programados, realizados, pendentes, vencidos e dispensados no período.
 *
 * "Programado" é o item que EXISTE (ciclo aberto). O que ainda não foi gerado
 * não entra aqui — é previsão, e aparece só no cronograma, marcado como tal.
 * A taxa é a mesma do indicador de conformidade: feitos ÷ (programados −
 * dispensados).
 */
export async function planBoard(
  session: TenantSession,
  f: PlanBoardFilters,
  scope: MembershipScope,
  now = new Date()
): Promise<PlanBoard> {
  const itens = await realItems(session, f, scope);
  const totals = { ...vazio(), scheduled: itens.length };
  const porTipo = new Map<string, Record<BoardState, number>>();
  const porCliente = new Map<string, { label: string; v: Record<BoardState, number> }>();
  const porSetor = new Map<string, { label: string; v: Record<BoardState, number> }>();
  const porMes = new Map<string, Record<BoardState, number>>();

  for (const i of itens) {
    const estado = boardState(
      complianceState(
        {
          dueAt: new Date(i.due_at).toISOString(),
          toleranceDays: Number(i.tolerance_days),
          status: i.status,
          workOrderCategory: i.wo_category,
        },
        now
      )
    );
    totals[estado]++;
    const t = porTipo.get(i.kind) ?? vazio();
    t[estado]++;
    porTipo.set(i.kind, t);
    const c = porCliente.get(i.customer_id) ?? { label: i.customer_name, v: vazio() };
    c.v[estado]++;
    porCliente.set(i.customer_id, c);
    const sk = i.sector_id ?? 'sem-setor';
    const s = porSetor.get(sk) ?? { label: i.sector_name ?? 'Sem setor', v: vazio() };
    s.v[estado]++;
    porSetor.set(sk, s);
    const mes = new Date(i.due_at).toISOString().slice(0, 7);
    const m = porMes.get(mes) ?? vazio();
    m[estado]++;
    porMes.set(mes, m);
  }

  const [contagem] = await session.query<{ planos: string; tarefas: string }>(
    `SELECT count(DISTINCT p.id)::text AS planos, count(t.id)::text AS tarefas
       FROM aurora.maintenance_plans p
       LEFT JOIN aurora.plan_tasks t ON t.plan_id = p.id AND t.archived_at IS NULL
      WHERE p.archived_at IS NULL AND p.is_active
        AND ($1::uuid IS NULL OR p.customer_id = $1)
        AND ($2::uuid[] IS NULL OR p.customer_id = ANY($2::uuid[]))`,
    [f.customerId ?? null, scope.customerIds]
  );

  const denominador = totals.scheduled - totals.skipped;
  return {
    totals,
    rate: denominador > 0 ? Number(((totals.done / denominador) * 100).toFixed(1)) : null,
    byKind: [...porTipo.entries()].map(([key, v]) => ({ key, ...v })),
    byCustomer: [...porCliente.entries()].map(([key, x]) => ({ key, label: x.label, ...x.v })),
    bySector: [...porSetor.entries()].map(([key, x]) => ({ key, label: x.label, ...x.v })),
    byMonth: [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({ key, ...v })),
    plans: { active: Number(contagem?.planos ?? 0), tasks: Number(contagem?.tarefas ?? 0) },
  };
}

/* -------------------------------------------------------------------------- */
/* cronograma                                                                  */
/* -------------------------------------------------------------------------- */

export interface ScheduleEntry {
  /** Nulo nos previstos: não existem no banco ainda. */
  id: string | null;
  projected: boolean;
  due_at: string;
  state: BoardState | 'planned';
  plan_id: string;
  plan_name: string;
  task_name: string;
  kind: string;
  customer_id: string;
  customer_name: string;
  sector_name: string | null;
  asset_id: string;
  asset_name: string;
  work_order_id: string | null;
  work_order_number: string | null;
}

/** Teto de previstos por resposta: um plano diário de 300 ativos num ano são 100 mil linhas. */
const MAX_PREVISTOS = 1500;

/**
 * Itens reais do período + ciclos FUTUROS projetados pela frequência da tarefa.
 *
 * A projeção usa a mesma conta da geração (`addFrequency` a partir do fim do
 * último ciclo, ou da âncora) e os ativos que o alvo alcança HOJE. É previsão:
 * um ativo que chegar ou sair muda a lista, e por isso vem marcada.
 */
export async function planSchedule(
  session: TenantSession,
  f: PlanBoardFilters,
  scope: MembershipScope,
  now = new Date()
): Promise<{ items: ScheduleEntry[]; truncated: boolean }> {
  const reais = await realItems(session, f, scope, 2000);
  const items: ScheduleEntry[] = reais.map((i) => ({
    id: i.id,
    projected: false,
    due_at: new Date(i.due_at).toISOString(),
    state: boardState(
      complianceState(
        {
          dueAt: new Date(i.due_at).toISOString(),
          toleranceDays: Number(i.tolerance_days),
          status: i.status,
          workOrderCategory: i.wo_category,
        },
        now
      )
    ),
    plan_id: i.plan_id,
    plan_name: i.plan_name,
    task_name: i.task_name,
    kind: i.kind,
    customer_id: i.customer_id,
    customer_name: i.customer_name,
    sector_name: i.sector_name,
    asset_id: i.asset_id,
    asset_name: i.asset_name,
    work_order_id: i.work_order_id,
    work_order_number: i.work_order_number,
  }));

  const caminho = await sectorPath(session, f.sectorId);
  const tarefas = await session.query<{
    id: string;
    name: string;
    frequency_unit: FrequencyUnit;
    frequency_interval: number;
    anchor_date: string;
    last_end: Date | null;
    plan_id: string;
    plan_name: string;
    customer_id: string;
    customer_name: string;
    kind: string;
  }>(
    `SELECT t.id, t.name, t.frequency_unit::text AS frequency_unit, t.frequency_interval,
            p.anchor_date::text AS anchor_date,
            (SELECT max(c.ends_at) FROM aurora.plan_cycles c WHERE c.task_id = t.id) AS last_end,
            p.id AS plan_id, p.name AS plan_name, c.id AS customer_id, c.name AS customer_name,
            ${TIPO_DA_TAREFA_SQL} AS kind
       FROM aurora.plan_tasks t
       JOIN aurora.maintenance_plans p ON p.id = t.plan_id
       JOIN aurora.customers c ON c.id = p.customer_id
      WHERE t.archived_at IS NULL AND p.archived_at IS NULL AND p.is_active
        AND t.trigger = 'calendar'
        AND ($1::uuid IS NULL OR p.customer_id = $1)
        AND ($2::uuid[] IS NULL OR p.customer_id = ANY($2::uuid[]))`,
    [f.customerId ?? null, scope.customerIds]
  );

  let previstos = 0;
  let truncated = false;
  for (const t of tarefas) {
    if (truncated) break;
    const alvos = await session.query<{
      id: string;
      name: string;
      location_path: string;
      customer_id: string;
      sector_name: string | null;
    }>(
      `SELECT a.id, a.name, a.location_path, a.customer_id,
              (SELECT s.name FROM aurora.locations s
                 JOIN aurora.location_types lt ON lt.id = s.location_type_id AND lt.key = 'setor'
                WHERE a.location_path LIKE s.path || '%' AND s.deleted_at IS NULL
                ORDER BY s.depth DESC LIMIT 1) AS sector_name
         FROM aurora.resolve_plan_task_assets($1) r
         JOIN aurora.assets a ON a.id = r.asset_id
        WHERE ($2::text IS NULL OR a.location_path LIKE $2 || '%')
          AND ${scopeSql('a.customer_id', 'a.location_path', 3)}
        ORDER BY a.name`,
      [t.id, caminho, scope.customerIds, scope.locationPaths]
    );
    if (alvos.length === 0) continue;

    // Ciclos que ainda NÃO existem: começam no fim do último gerado.
    let inicio = t.last_end ? new Date(t.last_end) : new Date(`${t.anchor_date}T00:00:00Z`);
    for (let guarda = 0; guarda < 400; guarda++) {
      const fim = addFrequency(inicio, t.frequency_unit, Number(t.frequency_interval));
      if (fim.getTime() >= f.to.getTime()) break;
      if (fim.getTime() >= f.from.getTime()) {
        for (const a of alvos) {
          if (previstos >= MAX_PREVISTOS) {
            truncated = true;
            break;
          }
          previstos++;
          items.push({
            id: null,
            projected: true,
            due_at: fim.toISOString(),
            state: 'planned',
            plan_id: t.plan_id,
            plan_name: t.plan_name,
            task_name: t.name,
            kind: t.kind,
            customer_id: t.customer_id,
            customer_name: t.customer_name,
            sector_name: a.sector_name,
            asset_id: a.id,
            asset_name: a.name,
            work_order_id: null,
            work_order_number: null,
          });
        }
      }
      if (truncated) break;
      inicio = fim;
    }
  }

  items.sort((a, b) => a.due_at.localeCompare(b.due_at) || a.asset_name.localeCompare(b.asset_name));
  return { items, truncated };
}
