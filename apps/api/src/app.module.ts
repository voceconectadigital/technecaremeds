/**
 * Aurora — composição da API (EPIC-001).
 *
 * DI explícita por token, sem depender de `emitDecoratorMetadata`: além de
 * funcionar em qualquer transpilador, deixa visível o que cada peça recebe.
 */
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import type { Database } from '@aurora/db';
import type { AuroraEnv } from '@aurora/config';
import { HealthController } from './health/health.controller';
import { OrganizationsController } from './platform/organizations.controller';
import { MeController } from './platform/me.controller';
import { LocationsController } from './directory/locations.controller';
import { CustomersController } from './directory/customers.controller';
import { TeamsController } from './directory/teams.controller';
import { CatalogsController } from './catalogs/catalogs.controller';
import { AssetsController } from './assets/assets.controller';
import { QrController } from './assets/qr.controller';
import { ServiceRequestsController } from './requests/service-requests.controller';
import { WorkOrdersController } from './work-orders/work-orders.controller';
import { ExecutionController, ExecutionResourcesController } from './work-orders/execution.controller';
import { ContractsController, AssetContractController } from './contracts/contracts.controller';
import { createContextMiddleware } from './common/context.middleware';
import { ContextResolver } from './common/context.resolver';
import { LocalAuthProvider, type AuthProvider } from './auth/auth-provider.port';
import { createLogger, type StructuredLogger } from './common/logger';
import { DATABASE, ENV, LOGGER, AUTH_PROVIDER } from './common/tokens';

export interface AppDeps {
  db: Database;
  env: AuroraEnv;
  logger?: StructuredLogger;
  authProvider?: AuthProvider;
}

export function createAppModule(deps: AppDeps): new () => NestModule {
  const logger = deps.logger ?? createLogger(deps.env.AURORA_LOG_LEVEL, { app: 'aurora-api' });
  const auth =
    deps.authProvider ??
    new LocalAuthProvider(deps.env.NODE_ENV !== 'production' || deps.env.AURORA_ALLOW_UNSAFE_DEV);
  const resolver = new ContextResolver(deps.db, auth);
  const contextMiddleware = createContextMiddleware(resolver, logger);

  @Module({
    controllers: [
      HealthController,
      MeController,
      OrganizationsController,
      CustomersController,
      LocationsController,
      TeamsController,
      CatalogsController,
      AssetsController,
      QrController,
      ServiceRequestsController,
      WorkOrdersController,
      ExecutionController,
      ExecutionResourcesController,
      ContractsController,
      AssetContractController,
    ],
    providers: [
      { provide: DATABASE, useValue: deps.db },
      { provide: ENV, useValue: deps.env },
      { provide: LOGGER, useValue: logger },
      { provide: AUTH_PROVIDER, useValue: auth },
      { provide: ContextResolver, useValue: resolver },
    ],
  })
  class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(contextMiddleware).forRoutes('*');
    }
  }

  return AppModule;
}
