#!/usr/bin/env node
/**
 * Aurora — operações de banco a partir da linha de comando.
 *
 * Uso: node tools/db/run.mjs <migrate|seed|status>
 *
 * Exige DATABASE_URL. Não descobre banco sozinho e não toca em nada remoto por
 * conta própria: se a variável não estiver definida, o comando falha.
 *
 * O usuário de DATABASE_URL precisa de privilégio de DDL para `migrate` e
 * `seed` (papel aurora_owner/aurora_migrator). A API usa outro usuário.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// `tsx` e não `ts-node`: o segundo estava declarado aqui e nunca foi
// instalado, então este comando nunca rodou uma vez sequer — descoberto ao
// aplicar as migrations num PostgreSQL real pela primeira vez. Um script no
// package.json que ninguém executa é um script que não existe.
require('tsx/cjs');

/*
 * O DESTINO É CONFERIDO ANTES DE ABRIR CONEXÃO.
 *
 * A versão anterior deste guard conferia se `AURORA_CONFIRM_REMOTE` estava
 * DEFINIDA — não o valor. `AURORA_CONFIRM_REMOTE=sim` liberava qualquer projeto
 * do mundo, e quem exportasse ficaria com a sensação de ter confirmado alguma
 * coisa. Era pior do que nenhuma proteção, porque parecia proteção.
 *
 * Agora a URL é lida, o ref é extraído (do host E do usuário do pooler) e
 * confrontado com `aurora.destinos.json`. Recusa encerra com 1 lá dentro.
 */
const { conferirOuSair } = await import('./destino.mjs');
const url = process.env.DATABASE_URL;
conferirOuSair(url);

const { Pool } = require('pg');
const { pgPoolAdapter, migrate } = require('../../packages/db/src/index.ts');
const { seed } = require('../../packages/db/src/seeds/index.ts');

const command = process.argv[2] ?? 'status';
const pool = new Pool({ connectionString: url, max: 2 });
const db = pgPoolAdapter(pool, null); // operações administrativas: sem SET ROLE

try {
  if (command === 'migrate') {
    const r = await migrate(db);
    console.log(`aplicadas: ${r.applied.length}, já presentes: ${r.skipped.length}`);
    r.applied.forEach((n) => console.log('  + ' + n));
  } else if (command === 'seed') {
    const r = await seed(db);
    console.log(`organizações: ${r.organizations}, usuários: ${r.users}, vínculos: ${r.memberships}`);
  } else {
    const rows = await db.query('SELECT name, applied_at FROM aurora.schema_migrations ORDER BY name');
    console.log(`${rows.length} migration(s) aplicadas:`);
    rows.forEach((r) => console.log(`  ${r.name}  ${r.applied_at.toISOString?.() ?? r.applied_at}`));
  }
} finally {
  await db.close();
}
