/**
 * Aurora — catálogos configuráveis (SPEC v0.2 §06 · ADR-028 · EPIC-004).
 *
 * Natureza de OS, código de falha, motivo de recusa: cada organização define
 * os seus. Onde a SPEC v0.1 nomeava tabelas separadas, o que existe é
 * `catalog_items` com o `catalog_key` correspondente.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const CatalogItem = z.object({
  id: Uuid,
  catalog_key: z.string(),
  key: z.string(),
  /**
   * A chave do SIGNIFICADO, quando existe.
   *
   * O nome pode ser qualquer um — "Corretiva", "Emergencial", "Conserto" —,
   * mas o relatório precisa saber que os três são corretiva. É `system_key`
   * que carrega isso; sem ele, todo painel dependeria de alguém ter escrito o
   * nome do jeito esperado.
   */
  system_key: z.string().nullable(),
  label: z.string(),
  normalized_label: z.string().nullable(),
  parent_id: Uuid.nullable(),
  position: z.number().int().nullable(),
  archived_at: Timestamp.nullable(),
  merged_into_id: Uuid.nullable(),
});
export type CatalogItem = z.infer<typeof CatalogItem>;

export const catalogItems = defineOperation({
  operationId: 'catalogs.items',
  method: 'GET',
  path: '/catalogs/:catalog/items',
  summary: 'Itens de um catálogo desta organização',
  permissions: ['organization.read'],
  params: z.object({ catalog: z.string() }),
  query: z.object({ include_archived: z.enum(['true', 'false']).optional() }),
  response: z.object({ items: z.array(CatalogItem) }),
  errors: ['validation_failed'],
});
