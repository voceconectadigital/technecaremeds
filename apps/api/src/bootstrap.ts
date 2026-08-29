/**
 * Aurora — criação da aplicação (compartilhada entre runtime e testes).
 */
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { createAppModule, type AppDeps } from './app.module';
import { DomainErrorFilter } from './common/error.filter';
import { PermissionsGuard } from './common/permissions.guard';
import { Reflector } from '@nestjs/core';
import { createLogger } from './common/logger';
import { json, urlencoded } from 'express';

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const logger = deps.logger ?? createLogger(deps.env.AURORA_LOG_LEVEL, { app: 'aurora-api' });
  const app = await NestFactory.create(createAppModule({ ...deps, logger }), { logger: false });
  // O padrão do Express é 100 kB, que recusa a importação do EPIC-005 antes de
  // qualquer validação nossa — e recusa com 500, porque o erro nasce no
  // middleware. 12 MB cobre as 50 mil linhas que a rota aceita (§07) com folga,
  // e continua sendo um teto: acima dele o cliente recebe 413, não 500.
  app.use(json({ limit: '12mb' }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  /*
   * CORS por lista explícita, e nunca `*`.
   *
   * A interface e a API vivem em origens diferentes — em desenvolvimento por
   * porta, em produção por domínio. Sem CORS o navegador recusa a chamada e a
   * tela mostra "Failed to fetch", que não diz nada a ninguém.
   *
   * `credentials: true` combinado com `origin: '*'` é recusado pelo próprio
   * navegador, e com razão: seria autorizar qualquer site a agir em nome de
   * quem está logado. Por isso a lista é fechada.
   */
  const origens = deps.env.AURORA_CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (origens.length > 0) {
    app.enableCors({
      origin: origens,
      credentials: true,
      // Só o que a aplicação realmente manda. `x-aurora-organization` é a
      // escolha de organização; `x-request-id` correlaciona com o log.
      allowedHeaders: ['authorization', 'content-type', 'x-aurora-organization', 'x-request-id'],
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    });
    logger.info('CORS habilitado', { origens });
  }

  app.useGlobalFilters(new DomainErrorFilter(logger));
  app.useGlobalGuards(new PermissionsGuard(app.get(Reflector)));
  // A rota do QR fica fora de `/v1`: o endereço vai impresso numa etiqueta que
  // ficará colada num equipamento por anos, e versão de API numa etiqueta
  // física é uma promessa que não temos como cumprir.
  app.setGlobalPrefix('v1', { exclude: ['q/:token'] });
  return app;
}
