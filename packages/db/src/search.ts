/**
 * Aurora — busca global na camada de dados (SPEC v0.2 §27 · EPIC-025).
 *
 * NÃO HÁ ÍNDICE PRÓPRIO, E ISSO É DECISÃO
 *   A busca consulta as tabelas de origem, uma por escopo, com os índices que
 *   cada uma já tem — o nome normalizado dos ativos, o número da OS, o SKU do
 *   item. A alternativa seria uma tabela de índice mantida por gatilho, como o
 *   fato do EPIC-021, e ela seria mais rápida.
 *
 *   Não foi escolhida porque o risco aqui é diferente: o fato de OS erra e o
 *   painel fica velho; o índice de busca erra e o registro DESAPARECE para quem
 *   procura — que é exatamente o problema da referência, resolvido de outro
 *   jeito. Consultar a origem não tem como dessincronizar.
 *
 *   O §27 diz "motor dedicado apenas quando o volume ou a latência exigirem", e
 *   é a mesma disciplina: a estrutura extra entra quando houver medida que a
 *   justifique, não antes.
 *
 * O ESCOPO É APLICADO NA CONSULTA, NÃO NA EXIBIÇÃO
 *   Um resultado fora do escopo do usuário não existe para ele. Filtrar depois
 *   de buscar vazaria a existência do registro — o contador diria "12" e a tela
 *   mostraria 3.
 *
 *   E o escopo tem DUAS dimensões (§05), clientes e locais, que são
 *   independentes: um vínculo pode enxergar o hospital inteiro e só a UTI dele.
 *   Filtrar por uma das duas deixaria passar metade do que deveria esconder.
 */
import {
  parseQuery,
  rankHits,
  matchCommands,
  MIN_TERM_LENGTH,
  ValidationError,
  type SearchHit,
  type SearchScope,
  type MatchKind,
  type CommandDefinition,
} from '@aurora/domain';
import type { TenantSession } from './client';

export interface SearchOptions {
  /** Teto de resultados por escopo, antes do ranqueamento. */
  perScope?: number;
  /** Teto do resultado final. */
  limit?: number;
}

export interface SearchResponse {
  term: string;
  commandMode: boolean;
  commands: CommandDefinition[];
  hits: SearchHit[];
  /** Escopos de fato consultados — a tela mostra os agrupadores certos. */
  scopes: SearchScope[];
}

interface RawHit {
  scope: SearchScope;
  id: string;
  title: string;
  subtitle: string | null;
  match_kind: MatchKind;
  touched_at: Date | null;
}

/**
 * A busca.
 *
 * Cada escopo é uma consulta própria, e não um `UNION` gigante: o `UNION`
 * obrigaria todas as colunas a terem o mesmo tipo e o mesmo significado, e o
 * planejador do banco perderia os índices específicos de cada tabela — que é o
 * que faz a busca por patrimônio ser instantânea.
 */
export async function search(
  session: TenantSession,
  input: string,
  opts: SearchOptions = {}
): Promise<SearchResponse> {
  const q = parseQuery(input);

  if (q.commandMode) {
    return {
      term: q.term,
      commandMode: true,
      commands: matchCommands(q.term, session.context.permissions),
      hits: [],
      scopes: [],
    };
  }

  if (q.term.length < MIN_TERM_LENGTH) {
    throw new ValidationError(`informe ao menos ${MIN_TERM_LENGTH} caracteres para buscar`, { field: 'q' });
  }

  const porEscopo = Math.min(Math.max(opts.perScope ?? 10, 1), 50);
  const total = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const escopos: SearchScope[] = q.scopes.length > 0 ? [...q.scopes] : [...ESCOPOS_PADRAO];

  const brutos: RawHit[] = [];
  for (const escopo of escopos) {
    const consulta = CONSULTAS[escopo];
    if (!consulta) continue;
    // A permissão de leitura do escopo é conferida ANTES da consulta: sem ela,
    // o escopo não é consultado e o resultado não existe.
    if (!session.context.permissions.has(consulta.permission)) continue;

    brutos.push(...(await consulta.run(session, q.term, q.raw, porEscopo)));
  }

  const hits = rankHits(
    brutos.map((r) => ({
      scope: r.scope,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      matchKind: r.match_kind,
      touchedAt: r.touched_at ? new Date(r.touched_at) : null,
    }))
  ).slice(0, total);

  return {
    term: q.term,
    commandMode: false,
    // A paleta também sugere comandos numa busca comum: quem digita "agenda"
    // quase sempre quer ir para a agenda, não achar um registro chamado agenda.
    commands: matchCommands(q.term, session.context.permissions).slice(0, 3),
    hits,
    scopes: escopos,
  };
}

const ESCOPOS_PADRAO: readonly SearchScope[] = [
  'asset',
  'work_order',
  'service_request',
  'customer',
  'location',
  'inventory_item',
  'document',
  'quote',
  'person',
];

interface ScopeQuery {
  permission: string;
  run(session: TenantSession, term: string, raw: string, limit: number): Promise<RawHit[]>;
}

