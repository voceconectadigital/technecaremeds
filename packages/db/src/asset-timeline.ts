/**
 * Aurora — a linha do tempo do ativo (gap V2 §7 e P1.3 · critério 3 do PLAT §14:
 * "o ativo mantém histórico completo de serviços, documentos, medições e ciclo
 * de vida").
 *
 * Antes, a resposta existia em quatro rotas separadas — OS por ativo,
 * documentos por ativo, transferências na ficha, trilha de auditoria — e
 * medição não tinha onde constar. Aqui é UMA lista, em ordem, com o que
 * aconteceu, quando e onde ver mais.
 *
 * É LEITURA COMPOSTA, não tabela nova: cada evento vem da tabela dona dele, e a
 * RLS de cada uma vale como sempre. O que a pessoa não pode ver (documento sem
 * `document.read`, OS sem `work_order.read`) não entra — a linha do tempo não é
 * um atalho para atravessar permissão.
 *
 * Nenhum valor financeiro entra aqui.
 */
import { NotFoundError } from '@aurora/domain';
import type { TenantSession } from './client';

export const ASSET_TIMELINE_KINDS = [
  'registered',
  'manufactured',
  'acquired',
  'installed',
  'transferred',
  'work_order_opened',
  'work_order_completed',
  'measurement_session',
  'document_issued',
  'document_released',
  'decommissioned',
  'replaced',
  'replaces',
] as const;
export type AssetTimelineKind = (typeof ASSET_TIMELINE_KINDS)[number];

export interface AssetTimelineEvent {
  kind: AssetTimelineKind;
  /** Instante (ISO) ou data civil (AAAA-MM-DD) quando o fato é de um dia. */
  at: string;
  title: string;
  detail: string | null;
  /** O registro de origem, para a tela abrir: OS, documento, sessão, ativo. */
  ref: { type: 'work_order' | 'document' | 'measurement_session' | 'asset' | 'transfer'; id: string } | null;
}

