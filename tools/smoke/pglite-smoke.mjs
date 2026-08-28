import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const q = async (sql, p) => (await db.query(sql, p)).rows;

console.log('versão:', (await q('select version()'))[0].version.split(',')[0]);

// papéis
await db.exec(`CREATE ROLE aurora_owner NOLOGIN; CREATE ROLE aurora_app NOLOGIN NOBYPASSRLS;`);
console.log('papéis criados ok');

// tabela tenant-scoped
await db.exec(`
  CREATE SCHEMA aurora;
  CREATE FUNCTION aurora.current_organization_id() RETURNS uuid
    LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('aurora.organization_id', true), '')::uuid $$;
  CREATE TABLE t (id uuid primary key, organization_id uuid not null, name text);
  ALTER TABLE t OWNER TO aurora_owner;
  ALTER TABLE t ENABLE ROW LEVEL SECURITY;
  ALTER TABLE t FORCE ROW LEVEL SECURITY;
  CREATE POLICY t_iso ON t USING (organization_id = aurora.current_organization_id())
                           WITH CHECK (organization_id = aurora.current_organization_id());
  GRANT USAGE ON SCHEMA aurora, public TO aurora_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON t TO aurora_app;
`);
const A = '11111111-1111-7111-8111-111111111111',
  B = '22222222-2222-7222-8222-222222222222';
await db.exec(`INSERT INTO t VALUES ('${A}','${A}','de A'), ('${B}','${B}','de B')`);
console.log(
  'seed como superuser ok (owner ignora? FORCE ativo):',
  (await q('select count(*)::int c from t'))[0].c
);

// agora como aurora_app
await db.exec(`SET ROLE aurora_app`);
console.log('--- como aurora_app ---');
console.log('sem contexto (esperado 0):', (await q('select count(*)::int c from t'))[0].c);

await db.exec('BEGIN');
await q(`select set_config('aurora.organization_id', $1, true)`, [A]);
console.log('contexto A dentro da tx (esperado 1):', (await q('select count(*)::int c from t'))[0].c);
await db.exec('COMMIT');

console.log(
  'após COMMIT, mesma conexão (esperado 0 = não vazou):',
  (await q('select count(*)::int c from t'))[0].c
);
console.log(
  'setting após commit:',
  JSON.stringify((await q(`select current_setting('aurora.organization_id', true) s`))[0].s)
);

await db.exec('BEGIN');
await q(`select set_config('aurora.organization_id', $1, true)`, [B]);
const rows = await q('select name from t');
console.log(
  'contexto B (esperado só "de B"):',
  rows.map((r) => r.name)
);
// tentativa de escrever para outro tenant
try {
  await q(`insert into t values ($1,$2,'invasor')`, ['33333333-3333-7333-8333-333333333333', A]);
  console.log('!!! WITH CHECK NÃO bloqueou');
} catch (e) {
  console.log('WITH CHECK bloqueou insert cross-tenant:', e.message.slice(0, 60));
}
await db.exec('ROLLBACK');
console.log('\nSMOKE OK');
