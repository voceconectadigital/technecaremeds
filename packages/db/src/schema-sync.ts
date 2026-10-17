/**
 * Aurora — migrar E sincronizar os catálogos que são espelho do código.
 *
 * `permissions` e `catalog_definitions` não vêm por migration (§21): a lista
 * mora em `@aurora/domain` e é copiada para o banco por `syncPermissionCatalog`
 * e `syncCatalogDefinitions`. Até 17/10/2026 só os seeds (desenvolvimento,
 * homologação, demonstração, E2E) chamavam a segunda — e o `migrate` de
 * produção não chamava nenhuma das duas.
 *
 * O efeito apareceu com a rodada de 16/10: o provisionamento de organização
 * passou a semear os tipos de OS (`catalog_items` com `catalog_key =
 * 'work_order_type'`), cuja chave estrangeira exige a definição do catálogo.
 * Num banco preparado só com `db:migrate` + `admin:criar`, criar a primeira
 * organização (ou um Novo Negócio) falhava com violação de chave estrangeira; e
 * a 0064, aplicada sobre um banco com organização mas sem definições, também.
 *
 * Por isso as duas listas são sincronizadas ANTES das migrations pendentes
 * (quando as tabelas já existem — as colunas usadas são as da 0006 e da 0011),
 * para que uma migration que semeia dado dependente delas encontre a chave, e de
 * novo DEPOIS, para as chaves novas. As duas funções são idempotentes.
 */
import type { Database } from './client';
import { migrate, type MigrateResult } from './migrator';
import { syncPermissionCatalog } from './rbac';
import { syncCatalogDefinitions } from './catalogs';

export interface MigrateAndSyncResult extends MigrateResult {
  permissions: { inserted: number; updated: number; orphaned: string[] };
  catalogs: { inserted: number; updated: number; orphaned: string[] };
}

export async function migrateAndSyncCatalogs(adminDb: Database, dir?: string): Promise<MigrateAndSyncResult> {
  if (adminDb.appRole) {
    throw new Error('migrateAndSyncCatalogs exige o banco administrativo (appRole = null)');
  }
  const [existe] = await adminDb.query<{ permissoes: boolean; catalogos: boolean }>(
    `SELECT to_regclass('aurora.permissions') IS NOT NULL AS permissoes,
            to_regclass('aurora.catalog_definitions') IS NOT NULL AS catalogos`
  );
  if (existe?.permissoes) await syncPermissionCatalog(adminDb);
  if (existe?.catalogos) await syncCatalogDefinitions(adminDb);

  const result = await migrate(adminDb, dir);
  const permissions = await syncPermissionCatalog(adminDb);
  const catalogs = await syncCatalogDefinitions(adminDb);
  return { ...result, permissions, catalogs };
}
