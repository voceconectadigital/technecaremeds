/**
 * Aurora — relatório PATRIMONIAL (REL-11, WhatsApp 19/10/2026: "Em relatórios também preciso de
 * uma opção de relatório patrimonial, com opção de ativos, em manutenção e obsoletos").
 *
 * O QUE ELE É
 *
 * O inventário recortado pelo escopo de quem pede — o MESMO recorte da lista de equipamentos
 * (`accessible_customer_ids` / `accessible_location_ids`) —, filtrado por cliente e pela situação
 * do relatório (ativos, em manutenção, obsoletos; ver `ASSET_REPORT_SITUATIONS` no domínio), com
 * a depreciação em linha reta de cada bem e os totais.
 *
 * VALOR É DADO FINANCEIRO
 *
 * Valor de compra, residual, NF e tudo o que se calcula a partir deles (depreciação acumulada,
 * valor contábil, totais) só existem para quem tem `asset.read_financials` — a mesma regra da
 * ficha do ativo. E a regra é na CONSULTA, como lá: sem a permissão, a coluna nem é lida, e não
 * há total em R$ que pudesse vazar o valor de um bem só (um relatório de um equipamento é o valor
 * dele). O percentual depreciado e a vida útil continuam, porque dependem só de data e vida útil.
 *
 * Nada é estimado: bem sem valor de compra fica fora da soma (e o relatório conta quantos); bem
 * sem data de aquisição ou vida útil fica sem depreciação.
 */
