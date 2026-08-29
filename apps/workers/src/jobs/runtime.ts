/**
 * Aurora — o runtime de trabalhos, sobre pg-boss (SPEC v0.2 §31 · ADR-017).
 *
 * POR QUE FILA NO PRÓPRIO POSTGRES
 *
 * Porque o enfileiramento entra na MESMA transação do dado. Um job que só
 * existe se a transação existiu é a diferença entre "a OS foi criada e o aviso
 * saiu" e "a OS foi criada e o aviso sumiu" — que é o que acontece quando a
 * fila mora em outro processo e o commit falha depois do envio.
 *
 * AS TRÊS GARANTIAS QUE ESTE ARQUIVO EXISTE PARA DAR
 *
 * 1. NUNCA DUAS EXECUÇÕES CONCORRENTES DO MESMO TRABALHO LÓGICO.
 *    Toda fila usa política `exclusive` com `singletonKey` = organização. Só
 *    existe UM job por (fila, organização), enfileirado ou ativo. Dois
 *    processos worker, dois disparos de cron sobrepostos, uma reinicialização
 *    no meio: em nenhum caso a varredura de uma organização roda duas vezes ao
 *    mesmo tempo. Isso importa porque as varreduras ABREM CICLO e GERAM OS —
 *    duas execuções concorrentes gerariam a mesma OS preventiva duas vezes.
 *
 * 2. FALHA NÃO SOME. A retentativa é com recuo exponencial; esgotada, o job vai
 *    para a fila de cartas mortas em vez de desaparecer. Um trabalho que falha
 *    em silêncio é pior do que um trabalho que não existe: cria a impressão de
 *    que a varredura aconteceu.
 *
 * 3. UMA ORGANIZAÇÃO NÃO DERRUBA AS OUTRAS. O cron dispara um trabalho de
 *    DISPERSÃO, que enfileira um job por organização. Falha, retentativa e
 *    carta morta são por organização.
 */
import type { PgBoss, Job } from 'pg-boss';
import { withTenant, unsafeCrossTenant, type Database } from '@aurora/db';
import { buildContext, newId, PERMISSION_KEYS } from '@aurora/domain';
import { TENANT_JOBS, PLATFORM_JOBS, type TenantJob, type JobOutcome } from './catalog';

/** Sufixo da fila de dispersão de um trabalho por organização. */
const DISPERSAO = '.fanout';

export interface JobLogger {
  info(dados: Record<string, unknown>, mensagem: string): void;
  error(dados: Record<string, unknown>, mensagem: string): void;
}

const SILENCIO: JobLogger = { info: () => undefined, error: () => undefined };

export interface RuntimeOptions {
  /** Banco da aplicação: é ele que os trabalhos de tenant usam, sob RLS. */
  db: Database;
  /**
   * Banco de plataforma, para enumerar as organizações a varrer.
   *
   * Precisa ser conexão SEM papel de aplicação fixado: a dispersão assume
   * `aurora_scheduler` (migration 0041), que lê o identificador das
   * organizações ativas e mais nada. `aurora_app` não consegue enumerar
   * organização — e é assim que tem de ser, senão a política de isolamento
   * teria um buraco do tamanho da plataforma.
   *
   * Ausente: a dispersão usa `db`, o que só funciona se ele puder assumir o
   * papel do agendador.
   */
  platformDb?: Database;
  /** Conexão do pg-boss. Em teste, o adaptador do PGlite. */
  boss: PgBoss;
  logger?: JobLogger;
  /** Quantas organizações um worker processa ao mesmo tempo. */
  concurrency?: number;
  /** Quantas vezes tentar antes da carta morta. */
  retryLimit?: number;
  /** Executa o publicador do outbox. Ausente: a fila existe e não faz nada. */
  publishOutbox?: () => Promise<{ published: number; failed: number }>;
  /**
   * Só registra as filas e os handlers, sem instalar o cron.
   *
   * É o que os testes usam: disparar o trabalho na mão e observar o resultado é
   * determinístico; esperar o relógio não é.
   */
  withoutCron?: boolean;
  /**
   * Não registra os handlers de trabalho.
   *
   * Também é para teste: com worker registrado, o job some da fila quando o
   * pg-boss resolve buscá-lo, e um teste que verifica o que está NA FILA passa
   * a depender do relógio. Sem handler, a fila fica parada e observável.
   */
  withoutWorkers?: boolean;
}

