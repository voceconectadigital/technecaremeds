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
  // Pente-fino 17/10: as entidades que tinham cliente e ficaram de fora.
  //
  // Documento SEM cliente (interno da organização) tem `customer_id` nulo, e
  // `NULL IN (...)` não é verdadeiro: quem é restrito não o vê — a mesma regra
  // do portal (`documentForPdf`), que só mostra documento do cliente dele. O
  // local vem do equipamento e, sem ele, da OS.
  document: `SELECT d.customer_id, COALESCE(a.location_id, w.location_id) AS location_id
               FROM aurora.documents d
               LEFT JOIN aurora.assets a      ON a.id = d.asset_id
               LEFT JOIN aurora.work_orders w ON w.id = d.work_order_id
              WHERE d.id = $2`,
  contract: `SELECT customer_id, NULL::uuid AS location_id FROM aurora.contracts WHERE id = $2`,
  opportunity: `SELECT o.customer_id, a.location_id
                  FROM aurora.opportunities o
                  LEFT JOIN aurora.assets a ON a.id = o.asset_id
                 WHERE o.id = $2`,
  measurement_session: `SELECT w.customer_id, w.location_id
                          FROM aurora.measurement_sessions m
                          JOIN aurora.work_orders w ON w.id = m.work_order_id
                         WHERE m.id = $2`,
  customer: `SELECT id AS customer_id, NULL::uuid AS location_id FROM aurora.customers WHERE id = $2`,
  location: `SELECT customer_id, id AS location_id FROM aurora.locations WHERE id = $2`,
  // O plano é DE um cliente (mesma regra de `planoNoEscopo`); o item do ciclo
  // é de um equipamento, e o local dele também conta.
  plan: `SELECT customer_id, NULL::uuid AS location_id FROM aurora.maintenance_plans WHERE id = $2`,
  plan_task: `SELECT p.customer_id, NULL::uuid AS location_id
                FROM aurora.plan_tasks t
                JOIN aurora.maintenance_plans p ON p.id = t.plan_id
               WHERE t.id = $2`,
  plan_cycle: `SELECT p.customer_id, NULL::uuid AS location_id
                 FROM aurora.plan_cycles c
                 JOIN aurora.maintenance_plans p ON p.id = c.plan_id
                WHERE c.id = $2`,
  plan_cycle_item: `SELECT p.customer_id, a.location_id
                      FROM aurora.plan_cycle_items i
                      JOIN aurora.plan_cycles c       ON c.id = i.cycle_id
                      JOIN aurora.maintenance_plans p ON p.id = c.plan_id
                      LEFT JOIN aurora.assets a       ON a.id = i.asset_id
                     WHERE i.id = $2`,
} as const;

type Origem = keyof typeof ORIGEM;

/**
 * Lista fechada: caminho → entidade. A ordem não importa (os padrões não se sobrepõem).
 *
 * Os padrões são casados contra o caminho NORMALIZADO (`normalizarCaminho`) e
 * também sem diferenciar maiúsculas: o Express 5 roteia sem diferenciar e
 * decodifica os parâmetros, então `/v1/Work-Orders/<id>` ou um id com `%30`
 * chegavam ao handler sem passar por aqui.
 */
const R = (caminho: string): RegExp => new RegExp(`^/v1/${caminho}(?:/|$)`, 'i');
const TIMELINE = (tipo: string): RegExp => R(`audit/timeline/${tipo}/${UUID}`);
export const REGRAS_DE_ESCOPO: readonly [RegExp, Origem][] = [
  [R(`work-orders/${UUID}`), 'work_order'],
  [R(`work-orders/from-request/${UUID}`), 'service_request'],
  [R(`schedule/work-orders/${UUID}`), 'work_order'],
  [R(`inventory/work-orders/${UUID}`), 'work_order'],
  [R(`service-requests/${UUID}`), 'service_request'],
  [R(`assets/${UUID}`), 'asset'],
  [R(`quotes/${UUID}`), 'quote'],
  [R(`checklist-responses/${UUID}`), 'checklist_response'],
  [R(`time-entries/${UUID}`), 'time_entry'],
  [R(`documents/${UUID}`), 'document'],
  [R(`documents/from-session/${UUID}`), 'measurement_session'],
  [R(`contracts/${UUID}`), 'contract'],
  [R(`opportunities/${UUID}`), 'opportunity'],
  [R(`measurement-sessions/${UUID}`), 'measurement_session'],
  [R(`locations/${UUID}`), 'location'],
  [R(`maintenance-plans/${UUID}`), 'plan'],
  [R(`maintenance-plans/tasks/${UUID}`), 'plan_task'],
  [R(`maintenance-plans/cycles/${UUID}`), 'plan_cycle'],
  [R(`maintenance-plans/cycle-items/${UUID}`), 'plan_cycle_item'],
  // A linha do tempo de um registro tem o escopo DO registro.
  [TIMELINE('work_orders'), 'work_order'],
  [TIMELINE('assets'), 'asset'],
  [TIMELINE('service_requests'), 'service_request'],
  [TIMELINE('customers'), 'customer'],
  [TIMELINE('contracts'), 'contract'],
  [TIMELINE('quotes'), 'quote'],
  [TIMELINE('documents'), 'document'],
];

/**
 * O caminho como o roteador o enxerga: sem consulta, sem barras repetidas,
 * cada segmento decodificado e tudo em minúsculas.
 *
 * Devolve `null` quando um segmento tem codificação inválida (`%zz`) — quem
 * chama recusa em vez de deixar a requisição passar sem conferência.
 */
export function normalizarCaminho(bruto: string): string | null {
  const semConsulta = bruto.split('?')[0] ?? '';
  const partes: string[] = [];
  for (const segmento of semConsulta.split('/')) {
    if (segmento === '') continue;
    let decodificado: string;
    try {
      decodificado = decodeURIComponent(segmento);
    } catch {
      return null;
    }
    partes.push(decodificado.toLowerCase());
  }
  return `/${partes.join('/')}`;
}

export function entidadeDoCaminho(caminho: string): { origem: Origem; id: string } | null {
  const normalizado = normalizarCaminho(caminho);
  if (normalizado === null) return null;
  for (const [padrao, origem] of REGRAS_DE_ESCOPO) {
    const m = padrao.exec(normalizado);
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

    const caminho = normalizarCaminho(req.originalUrl ?? req.url ?? '');
    // Codificação inválida no caminho de quem tem escopo restrito: recusa, em
    // vez de deixar a requisição passar sem conferência.
    if (caminho === null) throw new NotFoundError('registro não encontrado');
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
