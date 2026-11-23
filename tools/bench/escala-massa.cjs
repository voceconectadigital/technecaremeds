/**
 * Massa sintética EM MEMÓRIA (PGlite = PostgreSQL 16.4), gerada por SQL de conjunto.
 * 10 organizações: 1 grande e 9 pequenas — o cenário "10 organizações" do pedido, com a grande
 * representando o pior caso de crescimento. Exporta `criarBanco()` → { pg, orgGrande }.
 * Reprodutível: setseed() fixa o random() do PostgreSQL.
 */
const path = require('node:path');
const Module = require('node:module');
const REPO = process.env.REPO_DIR ?? path.resolve(__dirname, '..', '..');
process.env.TSX_TSCONFIG_PATH ??= path.join(REPO, 'tsconfig.base.json');
const rq = Module.createRequire(path.join(REPO, 'package.json'));
rq('tsx/cjs');
const { PGlite } = rq('@electric-sql/pglite');
const { pgliteAdapter } = rq('./packages/db/src/adapters.ts');
const { migrate } = rq('./packages/db/src/migrator.ts');
const { syncPermissionCatalog } = rq('./packages/db/src/rbac.ts');
const { syncCatalogDefinitions } = rq('./packages/db/src/catalogs.ts');

const ESCALA = {
  grande: { ativos: Number(process.env.MASSA_ATIVOS ?? 5000), os: Number(process.env.MASSA_OS ?? 50000) },
  pequena: { ativos: 300, os: 2000 },
  pequenas: 9,
  clientes: 4,
  unidadesPorCliente: 2,
  setoresPorUnidade: 10,
  salasPorSetor: 2,
};

