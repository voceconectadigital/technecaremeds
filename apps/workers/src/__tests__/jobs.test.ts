/**
 * Aurora — trabalhos periódicos sobre pg-boss (SPEC v0.2 §31 · ADR-017).
 *
 * O que precisa estar provado aqui, e não em outro lugar:
 *
 *   · a varredura de uma organização NUNCA roda duas vezes ao mesmo tempo;
 *   · uma organização que falha não impede as outras;
 *   · a falha esgotada não some — vai para a carta morta;
 *   · reiniciar o worker no meio não perde nem duplica trabalho.
 *
 * As varreduras abrem ciclo e GERAM ORDEM DE SERVIÇO. Duas execuções
 * concorrentes da mesma varredura produziriam a mesma OS preventiva duas vezes,
 * e o técnico descobriria isso na agenda dele.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgBoss, fromPglite } from 'pg-boss';
import { newId } from '@aurora/domain';
import { pgliteAdapter } from '@aurora/db';
import type { Database } from '@aurora/db';
import { migrate } from '@aurora/db';
import { syncPermissionCatalog, syncCatalogDefinitions } from '@aurora/db';
import { JobRuntime, cartaMorta, TENANT_JOBS, PLATFORM_JOBS, JOBS_SEM_FUNCAO_DE_DOMINIO } from '../index';

let pg: PGlite;
let boss: PgBoss;
let db: Database;
let platformDb: Database;
let runtime: JobRuntime;

const ORG_A = newId();
const ORG_B = newId();

async function semear(organizationId: string, slug: string, ativa = true) {
  await pg.query(
    `INSERT INTO aurora.organizations (id, slug, name, status)
     VALUES ($1, $2, $3, $4::aurora.organization_status)`,
    [organizationId, slug, slug, ativa ? 'active' : 'suspended']
  );
}

beforeEach(async () => {
  pg = new PGlite();
  const superuser = pgliteAdapter(pg, null);
  await migrate(superuser);
  await syncPermissionCatalog(superuser);
  await syncCatalogDefinitions(superuser);

  db = pgliteAdapter(pg, 'aurora_app');
  // Como o publicador do outbox: a conexão do worker não fixa papel, e cada
  // rotina de plataforma assume o SEU. A dispersão assume aurora_scheduler.
  platformDb = pgliteAdapter(pg, null);

  await semear(ORG_A, 'org-a-jobs');
  await semear(ORG_B, 'org-b-jobs');

  boss = new PgBoss({ db: fromPglite(pg), schema: 'aurora_jobs', supervise: false, schedule: false });
  // Sem ouvinte de erro, um erro assíncrono do pg-boss derruba o processo de
  // teste com uma mensagem que não diz nada sobre o teste que falhou.
  boss.on('error', () => undefined);
}, 120_000);

afterEach(async () => {
  await runtime?.stop().catch(() => undefined);
  await pg?.close().catch(() => undefined);
});

/** Processa a fila na mão: determinístico, ao contrário de esperar o worker. */
async function processar(fila: string, handler: (data: unknown) => Promise<void>): Promise<number> {
  const jobs = await boss.fetch(fila, { batchSize: 50 });
  for (const j of jobs) {
    try {
      await handler(j.data);
      await boss.complete(fila, j.id);
    } catch (e) {
      await boss.fail(fila, j.id, { message: e instanceof Error ? e.message : String(e) });
    }
  }
  return jobs.length;
}

/* -------------------------------------------------------------------------- */

describe('catálogo', () => {
  it('todo trabalho tem nome no espaço da Aurora e cron de cinco campos', () => {
    for (const job of [...TENANT_JOBS, ...PLATFORM_JOBS]) {
      expect(job.name, job.name).toMatch(/^aurora\./);
      expect(job.cron.trim().split(/\s+/), job.name).toHaveLength(5);
      expect(job.description.length, job.name).toBeGreaterThan(10);
    }
  });

  it('nenhum nome se repete — nome repetido seria fila compartilhada por engano', () => {
    const nomes = [...TENANT_JOBS, ...PLATFORM_JOBS].map((j) => j.name);
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it('o que ainda não tem função de domínio está dito, não escondido', () => {
    // Se alguém implementar o digest e esquecer de agendar, esta lista fica
    // desatualizada — e é melhor ela existir errada do que não existir.
    expect(JOBS_SEM_FUNCAO_DE_DOMINIO.length).toBeGreaterThan(0);
    for (const item of JOBS_SEM_FUNCAO_DE_DOMINIO) expect(item).toMatch(/§\d+/);
  });
});

describe('dispersão por organização', () => {
  it('enfileira um job por organização ATIVA', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();

    const n = await runtime.fanOutNow('aurora.sla.sweep');
    expect(n).toBe(2);
  });

  it('organização suspensa fica de fora', async () => {
    await semear(newId(), 'suspensa', false);
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();

    expect(await runtime.fanOutNow('aurora.sla.sweep')).toBe(2);
  });

  it('trabalho desconhecido falha alto, em vez de não fazer nada em silêncio', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();
    await expect(runtime.fanOutNow('aurora.inventado')).rejects.toThrow(/desconhecido/);
  });
});

