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

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const logger = deps.logger ?? createLogger(deps.env.AURORA_LOG_LEVEL, { app: 'aurora-api' });
  const app = await NestFactory.create(createAppModule({ ...deps, logger }), { logger: false });
  app.useGlobalFilters(new DomainErrorFilter(logger));
  app.useGlobalGuards(new PermissionsGuard(app.get(Reflector)));
  app.setGlobalPrefix('v1');
  return app;
}
