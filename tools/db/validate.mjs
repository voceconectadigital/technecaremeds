#!/usr/bin/env node
/**
 * Aurora — validação estrutural contra PostgreSQL real.
 *
 * O PGlite prova que as migrations rodam e que o comportamento está certo. O
 * que ele NÃO prova é o que só existe num servidor de verdade: dono de tabela,
 * concessões, papéis com atributos, e a diferença entre `ENABLE` e `FORCE` RLS
 * quando há mais de um usuário.
 *
 * Este script pergunta ao catálogo do banco, uma verificação por vez, e falha
 * com a lista do que está errado — nunca com "algo deu errado".
 *
 * Uso: DATABASE_URL=... node tools/db/validate.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido.');
  process.exit(1);
}

const { Pool } = require('pg');
const pool = new Pool({ connectionString: url, max: 2 });

const falhas = [];
const notas = [];

async function q(sql, params) {
  const r = await pool.query(sql, params);
  return r.rows;
}

function checa(condicao, mensagem) {
  if (!condicao) falhas.push(mensagem);
}

try {
  /* ---------------------------------------------------------------- versão */
  const [{ version }] = await q('SELECT version()');
  notas.push(`versão: ${version.split(',')[0]}`);

  const [{ num }] = await q(`SELECT current_setting('server_version_num') AS num`);
  checa(Number(num) >= 160000, `PostgreSQL 16+ exigido; encontrado ${num}`);

  /* -------------------------------------------------------------- migrations */
  const migs = await q('SELECT name, checksum FROM aurora.schema_migrations ORDER BY name');
  notas.push(`migrations aplicadas: ${migs.length}`);

  // O checksum é a defesa contra migration editada depois de aplicada. Conferir
  // aqui é o que transforma a promessa em verificação.
  const { loadMigrations } = require('../../packages/db/src/migrator.ts');
  const arquivos = loadMigrations();
  checa(
    arquivos.length === migs.length,
    `${arquivos.length} arquivo(s) de migration, mas ${migs.length} aplicada(s)`
  );
  for (const a of arquivos) {
    const aplicada = migs.find((m) => m.name === a.name);
    if (!aplicada) {
      falhas.push(`migration não aplicada: ${a.name}`);
    } else if (aplicada.checksum !== a.checksum) {
      falhas.push(`checksum divergente em ${a.name}`);
    }
  }

  /* ------------------------------------------------------------------ papéis */
  const papeis = await q(
    `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
       FROM pg_roles WHERE rolname LIKE 'aurora%' ORDER BY rolname`
  );
  notas.push(`papéis: ${papeis.map((p) => p.rolname).join(', ')}`);

  const app = papeis.find((p) => p.rolname === 'aurora_app');
  checa(app, 'papel aurora_app não existe');
  if (app) {
    // As três garantias do usuário, verificadas no catálogo e não na intenção.
    checa(!app.rolbypassrls, 'aurora_app tem BYPASSRLS — o isolamento não valeria');
    checa(!app.rolsuper, 'aurora_app é SUPERUSER');
    checa(!app.rolcreaterole, 'aurora_app pode criar papéis');
  }
  const ro = papeis.find((p) => p.rolname === 'aurora_readonly');
  if (ro) checa(!ro.rolbypassrls, 'aurora_readonly tem BYPASSRLS');

  /* -------------------------------------------------------------------- RLS */
  const tabelas = await q(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'aurora' AND c.relkind = 'r'
      ORDER BY c.relname`
  );
  notas.push(`tabelas em aurora: ${tabelas.length}`);

  // `schema_migrations` é registro do migrador, não dado de tenant: fica fora.
  const negocio = tabelas.filter((t) => t.relname !== 'schema_migrations');

  for (const t of negocio) {
    checa(t.relrowsecurity, `RLS desligada em ${t.relname}`);
    // FORCE é o que faz a política valer TAMBÉM para o dono da tabela. Sem ele,
    // qualquer caminho que rode como owner enxerga tudo.
    checa(t.relforcerowsecurity, `FORCE RLS ausente em ${t.relname}`);
    checa(t.owner === 'aurora_owner', `${t.relname} pertence a "${t.owner}" e não a aurora_owner`);
  }

  const semPolitica = await q(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'aurora' AND c.relkind = 'r' AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`
  );
  for (const t of semPolitica) {
    falhas.push(`${t.relname} tem RLS ligada e nenhuma política — fecha tudo, inclusive o legítimo`);
  }

  /* ------------------------------------------------------------- concessões */
  const podeEscrever = await q(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'aurora' AND c.relkind = 'r'
        AND c.relname IN ('audit_logs')
        AND (has_table_privilege('aurora_app', c.oid, 'UPDATE')
             OR has_table_privilege('aurora_app', c.oid, 'DELETE'))`
  );
  for (const t of podeEscrever) {
    falhas.push(`aurora_app pode alterar/apagar ${t.relname} — a trilha deixaria de ser append-only`);
  }

  const semLeitura = await q(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'aurora' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
        AND NOT has_table_privilege('aurora_app', c.oid, 'SELECT')`
  );
  for (const t of semLeitura) {
    falhas.push(`aurora_app não pode ler ${t.relname}`);
  }

  /* -------------------------------------------- chaves estrangeiras compostas */
  /*
   * A verificação de FK roda como dona da tabela e IGNORA a RLS. Uma FK só por
   * `id` entre tabelas tenant-scoped aceitaria apontar para a linha de outro
   * tenant — por isso toda relação dessas precisa incluir `organization_id`.
   */
  const comOrg = new Set(
    (
      await q(
        `SELECT c.relname FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute a ON a.attrelid = c.oid
          WHERE n.nspname = 'aurora' AND c.relkind = 'r'
            AND a.attname = 'organization_id' AND a.attnum > 0 AND NOT a.attisdropped`
      )
    ).map((r) => r.relname)
  );

  const fks = await q(
    `SELECT con.conname, src.relname AS origem, tgt.relname AS destino,
            (SELECT string_agg(a.attname, ',' ORDER BY a.attname)
               FROM unnest(con.conkey) k
               JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k) AS colunas
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid
       JOIN pg_class tgt ON tgt.oid = con.confrelid
       JOIN pg_namespace n ON n.oid = src.relnamespace
      WHERE con.contype = 'f' AND n.nspname = 'aurora'`
  );

  let compostas = 0;
  const frouxas = [];
  for (const fk of fks) {
    const tenantAmbos = comOrg.has(fk.origem) && comOrg.has(fk.destino);
    if (!tenantAmbos) continue;
    // A FK para `organizations` é a raiz da árvore e não precisa se repetir.
    if (fk.destino === 'organizations') continue;
    const cols = (fk.colunas ?? '').split(',');
    if (cols.includes('organization_id')) compostas++;
    else frouxas.push(`${fk.origem}.${fk.conname} -> ${fk.destino} (${cols.join(', ')})`);
  }
  notas.push(`FKs compostas entre tabelas tenant-scoped: ${compostas}`);
  for (const f of frouxas) {
    falhas.push(`FK sem organization_id: ${f}`);
  }

  /* -------------------------------------------------------------- gatilhos */
  const auditoria = await q(
    `SELECT count(*)::int AS total FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'aurora' AND NOT t.tgisinternal
        AND pg_get_triggerdef(t.oid) LIKE '%fn_audit%'`
  );
  notas.push(`gatilhos de auditoria: ${auditoria[0].total}`);
  checa(auditoria[0].total >= 20, `poucos gatilhos de auditoria (${auditoria[0].total})`);

  /* ------------------------------------------------------------- outbox */
  const [{ existe }] = await q(
    `SELECT count(*)::int AS existe FROM information_schema.tables
      WHERE table_schema = 'aurora' AND table_name = 'domain_events'`
  );
  checa(existe === 1, 'tabela domain_events ausente');

  const idx = await q(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'aurora' AND tablename = 'domain_events'`
  );
  notas.push(`índices em domain_events: ${idx.length}`);

  /* ------------------------------------------------------------ funções */
  const funcs = await q(
    `SELECT p.proname, p.prosecdef
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'aurora' ORDER BY p.proname`
  );
  notas.push(`funções: ${funcs.length}`);

  const definer = funcs.filter((f) => f.prosecdef);
  notas.push(
    definer.length
      ? `SECURITY DEFINER: ${definer.map((f) => f.proname).join(', ')}`
      : 'SECURITY DEFINER: nenhuma'
  );

  /* -------------------------------------------------------------- saída */
  console.log('\n--- estado ---');
  notas.forEach((n) => console.log('  ' + n));

  if (falhas.length === 0) {
    console.log('\n✓ validação estrutural: nenhuma falha\n');
  } else {
    console.log(`\n✗ ${falhas.length} falha(s):`);
    falhas.forEach((f) => console.log('  · ' + f));
    console.log();
  }
} finally {
  await pool.end();
}

process.exit(falhas.length === 0 ? 0 : 1);