export async function assetTimeline(
  session: TenantSession,
  assetId: string,
  opts: { canReadWorkOrders: boolean; canReadDocuments: boolean; limit?: number }
): Promise<AssetTimelineEvent[]> {
  const limite = Math.min(Math.max(opts.limit ?? 200, 1), 500);

  const [a] = await session.query<Record<string, unknown>>(
    `SELECT a.id, a.name, a.created_at,
            a.manufactured_at::text AS manufactured_at, a.acquired_at::text AS acquired_at,
            a.installed_at::text AS installed_at, a.decommissioned_at, a.decommission_reason,
            a.replaced_by_asset_id, s.name AS successor_name,
            p.id AS predecessor_id, p.name AS predecessor_name, p.decommissioned_at AS predecessor_out
       FROM aurora.assets a
       LEFT JOIN aurora.assets s ON s.id = a.replaced_by_asset_id
       LEFT JOIN aurora.assets p ON p.replaced_by_asset_id = a.id
      WHERE a.id = $1 AND a.deleted_at IS NULL`,
    [assetId]
  );
  if (!a) throw new NotFoundError('Ativo', assetId);

  const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
  const ev: AssetTimelineEvent[] = [];

  ev.push({
    kind: 'registered',
    at: iso(a.created_at),
    title: 'Cadastrado no sistema',
    detail: null,
    ref: null,
  });
  if (a.manufactured_at) {
    ev.push({
      kind: 'manufactured',
      at: String(a.manufactured_at),
      title: 'Fabricação',
      detail: null,
      ref: null,
    });
  }
  if (a.acquired_at) {
    ev.push({ kind: 'acquired', at: String(a.acquired_at), title: 'Aquisição', detail: null, ref: null });
  }
  if (a.installed_at) {
    ev.push({ kind: 'installed', at: String(a.installed_at), title: 'Instalação', detail: null, ref: null });
  }
  if (a.predecessor_id) {
    ev.push({
      kind: 'replaces',
      at: iso(a.predecessor_out ?? a.created_at),
      title: `Substituiu "${a.predecessor_name as string}"`,
      detail: null,
      ref: { type: 'asset', id: a.predecessor_id as string },
    });
  }
  if (a.decommissioned_at) {
    ev.push({
      kind: 'decommissioned',
      at: iso(a.decommissioned_at),
      title: 'Descomissionado',
      detail: (a.decommission_reason as string | null) ?? null,
      ref: null,
    });
    if (a.replaced_by_asset_id) {
      ev.push({
        kind: 'replaced',
        at: iso(a.decommissioned_at),
        title: `Substituído por "${a.successor_name as string}"`,
        detail: null,
        ref: { type: 'asset', id: a.replaced_by_asset_id as string },
      });
    }
  }

  const transfers = await session.query<Record<string, unknown>>(
    `SELECT t.id, t.kind::text AS kind, t.occurred_at, t.reason,
            lf.name AS from_location, lt.name AS to_location
       FROM aurora.asset_transfers t
       LEFT JOIN aurora.locations lf ON lf.id = t.from_location_id
       LEFT JOIN aurora.locations lt ON lt.id = t.to_location_id
      WHERE t.asset_id = $1
      ORDER BY t.occurred_at DESC LIMIT $2`,
    [assetId, limite]
  );
  for (const t of transfers) {
    ev.push({
      kind: 'transferred',
      at: iso(t.occurred_at),
      title: `${t.kind === 'loan' ? 'Emprestado' : 'Transferido'}: ${(t.from_location as string | null) ?? '—'} → ${(t.to_location as string | null) ?? '—'}`,
      detail: (t.reason as string | null) ?? null,
      ref: { type: 'transfer', id: t.id as string },
    });
  }

  if (opts.canReadWorkOrders) {
    const os = await session.query<Record<string, unknown>>(
      `SELECT w.id, w.number, w.title, w.created_at AS opened_at, w.completed_at, st.label AS status_label
         FROM aurora.work_orders w
         JOIN aurora.work_order_statuses st ON st.id = w.status_id
        WHERE w.asset_id = $1 AND w.status_category <> 'draft'
        ORDER BY w.created_at DESC LIMIT $2`,
      [assetId, limite]
    );
    for (const w of os) {
      const ref = { type: 'work_order' as const, id: w.id as string };
      const nome = `${(w.number as string | null) ?? 'OS'} — ${w.title as string}`;
      ev.push({
        kind: 'work_order_opened',
        at: iso(w.opened_at),
        title: `Aberta: ${nome}`,
        detail: null,
        ref,
      });
      if (w.completed_at) {
        ev.push({
          kind: 'work_order_completed',
          at: iso(w.completed_at),
          title: `Concluída: ${nome}`,
          detail: (w.status_label as string) ?? null,
          ref,
        });
      }
    }

    // Medição é evidência de execução: quem vê a OS vê a sessão dela.
    const sessoes = await session.query<Record<string, unknown>>(
      `SELECT ms.id, ms.started_at, ms.measured_on::text AS measured_on, ms.finished_at,
              t.title AS protocol_title, t.key, t.version, ia.name AS instrument_name
         FROM aurora.measurement_sessions ms
         JOIN aurora.checklist_responses r ON r.id = ms.response_id
         JOIN aurora.checklist_templates t ON t.id = r.template_id
         LEFT JOIN aurora.assets ia ON ia.id = ms.instrument_id
        WHERE ms.asset_id = $1
        ORDER BY ms.started_at DESC LIMIT $2`,
      [assetId, limite]
    );
    for (const s of sessoes) {
      ev.push({
        kind: 'measurement_session',
        at: iso(s.started_at),
        title: `Medição: ${s.protocol_title as string} (v${String(s.version)})`,
        detail:
          `Dia ${s.measured_on as string}` +
          (s.instrument_name ? ` · instrumento ${s.instrument_name as string}` : '') +
          (s.finished_at ? '' : ' · sessão aberta'),
        ref: { type: 'measurement_session', id: s.id as string },
      });
    }
  }

  if (opts.canReadDocuments) {
    const docs = await session.query<Record<string, unknown>>(
      `SELECT d.id, d.number, d.version, dt.label AS type_label, d.issued_at, d.released_to_customer_at,
              d.verdict::text AS verdict, d.status::text AS status
         FROM aurora.documents d
         JOIN aurora.document_types dt ON dt.id = d.document_type_id
        WHERE d.asset_id = $1 AND d.issued_at IS NOT NULL
        ORDER BY d.issued_at DESC LIMIT $2`,
      [assetId, limite]
    );
    for (const d of docs) {
      const ref = { type: 'document' as const, id: d.id as string };
      const nome = `${d.type_label as string} ${d.number as string} (v${String(d.version)})`;
      ev.push({
        kind: 'document_issued',
        at: iso(d.issued_at),
        title: `Emitido: ${nome}`,
        detail: null,
        ref,
      });
      if (d.released_to_customer_at) {
        ev.push({
          kind: 'document_released',
          at: iso(d.released_to_customer_at),
          title: `Liberado ao cliente: ${nome}`,
          detail: null,
          ref,
        });
      }
    }
  }

  // Data civil (AAAA-MM-DD) ordena junto com instante ISO: o dia vem antes de
  // qualquer hora daquele dia, que é o que se espera de "fabricado em".
  return ev.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, limite);
}

