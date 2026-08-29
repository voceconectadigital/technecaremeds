/**
 * Aurora — os trabalhos periódicos contra PostgreSQL de verdade.
 *
 * O que a suíte em PGlite NÃO consegue provar, porque tem uma conexão só:
 *
 *   · DOIS workers, em conexões físicas distintas, disputando a mesma fila;
 *   · a garantia de exclusividade valendo entre PROCESSOS, e não dentro de um;
 *   · a dispersão rodando sob `aurora_scheduler` com os privilégios reais.
 *
 * Sem `AURORA_TEST_PG_URL` a suíte é PULADA, e diz isso — em vez de passar em
 * silêncio, que seria cobertura aparente.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { newId } from '@aurora/domain';
import { pgPoolAdapter, migrate, syncPermissionCatalog, syncCatalogDefinitions } from '@aurora/db';
import type { Database } from '@aurora/db';
import { JobRuntime } from '../jobs/runtime';

const URL = process.env.AURORA_TEST_PG_URL;
const rodar = Boolean(URL);

/** Um esquema de filas por execução: a suíte não pode depender de banco limpo. */
const ESQUEMA = `aurora_jobs_t${Date.now().toString(36)}`;

const ORG_A = newId();
const ORG_B = newId();

let pool: Pool;
let db: Database;
let platformDb: Database;
let boss: PgBoss;
let runtime: JobRuntime;

beforeAll(async () => {
  if (!rodar) return;

  pool = new Pool({ connectionString: URL, max: 6 });
  const admin = pgPoolAdapter(pool, null);
  await migrate(admin);
  await syncPermissionCatalog(admin);
  await syncCatalogDefinitions(admin);

  db = pgPoolAdapter(pool, 'aurora_app');
  platformDb = pgPoolAdapter(pool, null);

  for (const [id, slug] of [
    [ORG_A, `jobs-a-${Date.now().toString(36)}`],
    [ORG_B, `jobs-b-${Date.now().toString(36)}`],
  ] as const) {
    await pool.query(`INSERT INTO aurora.organizations (id, slug, name) VALUES ($1, $2, $3)`, [
      id,
      slug,
      slug,
    ]);
  }

  boss = new PgBoss({ connectionString: URL, schema: ESQUEMA, supervise: false, schedule: false });
  boss.on('error', () => undefined);

  runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
  await runtime.start();
}, 180_000);

afterAll(async () => {
  if (!rodar) return;
  await runtime?.stop().catch(() => undefined);
  await pool?.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`).catch(() => undefined);
  await pool?.end().catch(() => undefined);
});

describe.skipIf(!rodar)('trabalhos periódicos em PostgreSQL real', () => {
  it('a dispersão enxerga as organizações sob o papel do agendador', async () => {
    // Prova que `aurora_scheduler` tem exatamente o privilégio de que precisa.
    // Sob `aurora_app` esta chamada devolveria zero — e o worker varreria nada.
    const n = await runtime.fanOutNow('aurora.sla.sweep');
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('o papel do agendador NÃO lê dado de negócio', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE aurora_scheduler');
      // Enxerga a organização...
      const orgs = await c.query('SELECT id FROM aurora.organizations');
      expect(orgs.rows.length).toBeGreaterThan(0);
      // ...e nada além disso. Um agendador que lê OS seria mais um caminho
      // para atravessar organização sem contexto.
      await expect(c.query('SELECT id FROM aurora.work_orders')).rejects.toThrow(/permission denied/i);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });

  it('dois workers em conexões distintas: cada job é entregue a UM só', async () => {
    const fila = 'aurora.plans.sweep';

    // Estado limpo para esta fila.
    for (const j of await boss.fetch(fila, { batchSize: 100 })) await boss.complete(fila, j.id);
    await runtime.fanOutNow(fila);

    const bossA = new PgBoss({ connectionString: URL, schema: ESQUEMA, supervise: false, schedule: false });
    const bossB = new PgBoss({ connectionString: URL, schema: ESQUEMA, supervise: false, schedule: false });
    bossA.on('error', () => undefined);
    bossB.on('error', () => undefined);
    await bossA.start();
    await bossB.start();

    try {
      // Ao mesmo tempo, de propósito: é a disputa que interessa.
      const [a, b] = await Promise.all([
        bossA.fetch(fila, { batchSize: 10 }),
        bossB.fetch(fila, { batchSize: 10 }),
      ]);

      const ids = [...a.map((j) => j.id), ...b.map((j) => j.id)];
      // Nenhum job entregue duas vezes. Se isso falhar, a mesma varredura roda
      // em dois processos e a OS preventiva nasce duplicada.
      expect(new Set(ids).size).toBe(ids.length);

      for (const j of a) await bossA.complete(fila, j.id);
      for (const j of b) await bossB.complete(fila, j.id);
    } finally {
      await bossA.stop({ graceful: false }).catch(() => undefined);
      await bossB.stop({ graceful: false }).catch(() => undefined);
    }
  });

  it('duas dispersões simultâneas não enfileiram a mesma organização duas vezes', async () => {
    const fila = 'aurora.quotes.expire';
    for (const j of await boss.fetch(fila, { batchSize: 100 })) await boss.complete(fila, j.id);

    // Dois processos disparando o mesmo cron no mesmo segundo — o caso que
    // acontece de verdade quando há duas instâncias do worker.
    const [x, y] = await Promise.all([runtime.fanOutNow(fila), runtime.fanOutNow(fila)]);

    const jobs = await boss.fetch(fila, { batchSize: 100 });
    const orgs = jobs.map((j) => (j.data as { organizationId: string }).organizationId);
    expect(new Set(orgs).size).toBe(orgs.length);
    expect(x + y).toBe(orgs.length);

    for (const j of jobs) await boss.complete(fila, j.id);
  });

  it('a varredura de uma organização roda sob RLS, com o contexto daquela organização', async () => {
    const r = await runtime.runForTenant('aurora.sla.sweep', ORG_A);
    expect(r).toEqual({ warned: 0, breached: 0 });
  });
});
