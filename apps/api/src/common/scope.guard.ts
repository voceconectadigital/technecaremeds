/**
 * Aurora — recorte de ESCOPO nas rotas por identificador (reunião 16/10/2026, Fase 1).
 *
 * Autorização = permissão E escopo. O `PermissionsGuard` cobre a permissão; as
 * listas aplicam o escopo nas próprias consultas. Faltava o terceiro caminho:
 * a rota que recebe um IDENTIFICADOR — `GET /work-orders/:id`, `POST
 * /assets/:id/transfer`, `POST /service-requests/:id/transitions`… Sem esta
 * conferência, quem só enxerga a UTI do Hospital A lia (e agia sobre) a OS do
 * Bloco Cirúrgico, ou do Hospital B, desde que soubesse o id.
 *
 * COMO FUNCIONA
 *
 *   1. Vínculo que enxerga tudo (cliente `all` e local `all`) passa direto — é o
 *      caso da maioria, e não paga consulta nenhuma.
 *   2. Para os demais, o caminho é casado com uma lista FECHADA de padrões; cada
 *      padrão sabe de qual tabela vem o par (cliente, local) da entidade.
 *   3. Entidade fora do escopo → 404, a mesma resposta de "não existe": dizer
 *      403 confirmaria que o id é real.
 *
 * Entidade que não existe passa: o handler responde o 404 dele. A consulta roda
 * dentro de `withTenant`, então a RLS da organização continua valendo por
 * baixo — este guard só estreita, nunca alarga.
 */
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { NotFoundError } from '@aurora/domain';
import { withTenant, type Database } from '@aurora/db';
import type { AuroraRequest } from './context.middleware';

const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

/** De onde vem o par (cliente, local) de cada tipo de entidade. */
const ORIGEM = {
  work_order: `SELECT customer_id, location_id FROM aurora.work_orders WHERE id = $2`,
  service_request: `SELECT customer_id, location_id FROM aurora.service_requests WHERE id = $2`,
  asset: `SELECT customer_id, location_id FROM aurora.assets WHERE id = $2`,
  quote: `SELECT customer_id, NULL::uuid AS location_id FROM aurora.quotes WHERE id = $2`,
  checklist_response: `SELECT w.customer_id, w.location_id
                         FROM aurora.checklist_responses r
                         JOIN aurora.work_orders w ON w.id = r.work_order_id
                        WHERE r.id = $2`,
  time_entry: `SELECT w.customer_id, w.location_id
                 FROM aurora.time_entries t
                 JOIN aurora.work_orders w ON w.id = t.work_order_id
                WHERE t.id = $2`,
} as const;

type Origem = keyof typeof ORIGEM;

/** Lista fechada: caminho → entidade. A ordem não importa (os padrões não se sobrepõem). */
export const REGRAS_DE_ESCOPO: readonly [RegExp, Origem][] = [
  [new RegExp(`^/v1/work-orders/${UUID}(?:/|$)`), 'work_order'],
  [new RegExp(`^/v1/work-orders/from-request/${UUID}(?:/|$)`), 'service_request'],
  [new RegExp(`^/v1/schedule/work-orders/${UUID}(?:/|$)`), 'work_order'],
  [new RegExp(`^/v1/inventory/work-orders/${UUID}(?:/|$)`), 'work_order'],
  [new RegExp(`^/v1/service-requests/${UUID}(?:/|$)`), 'service_request'],
  [new RegExp(`^/v1/assets/${UUID}(?:/|$)`), 'asset'],
  [new RegExp(`^/v1/quotes/${UUID}(?:/|$)`), 'quote'],
  [new RegExp(`^/v1/checklist-responses/${UUID}(?:/|$)`), 'checklist_response'],
  [new RegExp(`^/v1/time-entries/${UUID}(?:/|$)`), 'time_entry'],
];

export function entidadeDoCaminho(caminho: string): { origem: Origem; id: string } | null {
  for (const [padrao, origem] of REGRAS_DE_ESCOPO) {
    const m = padrao.exec(caminho);
    if (m) return { origem, id: m[1]!.toLowerCase() };
  }
  return null;
}

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuroraRequest>();
    const ctx = req.auroraContext;
    // Sem contexto (rota pública) ou sem vínculo: nada a estreitar aqui.
    if (!ctx || !ctx.membershipId) return true;
    if (ctx.scope.customerScope === 'all' && ctx.scope.locationScope === 'all') return true;

    const caminho = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
    const alvo = entidadeDoCaminho(caminho);
    if (!alvo) return true;

    const dentro = await withTenant(this.db, ctx, async (s) => {
      const linhas = await s.query<{ ok: boolean | null }>(
        `WITH e AS (${ORIGEM[alvo.origem]})
         SELECT (e.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))
                 AND (e.location_id IS NULL
                      OR e.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($1)))) AS ok
           FROM e`,
        [ctx.membershipId, alvo.id]
      );
      // Não existe (ou é de outra organização, que a RLS esconde): o handler responde.
      if (linhas.length === 0) return true;
      return linhas[0]!.ok === true;
    });

    if (!dentro) throw new NotFoundError('registro não encontrado');
    return true;
  }
}
