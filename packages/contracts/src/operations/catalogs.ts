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

/**
 * As chaves de catálogo que existem.
 *
 * Era `z.string()`, e por isso a tela de abrir solicitação pedia
 * `failure_code` — chave que nunca existiu. O servidor respondia 422, o
 * seletor de sintoma ficava vazio, e nada na tela dizia que a lista havia
 * falhado: parecia apenas uma organização sem sintomas cadastrados.
 *
 * Com a união literal, o mesmo erro deixa de compilar. A lista está duplicada
 * em `@aurora/domain` de propósito — este pacote não depende de nenhum outro,
 * e é o contrato que a web consome — e um teste falha se as duas divergirem.
 */
export const CATALOG_KEYS = [
  'work_order_type',
  'failure_symptom',
  'failure_cause',
  'failure_action',
  'rejection_reason',
  'customer_segment',
] as const;

export const CatalogKey = z.enum(CATALOG_KEYS);
export type CatalogKey = z.infer<typeof CatalogKey>;

export const catalogItems = defineOperation({
  operationId: 'catalogs.items',
  method: 'GET',
  path: '/catalogs/:catalog/items',
  summary: 'Itens de um catálogo desta organização',
  permissions: ['organization.read'],
  params: z.object({ catalog: CatalogKey }),
  query: z.object({ include_archived: z.enum(['true', 'false']).optional() }),
  response: z.object({ items: z.array(CatalogItem) }),
  errors: ['validation_failed'],
});