export interface JobRunReport {
  job: string;
  organizationId?: string;
  outcome: JobOutcome;
}

/**
 * O ciclo de vida do runtime.
 *
 * `start` é idempotente e `stop` espera o que está em andamento — reinício de
 * worker no meio de uma varredura devolve o job para a fila em vez de deixá-lo
 * ativo para sempre.
 */
export class JobRuntime {
  private readonly db: Database;
  private readonly boss: PgBoss;
  private readonly log: JobLogger;
  private readonly concurrency: number;
  private readonly retryLimit: number;
  private iniciado = false;

  constructor(private readonly options: RuntimeOptions) {
    this.db = options.db;
    this.boss = options.boss;
    this.log = options.logger ?? SILENCIO;
    this.concurrency = options.concurrency ?? 4;
    this.retryLimit = options.retryLimit ?? 5;
  }

  async start(): Promise<void> {
    if (this.iniciado) return;
    this.iniciado = true;

    await this.boss.start();
    await this.criarFilas();
    if (!this.options.withoutWorkers) await this.registrarHandlers();
    if (!this.options.withoutCron) await this.agendar();
  }

  async stop(): Promise<void> {
    if (!this.iniciado) return;
    this.iniciado = false;
    // `wait` deixa o job em andamento terminar. Sem isso, uma implantação no
    // meio da varredura deixaria a organização pela metade — e como a política
    // é exclusiva, a próxima só entraria depois de o job ativo expirar.
    await this.boss.stop({ graceful: true });
  }

  /* ------------------------------------------------------------------ filas */

  private async criarFilas(): Promise<void> {
    for (const job of TENANT_JOBS) {
      // A dispersão é `exclusive` sem chave: uma dispersão de cada vez para
      // todo o sistema, senão dois disparos de cron sobrepostos enfileirariam
      // a mesma organização duas vezes antes de a política por chave valer.
      await this.boss.createQueue(job.name + DISPERSAO, { policy: 'exclusive' });

      // A carta morta primeiro: a fila que a referencia não é criada se o
      // destino ainda não existe.
      await this.boss.createQueue(cartaMorta(job.name));
      await this.boss.createQueue(job.name, {
        // A garantia nº 1 mora nesta linha.
        policy: 'exclusive',
        retryLimit: this.retryLimit,
        retryBackoff: true,
        retryDelay: 30,
        retryDelayMax: 3600,
        deadLetter: cartaMorta(job.name),
      });
    }

    for (const job of PLATFORM_JOBS) {
      await this.boss.createQueue(cartaMorta(job.name));
      await this.boss.createQueue(job.name, {
        policy: 'exclusive',
        retryLimit: this.retryLimit,
        retryBackoff: true,
        retryDelay: 30,
        deadLetter: cartaMorta(job.name),
      });
    }
  }

  /* --------------------------------------------------------------- handlers */

  private async registrarHandlers(): Promise<void> {
    for (const job of TENANT_JOBS) {
      await this.boss.work(job.name + DISPERSAO, async (jobs: Job<{ at?: string }>[]) => {
        for (const j of jobs) {
          const quando = j.data?.at ? new Date(j.data.at) : new Date();
          await this.dispersar(job, quando);
        }
      });

      await this.boss.work(
        job.name,
        { batchSize: 1, concurrency: this.concurrency },
        async (jobs: Job<TenantJobData>[]) => {
          for (const j of jobs) await this.executarTenant(job, j.data);
        }
      );
    }

    for (const job of PLATFORM_JOBS) {
      await this.boss.work(job.name, { batchSize: 1 }, async () => {
        if (!this.options.publishOutbox) return;
        const r = await this.options.publishOutbox();
        this.log.info({ job: job.name, ...r }, 'publicação do outbox');
      });
    }
  }

  /* ------------------------------------------------------------- dispersão */