async function criarBanco(log = console.error) {
  const pg = new PGlite();
  const su = pgliteAdapter(pg, null);
  await migrate(su);
  await syncPermissionCatalog(su);
  await syncCatalogDefinitions(su);
  const q = async (sql, p) => (await pg.query(sql, p)).rows;
  await q(`SELECT setseed(0.42)`);
  const t0 = Date.now();
  let orgGrande = null;
  for (let o = 0; o <= ESCALA.pequenas; o++) {
    const grande = o === 0;
    const e = grande ? ESCALA.grande : ESCALA.pequena;
    const [{ id: org }] = await q(
      `INSERT INTO aurora.organizations (id, slug, name) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [grande ? 'bench-grande' : `bench-p${o}`, grande ? 'Grande' : `Pequena ${o}`]
    );
    if (grande) orgGrande = org;
    await semearOrg(q, org, e);
    log(`  org ${o}: ${e.ativos} ativos, ${e.os} OS (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  for (const t of [
    'work_orders',
    'assets',
    'locations',
    'sla_clocks',
    'work_order_status_history',
    'fact_work_order',
    'customers',
  ])
    await q(`ANALYZE aurora.${t}`);
  return { pg, orgGrande };
}

async function semearOrg(q, org, e) {
  // tipos de local, tipos de OS, situações, categoria
  await q(
    `WITH u AS (INSERT INTO aurora.location_types (id, organization_id, key, name, can_be_root, allows_assets, position, allowed_parent_type_ids)
                VALUES (gen_random_uuid(), $1, 'unidade', 'Unidade', true, true, 1, '{}') RETURNING id),
          s AS (INSERT INTO aurora.location_types (id, organization_id, key, name, can_be_root, allows_assets, position, allowed_parent_type_ids)
                SELECT gen_random_uuid(), $1, 'setor', 'Setor', false, true, 2, ARRAY[u.id] FROM u RETURNING id)
     INSERT INTO aurora.location_types (id, organization_id, key, name, can_be_root, allows_assets, position, allowed_parent_type_ids)
     SELECT gen_random_uuid(), $1, 'sala', 'Sala', false, true, 3, ARRAY[s.id] FROM s`,
    [org]
  );
  await q(
    `INSERT INTO aurora.catalog_items (id, organization_id, catalog_key, key, label, system_key)
     SELECT gen_random_uuid(), $1, 'work_order_type', k, l, s FROM (VALUES ('corretiva','Corretiva','corrective'),('preventiva','Preventiva','preventive'),('calibracao','Calibração',NULL)) v(k,l,s)`,
    [org]
  );
  await q(
    `INSERT INTO aurora.work_order_statuses (id, organization_id, key, label, category, position, visible_on_board)
     SELECT gen_random_uuid(), $1, k, l, c::aurora.status_category, p, true
       FROM (VALUES ('aberta','Aberta','open',1),('em_execucao','Em execução','in_progress',2),('aguardando','Aguardando peça','waiting',3),('concluida','Concluída','done',4)) v(k,l,c,p)`,
    [org]
  );
  await q(
    `INSERT INTO aurora.asset_categories (id, organization_id, name) VALUES (gen_random_uuid(), $1, 'Equipamento médico')`,
    [org]
  );
  await q(
    `INSERT INTO aurora.customers (id, organization_id, name, is_internal)
     SELECT gen_random_uuid(), $1, 'Hospital ' || g, g = 1 FROM generate_series(1, $2) g`,
    [org, ESCALA.clientes]
  );
  // árvore: unidade → setor → sala (o gatilho calcula path/depth)
  await q(
    `INSERT INTO aurora.locations (id, organization_id, customer_id, location_type_id, name)
     SELECT gen_random_uuid(), $1, c.id, t.id, 'Unidade ' || g
       FROM aurora.customers c, aurora.location_types t, generate_series(1, $2) g
      WHERE c.organization_id = $1 AND t.organization_id = $1 AND t.key = 'unidade'`,
    [org, ESCALA.unidadesPorCliente]
  );
  await q(
    `INSERT INTO aurora.locations (id, organization_id, customer_id, location_type_id, parent_id, name)
     SELECT gen_random_uuid(), $1, u.customer_id, t.id, u.id, 'Setor ' || g
       FROM aurora.locations u JOIN aurora.location_types tu ON tu.id = u.location_type_id AND tu.key = 'unidade',
            aurora.location_types t, generate_series(1, $2) g
      WHERE u.organization_id = $1 AND t.organization_id = $1 AND t.key = 'setor'`,
    [org, ESCALA.setoresPorUnidade]
  );
  await q(
    `INSERT INTO aurora.locations (id, organization_id, customer_id, location_type_id, parent_id, name)
     SELECT gen_random_uuid(), $1, s.customer_id, t.id, s.id, 'Sala ' || g
       FROM aurora.locations s JOIN aurora.location_types ts ON ts.id = s.location_type_id AND ts.key = 'setor',
            aurora.location_types t, generate_series(1, $2) g
      WHERE s.organization_id = $1 AND t.organization_id = $1 AND t.key = 'sala'`,
    [org, ESCALA.salasPorSetor]
  );
  // ativos em salas (90%) e em unidades (10%, sem setor)
  await q(
    `WITH l AS (
       SELECT l.id, l.customer_id, t.key, row_number() OVER (PARTITION BY t.key ORDER BY l.id) AS rn,
              count(*) OVER (PARTITION BY t.key) AS n
         FROM aurora.locations l JOIN aurora.location_types t ON t.id = l.location_type_id
        WHERE l.organization_id = $1 AND t.key IN ('sala','unidade'))
     INSERT INTO aurora.assets (id, organization_id, customer_id, asset_category_id, location_id, name, asset_number, serial_number, qr_token)
     SELECT gen_random_uuid(), $1, l.customer_id, (SELECT id FROM aurora.asset_categories WHERE organization_id = $1),
            l.id, 'Equipamento ' || lpad(g::text, 6, '0'), 'PAT-' || g, 'SN' || g, replace(gen_random_uuid()::text, '-', '')
       FROM generate_series(1, $2) g
       JOIN l ON l.key = CASE WHEN g % 10 = 0 THEN 'unidade' ELSE 'sala' END AND l.rn = 1 + (g % l.n)`,
    [org, e.ativos]
  );
  // OS: dois anos, ativo com distribuição torta, situação torta
  await q(`CREATE TEMP TABLE IF NOT EXISTS _a (rn int, id uuid, customer_id uuid, name text)`);
  await q(`TRUNCATE _a`);
  await q(
    `INSERT INTO _a SELECT row_number() OVER (ORDER BY id), id, customer_id, name FROM aurora.assets WHERE organization_id = $1`,
    [org]
  );
  await q(
    `WITH st AS (SELECT id, category, row_number() OVER (ORDER BY position) AS rn FROM aurora.work_order_statuses WHERE organization_id = $1),
          ty AS (SELECT id, row_number() OVER (ORDER BY key) AS rn FROM aurora.catalog_items WHERE organization_id = $1 AND catalog_key = 'work_order_type'),
          g AS (SELECT g, 1 + floor(power(random(), 3) * $3)::int AS arn,
                       CASE WHEN random() < 0.65 THEN 4 ELSE 1 + floor(random() * 3)::int END AS srn,
                       1 + floor(random() * 3)::int AS trn,
                       timestamptz '2026-11-01' - random() * interval '730 days' AS criada
                  FROM generate_series(1, $2) g)
     INSERT INTO aurora.work_orders (id, organization_id, number, customer_id, work_order_type_id, asset_id,
                                     status_id, status_category, priority, title, asset_name_snapshot, created_at)
     SELECT gen_random_uuid(), $1, 'OS-' || lpad(g.g::text, 7, '0'), a.customer_id, ty.id, a.id, st.id, st.category,
            (ARRAY['none','low','urgent','very_urgent','emergency'])[1 + floor(random() * 5)::int]::aurora.request_priority,
            'Chamado ' || g.g, a.name, g.criada
       FROM g JOIN _a a ON a.rn = g.arn JOIN st ON st.rn = g.srn JOIN ty ON ty.rn = g.trn`,
    [org, e.os, e.ativos]
  );
  // relógio de resolução por OS
  await q(
    `INSERT INTO aurora.sla_clocks
       (id, organization_id, document_type, document_id, kind, state, policy_name_snapshot, target_minutes,
        business_hours_only, calendar_snapshot, priority_snapshot, started_at, due_at, stopped_at, breached_at)
     SELECT gen_random_uuid(), w.organization_id, 'work_order', w.id, 'resolution',
            CASE WHEN w.status_category IN ('done','closed') THEN (CASE WHEN random() < 0.8 THEN 'met' ELSE 'breached' END)::aurora.sla_clock_state
                 ELSE 'running'::aurora.sla_clock_state END,
            'Bench', 1440, false, '{}'::jsonb, w.priority, w.created_at, w.created_at + interval '1 day',
            CASE WHEN w.status_category IN ('done','closed') THEN w.created_at + (random() * interval '3 days') END,
            CASE WHEN w.status_category NOT IN ('done','closed') AND random() < 0.7 THEN w.created_at + interval '1 day' END
       FROM aurora.work_orders w WHERE w.organization_id = $1`,
    [org]
  );
  // três transições por OS
  await q(
    `INSERT INTO aurora.work_order_status_history
       (id, organization_id, work_order_id, from_status_id, to_status_id, from_category, to_category, changed_at, seconds_in_from)
     SELECT gen_random_uuid(), w.organization_id, w.id, w.status_id, w.status_id, w.status_category, w.status_category,
            w.created_at + (g * interval '6 hours'), (random() * 20000)::bigint
       FROM aurora.work_orders w, generate_series(1, 3) g WHERE w.organization_id = $1`,
    [org]
  );
}

module.exports = { criarBanco, ESCALA };
