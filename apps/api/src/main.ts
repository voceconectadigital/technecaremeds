/**
 * Aurora — entrypoint da API.
 * Falha alto e cedo: configuração inválida ou banco inacessível impedem o boot.
 */
import 'reflect-metadata';
import { Pool } from 'pg';
import { loadEnv, describe as describeEnv } from '@aurora/config';
import { pgPoolAdapter, assertAppRoleIsSafe, protegerPool, OPCOES_DE_POOL } from '@aurora/db';
import { createApp } from './bootstrap';
import { escolherProvedorDeAutenticacao } from './auth/escolher-provedor';
import { createLogger } from './common/logger';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.AURORA_LOG_LEVEL, { app: 'aurora-api' });
  logger.info('configuração carregada', describeEnv(env));

  const pool = protegerPool(
    new Pool({ connectionString: env.DATABASE_URL, max: env.AURORA_DB_POOL_MAX, ...OPCOES_DE_POOL }),
    (e) => logger.error('conexão ociosa do banco caiu; o pool a descartou', { erro: e.message })
  );
  const db = pgPoolAdapter(pool, env.AURORA_DB_APP_ROLE);

  // o boot falha se o papel do banco puder ignorar RLS (§37)
  const role = await assertAppRoleIsSafe(db, env.AURORA_ALLOW_UNSAFE_DEV);
  logger.info('papel de banco verificado', { role: role.role });

  const auth = escolherProvedorDeAutenticacao(env, db);
  logger.info('provedor de identidade', { provider: auth.name });

  const app = await createApp({ db, env, logger, authProvider: auth });
  await app.listen(env.AURORA_PORT);
  logger.info('api no ar', { port: env.AURORA_PORT });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      logger.info('encerrando', { signal });
      void app
        .close()
        .then(() => db.close())
        .catch((e: unknown) => logger.error('falha ao encerrar', { erro: String(e) }))
        .then(() => process.exit(0));
    });
  }
}

main().catch((e) => {
  process.stderr.write(`\n${e instanceof Error ? e.message : String(e)}\n\n`);
  process.exit(1);
});
