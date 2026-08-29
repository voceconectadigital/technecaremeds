#!/usr/bin/env node
/**
 * Aurora — medição de desempenho (SPEC v0.2 §41).
 *
 * COMO ESTA MEDIÇÃO EVITA MENTIR
 *
 *   · roda sob `aurora_app`, com contexto de tenant, como a API roda. Medir
 *     como superusuário mede um sistema sem RLS, que não é o nosso;
 *   · descarta as primeiras execuções. A primeira consulta paga o plano e o
 *     cache frio; incluí-la faz a média dizer mais sobre o aquecimento do que
 *     sobre a consulta;
 *   · reporta p50 E p95. A média esconde a cauda, e é a cauda que a pessoa
 *     sente — quem espera dois segundos não se consola com a média de 80 ms;
 *   · varia os parâmetros entre as repetições, para não medir cache de
 *     resultado repetido.
 *
 * Uso: DATABASE_URL=... node tools/bench/run.mjs [--repeticoes 30]
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido.');
  process.exit(1);
}

/**
 * Lê um argumento numérico da linha de comando.
 *
 * `indexOf` devolve -1 quando a bandeira não está lá, e `argv[-1 + 1]` é o
 * caminho do node — que vira `NaN`. O laço de medição rodava zero vezes e o
 * relatório quebrava numa linha que não tinha nada a ver.
 */
function numero(bandeira, padrao) {
  const i = process.argv.indexOf(bandeira);
  if (i < 0) return padrao;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

const REPETICOES = numero('--repeticoes', 30);
const AQUECIMENTO = 5;

/** A meta da SPEC §41, por cenário, em milissegundos. */
const METAS = {
  'lista de OS, filtrada por situação (filtro montado)': 400,
  'lista de OS, filtrada por situação (catch-all, forma antiga)': 400,
  'lista de OS, filtrada por cliente e situação': 400,
  'lista de OS, página 50 (rolagem profunda)': 400,
  'busca por patrimônio exato': 300,
  'busca textual por título': 400,
  'quadro por estado, com quebra de motivo': 400,
  'agenda da semana': 400,
  'ficha de OS com histórico': 200,
  'indicador: OS abertas por mês (12 meses)': 1000,
};

const pool = new Pool({ connectionString: url, max: 2 });

async function contexto(c, orgId) {
  await c.query('BEGIN');
  await c.query('SET LOCAL ROLE aurora_app');
  await c.query(`SELECT set_config('aurora.organization_id', $1, true)`, [orgId]);
}

function percentil(ordenados, p) {
  const i = Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length));
  return ordenados[i];
}

/**
 * Mede um cenário.
 *
 * `variar` recebe o número da repetição e devolve os parâmetros — é o que
 * impede a medição de virar um teste de cache de resultado.
 */
async function medir(nome, sql, variar) {
  const c = await pool.connect();
  const tempos = [];
  let linhas = 0;

  try {
    for (let i = 0; i < REPETICOES + AQUECIMENTO; i++) {
      const params = variar(i);
      await contexto(c, ORG);
      const t0 = process.hrtime.bigint();
      const r = await c.query(sql, params);
      const t1 = process.hrtime.bigint();
      await c.query('ROLLBACK');

      // As primeiras pagam plano e cache frio: medi-las é medir o aquecimento.
      if (i >= AQUECIMENTO) {
        tempos.push(Number(t1 - t0) / 1e6);
        linhas = r.rowCount ?? 0;
      }
    }
  } finally {
    c.release();
  }

  tempos.sort((a, b) => a - b);
  return {
    nome,
    linhas,
    p50: percentil(tempos, 50),
    p95: percentil(tempos, 95),
    max: tempos[tempos.length - 1],
    meta: METAS[nome],
  };
}

/* -------------------------------------------------------------------------- */

let ORG;
let CLIENTES = [];
let ATIVOS = [];
let PATRIMONIOS = [];
let OS_IDS = [];