import {
  ASSET_REPORT_SITUATION_STATUSES,
  NotFoundError,
  assetReportSituationOf,
  straightLineDepreciation,
  type AssetReportSituation,
  type AssetStatus,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { OBSOLESCENCE_SYSTEM_KEY } from './obsolescencia';

export interface AssetReportInput {
  customer_id?: string | null;
  situation?: AssetReportSituation;
}

export interface AssetReportRow {
  id: string;
  name: string;
  tag: string | null;
  serial_number: string | null;
  asset_number: string | null;
  customer_name: string;
  location_name: string | null;
  category_name: string;
  manufacturer_name: string | null;
  model_name: string | null;
  status: AssetStatus;
  situation: Exclude<AssetReportSituation, 'all'>;
  acquired_at: string | null;
  useful_life_years: number | null;
  decommissioned_at: string | null;
  decommission_reason: string | null;
  /** Número do laudo de obsolescência (OBC) concluído, quando a baixa veio dele. */
  obsolescence_report: string | null;
  /** 0–100; nulo sem data de aquisição ou vida útil. */
  percent_depreciated: number | null;
  /** Os campos abaixo só existem com `asset.read_financials` (senão, nulos). */
  currency: string | null;
  acquisition_invoice: string | null;
  purchase_value: number | null;
  residual_value: number | null;
  accumulated_depreciation: number | null;
  book_value: number | null;
}

export interface AssetReportTotals {
  currency: string;
  /** Bens com valor de compra informado (os que entram na soma). */
  assets_with_value: number;
  purchase_value: number;
  /** Soma do valor contábil dos bens que têm valor, data de aquisição e vida útil. */
  book_value: number;
  /** Bens com valor de compra, mas sem data ou vida útil: sem valor contábil. */
  assets_without_depreciation: number;
}

export interface AssetReport {
  filters: { customer: string | null; situation: AssetReportSituation };
  counts: Record<Exclude<AssetReportSituation, 'all'>, number> & { total: number };
  by_status: Partial<Record<AssetStatus, number>>;
  financials_visible: boolean;
  /** Um total por moeda (quase sempre só BRL). Vazio sem a permissão financeira. */
  totals: AssetReportTotals[];
  /** Bens sem valor de compra informado (fora da soma). Nulo sem a permissão financeira. */
  assets_without_value: number | null;
  items: AssetReportRow[];
}

const arred = (n: number) => Math.round(n * 100) / 100;

export async function buildAssetReport(
  s: TenantSession,
  membershipId: string,
  b: AssetReportInput,
  opcoes: { financials: boolean; now?: Date }
): Promise<AssetReport> {
  const situacao = b.situation ?? 'all';
  const clienteId = b.customer_id ?? null;
  let clienteNome: string | null = null;
  if (clienteId) {
    // Fora do escopo é 404, como no relatório de indicadores: responder "zero bens" diria que
    // o cliente existe e só não tem nada.
    const [c] = await s.query<{ name: string }>(
      `SELECT c.name FROM aurora.customers c
        WHERE c.id = $2 AND c.deleted_at IS NULL
          AND c.id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))`,
      [membershipId, clienteId]
    );
    if (!c) throw new NotFoundError('cliente', clienteId);
    clienteNome = c.name;
  }
  const statuses = situacao === 'all' ? null : [...ASSET_REPORT_SITUATION_STATUSES[situacao]];

  const linhas = await s.query<{
    id: string;
    name: string;
    tag: string | null;
    serial_number: string | null;
    asset_number: string | null;
    customer_name: string;
    location_name: string | null;
    category_name: string;
    manufacturer_name: string | null;
    model_name: string | null;
    status: AssetStatus;
    acquired_at: string | null;
    useful_life_years: number | null;
    decommissioned_at: Date | string | null;
    decommission_reason: string | null;
    obsolescence_report: string | null;
    currency: string | null;
    acquisition_invoice: string | null;
    purchase_value: string | null;
    residual_value: string | null;
  }>(
    `SELECT a.id, a.name, a.tag, a.serial_number, a.asset_number,
            cu.name AS customer_name, l.name AS location_name, c.name AS category_name,
            f.name AS manufacturer_name, m.name AS model_name,
            a.status::text AS status, a.acquired_at::text AS acquired_at, a.useful_life_years,
            a.decommissioned_at, a.decommission_reason,
            (SELECT w.number FROM aurora.work_orders w
               JOIN aurora.catalog_items t ON t.id = w.work_order_type_id
              WHERE w.asset_id = a.id AND t.system_key = $4
                AND w.status_category::text IN ('done', 'closed')
              ORDER BY w.updated_at DESC LIMIT 1) AS obsolescence_report,
            -- Dado financeiro: só sai da consulta com asset.read_financials (como a ficha).
            CASE WHEN $5::boolean THEN a.currency END AS currency,
            CASE WHEN $5::boolean THEN a.acquisition_invoice END AS acquisition_invoice,
            CASE WHEN $5::boolean THEN a.purchase_value::text END AS purchase_value,
            CASE WHEN $5::boolean THEN a.residual_value::text END AS residual_value
       FROM aurora.assets a
       JOIN aurora.asset_categories c ON c.id = a.asset_category_id
       JOIN aurora.customers cu ON cu.id = a.customer_id
       LEFT JOIN aurora.locations l ON l.id = a.location_id
       LEFT JOIN aurora.asset_models m ON m.id = a.asset_model_id
       LEFT JOIN aurora.manufacturers f ON f.id = m.manufacturer_id
      WHERE a.deleted_at IS NULL
        -- O mesmo recorte da lista de equipamentos: o que a pessoa vê no inventário.
        AND (a.location_id IS NULL
             OR a.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($1)))
        AND a.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))
        AND ($2::uuid IS NULL OR a.customer_id = $2)
        AND ($3::text[] IS NULL OR a.status::text = ANY($3::text[]))
      ORDER BY cu.name, a.name, a.id`,
    [membershipId, clienteId, statuses, OBSOLESCENCE_SYSTEM_KEY, opcoes.financials]
  );

  const agora = opcoes.now ?? new Date();
  const counts = { active: 0, maintenance: 0, obsolete: 0, total: 0 };
  const porStatus: Partial<Record<AssetStatus, number>> = {};
  const totais = new Map<string, AssetReportTotals>();
  let semValor = 0;

  const items: AssetReportRow[] = linhas.map((r) => {
    const compra = r.purchase_value === null ? null : Number(r.purchase_value);
    const residual = r.residual_value === null ? null : Number(r.residual_value);
    const dep = straightLineDepreciation({
      acquiredAt: r.acquired_at,
      usefulLifeYears: r.useful_life_years,
      purchaseValue: compra,
      residualValue: residual,
      now: agora,
    });
    const situation = assetReportSituationOf(r.status);
    counts[situation] += 1;
    counts.total += 1;
    porStatus[r.status] = (porStatus[r.status] ?? 0) + 1;
    if (opcoes.financials) {
      if (compra === null) semValor += 1;
      else {
        const moeda = r.currency ?? 'BRL';
        const t = totais.get(moeda) ?? {
          currency: moeda,
          assets_with_value: 0,
          purchase_value: 0,
          book_value: 0,
          assets_without_depreciation: 0,
        };
        t.assets_with_value += 1;
        t.purchase_value = arred(t.purchase_value + compra);
        if (dep?.bookValue != null) t.book_value = arred(t.book_value + dep.bookValue);
        else t.assets_without_depreciation += 1;
        totais.set(moeda, t);
      }
    }
    const decom = r.decommissioned_at;
    return {
      id: r.id,
      name: r.name,
      tag: r.tag,
      serial_number: r.serial_number,
      asset_number: r.asset_number,
      customer_name: r.customer_name,
      location_name: r.location_name,
      category_name: r.category_name,
      manufacturer_name: r.manufacturer_name,
      model_name: r.model_name,
      status: r.status,
      situation,
      acquired_at: r.acquired_at,
      useful_life_years: r.useful_life_years,
      decommissioned_at: decom === null ? null : decom instanceof Date ? decom.toISOString() : String(decom),
      decommission_reason: r.decommission_reason,
      obsolescence_report: r.obsolescence_report,
      percent_depreciated: dep?.percentDepreciated ?? null,
      currency: r.currency,
      acquisition_invoice: r.acquisition_invoice,
      purchase_value: compra,
      residual_value: residual,
      accumulated_depreciation: dep?.accumulatedDepreciation ?? null,
      book_value: dep?.bookValue ?? null,
    };
  });

  return {
    filters: { customer: clienteNome, situation: situacao },
    counts,
    by_status: porStatus,
    financials_visible: opcoes.financials,
    totals: [...totais.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    assets_without_value: opcoes.financials ? semValor : null,
    items,
  };
}