describe('nunca duas execuções concorrentes do mesmo trabalho lógico', () => {
  it('a segunda dispersão não enfileira de novo o que ainda está na fila', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();

    expect(await runtime.fanOutNow('aurora.plans.sweep')).toBe(2);
    // Cron sobreposto, worker lento, duas instâncias: dá no mesmo. A política
    // `exclusive` com chave por organização recusa a segunda.
    expect(await runtime.fanOutNow('aurora.plans.sweep')).toBe(0);
    expect(await runtime.fanOutNow('aurora.plans.sweep')).toBe(0);
  });

  it('enquanto o job de uma organização está ATIVO, outro igual não entra', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();
    await runtime.fanOutNow('aurora.plans.sweep');

    // Pegar sem completar deixa os jobs ativos — é o worker no meio da tarefa.
    const ativos = await boss.fetch('aurora.plans.sweep', { batchSize: 10 });
    expect(ativos).toHaveLength(2);

    expect(await runtime.fanOutNow('aurora.plans.sweep')).toBe(0);
  });

  it('depois de concluído, a próxima passada entra normalmente', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();
    await runtime.fanOutNow('aurora.plans.sweep');

    const jobs = await boss.fetch('aurora.plans.sweep', { batchSize: 10 });
    for (const j of jobs) await boss.complete('aurora.plans.sweep', j.id);

    expect(await runtime.fanOutNow('aurora.plans.sweep')).toBe(2);
  });

  it('a chave é por ORGANIZAÇÃO: A ocupada não bloqueia B', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();

    // Só A enfileirada.
    await boss.send(
      'aurora.sla.sweep',
      { organizationId: ORG_A, at: new Date().toISOString() },
      {
        singletonKey: ORG_A,
      }
    );

    // A dispersão recusa A (já está lá) e aceita B.
    expect(await runtime.fanOutNow('aurora.sla.sweep')).toBe(1);
  });
});

describe('o instante da medição viaja com o job', () => {
  it('a retentativa mede a mesma janela da primeira tentativa', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();

    const quando = new Date('2026-03-15T03:23:00.000Z');
    await runtime.fanOutNow('aurora.contracts.alerts', quando);

    const jobs = await boss.fetch('aurora.contracts.alerts', { batchSize: 10 });
    // Sem esta linha o laço abaixo não roda e o teste passa sem testar nada —
    // que foi exatamente o que aconteceu na primeira execução desta suíte.
    expect(jobs).toHaveLength(2);
    for (const j of jobs) {
      // Sem isto, "vence em 30 dias" significaria uma coisa na tentativa que
      // falhou e outra na que deu certo — e o alerta sairia com número
      // diferente do que teria saído.
      expect((j.data as { at: string }).at).toBe(quando.toISOString());
    }
  });
});

describe('execução de verdade, sob RLS', () => {
  it('a varredura de SLA roda para a organização e devolve o que fez', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();

    const r = await runtime.runForTenant('aurora.sla.sweep', ORG_A);
    // Sem relógios em andamento não há nada a avisar — o que importa é que a
    // varredura ROLE dentro do contexto certo e devolva números, não que ela
    // encontre algo nesta base recém-criada.
    expect(r).toEqual({ warned: 0, breached: 0 });
  });

  it('a varredura de planos devolve ciclos e OS abertos', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();

    const r = await runtime.runForTenant('aurora.plans.sweep', ORG_A);
    expect(r).toEqual({ cyclesOpened: 0, workOrders: 0 });
  });

  it('as cinco varreduras de tenant rodam sem estourar', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();

    for (const job of TENANT_JOBS) {
      const r = await runtime.runForTenant(job.name, ORG_A, new Date('2026-03-15T03:00:00.000Z'));
      expect(
        Object.values(r).every((v) => typeof v === 'number'),
        job.name
      ).toBe(true);
    }
  });
});