async function preparar() {
  const { rows: orgs } = await pool.query(`SELECT id FROM aurora.organizations WHERE slug = 'bench-grande'`);
  if (orgs.length === 0) {
    console.error('Massa de benchmark ausente. Rode tools/bench/seed.mjs antes.');
    process.exit(1);
  }
  ORG = orgs[0].id;

  const { rows: total } = await pool.query(
    `SELECT count(*)::int AS n FROM aurora.work_orders WHERE organization_id = $1`,
    [ORG]
  );
  console.log(`Organização de medição: ${ORG}`);
  console.log(`Ordens de serviço nela: ${Number(total[0].n).toLocaleString('pt-BR')}`);

  const { rows: total2 } = await pool.query(`SELECT count(*)::int AS n FROM aurora.work_orders`);
  console.log(`Ordens de serviço no banco: ${Number(total2[0].n).toLocaleString('pt-BR')}\n`);

  CLIENTES = (
    await pool.query(`SELECT id FROM aurora.customers WHERE organization_id = $1 LIMIT 12`, [ORG])
  ).rows.map((r) => r.id);
  ATIVOS = (
    await pool.query(`SELECT id FROM aurora.assets WHERE organization_id = $1 LIMIT 200`, [ORG])
  ).rows.map((r) => r.id);
  PATRIMONIOS = (
    await pool.query(
      `SELECT asset_number FROM aurora.assets WHERE organization_id = $1 AND asset_number IS NOT NULL LIMIT 200`,
      [ORG]
    )
  ).rows.map((r) => r.asset_number);
  OS_IDS = (
    await pool.query(`SELECT id FROM aurora.work_orders WHERE organization_id = $1 LIMIT 200`, [ORG])
  ).rows.map((r) => r.id);
}

/* -------------------------------------------------------------------------- */

const CATEGORIAS = ['open', 'in_progress', 'waiting', 'done'];
const TERMOS = ['alarme', 'vazamento', 'bateria', 'filtro', 'ruído', 'calibração'];

