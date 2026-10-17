/**
 * Aurora — Painel de Controle: escopo do vínculo, séries e fotografias.
 *
 * NADA AQUI É MÉTRICA NOVA.
 *
 * As séries são as MESMAS definições de `metrics.ts` (abertas, concluídas,
 * backlog) aplicadas a fatias do período, e não uma fórmula paralela: um
 * gráfico que somasse diferente do cartão ao lado seria o defeito mais difícil
 * de perceber no painel. A fotografia do parque é contagem de `assets.status`
 * agora — não é disponibilidade, que continua sem definição do cliente
 * (AI-HANDOFF §15-A) e por isso não é calculada.
 *
 * O ESCOPO É DO VÍNCULO, NÃO DA TELA.
 *
 * `membershipScope` lê `membership_scopes` e devolve a borda de quem pergunta:
 * a coordenação com escopo `all` não recebe restrição; o usuário do hospital
 * recebe só o cliente dele. Toda consulta do painel recebe essa borda — um
 * filtro escolhido na tela só pode ESTREITÁ-la.
 */
import { NotFoundError, type Period } from '@aurora/domain';
import type { TenantSession } from './client';
import { scopeParams, scopeSql, type MetricFilters } from './metrics';

export interface MembershipScope {
  /** Nulo: sem restrição de cliente. */
  customerIds: string[] | null;
  /** Nulo: sem restrição de local. Caminhos materializados das raízes listadas. */
  locationPaths: string[] | null;
}

/**
 * A borda do que o vínculo enxerga.
 *
 * Contexto de sistema (sem vínculo) não tem escopo definido — e quem chama
 * rota de tela sempre tem vínculo; a rota que precisa recusa antes.
 */
