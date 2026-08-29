/**
 * Aurora — busca global (SPEC v0.2 §27 · EPIC-025).
 *
 * A auditoria do sistema de referência registrou o custo de não ter isto: para
 * achar "patrimônio 7737" era preciso saber em qual lista procurar. O técnico
 * com o equipamento na frente sabe o número da etiqueta e não sabe se aquilo é
 * TAG, patrimônio ou série.
 */
import { defineOperation } from '../registry';
import { z, Uuid } from '../primitives';

export const SEARCH_SCOPES = [
  'asset',
  'work_order',
  'service_request',
  'customer',
  'location',
  'inventory_item',
  'document',
  'quote',
  'person',
] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

/**
 * COMO o termo casou.
 *
 * Não é enfeite: é o que ordena o resultado. Identificador exato ganha de
 * tudo, porque quem digita "7737" está com a etiqueta na mão e quer AQUELE
 * equipamento — não os quarenta que mencionam 7737 numa observação.
 */
export const MATCH_KINDS = ['identifier_exact', 'identifier_prefix', 'text'] as const;

export const SearchHit = z.object({
  scope: z.enum(SEARCH_SCOPES),
  id: Uuid,
  title: z.string(),
  subtitle: z.string().nullable(),
  matchKind: z.enum(MATCH_KINDS),
  touchedAt: z.string().nullable(),
});
export type SearchHit = z.infer<typeof SearchHit>;

/** Um atalho de ação — "nova OS" — e não um registro encontrado. */
export const SearchCommand = z.object({
  key: z.string(),
  label: z.string(),
  action: z.string(),
  permission: z.string(),
  keywords: z.array(z.string()),
});

export const SearchResult = z.object({
  term: z.string(),
  /** O termo começava com `>`: a pessoa quer um comando, não um registro. */
  commandMode: z.boolean(),
  commands: z.array(SearchCommand),
  hits: z.array(SearchHit),
  /** Escopos de fato consultados — os que a permissão permitiu. */
  scopes: z.array(z.enum(SEARCH_SCOPES)),
  /** Os rótulos vêm do servidor para a tela não ter a sua própria tradução. */
  scopeLabels: z.record(z.string(), z.string()),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const searchGlobal = defineOperation({
  operationId: 'search.global',
  method: 'GET',
  path: '/search',
  summary: 'Busca global por identificador, título e cliente',
  description:
    'Um lugar só, que aceita o que a pessoa tem na mão. Cada escopo só é consultado se a ' +
    'permissão de leitura dele existir — o resultado fora do alcance não aparece porque não ' +
    'é buscado, e não porque foi filtrado depois.',
  query: z.object({
    q: z.string().min(1).max(120),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }),
  response: SearchResult,
  errors: ['validation_failed'],
});