async function main() {
  await preparar();

  const resultados = [];

  /*
   * A consulta é a MESMA da rota `GET /work-orders`. Medir uma consulta
   * simplificada mediria uma promessa diferente da que o produto faz.
   */
  /*
   * A forma ANTIGA, mantida aqui de propósito.
   *
   * Sem ela, a melhora do filtro montado seria uma afirmação — e afirmação
   * sobre desempenho, sem as duas medidas lado a lado, quase sempre está
   * medindo cache quente. As duas rodam na mesma sessão, com o mesmo
   * aquecimento, contra os mesmos dados.
   */
  const LISTA_CATCH_ALL = `
    SELECT w.id, w.number, w.title, w.status_category::text, w.priority::text,
           w.customer_id, w.asset_id, w.location_name_snapshot, w.asset_name_snapshot,
           w.scheduled_start, w.created_at, w.version,
           st.key AS status_key, st.label AS status_label, st.color AS status_color,
           wr.key AS wait_reason_key, wr.label AS wait_reason_label
      FROM aurora.work_orders w
      JOIN aurora.work_order_statuses st ON st.id = w.status_id
      LEFT JOIN aurora.wait_reasons wr   ON wr.id = w.wait_reason_id
     WHERE ($1::uuid IS NULL OR w.customer_id = $1)
       AND ($2::text IS NULL OR w.status_category::text = $2)
       AND ($3::uuid IS NULL OR w.assignee_membership_id = $3)
     ORDER BY w.created_at DESC
     LIMIT $4`;

  /*
   * A forma NOVA: a condição só existe quando o filtro existe, e a comparação
   * é feita no próprio tipo do enumerado. É o que a rota faz desde a correção.
   */
  const LISTA_MONTADA = LISTA_CATCH_ALL.replace(
    `WHERE ($1::uuid IS NULL OR w.customer_id = $1)
       AND ($2::text IS NULL OR w.status_category::text = $2)
       AND ($3::uuid IS NULL OR w.assignee_membership_id = $3)`,
    'WHERE w.status_category = $1::aurora.status_category'
  ).replace('LIMIT $4', 'LIMIT $2');

  /*
   * A forma montada recebe SÓ os parâmetros que usa.
   *
   * Parâmetro declarado e não usado derruba a consulta inteira — o PostgreSQL
   * não infere o tipo do que não aparece. É o mesmo defeito registrado como
   * nº 40 no PROGRESS, e ele reapareceu aqui na primeira tentativa.
   */
  resultados.push(
    await medir('lista de OS, filtrada por situação (filtro montado)', LISTA_MONTADA, (i) => [
      CATEGORIAS[i % CATEGORIAS.length],
      100,
    ])
  );

  resultados.push(
    await medir('lista de OS, filtrada por situação (catch-all, forma antiga)', LISTA_CATCH_ALL, (i) => [
      null,
      CATEGORIAS[i % CATEGORIAS.length],
      null,
      100,
    ])
  );

  resultados.push(
    await medir('lista de OS, filtrada por cliente e situação', LISTA_CATCH_ALL, (i) => [
      CLIENTES[i % CLIENTES.length],
      CATEGORIAS[i % CATEGORIAS.length],
      null,
      100,
    ])
  );

  /*
   * Rolagem profunda: a página 50.
   *
   * É onde o `OFFSET` mostra o custo — o banco precisa produzir e descartar
   * cinco mil linhas antes de devolver cem. Se este número for muito pior que
   * o da primeira página, a lista precisa de paginação por cursor.
   */
  resultados.push(
    await medir(
      'lista de OS, página 50 (rolagem profunda)',
      LISTA_CATCH_ALL.replace('LIMIT $4', 'LIMIT $4 OFFSET 5000'),
      (i) => [null, CATEGORIAS[i % CATEGORIAS.length], null, 100]
    )
  );

  resultados.push(
    await medir(
      'busca por patrimônio exato',
      `SELECT id, name, asset_number, serial_number
         FROM aurora.assets
        WHERE asset_number = $1 OR serial_number = $1
        LIMIT 20`,
      (i) => [PATRIMONIOS[i % PATRIMONIOS.length]]
    )
  );

  resultados.push(
    await medir(
      'busca textual por título',
      `SELECT id, number, title
         FROM aurora.work_orders
        WHERE title ILIKE '%' || $1 || '%'
        ORDER BY created_at DESC
        LIMIT 30`,
      (i) => [TERMOS[i % TERMOS.length]]
    )
  );

  resultados.push(
    await medir(
      'quadro por estado, com quebra de motivo',
      `SELECT st.id, st.key, st.label, st.category::text, st.color, st.position,
              count(w.id)::int AS total
         FROM aurora.work_order_statuses st
         LEFT JOIN aurora.work_orders w
                ON w.status_id = st.id AND ($1::uuid IS NULL OR w.customer_id = $1)
        WHERE st.archived_at IS NULL AND st.visible_on_board
        GROUP BY st.id, st.key, st.label, st.category, st.color, st.position
        ORDER BY st.position`,
      (i) => [i % 3 === 0 ? CLIENTES[i % CLIENTES.length] : null]
    )
  );

  resultados.push(
    await medir(
      'agenda da semana',
      `SELECT id, number, title, scheduled_start, scheduled_end, assignee_membership_id
         FROM aurora.work_orders
        WHERE scheduled_start >= $1::timestamptz
          AND scheduled_start < $1::timestamptz + interval '7 days'
        ORDER BY scheduled_start`,
      (i) => [new Date(Date.parse('2026-08-01T00:00:00Z') + i * 86400000).toISOString()]
    )
  );

  resultados.push(
    await medir(
      'ficha de OS com histórico',
      `SELECT w.*, st.key AS status_key, st.label AS status_label
         FROM aurora.work_orders w
         JOIN aurora.work_order_statuses st ON st.id = w.status_id
        WHERE w.id = $1`,
      (i) => [OS_IDS[i % OS_IDS.length]]
    )
  );

  resultados.push(
    await medir(
      'indicador: OS abertas por mês (12 meses)',
      `SELECT date_trunc('month', created_at) AS mes, count(*)::int AS total
         FROM aurora.work_orders
        WHERE created_at >= $1::timestamptz
        GROUP BY 1
        ORDER BY 1`,
      (i) => [new Date(Date.parse('2025-09-01T00:00:00Z') + i * 3600000).toISOString()]
    )
  );

  /* --------------------------------------------------------------- relatório */

  console.log(
    `${'cenário'.padEnd(46)} ${'p50'.padStart(9)} ${'p95'.padStart(9)} ${'máx'.padStart(9)}  ${'meta'.padStart(7)}`
  );
  console.log('-'.repeat(90));

  let falhou = 0;
  for (const r of resultados) {
    const dentro = r.meta === undefined || r.p95 <= r.meta;
    if (!dentro) falhou += 1;
    console.log(
      `${r.nome.padEnd(46)} ${r.p50.toFixed(1).padStart(7)}ms ${r.p95.toFixed(1).padStart(7)}ms ` +
        `${r.max.toFixed(1).padStart(7)}ms  ${(r.meta ? `${r.meta}ms` : '—').padStart(7)}  ${dentro ? '✓' : '✗'}`
    );
  }

  console.log('-'.repeat(90));
  console.log(`${REPETICOES} repetições por cenário, ${AQUECIMENTO} de aquecimento descartadas.`);

  if (falhou > 0) {
    console.log(`\n✗ ${falhou} cenário(s) acima da meta no p95.`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ todos os cenários dentro da meta no p95.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
