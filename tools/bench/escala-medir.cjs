/**
 * Medição antes/depois (auditoria 23/11/2026). MESMA metodologia nos dois lados:
 *   · transação com SET LOCAL ROLE aurora_app + set_config da organização (RLS ativa, como a API);
 *   · 3 execuções de aquecimento descartadas + REPS medidas; p50/p95 do "Execution Time" do
 *     EXPLAIN (ANALYZE, BUFFERS); buffers = blocos lidos pelo nó raiz.
 *   · "antes" roda sem os índices novos; depois cria os índices da 0091 no MESMO banco, ANALYZE,
 *     e mede de novo. Consultas reescritas são medidas lado a lado (velha × nova).
 * Uso: node tools/bench/escala-medir.cjs [--json saida.json]   (MASSA_ATIVOS, MASSA_OS, REPS opcionais)
 */
const fs = require('node:fs');
const path = require('node:path');
const { criarBanco } = require('./escala-massa.cjs');
const REPS = Number(process.env.REPS ?? 15);
const AQUEC = 3;

async function medir(pg, org, nome, sql, params = []) {
  const tempos = [];
  let buffers = 0,
    linhas = 0,
    plano = '';
  for (let i = 0; i < REPS + AQUEC; i++) {
    const r = await pg.transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE aurora_app');
      await tx.query(`SELECT set_config('aurora.organization_id', $1, true)`, [org]);
      return tx.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
    });
    const raiz = r.rows[0]['QUERY PLAN'][0];
    if (i >= AQUEC) {
      tempos.push(raiz['Execution Time']);
      buffers = (raiz.Plan['Shared Hit Blocks'] ?? 0) + (raiz.Plan['Shared Read Blocks'] ?? 0);
      linhas = raiz.Plan['Actual Rows'];
      plano = resumo(raiz.Plan);
    }
  }
  tempos.sort((a, b) => a - b);
  const pct = (x) => tempos[Math.min(tempos.length - 1, Math.floor((x / 100) * tempos.length))];
  const r = { nome, p50_ms: +pct(50).toFixed(2), p95_ms: +pct(95).toFixed(2), buffers, linhas, plano };
  console.log(
    `${nome.padEnd(52)} p50 ${String(r.p50_ms).padStart(9)} ms  p95 ${String(r.p95_ms).padStart(9)} ms  buf ${String(buffers).padStart(7)}  linhas ${String(linhas).padStart(6)} | ${plano}`
  );
  return r;
}

function resumo(p) {
  const nos = [];
  (function v(n) {
    if (/Scan/.test(n['Node Type']))
      nos.push(`${n['Node Type']}(${n['Index Name'] ?? n['Relation Name'] ?? ''})`);
    for (const f of n.Plans ?? []) v(f);
  })(p);
  return [...new Set(nos)].slice(0, 5).join(' › ');
}

const ANY = (c) => `s.id = ANY (string_to_array(btrim(${c}, '/'), '/')::uuid[])`;
const UNNEST_SETOR = `SELECT s.id AS location_id, s.name, c.name AS customer_name, count(a.id)::text AS assets
       FROM aurora.assets a
       CROSS JOIN LATERAL unnest(string_to_array(btrim(a.location_path, '/'), '/')::uuid[]) AS anc(id)
       JOIN aurora.locations s ON s.id = anc.id AND s.deleted_at IS NULL
       JOIN aurora.location_types t ON t.id = s.location_type_id AND t.key = 'setor'
       JOIN aurora.customers c ON c.id = s.customer_id
      WHERE a.deleted_at IS NULL AND a.status::text NOT IN ('decommissioned', 'disposed')
      GROUP BY 1, 2, 3 ORDER BY count(a.id) DESC, s.name LIMIT 10`;
const UNNEST_SEM = `SELECT count(*)::text AS total FROM aurora.assets a
      WHERE a.deleted_at IS NULL AND a.status::text NOT IN ('decommissioned', 'disposed')
        AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(btrim(a.location_path, '/'), '/')::uuid[]) AS anc(id)
            JOIN aurora.locations s ON s.id = anc.id AND s.deleted_at IS NULL
            JOIN aurora.location_types t ON t.id = s.location_type_id AND t.key = 'setor')`;
