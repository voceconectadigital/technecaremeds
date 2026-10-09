/**
 * Aurora — indicadores na camada de dados (SPEC v0.2 §25 · EPIC-021).
 *
 * Duas camadas, como o §25 manda:
 *
 *   · CONSULTA DIRETA para o que é do dia — backlog, fila. É pergunta sobre o
 *     estado agora, e uma projeção só acrescentaria latência a uma resposta que
 *     já é barata;
 *   · TABELA DE FATO para séries e médias, que é onde a referência produziu
 *     telas de trinta segundos ao consultar o transacional.
 *
 * Toda função aqui devolve `MetricResult`: o número vem grudado na definição,
 * no período, nos filtros e na cobertura. Não há caminho para um número sair
 * daqui sem dizer como foi feito.
 */
import {
  withDefinition,
  coverage,
  average,
  bucketize,
  failureIntervals,
  type MetricResult,
  type Period,
  type Average,
  type AgeBucket,
} from '@aurora/domain';
import type { TenantSession } from './client';

/* -------------------------------------------------------------------------- */
/* filtros                                                                     */
/* -------------------------------------------------------------------------- */

export interface MetricFilters {
  customerId?: string | null;
  /** Subárvore de locais, por prefixo do caminho materializado. */
  locationPath?: string | null;
  assetCategoryId?: string | null;
  teamId?: string | null;
  membershipId?: string | null;
  /**
   * O ESCOPO de quem pergunta, e não um filtro que a pessoa escolheu.
   *
   * Clientes e subárvores de local que o vínculo alcança (`membership_scopes`).
   * Nulo é "sem restrição" — vínculo com escopo `all`. Fica fora de
   * `filterRecord` de propósito: não é recorte da tela, é a borda do que a
   * pessoa pode ver, e a resposta não precisa ecoá-la.
   */
  scopeCustomerIds?: readonly string[] | null;
  scopeLocationPaths?: readonly string[] | null;
}

function filterRecord(f: MetricFilters): Record<string, string | null> {
  return {
    customerId: f.customerId ?? null,
    locationPath: f.locationPath ?? null,
    assetCategoryId: f.assetCategoryId ?? null,
    teamId: f.teamId ?? null,
    membershipId: f.membershipId ?? null,
  };
}

/**
 * O trecho de `WHERE` comum a todas as métricas de OS, e os seus parâmetros.
 *
 * Escrito uma vez e reutilizado: cinco cópias do mesmo filtro divergiriam na
 * primeira dimensão nova, e o painel passaria a mostrar números que não se
 * somam entre si — o defeito mais difícil de perceber num relatório.
 */
function factFilter(f: MetricFilters, from = 1): { sql: string; params: unknown[] } {
  const p = [
    f.customerId ?? null,
    f.locationPath ?? null,
    f.assetCategoryId ?? null,
    f.teamId ?? null,
    f.membershipId ?? null,
    ...scopeParams(f),
  ];
  const sql = `
      AND ($${from}::uuid IS NULL OR f.customer_id = $${from})
      AND ($${from + 1}::text IS NULL OR f.location_path LIKE $${from + 1} || '%')
      AND ($${from + 2}::uuid IS NULL OR f.asset_category_id = $${from + 2})
      AND ($${from + 3}::uuid IS NULL OR f.team_id = $${from + 3})
      AND ($${from + 4}::uuid IS NULL OR f.assignee_membership_id = $${from + 4})
      AND ${scopeSql('f.customer_id', 'f.location_path', from + 5)}`;
  return { sql, params: p };
}

/**
 * A condição de escopo, para qualquer tabela que tenha cliente e caminho de local.
 *
 * Registro SEM local (OS sem equipamento) passa no recorte por local — o mesmo
 * critério de `GET /assets`, que lista o ativo sem local para quem vê o
 * cliente. O recorte por cliente vale sempre.
 */
export function scopeSql(customerCol: string, pathCol: string, from: number): string {
  return `($${from}::uuid[] IS NULL OR ${customerCol} = ANY($${from}::uuid[]))
      AND ($${from + 1}::text[] IS NULL OR ${pathCol} = ''
           OR EXISTS (SELECT 1 FROM unnest($${from + 1}::text[]) AS sp(p) WHERE ${pathCol} LIKE sp.p || '%'))`;
}