/**
 * Casamento de identificador do ativo.
 *
 * Os três identificadores — TAG, série e patrimônio — são lidos DIRETO das
 * colunas do ativo, e não de `asset_identifiers`.
 *
 * A tentação é usar aquela projeção: ela já traz os três normalizados. Mas ela
 * é a projeção de UNICIDADE (EPIC-005), e só contém os campos que a organização
 * declarou como únicos. Numa organização que não exige patrimônio único, o
 * patrimônio simplesmente não estaria lá — e "7737" não acharia o ativo. Seria
 * a lacuna da referência de volta, por um caminho mais sofisticado: fazer a
 * busca depender de uma configuração que não tem nada a ver com busca.
 */
const CONSULTAS: Partial<Record<SearchScope, ScopeQuery>> = {
  asset: {
    permission: 'asset.read',
    async run(session, term, raw, limit) {
      return session.query<RawHit>(
        `SELECT 'asset'::text AS scope, a.id, a.name AS title,
                COALESCE(NULLIF(a.location_path, ''), c.name) AS subtitle,
                CASE
                  WHEN aurora.normalize_label(COALESCE(a.tag, '')) = $1::text
                    OR aurora.normalize_label(COALESCE(a.serial_number, '')) = $1::text
                    OR aurora.normalize_label(COALESCE(a.asset_number, '')) = $1::text
                    THEN 'identifier_exact'
                  WHEN aurora.normalize_label(COALESCE(a.tag, '')) LIKE $1::text || '%'
                    OR aurora.normalize_label(COALESCE(a.serial_number, '')) LIKE $1::text || '%'
                    OR aurora.normalize_label(COALESCE(a.asset_number, '')) LIKE $1::text || '%'
                    THEN 'identifier_prefix'
                  ELSE 'text'
                END::text AS match_kind,
                a.updated_at AS touched_at
           FROM aurora.assets a
           LEFT JOIN aurora.customers c ON c.id = a.customer_id
          WHERE a.deleted_at IS NULL
            AND (
              aurora.normalize_label(a.name) LIKE '%' || $1::text || '%'
              OR aurora.normalize_label(COALESCE(a.tag, '')) LIKE $1::text || '%'
              OR aurora.normalize_label(COALESCE(a.serial_number, '')) LIKE $1::text || '%'
              OR aurora.normalize_label(COALESCE(a.asset_number, '')) LIKE $1::text || '%'
            )
            AND a.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($2::uuid))
            AND (
              a.location_id IS NULL
              OR a.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2::uuid))
            )
          ORDER BY match_kind, a.updated_at DESC
          LIMIT ${limit}`,
        [term, session.context.membershipId]
      );
    },
  },

  work_order: {
    permission: 'work_order.read',
    async run(session, term, raw, limit) {
      return session.query<RawHit>(
        `SELECT 'work_order'::text AS scope, w.id, COALESCE(w.number, w.title) AS title,
                w.title AS subtitle,
                CASE
                  WHEN lower(w.number) = lower($3::text) THEN 'identifier_exact'
                  WHEN lower(w.number) LIKE lower($3::text) || '%' THEN 'identifier_prefix'
                  WHEN w.number LIKE '%' || $3::text || '%' THEN 'identifier_prefix'
                  ELSE 'text'
                END::text AS match_kind,
                w.updated_at AS touched_at
           FROM aurora.work_orders w
          WHERE (
                  w.number ILIKE '%' || $3::text || '%'
                  OR aurora.normalize_label(w.title) LIKE '%' || $1::text || '%'
                )
            AND w.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($2::uuid))
            AND (
              w.location_id IS NULL
              OR w.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2::uuid))
            )
          ORDER BY match_kind, w.updated_at DESC
          LIMIT ${limit}`,
        [term, session.context.membershipId, raw]
      );
    },
  },

  service_request: {
    permission: 'service_request.read',
    async run(session, term, raw, limit) {
      return session.query<RawHit>(
        `SELECT 'service_request'::text AS scope, r.id, COALESCE(r.number, r.summary) AS title,
                r.summary AS subtitle,
                CASE WHEN lower(r.number) = lower($3::text) THEN 'identifier_exact'
                     WHEN r.number ILIKE '%' || $3::text || '%' THEN 'identifier_prefix'
                     ELSE 'text' END::text AS match_kind,
                r.updated_at AS touched_at
           FROM aurora.service_requests r
          WHERE (
                  r.number ILIKE '%' || $3::text || '%'
                  OR aurora.normalize_label(r.summary) LIKE '%' || $1::text || '%'
                )
            AND r.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($2::uuid))
            AND (
              r.location_id IS NULL
              OR r.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2::uuid))
            )
          ORDER BY match_kind, r.updated_at DESC
          LIMIT ${limit}`,
        [term, session.context.membershipId, raw]
      );
    },
  },

  customer: {
    permission: 'customer.read',
    async run(session, term, raw, limit) {
      return session.query<RawHit>(
        `SELECT 'customer'::text AS scope, c.id, c.name AS title,
                c.tax_id AS subtitle,
                CASE WHEN aurora.normalize_label(c.name) = $1::text THEN 'identifier_exact' ELSE 'text' END::text
                  AS match_kind,
                c.updated_at AS touched_at
           FROM aurora.customers c
          WHERE c.deleted_at IS NULL
            AND (aurora.normalize_label(c.name) LIKE '%' || $1::text || '%' OR c.tax_id ILIKE '%' || $3::text || '%')
            AND c.id IN (SELECT customer_id FROM aurora.accessible_customer_ids($2::uuid))
          ORDER BY match_kind, c.updated_at DESC
          LIMIT ${limit}`,
        [term, session.context.membershipId, raw]
      );
    },
  },

  location: {
    permission: 'location.read',
    async run(session, term, raw, limit) {
      return session.query<RawHit>(
        `SELECT 'location'::text AS scope, l.id, l.name AS title,
                l.path AS subtitle,
                CASE WHEN lower(l.code) = lower($3::text) THEN 'identifier_exact' ELSE 'text' END::text
                  AS match_kind,
                l.updated_at AS touched_at
           FROM aurora.locations l
          WHERE l.deleted_at IS NULL
            AND (aurora.normalize_label(l.name) LIKE '%' || $1::text || '%'
                 OR l.code ILIKE '%' || $3::text || '%')
            AND l.id IN (SELECT location_id FROM aurora.accessible_location_ids($2::uuid))
          ORDER BY match_kind, l.updated_at DESC
          LIMIT ${limit}`,
        [term, session.context.membershipId, raw]
      );
    },
  },

  inventory_item: {
    permission: 'inventory.read',
    async run(session, term, raw, limit) {
      return session.query<RawHit>(
        `SELECT 'inventory_item'::text AS scope, i.id, i.name AS title,
                i.sku AS subtitle,
                CASE WHEN lower(i.sku) = lower($2::text) THEN 'identifier_exact'
                     WHEN lower(i.sku) LIKE lower($2::text) || '%' THEN 'identifier_prefix'
                     ELSE 'text' END::text AS match_kind,
                i.updated_at AS touched_at
           FROM aurora.inventory_items i
          WHERE i.archived_at IS NULL
            AND (i.normalized_name LIKE '%' || $1::text || '%' OR i.sku ILIKE '%' || $2::text || '%')
          ORDER BY match_kind, i.updated_at DESC
          LIMIT ${limit}`,
        [term, raw]
      );
    },
  },

  document: {
    permission: 'document.read',
    async run(session, term, raw, limit) {
      return session.query<RawHit>(
        `SELECT 'document'::text AS scope, d.id, COALESCE(d.number, d.title, t.label) AS title,
                t.label AS subtitle,
                CASE WHEN lower(d.number) = lower($2::text) THEN 'identifier_exact'
                     ELSE 'identifier_prefix' END::text AS match_kind,
                d.updated_at AS touched_at
           FROM aurora.documents d
           JOIN aurora.document_types t ON t.id = d.document_type_id
          WHERE d.number ILIKE '%' || $2::text || '%'
             OR aurora.normalize_label(COALESCE(d.title, '')) LIKE '%' || $1::text || '%'
          ORDER BY match_kind, d.updated_at DESC
          LIMIT ${limit}`,
        [term, raw]
      );
    },
  },

  quote: {
    permission: 'quote.read',
    async run(session, term, raw, limit) {
      return session.query<RawHit>(
        `SELECT 'quote'::text AS scope, q.id, q.number AS title,
                c.name AS subtitle,
                CASE WHEN lower(q.number) = lower($1::text) THEN 'identifier_exact'
                     ELSE 'identifier_prefix' END::text AS match_kind,
                q.updated_at AS touched_at
           FROM aurora.quotes q
           LEFT JOIN aurora.customers c ON c.id = q.customer_id
          WHERE q.number ILIKE '%' || $1::text || '%'
          ORDER BY match_kind, q.updated_at DESC
          LIMIT ${limit}`,
        // Só o termo original: um parâmetro declarado e não usado faz o
        // PostgreSQL recusar a consulta inteira por não conseguir inferir o
        // tipo dele — e o erro não diz qual consulta é.
        [raw]
      );
    },
  },

  person: {
    permission: 'team.read',
    async run(session, term, raw, limit) {
      return session.query<RawHit>(
        `SELECT 'person'::text AS scope, m.id, u.name AS title,
                u.email AS subtitle,
                CASE WHEN lower(split_part(u.email, '@', 1)) = $1::text THEN 'identifier_exact'
                     ELSE 'text' END::text AS match_kind,
                m.updated_at AS touched_at
           FROM aurora.memberships m
           JOIN aurora.users u ON u.id = m.user_id
          WHERE m.status = 'active'
            AND (aurora.normalize_label(u.name) LIKE '%' || $1::text || '%'
                 OR lower(u.email) LIKE '%' || $1::text || '%')
          ORDER BY match_kind, u.name
          LIMIT ${limit}`,
        [term]
      );
    },
  },
};