/* -------------------------------------------------------------------------- */
/* ficha de vida: planos, procedimentos e histórico de campos (ATV-13)         */
/* -------------------------------------------------------------------------- */

export interface AssetLifePlan {
  plan_id: string;
  plan_name: string;
  plan_active: boolean;
  task_id: string;
  task_name: string;
  target_kind: 'asset' | 'asset_category' | 'location_subtree';
  frequency_unit: string;
  frequency_interval: number;
  checklist_template_key: string | null;
}

export interface AssetLifeProcedure {
  response_id: string;
  work_order_id: string;
  work_order_number: string | null;
  template_key: string;
  template_title: string;
  template_version: number;
  started_at: string;
  finished_at: string | null;
  answers: { pass: number; fail: number; na: number };
}

export interface AssetFieldChange {
  at: string;
  actor_name: string | null;
  action: 'create' | 'update' | 'delete' | 'restore';
  changes: Array<{ field: string; from: unknown; to: unknown }>;
}

export interface AssetLifeRecord {
  /** `null` = quem pergunta não tem a permissão da seção (diferente de lista vazia). */
  plans: AssetLifePlan[] | null;
  procedures: AssetLifeProcedure[] | null;
  field_changes: AssetFieldChange[] | null;
}

/** Campos de máquina: mudam com o registro, mas não dizem nada a quem lê a história. */
const CAMPOS_TECNICOS = new Set([
  'id',
  'organization_id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'photo_key',
  'photo_sha256',
  'tag_legacy_duplicate',
]);
/** Valores financeiros: só para `asset.read_financials` — os mesmos que a ficha esconde. */
const CAMPOS_FINANCEIROS = new Set([
  'purchase_value',
  'residual_value',
  'replacement_value',
  'currency',
  'acquisition_invoice',
]);

/**
 * O que a linha do tempo não contava (ATV-13): os planos que COBREM o equipamento hoje, os
 * procedimentos/checklists executados nele e o histórico de alteração de campo (da trilha de
 * auditoria que já existe — 0002/0015). Leitura composta, como a linha do tempo: cada seção vem
 * da tabela dona, e a seção que a pessoa não pode ver vem `null`.
 *
 * Não confere escopo: quem chama confere que o equipamento é visível a quem pergunta.
 */