const SQL = {
  listaOs: `SELECT w.id, w.number, w.title, w.status_category::text AS category, w.priority::text AS priority,
                w.customer_id, w.asset_id, w.location_name_snapshot, w.asset_name_snapshot,
                w.scheduled_start, w.created_at, w.version,
                st.key AS status_key, st.label AS status_label, st.color AS status_color,
                wr.key AS wait_reason_key, wr.label AS wait_reason_label
           FROM aurora.work_orders w
           JOIN aurora.work_order_statuses st ON st.id = w.status_id
           LEFT JOIN aurora.wait_reasons wr   ON wr.id = w.wait_reason_id
          ORDER BY w.created_at DESC LIMIT 100`,
  slaMes: `SELECT c.kind::text AS kind, c.state::text AS state, count(*)::text AS total
       FROM aurora.sla_clocks c
      WHERE c.stopped_at >= $1 AND c.stopped_at < $2 AND c.state IN ('met', 'breached')
      GROUP BY 1, 2`,
  tempoPorSituacao: `SELECT s.key, s.label, (sum(h.seconds_in_from) / 60)::bigint::text AS minutes, count(*)::text AS occurrences
       FROM aurora.work_order_status_history h
       JOIN aurora.work_order_statuses s ON s.id = h.from_status_id
       JOIN aurora.fact_work_order f ON f.work_order_id = h.work_order_id
      WHERE h.changed_at >= $1 AND h.changed_at < $2 AND h.from_status_id IS NOT NULL
      GROUP BY s.key, s.label ORDER BY 3 DESC`,
  setor: (cond) => `SELECT s.id AS location_id, s.name, c.name AS customer_name, count(a.id)::text AS assets
       FROM aurora.assets a
       JOIN aurora.locations s ON ${cond} AND s.deleted_at IS NULL
       JOIN aurora.location_types t ON t.id = s.location_type_id AND t.key = 'setor'
       JOIN aurora.customers c ON c.id = s.customer_id
      WHERE a.deleted_at IS NULL AND a.status::text NOT IN ('decommissioned', 'disposed')
      GROUP BY 1, 2, 3 ORDER BY count(a.id) DESC, s.name LIMIT 10`,
  semSetor: (cond) => `SELECT count(*)::text AS total FROM aurora.assets a
      WHERE a.deleted_at IS NULL AND a.status::text NOT IN ('decommissioned', 'disposed')
        AND NOT EXISTS (SELECT 1 FROM aurora.locations s
            JOIN aurora.location_types t ON t.id = s.location_type_id AND t.key = 'setor'
           WHERE ${cond} AND s.deleted_at IS NULL)`,
  setorPorItem: (cond) => `SELECT a.id, (SELECT s.name FROM aurora.locations s
                 JOIN aurora.location_types lt ON lt.id = s.location_type_id AND lt.key = 'setor'
                WHERE ${cond} AND s.deleted_at IS NULL ORDER BY s.depth DESC LIMIT 1) AS sector_name
         FROM aurora.assets a WHERE a.deleted_at IS NULL ORDER BY a.name LIMIT 2000`,
  varredura: (extra) => `SELECT id, document_type, document_id, kind::text AS kind, started_at, due_at,
            target_minutes, warned_at, calendar_snapshot
       FROM aurora.sla_clocks WHERE state = 'running' ${extra} ORDER BY due_at`,
};

const INDICES = [
  `CREATE INDEX wo_org_created_idx ON aurora.work_orders (organization_id, created_at DESC)`,
  `CREATE INDEX sla_clocks_stopped_idx ON aurora.sla_clocks (organization_id, stopped_at) WHERE state IN ('met', 'breached')`,
  `CREATE INDEX wosh_org_changed_idx ON aurora.work_order_status_history (organization_id, changed_at)`,
];

async function rodada(pg, org, fase) {
  const mes = ['2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z'];
  const out = [];
  const m = async (...a) => out.push({ fase, ...(await medir(pg, org, ...a)) });
  await m('lista de OS sem filtro (LIMIT 100)', SQL.listaOs);
  await m('SLA cumprido no mês (stopped_at)', SQL.slaMes, mes);
  await m('tempo por situação no mês (changed_at)', SQL.tempoPorSituacao, mes);
  if (fase === 'antes') {
    await m('painel: ativos por setor — LIKE', SQL.setor(`a.location_path LIKE s.path || '%'`));
    await m('painel: ativos por setor — ANY', SQL.setor(ANY('a.location_path')));
    await m('painel: ativos por setor — UNNEST', UNNEST_SETOR);
    await m('painel: ativos sem setor — UNNEST', UNNEST_SEM);
    await m('painel: ativos sem setor — LIKE', SQL.semSetor(`a.location_path LIKE s.path || '%'`));
    await m('painel: ativos sem setor — ANY', SQL.semSetor(ANY('a.location_path')));
    await m('planos: setor por item (2000) — LIKE', SQL.setorPorItem(`a.location_path LIKE s.path || '%'`));
    await m('planos: setor por item (2000) — ANY', SQL.setorPorItem(ANY('a.location_path')));
    await m('varredura SLA — todos running', SQL.varredura(''));
    await m('varredura SLA — running sem estouro', SQL.varredura('AND breached_at IS NULL'));
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const { pg, orgGrande } = await criarBanco();
  const [massa] = (
    await pg.query(
      `SELECT
      (SELECT count(*) FROM aurora.organizations)::int AS orgs,
      (SELECT count(*) FROM aurora.work_orders)::int AS os,
      (SELECT count(*) FROM aurora.work_orders WHERE organization_id = $1)::int AS os_org_grande,
      (SELECT count(*) FROM aurora.assets)::int AS ativos,
      (SELECT count(*) FROM aurora.locations)::int AS locais,
      (SELECT count(*) FROM aurora.sla_clocks)::int AS relogios,
      (SELECT count(*) FROM aurora.sla_clocks WHERE state = 'running' AND breached_at IS NOT NULL)::int AS relogios_estourados_em_curso,
      (SELECT count(*) FROM aurora.work_order_status_history)::int AS historico,
      (SELECT count(*) FROM aurora.fact_work_order)::int AS fatos`,
      [orgGrande]
    )
  ).rows;
  console.log('massa:', JSON.stringify(massa), `(${Math.round((Date.now() - t0) / 1000)} s)`);
  console.log('\n— ANTES (sem índices novos) —');
  const antes = await rodada(pg, orgGrande, 'antes');
  for (const i of INDICES) await pg.query(i);
  for (const t of ['work_orders', 'sla_clocks', 'work_order_status_history'])
    await pg.query(`ANALYZE aurora.${t}`);
  console.log('\n— DEPOIS (com os índices da 0091) —');
  const depois = await rodada(pg, orgGrande, 'depois');
  const i = process.argv.indexOf('--json');
  if (i > 0)
    fs.writeFileSync(
      process.argv[i + 1],
      JSON.stringify({ massa, reps: REPS, aquecimento: AQUEC, medidas: [...antes, ...depois] }, null, 2)
    );
  await pg.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
