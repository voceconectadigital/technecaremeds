/**
 * Aurora — o modelo de relatório incluso no contrato do cliente (REL-13; conversa de 19/10/2026:
 * "no cadastro do cliente deve haver o campo com o tipo de relatório que está incluso no contrato
 * dele: basic, advanced, expert").
 *
 * O cadastro guarda `customers.report_tier` (0085). Aqui ele vira TRAVA no servidor: o relatório de
 * um cliente não sai num nível acima do contratado. A ordem é Basic < Advanced < Expert.
 *
 * Que clientes entram na conta:
 *   · com cliente escolhido no pedido, só ele;
 *   · sem cliente, quem tem escopo restrito a clientes (o solicitante do hospital) responde pelos
 *     clientes que alcança — senão bastaria não escolher o cliente para pular a trava;
 *   · sem cliente e com escopo de toda a organização (a prestadora), não há trava: o relatório é da
 *     carteira inteira, não de um contrato.
 * Entre vários clientes vale o nível MAIS BAIXO informado. Cliente sem nível informado não trava.
 */
import { DomainError, REPORT_TIER_LABEL, type ReportTier } from '@aurora/domain';
import type { TenantSession } from './client';

const ORDEM: Record<ReportTier, number> = { basic: 1, advanced: 2, expert: 3 };

/** 403 com a explicação de negócio — não é falta de permissão, é o contrato. */
export class NivelDeRelatorioNaoContratadoError extends DomainError {
  readonly code = 'forbidden' as const;
  readonly httpStatus = 403;
}

/** O nível mais alto que o pedido pode gerar; nulo = sem trava. */
export async function nivelDeRelatorioPermitido(
  session: TenantSession,
  membershipId: string | null,
  customerId: string | null
): Promise<{ tier: ReportTier; customer: string } | null> {
  const linhas = await session.query<{ name: string; report_tier: ReportTier | null }>(
    customerId
      ? `SELECT name, report_tier FROM aurora.customers
          WHERE id = $2 AND deleted_at IS NULL
            AND id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))`
      : `SELECT c.name, c.report_tier
           FROM aurora.customers c
          WHERE c.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM aurora.membership_scopes ms
                         WHERE ms.membership_id = $1 AND ms.customer_scope <> 'all')
            AND c.id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))`,
    customerId ? [membershipId, customerId] : [membershipId]
  );
  let menor: { tier: ReportTier; customer: string } | null = null;
  for (const l of linhas) {
    if (!l.report_tier) continue;
    if (!menor || ORDEM[l.report_tier] < ORDEM[menor.tier]) menor = { tier: l.report_tier, customer: l.name };
  }
  return menor;
}

export async function assertNivelDeRelatorioContratado(
  session: TenantSession,
  membershipId: string | null,
  customerId: string | null,
  pedido: ReportTier
): Promise<void> {
  const teto = await nivelDeRelatorioPermitido(session, membershipId, customerId);
  if (teto && ORDEM[pedido] > ORDEM[teto.tier]) {
    throw new NivelDeRelatorioNaoContratadoError(
      `O contrato de ${teto.customer} inclui o relatório ${REPORT_TIER_LABEL[teto.tier]}; ` +
        `o ${REPORT_TIER_LABEL[pedido]} não está contratado.`,
      { contracted_tier: teto.tier, requested_tier: pedido }
    );
  }
}