export function scopeParams(f: MetricFilters): [string[] | null, string[] | null] {
  return [
    f.scopeCustomerIds ? [...f.scopeCustomerIds] : null,
    f.scopeLocationPaths ? [...f.scopeLocationPaths] : null,
  ];
}

/* -------------------------------------------------------------------------- */
/* volume                                                                      */
/* -------------------------------------------------------------------------- */

export async function workOrdersOpened(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<{ count: number }>> {
  const f = factFilter(filters, 3);
  const [row] = await session.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM aurora.fact_work_order f
      WHERE f.opened_at >= $1 AND f.opened_at < $2 ${f.sql}`,
    [period.from, period.to, ...f.params]
  );
  return withDefinition('work_orders_opened', period, filterRecord(filters), {
    count: Number(row!.total),
  });
}

export async function workOrdersCompleted(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<{ count: number }>> {
  const f = factFilter(filters, 3);
  const [row] = await session.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM aurora.fact_work_order f
      WHERE f.completed_at >= $1 AND f.completed_at < $2 AND NOT f.cancelled ${f.sql}`,
    [period.from, period.to, ...f.params]
  );
  return withDefinition('work_orders_completed', period, filterRecord(filters), {
    count: Number(row!.total),
  });
}

/* -------------------------------------------------------------------------- */
/* backlog                                                                     */
/* -------------------------------------------------------------------------- */

export interface BacklogData {
  count: number;
  buckets: Record<AgeBucket, number>;
  oldestDays: number | null;
}

/**
 * O backlog na data de corte.
 *
 * Consulta direta ao fato, mas com semântica de "agora": o §25 classifica
 * backlog como tempo real, e a projeção mantida por gatilho não introduz atraso
 * — o fato nasce na mesma transação da OS.
 */
export async function backlog(
  session: TenantSession,
  asOf: Date = new Date(),
  filters: MetricFilters = {}
): Promise<MetricResult<BacklogData>> {
  const f = factFilter(filters, 2);
  const rows = await session.query<{ days: string }>(
    `SELECT (EXTRACT(EPOCH FROM ($1::timestamptz - f.opened_at)) / 86400)::int AS days
       FROM aurora.fact_work_order f
      WHERE f.opened_at IS NOT NULL
        AND f.opened_at <= $1
        AND NOT f.cancelled
        AND (f.completed_at IS NULL OR f.completed_at > $1)
        ${f.sql}`,
    [asOf, ...f.params]
  );

  const idades = rows.map((r) => Math.max(0, Number(r.days)));
  return withDefinition('backlog', { from: asOf, to: asOf }, filterRecord(filters), {
    count: idades.length,
    buckets: bucketize(idades),
    oldestDays: idades.length === 0 ? null : Math.max(...idades),
  });
}

/* -------------------------------------------------------------------------- */
/* MTTR e MTBF                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * MTTR sobre corretivas concluídas.
 *
 * A cobertura compara as corretivas concluídas COM tempo de resolução contra
 * todas as corretivas concluídas: uma OS concluída que nunca chegou a ser
 * aberta (nasceu e morreu rascunho) não tem intervalo, e informar isso é o que
 * separa "o mês foi bom" de "o mês tem poucos dados".
 */