  /**
   * Enfileira um job por organização ativa.
   *
   * O `at` viaja junto: a organização enfileirada às 03:23 é medida contra
   * 03:23, mesmo que o worker só a processe às 04:10 por causa de uma fila
   * grande. Sem isso, a janela de "vence em 30 dias" muda entre uma
   * organização e outra da mesma passada.
   */
  private async dispersar(job: TenantJob, quando: Date): Promise<number> {
    const orgs = await this.organizacoesAtivas();
    let enfileiradas = 0;

    for (const organizationId of orgs) {
      const id = await this.boss.send(
        job.name,
        { organizationId, at: quando.toISOString() },
        {
          // Um por organização, enfileirado OU ativo. A varredura anterior
          // ainda rodando faz esta ser DESCARTADA, não empilhada: uma
          // organização lenta não acumula uma fila de si mesma.
          singletonKey: organizationId,
        }
      );
      if (id) enfileiradas += 1;
    }

    this.log.info({ job: job.name, orgs: orgs.length, enfileiradas }, 'dispersão');
    return enfileiradas;
  }

  private async organizacoesAtivas(): Promise<string[]> {
    const linhas = await unsafeCrossTenant(
      this.options.platformDb ?? this.db,
      'dispersão de trabalho periódico: enumera as organizações a varrer',
      async (c) => {
        // O papel do AGENDADOR, e não o da aplicação: ler o identificador das
        // organizações ativas é o único privilégio que ele tem. O trabalho em
        // si continua rodando sob o papel da aplicação, dentro de withTenant.
        await c.query('SET LOCAL ROLE aurora_scheduler');
        return c.query<{ id: string }>(
          `SELECT id FROM aurora.organizations
            WHERE status = 'active' AND deleted_at IS NULL
            ORDER BY id`
        );
      }
    );
    return linhas.map((l) => l.id);
  }

  /* -------------------------------------------------------------- execução */

  private async executarTenant(job: TenantJob, data: TenantJobData): Promise<JobOutcome> {
    const ctx = buildContext({
      organizationId: data.organizationId,
      actorKind: 'system',
      requestId: `job-${job.name}-${newId()}`,
      source: 'job',
      // O trabalho periódico age em nome do sistema, não de uma pessoa. As
      // permissões são todas porque não há a quem pedir — e é justamente por
      // isso que ele NÃO atravessa organização: a RLS continua valendo, e o
      // contexto acima é o de UMA organização.
      permissions: PERMISSION_KEYS,
    });

    const resultado = await withTenant(this.db, ctx, (s) => job.run(s, new Date(data.at)));
    this.log.info({ job: job.name, organizationId: data.organizationId, ...resultado }, 'trabalho');
    return resultado;
  }

  /* ---------------------------------------------------------------- agenda */

  private async agendar(): Promise<void> {
    for (const job of TENANT_JOBS) {
      await this.boss.schedule(job.name + DISPERSAO, job.cron, {});
    }
    for (const job of PLATFORM_JOBS) {
      await this.boss.schedule(job.name, job.cron, {});
    }
  }

  /* ------------------------------------------------------ superfície de teste */

  /** Dispara a dispersão agora, sem esperar o cron. Devolve quantas entraram. */
  async fanOutNow(jobName: string, quando = new Date()): Promise<number> {
    const job = TENANT_JOBS.find((j) => j.name === jobName);
    if (!job) throw new Error(`trabalho de tenant desconhecido: ${jobName}`);
    return this.dispersar(job, quando);
  }

  /** Executa o trabalho de UMA organização, sem passar pela fila. */
  async runForTenant(jobName: string, organizationId: string, quando = new Date()): Promise<JobOutcome> {
    const job = TENANT_JOBS.find((j) => j.name === jobName);
    if (!job) throw new Error(`trabalho de tenant desconhecido: ${jobName}`);
    return this.executarTenant(job, { organizationId, at: quando.toISOString() });
  }

  /** Os jobs que esgotaram a retentativa e foram para a carta morta. */
  async deadJobs(jobName: string): Promise<Job<unknown>[]> {
    return this.boss.fetch(cartaMorta(jobName), { batchSize: 100 });
  }
}

export interface TenantJobData {
  organizationId: string;
  at: string;
}

export function cartaMorta(jobName: string): string {
  return `${jobName}.dead`;
}
