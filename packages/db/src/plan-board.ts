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
import { addPlanTask, createPlan, materializeCycle } from './maintenance-plans';
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
  /**
   * Procedimentos que vão JUNTO na mesma OS (OS-15): preventiva + TSE no mesmo
   * atendimento, por exemplo. Cada um precisa ter versão publicada; o tipo é
   * livre — a combinação existe justamente para juntar tipos diferentes.
   */
  extraChecklistTemplateKeys?: string[];
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

  const extras = [...new Set(input.extraChecklistTemplateKeys ?? [])].filter(
    (k) => k !== input.checklistTemplateKey
  );
  for (const chave of extras) {
    const [publicado] = await session.query<{ id: string }>(
      `SELECT id FROM aurora.checklist_templates WHERE key = $1 AND status = 'published' LIMIT 1`,
      [chave]
    );
    if (!publicado) {
      throw new ValidationError('um dos procedimentos adicionais não tem versão publicada', {
        field: 'extra_checklist_template_keys',
        key: chave,
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
    extraChecklistTemplateKeys: extras,
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
  /**
   * VÁRIOS setores ao mesmo tempo (PLN-11): o item entra se o equipamento está
   * em QUALQUER um deles. Somado a `sectorId` quando os dois vêm. Cada setor é
   * conferido contra o escopo de quem pergunta — fora dele é 404, e não um
   * quadro vazio que confirmaria que o setor existe.
   */
  sectorIds?: readonly string[] | null;
  /** Tipo (preventiva, calibração, TSE, qualificação) — combinável com cliente e setor. */
  kind?: string | null;
  /**
   * Categoria do equipamento. O relatório e o Painel recebiam o filtro e o
   * quadro o ignorava (pente-fino 17/10/2026, PF-53).
   */
  assetCategoryId?: string | null;
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
  procedure_key: string | null;
  procedure_title: string | null;
}

/**
 * Os caminhos dos setores pedidos, ou nulo quando nenhum foi pedido.
 *
 * Setor de outra organização some pela RLS; setor de cliente ou local fora do
 * escopo do vínculo também é "não encontrado" — e não um filtro que zera o
 * quadro, que diria que o setor existe e só não tem atividade.
 */
export async function sectorPaths(
  session: TenantSession,
  f: Pick<PlanBoardFilters, 'sectorId' | 'sectorIds'>,
  scope: MembershipScope
): Promise<string[] | null> {
  const ids = [...new Set([...(f.sectorId ? [f.sectorId] : []), ...(f.sectorIds ?? [])])];
  if (ids.length === 0) return null;
  const rows = await session.query<{ id: string; path: string; customer_id: string }>(
    `SELECT id, path, customer_id FROM aurora.locations WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [ids]
  );
  for (const id of ids) {
    const s = rows.find((r) => r.id === id);
    const noEscopo =
      s !== undefined &&
      (scope.customerIds === null || scope.customerIds.includes(s.customer_id)) &&
      (scope.locationPaths === null ||
        scope.locationPaths.some((p) => s.path.startsWith(p) || p.startsWith(s.path)));
    if (!noEscopo) throw new NotFoundError('setor', id);
  }
  return rows.map((r) => r.path);
}

/** Condição "o caminho está em algum dos setores" — `$n` é `text[]` ou nulo. */
const EM_ALGUM_SETOR = (col: string, n: number) =>
  `($${n}::text[] IS NULL OR EXISTS (SELECT 1 FROM unnest($${n}::text[]) AS setor(p) WHERE ${col} LIKE setor.p || '%'))`;

/** Itens reais (gerados) com vencimento no período, já recortados pelo escopo. */
async function realItems(
  session: TenantSession,
  f: PlanBoardFilters,
  scope: MembershipScope,
  limit = 5000
): Promise<ItemRow[]> {
  const caminho = await sectorPaths(session, f, scope);
  return session.query<ItemRow>(
    `SELECT i.id, i.due_at, i.status::text AS status, t.tolerance_days,
            st.category::text AS wo_category, i.work_order_id, w.number AS work_order_number,
            p.id AS plan_id, p.name AS plan_name, t.id AS task_id, t.name AS task_name,
            ${TIPO_DA_TAREFA_SQL} AS kind,
            c.id AS customer_id, c.name AS customer_name,
            a.id AS asset_id, a.name AS asset_name,
            se.id AS sector_id, se.name AS sector_name,
            t.checklist_template_key AS procedure_key,
            (SELECT ct.title FROM aurora.checklist_templates ct
              WHERE ct.key = t.checklist_template_key
              ORDER BY ct.version DESC LIMIT 1) AS procedure_title
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
        AND ${EM_ALGUM_SETOR('a.location_path', 4)}
        AND ${scopeSql('a.customer_id', 'a.location_path', 5)}
        AND ($7::text IS NULL OR ${TIPO_DA_TAREFA_SQL} = $7)
        AND ($8::uuid IS NULL OR a.asset_category_id = $8)
      ORDER BY i.due_at, a.name
      LIMIT ${limit}`,
    [
      f.from,
      f.to,
      f.customerId ?? null,
      caminho,
      scope.customerIds,
      scope.locationPaths,
      f.kind ?? null,
      f.assetCategoryId ?? null,
    ]
  );
}

/** Uma fatia do quadro, com a taxa de conformidade DELA (PLN-10). */
type Fatia = Record<BoardState, number> & { rate: number | null };

export interface PlanBoard {
  totals: Record<BoardState, number> & { scheduled: number };
  rate: number | null;
  byKind: Array<{ key: string } & Fatia>;
  byCustomer: Array<{ key: string; label: string } & Fatia>;
  bySector: Array<{ key: string; label: string } & Fatia>;
  byMonth: Array<{ key: string } & Fatia>;
  /** Por plano e por procedimento (reunião 16/10/2026) — dos mesmos itens reais. */
  byPlan: Array<{ key: string; label: string } & Fatia>;
  byProcedure: Array<{ key: string; label: string } & Fatia>;
  plans: { active: number; tasks: number };
}

function vazio(): Record<BoardState, number> {
  return { done: 0, pending: 0, late: 0, skipped: 0 };
}

/**
 * A taxa de conformidade de qualquer fatia: realizados ÷ (programados −
 * dispensados), em %, uma casa. É a MESMA conta do indicador e da taxa global
 * — programados são todos os itens da fatia (feitos + pendentes + vencidos +
 * dispensados); dispensado com justificativa sai do denominador. Sem
 * denominador é NULO, e não zero: zero diria "nada foi cumprido".
 */
export function complianceRate(v: Record<BoardState, number>): number | null {
  const denominador = v.done + v.pending + v.late;
  return denominador > 0 ? Number(((v.done / denominador) * 100).toFixed(1)) : null;
}

const comTaxa = <T extends Record<BoardState, number>>(v: T): T & { rate: number | null } => ({
  ...v,
  rate: complianceRate(v),
});

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
  const porPlano = new Map<string, { label: string; v: Record<BoardState, number> }>();
  const porProcedimento = new Map<string, { label: string; v: Record<BoardState, number> }>();

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
    const pl = porPlano.get(i.plan_id) ?? { label: i.plan_name, v: vazio() };
    pl.v[estado]++;
    porPlano.set(i.plan_id, pl);
    const pk = i.procedure_key ?? 'sem-procedimento';
    const pr = porProcedimento.get(pk) ?? { label: i.procedure_title ?? 'Sem procedimento', v: vazio() };
    pr.v[estado]++;
    porProcedimento.set(pk, pr);
  }

  const plans = await activePlanCount(session, f, scope);

  const denominador = totals.scheduled - totals.skipped;
  return {
    totals,
    rate: denominador > 0 ? Number(((totals.done / denominador) * 100).toFixed(1)) : null,
    byKind: [...porTipo.entries()].map(([key, v]) => comTaxa({ key, ...v })),
    byCustomer: [...porCliente.entries()].map(([key, x]) => comTaxa({ key, label: x.label, ...x.v })),
    bySector: [...porSetor.entries()].map(([key, x]) => comTaxa({ key, label: x.label, ...x.v })),
    byMonth: [...porMes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => comTaxa({ key, ...v })),
    byPlan: [...porPlano.entries()].map(([key, x]) => comTaxa({ key, label: x.label, ...x.v })),
    byProcedure: [...porProcedimento.entries()].map(([key, x]) => comTaxa({ key, label: x.label, ...x.v })),
    plans,
  };
}

/**
 * "Planos ativos" (PLN-02): PLANOS distintos — não programações nem execuções
 * do período —, ativos, não arquivados, com os MESMOS recortes do quadro.
 *
 * Um plano conta quando tem ao menos uma tarefa que passa no filtro: do tipo
 * pedido e, quando há setor ou categoria, cujo alvo alcança HOJE algum
 * equipamento daquele setor/categoria dentro do escopo. `tasks` conta essas
 * tarefas. Sem filtro de equipamento, o recorte é o do cliente (como antes).
 */
export async function activePlanCount(
  session: TenantSession,
  f: PlanBoardFilters,
  scope: MembershipScope
): Promise<{ active: number; tasks: number }> {
  const caminhos = await sectorPaths(session, f, scope);
  const porEquipamento = caminhos !== null || Boolean(f.assetCategoryId);
  const [contagem] = await session.query<{ planos: string; tarefas: string }>(
    `SELECT count(DISTINCT p.id)::text AS planos, count(t.id)::text AS tarefas
       FROM aurora.maintenance_plans p
       LEFT JOIN aurora.plan_tasks t
              ON t.plan_id = p.id AND t.archived_at IS NULL
             AND ($3::text IS NULL OR ${TIPO_DA_TAREFA_SQL} = $3)
             AND (NOT $4::boolean OR EXISTS (
                   SELECT 1 FROM aurora.resolve_plan_task_assets(t.id) r
                     JOIN aurora.assets a ON a.id = r.asset_id
                    WHERE ${EM_ALGUM_SETOR('a.location_path', 5)}
                      AND ($6::uuid IS NULL OR a.asset_category_id = $6)
                      AND ${scopeSql('a.customer_id', 'a.location_path', 7)}))
      WHERE p.archived_at IS NULL AND p.is_active
        AND ($1::uuid IS NULL OR p.customer_id = $1)
        AND ($2::uuid[] IS NULL OR p.customer_id = ANY($2::uuid[]))
        -- Sem recorte de tipo nem de equipamento, o plano sem tarefa ainda é um
        -- plano ativo (e a lista avisa "sem tarefa"); com recorte, só conta o
        -- plano que tem tarefa dentro dele.
        AND (($3::text IS NULL AND NOT $4::boolean) OR t.id IS NOT NULL)`,
    [
      f.customerId ?? null,
      scope.customerIds,
      f.kind ?? null,
      porEquipamento,
      caminhos,
      f.assetCategoryId ?? null,
      scope.customerIds,
      scope.locationPaths,
    ]
  );
  return { active: Number(contagem?.planos ?? 0), tasks: Number(contagem?.tarefas ?? 0) };
}

/* -------------------------------------------------------------------------- */
/* relatório de conformidade (REL-12)                                          */
/* -------------------------------------------------------------------------- */

export const COMPLIANCE_DEFINITION = {
  numerator: 'Realizados: itens de ciclo com vencimento no período cuja OS foi concluída/validada.',
  denominator:
    'Programados − dispensados: todos os itens de ciclo com vencimento no período (realizados, ' +
    'pendentes e vencidos), menos os dispensados com justificativa. O que ainda não foi gerado ' +
    '(previsto) não entra.',
  formula: 'Conformidade = realizados ÷ (programados − dispensados) × 100',
} as const;

export interface ComplianceRankRow {
  position: number;
  key: string;
  label: string;
  scheduled: number;
  done: number;
  pending: number;
  late: number;
  skipped: number;
  denominator: number;
  rate: number | null;
}

/**
 * Ordena pela CONFORMIDADE, e não pelo volume: a maior taxa primeiro; empate,
 * o maior denominador (mais atividades sustentando a mesma taxa); depois o
 * nome. Fatia sem denominador (tudo dispensado) vai para o fim, sem posição
 * inventada.
 */
export function rankByCompliance(
  linhas: ReadonlyArray<{ key: string; label: string } & Record<BoardState, number>>
): ComplianceRankRow[] {
  const comConta = linhas.map((l) => {
    const denominator = l.done + l.pending + l.late;
    return {
      key: l.key,
      label: l.label,
      scheduled: denominator + l.skipped,
      done: l.done,
      pending: l.pending,
      late: l.late,
      skipped: l.skipped,
      denominator,
      rate: complianceRate(l),
    };
  });
  comConta.sort((a, b) => {
    if (a.rate === null && b.rate === null) return a.label.localeCompare(b.label, 'pt-BR');
    if (a.rate === null) return 1;
    if (b.rate === null) return -1;
    return b.rate - a.rate || b.denominator - a.denominator || a.label.localeCompare(b.label, 'pt-BR');
  });
  return comConta.map((l, i) => ({ position: i + 1, ...l }));
}

export interface ComplianceReport {
  definition: typeof COMPLIANCE_DEFINITION;
  totals: Record<BoardState, number> & { scheduled: number; denominator: number };
  rate: number | null;
  byPlan: ComplianceRankRow[];
  byCustomer: ComplianceRankRow[];
  bySector: ComplianceRankRow[];
}

/** O relatório de conformidade: o quadro, ranqueado por taxa, com a definição escrita. */
export async function planComplianceReport(
  session: TenantSession,
  f: PlanBoardFilters,
  scope: MembershipScope,
  now = new Date()
): Promise<ComplianceReport> {
  const b = await planBoard(session, f, scope, now);
  return {
    definition: COMPLIANCE_DEFINITION,
    totals: { ...b.totals, denominator: b.totals.scheduled - b.totals.skipped },
    rate: b.rate,
    byPlan: rankByCompliance(b.byPlan),
    byCustomer: rankByCompliance(b.byCustomer),
    bySector: rankByCompliance(b.bySector),
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
  work_order_category?: string | null;
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
    work_order_category: i.wo_category,
    sector_name: i.sector_name,
    asset_id: i.asset_id,
    asset_name: i.asset_name,
    work_order_id: i.work_order_id,
    work_order_number: i.work_order_number,
  }));

  const caminho = await sectorPaths(session, f, scope);
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
        WHERE ${EM_ALGUM_SETOR('a.location_path', 2)}
          AND ${scopeSql('a.customer_id', 'a.location_path', 3)}
          AND ($5::uuid IS NULL OR a.asset_category_id = $5)
        ORDER BY a.name`,
      [t.id, caminho, scope.customerIds, scope.locationPaths, f.assetCategoryId ?? null]
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
  // Os previstos também respeitam o tipo escolhido (os reais já vêm filtrados na consulta).
  return { items: f.kind ? items.filter((x) => x.kind === f.kind) : items, truncated };
}

/* -------------------------------------------------------------------------- */
/* ▶ Executar um item do plano (reunião 16/10/2026, Fase 6)                    */
/* -------------------------------------------------------------------------- */

export interface EligibleItem {
  id: string;
  due_at: string;
  state: BoardState;
  task_id: string;
  task_name: string;
  asset_id: string;
  asset_name: string;
  sector_name: string | null;
  work_order_id: string | null;
  work_order_number: string | null;
}

/**
 * ▶ Play (PLN-09): os equipamentos ELEGÍVEIS de um plano — itens de ciclo
 * ainda em aberto (pendentes ou com OS gerada e não encerrada), dentro do
 * escopo de quem pergunta. Dispensado, realizado ou com OS encerrada não
 * aparece: não há o que executar. O passo seguinte do assistente é o mesmo
 * `executePlanItem` do botão da linha do cronograma.
 */
export async function planEligibleItems(
  session: TenantSession,
  planId: string,
  scope: MembershipScope,
  now = new Date()
): Promise<EligibleItem[]> {
  const [plano] = await session.query<{ customer_id: string }>(
    `SELECT customer_id FROM aurora.maintenance_plans WHERE id = $1 AND archived_at IS NULL`,
    [planId]
  );
  if (!plano || (scope.customerIds !== null && !scope.customerIds.includes(plano.customer_id))) {
    throw new NotFoundError('Plano de manutenção', planId);
  }
  const rows = await session.query<{
    id: string;
    due_at: Date;
    status: CycleItemStatus;
    tolerance_days: number;
    wo_category: string | null;
    task_id: string;
    task_name: string;
    asset_id: string;
    asset_name: string;
    sector_name: string | null;
    work_order_id: string | null;
    work_order_number: string | null;
  }>(
    `SELECT i.id, i.due_at, i.status::text AS status, t.tolerance_days,
            w.status_category::text AS wo_category,
            t.id AS task_id, t.name AS task_name, a.id AS asset_id, a.name AS asset_name,
            (SELECT s.name FROM aurora.locations s
               JOIN aurora.location_types lt ON lt.id = s.location_type_id AND lt.key = 'setor'
              WHERE a.location_path LIKE s.path || '%' AND s.deleted_at IS NULL
              ORDER BY s.depth DESC LIMIT 1) AS sector_name,
            i.work_order_id, w.number AS work_order_number
       FROM aurora.plan_cycle_items i
       JOIN aurora.plan_tasks t ON t.id = i.task_id AND t.archived_at IS NULL
       JOIN aurora.assets a ON a.id = i.asset_id AND a.deleted_at IS NULL
       LEFT JOIN aurora.work_orders w ON w.id = i.work_order_id
      WHERE t.plan_id = $1
        AND i.status IN ('pending', 'generated', 'overdue')
        AND (w.id IS NULL OR w.status_category NOT IN ('done', 'closed', 'cancelled'))
        AND ${scopeSql('a.customer_id', 'a.location_path', 2)}
      ORDER BY i.due_at, a.name
      LIMIT 500`,
    [planId, scope.customerIds, scope.locationPaths]
  );
  return rows.map((r) => ({
    id: r.id,
    due_at: new Date(r.due_at).toISOString(),
    state: boardState(
      complianceState(
        {
          dueAt: new Date(r.due_at).toISOString(),
          toleranceDays: Number(r.tolerance_days),
          status: r.status,
          workOrderCategory: r.wo_category,
        },
        now
      )
    ),
    task_id: r.task_id,
    task_name: r.task_name,
    asset_id: r.asset_id,
    asset_name: r.asset_name,
    sector_name: r.sector_name,
    work_order_id: r.work_order_id,
    work_order_number: r.work_order_number,
  }));
}

/**
 * Devolve a OS do item do ciclo, criando-a se ainda não existe.
 *
 * Nenhum motor novo: quem cria é `materializeCycle` — a mesma função da
 * varredura —, então a OS nasce com o procedimento/checklist da VERSÃO certa
 * da tarefa (P1.4). Item dispensado não executa.
 */
export async function executePlanItem(
  session: TenantSession,
  itemId: string,
  scope: MembershipScope
): Promise<{ workOrderId: string; created: boolean }> {
  const [item] = await session.query<{
    cycle_id: string;
    status: string;
    work_order_id: string | null;
    customer_id: string;
    location_path: string | null;
  }>(
    `SELECT i.cycle_id, i.status::text AS status, i.work_order_id, a.customer_id, a.location_path
       FROM aurora.plan_cycle_items i
       JOIN aurora.assets a ON a.id = i.asset_id
      WHERE i.id = $1
        AND ${scopeSql('a.customer_id', 'a.location_path', 2)}`,
    [itemId, scope.customerIds, scope.locationPaths]
  );
  if (!item) throw new NotFoundError('item do plano', itemId);
  if (item.status === 'skipped') {
    throw new ValidationError('este item foi dispensado e não gera execução', { field: 'itemId' });
  }
  if (item.work_order_id) return { workOrderId: item.work_order_id, created: false };
  await materializeCycle(session, item.cycle_id);
  const [depois] = await session.query<{ work_order_id: string | null }>(
    `SELECT work_order_id FROM aurora.plan_cycle_items WHERE id = $1`,
    [itemId]
  );
  if (!depois?.work_order_id) {
    throw new ValidationError('não foi possível gerar a OS deste item', { field: 'itemId' });
  }
  return { workOrderId: depois.work_order_id, created: true };
}
