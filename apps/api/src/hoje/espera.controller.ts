/**
 * Aurora — tela Hoje: aguardando orçamento e aguardando peças (ORC-05).
 *
 * O contador e a lista saem da MESMA consulta, com os mesmos recortes: o número da tela nunca
 * diverge da lista que ele abre. Ver o contrato (`today.waiting`) para o que conta como espera.
 *
 * ESCOPO. As OS passam pelo mesmo fragmento das listas de equipe (`filtroDeEscopo`): cliente e
 * local do vínculo. O orçamento sem OS não tem local, então o recorte é o do cliente — e ele só
 * entra para quem tem `quote.read`. Setor pedido fora do escopo é 404, como no quadro de planos.
 */
import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { withTenant, membershipScope, sectorPaths, type Database } from '@aurora/db';
import { NotFoundError } from '@aurora/domain';
import { todayWaiting, setoresDaConsulta, type WaitingItem } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import { escopoRestrito, filtroDeEscopo, filtroDeEscopoPor } from '../common/scope-sql';
import type { AuroraRequest } from '../common/context.middleware';

/** Teto por resposta: a tela é de acompanhamento, não de exportação. */
const MAX_LINHAS = 1000;

type Faceta = { id: string; label: string; total: number };

function facetas(
  itens: WaitingItem[],
  id: (i: WaitingItem) => string | null,
  rotulo: (i: WaitingItem) => string | null
): Faceta[] {
  const m = new Map<string, Faceta>();
  for (const i of itens) {
    const k = id(i);
    if (!k) continue;
    const f = m.get(k) ?? { id: k, label: rotulo(i) ?? '—', total: 0 };
    f.total++;
    m.set(k, f);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'));
}

@Controller('today')
export class HojeEsperaController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('waiting')
  @RequirePermissions('work_order.read')
  async waiting(@Req() req: AuroraRequest, @Query() query: unknown): Promise<unknown> {
    const ctx = req.auroraContext!;
    const q = parseWith(todayWaiting.query, query);
    const restrito = escopoRestrito(ctx) ? ctx.membershipId : null;
    const veOrcamento = ctx.permissions.has('quote.read');

    const todos = await withTenant(this.db, ctx, async (s) => {
      const escopo = await membershipScope(s, ctx.membershipId);
      // Cliente fora do escopo de quem é RESTRITO: 404. Para quem enxerga todos, um cliente que
      // não existe só não tem espera nenhuma (como no quadro de OS) — a RLS já impede que um
      // cliente de outra organização traga qualquer linha.
      if (q.customer && escopo.customerIds !== null && !escopo.customerIds.includes(q.customer)) {
        throw new NotFoundError('cliente', q.customer);
      }
      const caminhos = await sectorPaths(s, { sectorIds: setoresDaConsulta(q.sector) }, escopo);

      /*
       * As OS: peças pelo motivo de espera; orçamento pelo motivo OU por um orçamento enviado e
       * sem resposta. Uma OS parada por peça que também tem orçamento pendente aparece nas duas
       * listas — são duas esperas diferentes, e cada lista responde a sua.
       */
      const ordens = await s.query<WaitingItem>(
        `WITH base AS (
           SELECT w.id, w.number, w.title, w.customer_id, c.name AS customer_name,
                  w.assignee_membership_id, resp.name AS assignee_name,
                  w.asset_name_snapshot AS asset_name, w.status_category, w.status_changed_at,
                  wr.key AS wait_key, wr.label AS wait_label,
                  se.id AS sector_id, se.name AS sector_name, l.path AS location_path,
                  qp.id AS quote_id, qp.number AS quote_number, qp.status AS quote_status,
                  qp.sent_at AS quote_sent_at
             FROM aurora.work_orders w
             JOIN aurora.customers c ON c.id = w.customer_id
             LEFT JOIN aurora.wait_reasons wr ON wr.id = w.wait_reason_id
             LEFT JOIN aurora.memberships rm ON rm.id = w.assignee_membership_id
             LEFT JOIN aurora.users resp ON resp.id = rm.user_id
             LEFT JOIN aurora.locations l ON l.id = w.location_id
             LEFT JOIN LATERAL (
               SELECT s.id, s.name FROM aurora.locations s
                 JOIN aurora.location_types lt ON lt.id = s.location_type_id AND lt.key = 'setor'
                WHERE l.path LIKE s.path || '%' AND s.deleted_at IS NULL
                ORDER BY s.depth DESC LIMIT 1
             ) se ON true
             LEFT JOIN LATERAL (
               SELECT q.id, q.number, q.status::text AS status, q.sent_at FROM aurora.quotes q
                WHERE q.work_order_id = w.id AND q.status IN ('sent', 'viewed')
                ORDER BY q.version DESC LIMIT 1
             ) qp ON ${veOrcamento ? 'true' : 'false'}
            WHERE w.status_category NOT IN ('done', 'closed', 'cancelled')
              AND ($1::uuid IS NULL OR w.customer_id = $1)
              AND ($2::uuid IS NULL OR w.assignee_membership_id = $2)
              AND ($3::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM unnest($3::text[]) AS setor(p) WHERE l.path LIKE setor.p || '%'))
              AND ($4::uuid IS NULL OR ${filtroDeEscopo('w', 4)})
         )
         SELECT 'work_order' AS kind, 'parts' AS reason, id AS work_order_id, number AS work_order_number,
                title, NULL::uuid AS quote_id, NULL::text AS quote_number, NULL::text AS quote_status,
                customer_id, customer_name, sector_id, sector_name, assignee_membership_id,
                assignee_name, asset_name, wait_label AS wait_reason_label, status_changed_at AS since
           FROM base WHERE status_category = 'waiting' AND wait_key = 'parts'
         UNION ALL
         SELECT 'work_order', 'quote', id, number, title, quote_id, quote_number, quote_status,
                customer_id, customer_name, sector_id, sector_name, assignee_membership_id,
                assignee_name, asset_name,
                CASE WHEN status_category = 'waiting' AND wait_key = 'quote_approval'
                     THEN wait_label ELSE NULL END,
                COALESCE(quote_sent_at, status_changed_at)
           FROM base
          WHERE (status_category = 'waiting' AND wait_key = 'quote_approval') OR quote_id IS NOT NULL
         ORDER BY since NULLS LAST
         LIMIT ${MAX_LINHAS}`,
        [q.customer ?? null, q.assignee ?? null, caminhos, restrito]
      );

      // Orçamento enviado SEM OS: não tem setor nem responsável de execução — some quando um
      // desses recortes é pedido, porque não pertence a nenhum.
      const semOs =
        !veOrcamento || caminhos !== null || q.assignee
          ? []
          : await s.query<WaitingItem>(
              `SELECT 'quote' AS kind, 'quote' AS reason, NULL::uuid AS work_order_id,
                      NULL::text AS work_order_number,
                      'Orçamento ' || q.number AS title, q.id AS quote_id, q.number AS quote_number,
                      q.status::text AS quote_status, q.customer_id, c.name AS customer_name,
                      NULL::uuid AS sector_id, NULL::text AS sector_name,
                      NULL::uuid AS assignee_membership_id, NULL::text AS assignee_name,
                      NULL::text AS asset_name, NULL::text AS wait_reason_label, q.sent_at AS since
                 FROM aurora.quotes q
                 JOIN aurora.customers c ON c.id = q.customer_id
                WHERE q.work_order_id IS NULL AND q.status IN ('sent', 'viewed')
                  AND ($1::uuid IS NULL OR q.customer_id = $1)
                  AND ($2::uuid IS NULL OR ${filtroDeEscopoPor('q.customer_id', 'NULL::uuid', 2)})
                ORDER BY q.sent_at NULLS LAST
                LIMIT ${MAX_LINHAS}`,
              [q.customer ?? null, restrito]
            );
      return [...ordens, ...semOs];
    });

    const counts = {
      quote: todos.filter((i) => i.reason === 'quote').length,
      parts: todos.filter((i) => i.reason === 'parts').length,
    };
    const items = q.reason ? todos.filter((i) => i.reason === q.reason) : todos;
    return {
      counts,
      items,
      facets: {
        customers: facetas(
          items,
          (i) => i.customer_id,
          (i) => i.customer_name
        ),
        sectors: facetas(
          items,
          (i) => i.sector_id,
          (i) => i.sector_name
        ),
        assignees: facetas(
          items,
          (i) => i.assignee_membership_id,
          (i) => i.assignee_name
        ),
      },
    };
  }
}
