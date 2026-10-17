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
import { PortalController } from './portal/portal.controller';
import { PlansController } from './plans/plans.controller';
import { ProceduresController } from './plans/procedures.controller';
import { InventoryController } from './inventory/inventory.controller';
import { RolesController } from './platform/roles.controller';
import { MembersController } from './platform/members.controller';
import { MeController } from './platform/me.controller';
import { LocationsController } from './directory/locations.controller';
import { CustomersController } from './directory/customers.controller';
import { TeamsController } from './directory/teams.controller';
import { CatalogsController } from './catalogs/catalogs.controller';
import { AssetsController } from './assets/assets.controller';
import { AssetCatalogController } from './assets/asset-catalog.controller';
import { ExecucaoGuiadaController } from './work-orders/execucao-guiada.controller';
import { QrController } from './assets/qr.controller';
import { ServiceRequestsController } from './requests/service-requests.controller';
import { WorkOrdersController } from './work-orders/work-orders.controller';
import { ExecutionController, ExecutionResourcesController } from './work-orders/execution.controller';
import { FieldController } from './work-orders/field.controller';
import { ContractsController, AssetContractController } from './contracts/contracts.controller';
import { QuotesController } from './quotes/quotes.controller';
import { ScheduleController } from './schedule/schedule.controller';
import { DocumentsController } from './documents/documents.controller';
import { InsightsController } from './insights/insights.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { AutomationsController } from './automations/automations.controller';
import { SearchController } from './search/search.controller';
import { AuditController } from './audit/audit.controller';
import { FieldUploadController } from './work-orders/field-upload.controller';
import { armazenamentoEmDisco } from './common/arquivos/disco';
import type { ArmazenamentoDeObjetos } from './common/arquivos/porta';
import { createContextMiddleware } from './common/context.middleware';
import { ContextResolver } from './common/context.resolver';
import type { AuthProvider } from './auth/auth-provider.port';
import { escolherProvedorDeAutenticacao } from './auth/escolher-provedor';
import { AuthController } from './auth/auth.controller';
import { ImportsController } from './imports/imports.controller';
import { OpportunitiesController } from './opportunities/opportunities.controller';
import {
  InstrumentsController,
  InstrumentCertificatesController,
  WorkOrderMeasurementController,
  MeasurementSessionsController,
} from './metrology/metrology.controller';
import { createLogger, type StructuredLogger } from './common/logger';
import { ARQUIVOS, DATABASE, ENV, LOGGER, AUTH_PROVIDER } from './common/tokens';

export interface AppDeps {
  db: Database;
  env: AuroraEnv;
  logger?: StructuredLogger;
  authProvider?: AuthProvider;
  /**
   * Onde os bytes dos anexos moram. Sem isto, disco — o padrão da
   * homologação. Os testes passam memória, e assim exercitam o mesmo caminho
   * sem tocar no sistema de arquivos.
   */
  arquivos?: ArmazenamentoDeObjetos;
}

export function createAppModule(deps: AppDeps): new () => NestModule {
  const logger = deps.logger ?? createLogger(deps.env.AURORA_LOG_LEVEL, { app: 'aurora-api' });
  // O provedor vem da CONFIGURAÇÃO, e não de um padrão embutido. Ver
  // `escolher-provedor.ts`: um padrão silencioso aqui foi o defeito que fazia
  // `AURORA_AUTH_PROVIDER=supabase` subir aceitando entrada sem senha.
  const auth = deps.authProvider ?? escolherProvedorDeAutenticacao(deps.env, deps.db);
  const resolver = new ContextResolver(deps.db, auth);
  const contextMiddleware = createContextMiddleware(resolver, logger);

  @Module({
    controllers: [
      HealthController,
      AuthController,
      MeController,
      OrganizationsController,
      MembersController,
      RolesController,
      InventoryController,
      PlansController,
      ProceduresController,
      PortalController,
      CustomersController,
      LocationsController,
      TeamsController,
      CatalogsController,
      AssetsController,
      AssetCatalogController,
      QrController,
      ServiceRequestsController,
      WorkOrdersController,
      ExecutionController,
      ExecutionResourcesController,
      ExecucaoGuiadaController,
      FieldController,
      ContractsController,
      AssetContractController,
      QuotesController,
      ScheduleController,
      DocumentsController,
      InsightsController,
      NotificationsController,
      AutomationsController,
      SearchController,
      AuditController,
      InstrumentsController,
      InstrumentCertificatesController,
      WorkOrderMeasurementController,
      MeasurementSessionsController,
      OpportunitiesController,
      ImportsController,
      FieldUploadController,
    ],
    providers: [
      { provide: DATABASE, useValue: deps.db },
      {
        provide: ARQUIVOS,
        useValue: deps.arquivos ?? armazenamentoEmDisco(deps.env.AURORA_ARQUIVOS_DIR),
      },
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
