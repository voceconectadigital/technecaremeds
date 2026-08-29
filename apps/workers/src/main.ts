/**
 * Aurora — processo dos trabalhos periódicos (SPEC v0.2 §31 · ADR-017).
 *
 * Processo SEPARADO da API, de propósito. Uma varredura que percorre cem mil
 * ordens de serviço não pode competir por conexão com a requisição de alguém
 * esperando a tela abrir — e um worker que trava não deve derrubar o login.
 *
 * O que ele faz, em ordem: abre o pool, sobe o pg-boss no mesmo banco (a fila
 * mora no PostgreSQL para que o enfileiramento entre na mesma transação do
 * dado), registra as filas e os handlers, instala o cron e fica de pé até
 * receber sinal de parada.
 */
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { loadEnv } from '@aurora/config';
import { pgPoolAdapter } from '@aurora/db';
import { OutboxPublisher, type EventSink } from './outbox-publisher';
import { JobRuntime } from './jobs/runtime';

/**
 * Destino padrão: registrar e seguir.
 *
 * NÃO é entrega de verdade e não finge ser. A alternativa — marcar o evento
 * como publicado sem ter entregue nada — cria a impressão de que o webhook
 * saiu, e o problema só aparece quando alguém pergunta por que o cliente não
 * recebeu. O destino real entra quando houver um para configurar.
 */
const REGISTRO: EventSink = {
  name: 'log',
  async deliver(evento) {
    process.stdout.write(JSON.stringify({ nivel: 'info', evento: evento.type, id: evento.id }) + '\n');
  },
};

export async function main(): Promise<void> {
  const env = loadEnv(process.env);

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: env.AURORA_DB_POOL_MAX });
  const db = pgPoolAdapter(pool, 'aurora_app');
  // Conexão sem papel fixado: cada rotina de plataforma assume o SEU papel.
  const platformDb = pgPoolAdapter(pool, null);

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: 'aurora_jobs',
  });
  boss.on('error', (e: unknown) => {
    process.stderr.write(JSON.stringify({ nivel: 'error', origem: 'pg-boss', erro: String(e) }) + '\n');
  });

  const publicador = new OutboxPublisher(platformDb, REGISTRO);

  const runtime = new JobRuntime({
    db,
    platformDb,
    boss,
    logger: {
      info: (dados, mensagem) =>
        process.stdout.write(JSON.stringify({ nivel: 'info', mensagem, ...dados }) + '\n'),
      error: (dados, mensagem) =>
        process.stderr.write(JSON.stringify({ nivel: 'error', mensagem, ...dados }) + '\n'),
    },
    async publishOutbox() {
      // Em laço enquanto o lote vier cheio: o cron de um minuto é a rede de
      // segurança, não o mecanismo de vazão. Uma rajada de eventos não espera
      // sessenta segundos por lote.
      let publicados = 0;
      let falhas = 0;
      for (let i = 0; i < 20; i++) {
        const r = await publicador.runOnce();
        publicados += r.published;
        falhas += r.failed;
        if (r.fetched === 0) break;
      }
      return { published: publicados, failed: falhas };
    },
  });

  await runtime.start();
  process.stdout.write(JSON.stringify({ nivel: 'info', mensagem: 'trabalhos no ar' }) + '\n');

  // Parada graciosa: o job em andamento termina. Sem isso, uma implantação no
  // meio da varredura deixaria a organização pela metade — e a política
  // exclusiva só liberaria a próxima quando o job ativo expirasse.
  const parar = async () => {
    await runtime.stop().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void parar());
  process.on('SIGINT', () => void parar());
}

// Só executa quando chamado diretamente; importar este módulo não sobe nada.
if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(JSON.stringify({ nivel: 'fatal', erro: String(e) }) + '\n');
    process.exit(1);
  });
}
