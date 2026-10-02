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
