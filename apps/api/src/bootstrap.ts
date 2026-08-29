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
  app.useGlobalFilters(new DomainErrorFilter(logger));
  app.useGlobalGuards(new PermissionsGuard(app.get(Reflector)));
  app.setGlobalPrefix('v1');
  return app;
}