export async function assetLifeRecord(
  session: TenantSession,
  assetId: string,
  opts: {
    canReadPlans: boolean;
    canReadWorkOrders: boolean;
    canReadFieldHistory: boolean;
    canReadFinancials: boolean;
    canReadInternalNotes: boolean;
    limit?: number;
  }
): Promise<AssetLifeRecord> {
  const limite = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const [a] = await session.query<{ id: string }>(
    `SELECT id FROM aurora.assets WHERE id = $1 AND deleted_at IS NULL`,
    [assetId]
  );
  if (!a) throw new NotFoundError('Ativo', assetId);
  const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

  let plans: AssetLifePlan[] | null = null;
  if (opts.canReadPlans) {
    // As tarefas cujo alvo alcança o equipamento HOJE — a mesma resolução que gera as OS
    // (`resolve_plan_task_assets`, 0055): ativo, tipo ou subárvore de local, com os filtros.
    plans = await session.query<AssetLifePlan>(
      `SELECT p.id AS plan_id, p.name AS plan_name, p.is_active AS plan_active,
              pt.id AS task_id, pt.name AS task_name, pt.target_kind::text AS target_kind,
              pt.frequency_unit::text AS frequency_unit, pt.frequency_interval,
              pt.checklist_template_key
         FROM aurora.plan_tasks pt
         JOIN aurora.maintenance_plans p ON p.id = pt.plan_id
         JOIN aurora.assets a ON a.id = $1
        WHERE p.archived_at IS NULL AND pt.archived_at IS NULL
          AND p.customer_id = a.customer_id
          AND EXISTS (SELECT 1 FROM aurora.resolve_plan_task_assets(pt.id) r WHERE r.asset_id = a.id)
        ORDER BY p.name, pt.position, pt.name
        LIMIT $2`,
      [assetId, limite]
    );
  }

  let procedures: AssetLifeProcedure[] | null = null;
  if (opts.canReadWorkOrders) {
    const linhas = await session.query<Record<string, unknown>>(
      `SELECT r.id AS response_id, w.id AS work_order_id, w.number AS work_order_number,
              r.template_key, t.title AS template_title, r.template_version,
              r.started_at, r.finished_at,
              count(ans.id) FILTER (WHERE ans.verdict = 'pass')::int AS pass,
              count(ans.id) FILTER (WHERE ans.verdict = 'fail')::int AS fail,
              count(ans.id) FILTER (WHERE ans.verdict = 'na')::int AS na
         FROM aurora.checklist_responses r
         JOIN aurora.work_orders w ON w.id = r.work_order_id
         JOIN aurora.checklist_templates t ON t.id = r.template_id
         LEFT JOIN aurora.checklist_answers ans ON ans.response_id = r.id
        WHERE w.asset_id = $1 AND w.status_category <> 'draft'
        GROUP BY r.id, w.id, w.number, r.template_key, t.title, r.template_version,
                 r.started_at, r.finished_at
        ORDER BY r.started_at DESC
        LIMIT $2`,
      [assetId, limite]
    );
    procedures = linhas.map((l) => ({
      response_id: l.response_id as string,
      work_order_id: l.work_order_id as string,
      work_order_number: (l.work_order_number as string | null) ?? null,
      template_key: l.template_key as string,
      template_title: l.template_title as string,
      template_version: Number(l.template_version),
      started_at: iso(l.started_at),
      finished_at: l.finished_at ? iso(l.finished_at) : null,
      answers: { pass: Number(l.pass), fail: Number(l.fail), na: Number(l.na) },
    }));
  }

  let field_changes: AssetFieldChange[] | null = null;
  if (opts.canReadFieldHistory) {
    const linhas = await session.query<{
      occurred_at: Date | string;
      actor_name: string | null;
      action: AssetFieldChange['action'];
      changes: Record<string, { from: unknown; to: unknown }> | null;
    }>(
      `SELECT l.occurred_at, u.name AS actor_name, l.action::text AS action, l.changes
         FROM aurora.audit_logs l
         LEFT JOIN aurora.users u ON u.id = l.actor_user_id
        WHERE l.entity_type = 'assets' AND l.entity_id = $1
        ORDER BY l.occurred_at DESC, l.id DESC
        LIMIT $2`,
      [assetId, limite]
    );
    const visivel = (campo: string): boolean =>
      !CAMPOS_TECNICOS.has(campo) &&
      (opts.canReadFinancials || !CAMPOS_FINANCEIROS.has(campo)) &&
      (opts.canReadInternalNotes || campo !== 'internal_notes');
    field_changes = [];
    for (const l of linhas) {
      // O cadastro traz TODAS as colunas como "mudança": a ficha diz "cadastrado", sem a lista.
      const changes =
        l.action === 'create'
          ? []
          : Object.entries(l.changes ?? {})
              .filter(([campo]) => visivel(campo))
              .map(([field, c]) => ({ field, from: c?.from ?? null, to: c?.to ?? null }))
              .sort((x, y) => x.field.localeCompare(y.field));
      // Uma alteração que só mexeu em campo técnico ou escondido não vira linha vazia.
      if (l.action === 'update' && changes.length === 0) continue;
      field_changes.push({ at: iso(l.occurred_at), actor_name: l.actor_name, action: l.action, changes });
    }
  }

  return { plans, procedures, field_changes };
}