export async function mttr(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<Average>> {
  const f = factFilter(filters, 3);
  const rows = await session.query<{ resolution_minutes: number | null }>(
    `SELECT f.resolution_minutes FROM aurora.fact_work_order f
      WHERE f.completed_at >= $1 AND f.completed_at < $2
        AND NOT f.cancelled
        AND f.work_order_type_key = 'corrective'
        ${f.sql}`,
    [period.from, period.to, ...f.params]
  );

  const validas = rows.filter((r) => r.resolution_minutes !== null).map((r) => Number(r.resolution_minutes));
  return withDefinition(
    'mttr',
    period,
    filterRecord(filters),
    average(validas),
    coverage(validas.length, rows.length - validas.length, 'OS corretivas concluídas')
  );
}

export interface MtbfData extends Average {
  /** Ativos que entraram no cálculo (dois ou mais eventos de falha). */
  assetsWithInterval: number;
}

/**
 * MTBF por ativo.
 *
 * A cobertura aqui é a regra do §25 em forma de número: ativos com uma única
 * corretiva não produzem intervalo e ficam de fora, e o painel diz quantos
 * foram. Sem isso, um parque novo — em que quase todo ativo falhou uma vez só —
 * exibiria um MTBF calculado sobre um punhado de equipamentos como se fosse do
 * parque inteiro.
 */
export async function mtbf(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<MtbfData>> {
  const f = factFilter(filters, 3);
  const rows = await session.query<{ asset_id: string; opened_at: Date }>(
    `SELECT f.asset_id, f.opened_at FROM aurora.fact_work_order f
      WHERE f.asset_id IS NOT NULL
        AND f.opened_at >= $1 AND f.opened_at < $2
        AND f.work_order_type_key = 'corrective'
        AND NOT f.cancelled
        ${f.sql}
      ORDER BY f.asset_id, f.opened_at`,
    [period.from, period.to, ...f.params]
  );

  const porAtivo = new Map<string, Date[]>();
  for (const r of rows) {
    const lista = porAtivo.get(r.asset_id) ?? [];
    lista.push(new Date(r.opened_at));
    porAtivo.set(r.asset_id, lista);
  }

  const intervalos: number[] = [];
  let comIntervalo = 0;
  for (const falhas of porAtivo.values()) {
    const i = failureIntervals(falhas);
    if (i.length > 0) comIntervalo++;
    intervalos.push(...i);
  }

  const media = average(intervalos);
  return withDefinition(
    'mtbf',
    period,
    filterRecord(filters),
    { ...media, assetsWithInterval: comIntervalo },
    coverage(comIntervalo, porAtivo.size - comIntervalo, 'ativos com corretiva no período')
  );
}

/* -------------------------------------------------------------------------- */
/* SLA                                                                         */
/* -------------------------------------------------------------------------- */

export interface SlaData {
  met: number;
  breached: number;
  rate: number | null;
  byKind: Record<string, { met: number; breached: number; rate: number | null }>;
}

export async function slaCompliance(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<SlaData>> {
  const rows = await session.query<{ kind: string; state: string; total: string }>(
    `SELECT c.kind::text AS kind, c.state::text AS state, count(*)::text AS total
       FROM aurora.sla_clocks c
      WHERE c.stopped_at >= $1 AND c.stopped_at < $2
        AND c.state IN ('met', 'breached')
        AND ($3::uuid IS NULL OR EXISTS (
              SELECT 1 FROM aurora.fact_work_order f
               WHERE f.work_order_id = c.document_id AND f.customer_id = $3))
        AND (($4::uuid[] IS NULL AND $5::text[] IS NULL) OR EXISTS (
              SELECT 1 FROM aurora.fact_work_order f
               WHERE f.work_order_id = c.document_id
                 AND ${scopeSql('f.customer_id', 'f.location_path', 4)}))
      GROUP BY 1, 2`,
    [period.from, period.to, filters.customerId ?? null, ...scopeParams(filters)]
  );

  const porAlvo: SlaData['byKind'] = {};
  let cumpridos = 0;
  let violados = 0;

  for (const r of rows) {
    const alvo = (porAlvo[r.kind] ??= { met: 0, breached: 0, rate: null });
    const n = Number(r.total);
    if (r.state === 'met') {
      alvo.met += n;
      cumpridos += n;
    } else {
      alvo.breached += n;
      violados += n;
    }
  }

  for (const alvo of Object.values(porAlvo)) {
    const total = alvo.met + alvo.breached;
    alvo.rate = total > 0 ? Number(((alvo.met / total) * 100).toFixed(1)) : null;
  }

  const total = cumpridos + violados;

  // O denominador honesto do §11: OS sem política não têm relógio, então não
  // entram — e a cobertura diz quantas ficaram de fora, em vez de deixar o
  // indicador parecer completo.
  const f = factFilter(filters, 3);
  const [semSla] = await session.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM aurora.fact_work_order f
      WHERE f.completed_at >= $1 AND f.completed_at < $2 AND NOT f.cancelled
        AND NOT EXISTS (
          SELECT 1 FROM aurora.sla_clocks c
           WHERE c.document_id = f.work_order_id AND c.document_type = 'work_order')
        ${f.sql}`,
    [period.from, period.to, ...f.params]
  );

  return withDefinition(
    'sla_compliance',
    period,
    filterRecord(filters),
    {
      met: cumpridos,
      breached: violados,
      rate: total > 0 ? Number(((cumpridos / total) * 100).toFixed(1)) : null,
      byKind: porAlvo,
    },
    coverage(total, Number(semSla!.total), 'relógios de SLA')
  );
}

/* -------------------------------------------------------------------------- */
/* onde o fluxo trava                                                          */
/* -------------------------------------------------------------------------- */

export interface StatusTime {
  key: string;
  label: string;
  minutes: number;
  occurrences: number;
}

/**
 * Tempo somado por situação, a partir do histórico.
 *
 * Lê `seconds_in_from`, que o gatilho do EPIC-008 já grava na linha que FECHA
 * cada permanência. Recalcular a duração aqui por janela (`lead` sobre o
 * histórico) daria um segundo jeito de obter o mesmo número — e dois jeitos
 * divergem no primeiro caso de borda, sem ninguém perceber que o painel e o
 * detalhe da OS passaram a discordar.
 *
 * A situação CORRENTE fica de fora naturalmente: a permanência dela ainda não
 * terminou e por isso não tem linha. Incluí-la com o tempo até agora faria o
 * número crescer sozinho a cada recarga da tela.
 */
export async function timeByStatus(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<StatusTime[]>> {
  const rows = await session.query<{
    key: string;
    label: string;
    minutes: string;
    occurrences: string;
  }>(
    `SELECT s.key, s.label,
            (sum(h.seconds_in_from) / 60)::bigint::text AS minutes,
            count(*)::text AS occurrences
       FROM aurora.work_order_status_history h
       JOIN aurora.work_order_statuses s ON s.id = h.from_status_id
       JOIN aurora.fact_work_order f ON f.work_order_id = h.work_order_id
      WHERE h.changed_at >= $1 AND h.changed_at < $2
        AND h.from_status_id IS NOT NULL
        AND ${scopeSql('f.customer_id', 'f.location_path', 3)}
      GROUP BY s.key, s.label
      ORDER BY 3 DESC`,
    [period.from, period.to, ...scopeParams(filters)]
  );

  return withDefinition(
    'time_by_status',
    period,
    {},
    rows.map((r) => ({
      key: r.key,
      label: r.label,
      minutes: Number(r.minutes),
      occurrences: Number(r.occurrences),
    }))
  );
}

/**
 * Tempo somado por motivo de espera — o indicador novo do §25.
 *
 * É a resposta para "onde o trabalho para, e por culpa de quem": o motivo traz
 * o responsável pela liberação junto. Na referência esse número não existe, e é
 * por isso que os 789 registros de "aguardando peça" nunca viraram decisão.
 *
 * O motivo lido é o do estado que TERMINA — é assim que o gatilho do EPIC-008
 * grava, e é o que faz "tempo esperando peça" ser somável.
 */
export async function timeByWaitReason(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<Array<StatusTime & { responsible: string; pausesSla: boolean }>>> {
  const rows = await session.query<{
    key: string;
    label: string;
    responsible: string;
    pauses_sla: boolean;
    minutes: string;
    occurrences: string;
  }>(
    `SELECT r.key, r.label, r.responsible::text AS responsible, r.pauses_sla,
            (sum(h.seconds_in_from) / 60)::bigint::text AS minutes,
            count(*)::text AS occurrences
       FROM aurora.work_order_status_history h
       JOIN aurora.wait_reasons r ON r.id = h.wait_reason_id
       JOIN aurora.fact_work_order f ON f.work_order_id = h.work_order_id
      WHERE h.changed_at >= $1 AND h.changed_at < $2
        AND h.wait_reason_id IS NOT NULL
        AND ${scopeSql('f.customer_id', 'f.location_path', 3)}
      GROUP BY r.key, r.label, r.responsible, r.pauses_sla
      ORDER BY 5 DESC`,
    [period.from, period.to, ...scopeParams(filters)]
  );

  return withDefinition(
    'time_by_wait_reason',
    period,
    {},
    rows.map((r) => ({
      key: r.key,
      label: r.label,
      responsible: r.responsible,
      pausesSla: r.pauses_sla,
      minutes: Number(r.minutes),
      occurrences: Number(r.occurrences),
    }))
  );
}

/* -------------------------------------------------------------------------- */
/* maturidade e conformidade                                                   */
/* -------------------------------------------------------------------------- */

export interface MixData {
  preventive: number;
  corrective: number;
  preventiveShare: number | null;
}

export async function preventiveVsCorrective(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<MixData>> {
  const f = factFilter(filters, 3);
  const rows = await session.query<{ work_order_type_key: string | null; total: string }>(
    `SELECT f.work_order_type_key, count(*)::text AS total
       FROM aurora.fact_work_order f
      WHERE f.completed_at >= $1 AND f.completed_at < $2 AND NOT f.cancelled ${f.sql}
      GROUP BY 1`,
    [period.from, period.to, ...f.params]
  );

  const preventiva = Number(rows.find((r) => r.work_order_type_key === 'preventive')?.total ?? 0);
  const corretiva = Number(rows.find((r) => r.work_order_type_key === 'corrective')?.total ?? 0);
  const outras = rows
    .filter((r) => r.work_order_type_key !== 'preventive' && r.work_order_type_key !== 'corrective')
    .reduce((a, r) => a + Number(r.total), 0);

  const base = preventiva + corretiva;
  return withDefinition(
    'preventive_vs_corrective',
    period,
    filterRecord(filters),
    {
      preventive: preventiva,
      corrective: corretiva,
      preventiveShare: base > 0 ? Number(((preventiva / base) * 100).toFixed(1)) : null,
    },
    coverage(base, outras, 'OS concluídas')
  );
}

export async function planCompliance(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<{ expected: number; done: number; skipped: number; rate: number | null }>> {
  const [row] = await session.query<{
    expected: string;
    done: string;
    skipped: string;
  }>(
    `SELECT count(*)::text AS expected,
            count(*) FILTER (WHERE i.status = 'done')::text AS done,
            count(*) FILTER (WHERE i.status = 'skipped')::text AS skipped
       FROM aurora.plan_cycle_items i
       JOIN aurora.assets a ON a.id = i.asset_id
      WHERE i.due_at >= $1 AND i.due_at < $2
        AND ($3::uuid IS NULL OR a.customer_id = $3)
        AND ${scopeSql('a.customer_id', 'a.location_path', 4)}`,
    [period.from, period.to, filters.customerId ?? null, ...scopeParams(filters)]
  );

  const previstos = Number(row!.expected);
  const concluidos = Number(row!.done);
  const dispensados = Number(row!.skipped);
  const denominador = previstos - dispensados;

  return withDefinition(
    'plan_compliance',
    period,
    filterRecord(filters),
    {
      expected: previstos,
      done: concluidos,
      skipped: dispensados,
      rate: denominador > 0 ? Number(((concluidos / denominador) * 100).toFixed(1)) : null,
    },
    coverage(denominador, dispensados, 'itens previstos')
  );
}

/* -------------------------------------------------------------------------- */
/* pessoas                                                                     */
/* -------------------------------------------------------------------------- */

export interface ProductivityRow {
  membershipId: string;
  name: string | null;
  completed: number;
  laborMinutes: number;
}

export async function productivity(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<ProductivityRow[]>> {
  const f = factFilter(filters, 3);
  const rows = await session.query<{
    membership_id: string;
    name: string | null;
    completed: string;
    labor: string;
  }>(
    `SELECT f.assignee_membership_id AS membership_id, u.name,
            count(*)::text AS completed,
            COALESCE(sum(f.labor_minutes), 0)::text AS labor
       FROM aurora.fact_work_order f
       LEFT JOIN aurora.memberships m ON m.id = f.assignee_membership_id
       LEFT JOIN aurora.users u ON u.id = m.user_id
      WHERE f.completed_at >= $1 AND f.completed_at < $2
        AND NOT f.cancelled
        AND f.assignee_membership_id IS NOT NULL
        ${f.sql}
      GROUP BY 1, 2
      ORDER BY 3 DESC`,
    [period.from, period.to, ...f.params]
  );

  return withDefinition(
    'productivity',
    period,
    filterRecord(filters),
    rows.map((r) => ({
      membershipId: r.membership_id,
      name: r.name,
      completed: Number(r.completed),
      laborMinutes: Number(r.labor),
    }))
  );
}

export async function laborHours(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<{ hours: number; entries: number }>> {
  const f = factFilter(filters, 3);
  const [row] = await session.query<{ minutes: string; entries: string }>(
    `SELECT COALESCE(sum(EXTRACT(EPOCH FROM (t.ended_at - t.started_at)) / 60), 0)::bigint::text AS minutes,
            count(*)::text AS entries
       FROM aurora.time_entries t
       JOIN aurora.fact_work_order f ON f.work_order_id = t.work_order_id
      WHERE t.ended_at IS NOT NULL
        AND t.started_at >= $1 AND t.started_at < $2
        ${f.sql}`,
    [period.from, period.to, ...f.params]
  );

  return withDefinition('labor_hours', period, filterRecord(filters), {
    hours: Number((Number(row!.minutes) / 60).toFixed(2)),
    entries: Number(row!.entries),
  });
}

/* -------------------------------------------------------------------------- */
/* percepção de atendimento                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Tempo de primeira resposta — o que substitui a sigla "TMAC" da referência.
 *
 * Mede da submissão da solicitação até a primeira triagem humana. É consulta
 * direta ao transacional porque solicitações são poucas em relação a OS e o
 * recorte é sempre curto: não é o painel de doze meses que a regra de ouro
 * protege.
 */
export async function firstResponseTime(
  session: TenantSession,
  period: Period,
  filters: MetricFilters = {}
): Promise<MetricResult<Average>> {
  const rows = await session.query<{ minutes: string }>(
    `WITH triagem AS (
       SELECT h.request_id, min(h.changed_at) AS triaged_at
         FROM aurora.service_request_status_history h
        WHERE h.to_status = 'triage'
        GROUP BY 1
     )
     SELECT (EXTRACT(EPOCH FROM (t.triaged_at - r.submitted_at)) / 60)::bigint::text AS minutes
       FROM triagem t
       JOIN aurora.service_requests r ON r.id = t.request_id
      WHERE t.triaged_at >= $1 AND t.triaged_at < $2
        AND r.submitted_at IS NOT NULL
        AND ($3::uuid IS NULL OR r.customer_id = $3)
        AND ($4::uuid[] IS NULL OR r.customer_id = ANY($4::uuid[]))`,
    [period.from, period.to, filters.customerId ?? null, scopeParams(filters)[0]]
  );

  const [naoTriadas] = await session.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM aurora.service_requests
      WHERE submitted_at >= $1 AND submitted_at < $2 AND status = 'submitted'
        AND ($3::uuid IS NULL OR customer_id = $3)
        AND ($4::uuid[] IS NULL OR customer_id = ANY($4::uuid[]))`,
    [period.from, period.to, filters.customerId ?? null, scopeParams(filters)[0]]
  );

  const minutos = rows.map((r) => Math.max(0, Number(r.minutes)));
  return withDefinition(
    'first_response_time',
    period,
    filterRecord(filters),
    average(minutos),
    coverage(minutos.length, Number(naoTriadas!.total), 'solicitações do período')
  );
}

/* -------------------------------------------------------------------------- */
/* manutenção da projeção                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Reconstrói a tabela de fato da organização.
 *
 * Toda projeção precisa de um caminho de volta. Quando alguém desconfia do
 * número — e alguém sempre desconfia —, a resposta não pode ser "confie": é
 * rodar isto e comparar.
 */
export async function rebuildFacts(session: TenantSession): Promise<number> {
  const [row] = await session.query<{ total: string }>(
    `SELECT aurora.rebuild_fact_work_order($1)::text AS total`,
    [session.context.organizationId]
  );
  return Number(row!.total);
}