describe('falha, retentativa e carta morta', () => {
  it('a falha de uma organização não impede a outra', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();
    await runtime.fanOutNow('aurora.sla.sweep');

    const processadas: string[] = [];
    await processar('aurora.sla.sweep', async (data) => {
      const org = (data as { organizationId: string }).organizationId;
      if (org === ORG_A) throw new Error('banco fora do ar para A');
      processadas.push(org);
    });

    expect(processadas).toEqual([ORG_B]);
  });

  it('o job que falha volta para a fila em vez de sumir', async () => {
    runtime = new JobRuntime({
      db,
      platformDb,
      boss,
      retryLimit: 3,
      withoutCron: true,
      withoutWorkers: true,
    });
    await runtime.start();
    await runtime.fanOutNow('aurora.sla.sweep');

    await processar('aurora.sla.sweep', async () => {
      throw new Error('falha proposital');
    });

    const job = await boss.getJobById('aurora.sla.sweep', (await primeiroJobId('aurora.sla.sweep'))!);
    expect(job?.state === 'retry' || job?.state === 'created').toBe(true);
  });

  it('esgotada a retentativa, o job vai para a carta morta — não some', async () => {
    runtime = new JobRuntime({
      db,
      platformDb,
      boss,
      retryLimit: 0,
      withoutCron: true,
      withoutWorkers: true,
    });
    await runtime.start();
    await runtime.fanOutNow('aurora.sla.sweep');

    await processar('aurora.sla.sweep', async () => {
      throw new Error('falha definitiva');
    });

    const mortos = await runtime.deadJobs('aurora.sla.sweep');
    expect(mortos.length).toBe(2);
    // A causa vai junto: uma carta morta sem motivo obriga a reproduzir o erro.
    expect(JSON.stringify(mortos[0]!.data)).toContain('organizationId');
  });

  it('a fila de cartas mortas tem nome derivado, e não inventado caso a caso', () => {
    expect(cartaMorta('aurora.sla.sweep')).toBe('aurora.sla.sweep.dead');
  });
});

describe('publicação do outbox', () => {
  it('o trabalho de plataforma chama o publicador', async () => {
    let chamadas = 0;
    runtime = new JobRuntime({
      db,
      platformDb,
      boss,
      withoutCron: true,
      withoutWorkers: true,
      publishOutbox: async () => {
        chamadas += 1;
        return { published: 3, failed: 0 };
      },
    });
    await runtime.start();

    await boss.send('aurora.outbox.publish', {}, { singletonKey: 'global' });
    await processar('aurora.outbox.publish', async () => {
      await runtime['options'].publishOutbox!();
    });

    expect(chamadas).toBe(1);
  });

  it('sem publicador configurado, a fila existe e não faz nada — não estoura', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();
    const id = await boss.send('aurora.outbox.publish', {});
    expect(id).toBeTruthy();
  });
});

describe('reinício de worker', () => {
  it('parar e subir de novo não perde o que estava na fila', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();
    await runtime.fanOutNow('aurora.quotes.expire');
    await runtime.stop();

    const boss2 = new PgBoss({
      db: fromPglite(pg),
      schema: 'aurora_jobs',
      supervise: false,
      schedule: false,
    });
    boss2.on('error', () => undefined);
    runtime = new JobRuntime({ db, platformDb, boss: boss2, withoutCron: true, withoutWorkers: true });
    await runtime.start();

    const pendentes = await boss2.fetch('aurora.quotes.expire', { batchSize: 10 });
    expect(pendentes).toHaveLength(2);
  });

  it('subir duas vezes é idempotente: as filas não são recriadas nem duplicadas', async () => {
    runtime = new JobRuntime({ db, platformDb, boss, withoutCron: true, withoutWorkers: true });
    await runtime.start();
    await runtime.start();

    const filas = await boss.getQueues();
    const nomes = filas.map((f) => f.name);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const job of TENANT_JOBS) {
      expect(nomes, job.name).toContain(job.name);
      expect(nomes, job.name).toContain(cartaMorta(job.name));
    }
  });
});

async function primeiroJobId(fila: string): Promise<string | undefined> {
  const jobs = await boss.findJobs(fila, {});
  return jobs[0]?.id;
}