export async function membershipScope(
  session: TenantSession,
  membershipId: string | null
): Promise<MembershipScope> {
  if (!membershipId) return { customerIds: null, locationPaths: null };
  const [ms] = await session.query<{
    customer_scope: string;
    customer_ids: string[] | null;
    location_scope: string;
    location_ids: string[] | null;
  }>(
    `SELECT customer_scope::text AS customer_scope, customer_ids,
            location_scope::text AS location_scope, location_ids
       FROM aurora.membership_scopes WHERE membership_id = $1`,
    [membershipId]
  );
  // Vínculo sem linha de escopo não existe desde a 0039; se existisse, "sem
  // escopo" jamais poderia significar "tudo".
  if (!ms) return { customerIds: [], locationPaths: [] };

  const customerIds = ms.customer_scope === 'all' ? null : [...(ms.customer_ids ?? [])];
  let locationPaths: string[] | null = null;
  if (ms.location_scope !== 'all') {
    const ids = ms.location_ids ?? [];
    locationPaths =
      ids.length === 0
        ? []
        : (
            await session.query<{ path: string }>(
              `SELECT path FROM aurora.locations WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
              [ids]
            )
          ).map((r) => r.path);
  }
  return { customerIds, locationPaths };
}

/**
 * O cliente pedido está dentro da borda? Fora dela é 404, e não 403: confirmar
 * que o cliente existe já seria dizer demais (mesma regra de `/customers/:id`).
 */
export async function assertCustomerInScope(
  session: TenantSession,
  scope: MembershipScope,
  customerId: string | null | undefined
): Promise<void> {
  if (!customerId) return;
  if (scope.customerIds !== null && !scope.customerIds.includes(customerId)) {
    throw new NotFoundError('cliente', customerId);
  }
  // Escopo `all` não é "qualquer id": cliente de OUTRA organização some pela
  // RLS, e responder um painel vazio diria que ele existe e só não tem dados.
  const [c] = await session.query<{ id: string }>(
    `SELECT id FROM aurora.customers WHERE id = $1 AND deleted_at IS NULL`,
    [customerId]
  );
  if (!c) throw new NotFoundError('cliente', customerId);
}

export function scopedFilters(scope: MembershipScope, f: MetricFilters): MetricFilters {
  return { ...f, scopeCustomerIds: scope.customerIds, scopeLocationPaths: scope.locationPaths };
}

/* -------------------------------------------------------------------------- */
/* séries                                                                      */
/* -------------------------------------------------------------------------- */

export type Granularity = 'day' | 'week' | 'month';

/**
 * A fatia que cabe no período: até 31 dias, por dia; até 120, por semana;
 * acima disso, por mês. Mais de ~30 pontos num painel é ruído, e menos de 5
 * não mostra tendência nenhuma.
 */
export function granularityFor(period: Period): Granularity {
  const dias = (period.to.getTime() - period.from.getTime()) / 86_400_000;
  if (dias <= 31) return 'day';
  if (dias <= 120) return 'week';
  return 'month';
}

export interface SeriesPoint {
  start: string;
  end: string;
  opened: number;
  completed: number;
  completedPreventive: number;
  completedCorrective: number;
  /** Backlog no FIM da fatia, pela mesma definição do indicador. */
  backlog: number;
  /**
   * MTTR da fatia: média de `resolution_minutes` das corretivas concluídas
   * nela — a MESMA definição do indicador. Nulo quando a fatia não tem
   * amostra: zero diria "reparo instantâneo".
   */
  mttrMinutes: number | null;
  mttrSamples: number;
}

/**
 * Abertas, concluídas e backlog por fatia do período.
 *
 * Cada coluna é a definição do indicador correspondente, aplicada à fatia —
 * a soma das "abertas" das fatias é o cartão "abertas" do período.
 */
export async function workOrderSeries(
  session: TenantSession,
  period: Period,
  granularity: Granularity,
  filters: MetricFilters
): Promise<SeriesPoint[]> {
  const passo = granularity === 'day' ? '1 day' : granularity === 'week' ? '7 days' : '1 month';
  // Categoria do equipamento: o filtro chegava e era ignorado aqui (pente-fino
  // 17/10/2026, PF-53) — o cartão filtrava, o gráfico ao lado não.
  const p = [
    filters.customerId ?? null,
    filters.locationPath ?? null,
    ...scopeParams(filters),
    filters.assetCategoryId ?? null,
  ];
  const filtro = `
      AND ($4::uuid IS NULL OR f.customer_id = $4)
      AND ($5::text IS NULL OR f.location_path LIKE $5 || '%')
      AND ${scopeSql('f.customer_id', 'f.location_path', 6)}
      AND ($8::uuid IS NULL OR f.asset_category_id = $8)`;
  const rows = await session.query<{
    inicio: Date;
    fim: Date;
    opened: string;
    completed: string;
    prev: string;
    corr: string;
    backlog: string;
    mttr: string | null;
    mttr_n: string;
  }>(
    `WITH b AS (
       SELECT gs AS inicio, LEAST(gs + $3::interval, $2::timestamptz) AS fim
         FROM generate_series($1::timestamptz, $2::timestamptz - interval '1 second', $3::interval) gs
     )
     SELECT b.inicio, b.fim,
            (SELECT count(*) FROM aurora.fact_work_order f
              WHERE f.opened_at >= b.inicio AND f.opened_at < b.fim ${filtro})::text AS opened,
            (SELECT count(*) FROM aurora.fact_work_order f
              WHERE f.completed_at >= b.inicio AND f.completed_at < b.fim AND NOT f.cancelled ${filtro})::text AS completed,
            (SELECT count(*) FROM aurora.fact_work_order f
              WHERE f.completed_at >= b.inicio AND f.completed_at < b.fim AND NOT f.cancelled
                AND f.work_order_type_key = 'preventive' ${filtro})::text AS prev,
            (SELECT count(*) FROM aurora.fact_work_order f
              WHERE f.completed_at >= b.inicio AND f.completed_at < b.fim AND NOT f.cancelled
                AND f.work_order_type_key = 'corrective' ${filtro})::text AS corr,
            (SELECT count(*) FROM aurora.fact_work_order f
              WHERE f.opened_at IS NOT NULL AND f.opened_at <= b.fim AND NOT f.cancelled
                AND (f.completed_at IS NULL OR f.completed_at > b.fim) ${filtro})::text AS backlog,
            (SELECT avg(f.resolution_minutes) FROM aurora.fact_work_order f
              WHERE f.completed_at >= b.inicio AND f.completed_at < b.fim AND NOT f.cancelled
                AND f.work_order_type_key = 'corrective' AND f.resolution_minutes IS NOT NULL
                ${filtro})::text AS mttr,
            (SELECT count(*) FROM aurora.fact_work_order f
              WHERE f.completed_at >= b.inicio AND f.completed_at < b.fim AND NOT f.cancelled
                AND f.work_order_type_key = 'corrective' AND f.resolution_minutes IS NOT NULL
                ${filtro})::text AS mttr_n
       FROM b ORDER BY b.inicio`,
    [period.from, period.to, passo, ...p]
  );
  return rows.map((r) => ({
    start: new Date(r.inicio).toISOString(),
    end: new Date(r.fim).toISOString(),
    opened: Number(r.opened),
    completed: Number(r.completed),
    completedPreventive: Number(r.prev),
    completedCorrective: Number(r.corr),
    backlog: Number(r.backlog),
    mttrMinutes: r.mttr === null ? null : Math.round(Number(r.mttr)),
    mttrSamples: Number(r.mttr_n),
  }));
}

/* -------------------------------------------------------------------------- */
/* fotografias (agora)                                                         */
/* -------------------------------------------------------------------------- */

/** OS abertas agora, por categoria de situação e por prioridade. */
export async function openWorkOrdersSnapshot(
  session: TenantSession,
  filters: MetricFilters
): Promise<{ byStatus: Record<string, number>; byPriority: Record<string, number> }> {
  const rows = await session.query<{ status_category: string; priority: string; total: string }>(
    `SELECT f.status_category, f.priority, count(*)::text AS total
       FROM aurora.fact_work_order f
      WHERE f.opened_at IS NOT NULL AND NOT f.cancelled AND f.completed_at IS NULL
        AND ($1::uuid IS NULL OR f.customer_id = $1)
        AND ($2::text IS NULL OR f.location_path LIKE $2 || '%')
        AND ${scopeSql('f.customer_id', 'f.location_path', 3)}
        AND ($5::uuid IS NULL OR f.asset_category_id = $5)
      GROUP BY 1, 2`,
    [
      filters.customerId ?? null,
      filters.locationPath ?? null,
      ...scopeParams(filters),
      filters.assetCategoryId ?? null,
    ]
  );
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status_category] = (byStatus[r.status_category] ?? 0) + Number(r.total);
    byPriority[r.priority] = (byPriority[r.priority] ?? 0) + Number(r.total);
  }
  return { byStatus, byPriority };
}

export interface ParkSnapshot {
  total: number;
  byStatus: Record<string, number>;
  /** Equipamentos por setor (tipo de local `setor`), os dez maiores. */
  bySector: Array<{ location_id: string; name: string; customer_name: string; assets: number }>;
  withoutSector: number;
}

/**
 * O parque agora, pela situação cadastrada de cada equipamento.
 *
 * NÃO é disponibilidade: "em manutenção" aqui é o status do cadastro, e
 * disponibilidade (tempo parado ÷ tempo total) depende de uma definição que o
 * cliente não deu. O painel diz isso ao lado do gráfico.
 */
export async function parkSnapshot(session: TenantSession, filters: MetricFilters): Promise<ParkSnapshot> {
  const base = [
    filters.customerId ?? null,
    filters.locationPath ?? null,
    ...scopeParams(filters),
    filters.assetCategoryId ?? null,
  ];
  const filtro = `a.deleted_at IS NULL
        AND ($1::uuid IS NULL OR a.customer_id = $1)
        AND ($2::text IS NULL OR a.location_path LIKE $2 || '%')
        AND ${scopeSql('a.customer_id', 'a.location_path', 3)}
        AND ($5::uuid IS NULL OR a.asset_category_id = $5)`;
  const porStatus = await session.query<{ status: string; total: string }>(
    `SELECT a.status::text AS status, count(*)::text AS total
       FROM aurora.assets a WHERE ${filtro} GROUP BY 1`,
    base
  );
  const porSetor = await session.query<{
    location_id: string;
    name: string;
    customer_name: string;
    assets: string;
  }>(
    `SELECT s.id AS location_id, s.name, c.name AS customer_name, count(a.id)::text AS assets
       FROM aurora.assets a
       JOIN aurora.locations s ON a.location_path LIKE s.path || '%' AND s.deleted_at IS NULL
       JOIN aurora.location_types t ON t.id = s.location_type_id AND t.key = 'setor'
       JOIN aurora.customers c ON c.id = s.customer_id
      WHERE ${filtro} AND a.status::text NOT IN ('decommissioned', 'disposed')
      GROUP BY 1, 2, 3
      ORDER BY count(a.id) DESC, s.name
      LIMIT 10`,
    base
  );
  const [semSetor] = await session.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM aurora.assets a
      WHERE ${filtro} AND a.status::text NOT IN ('decommissioned', 'disposed')
        AND NOT EXISTS (
          SELECT 1 FROM aurora.locations s
            JOIN aurora.location_types t ON t.id = s.location_type_id AND t.key = 'setor'
           WHERE a.location_path LIKE s.path || '%' AND s.deleted_at IS NULL)`,
    base
  );
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of porStatus) {
    byStatus[r.status] = Number(r.total);
    total += Number(r.total);
  }
  return {
    total,
    byStatus,
    bySector: porSetor.map((r) => ({ ...r, assets: Number(r.assets) })),
    withoutSector: Number(semSetor?.total ?? 0),
  };
}
