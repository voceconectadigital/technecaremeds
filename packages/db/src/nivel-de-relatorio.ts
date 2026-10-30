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
 *
 * O cliente do pedido é o escolhido OU o do contrato OU o do setor (`clienteDoRecorte`): escolher
 * só o setor de um hospital é pedir o relatório daquele hospital.
 *
 * RELATÓRIO AGENDADO (REL-13 / AUT-05, 29/10/2026): a mesma trava ao CRIAR a automação (cliente
 * escolhido, ou cada destinatário restrito a clientes) e de novo na EXECUÇÃO — o contrato pode ter
 * mudado depois; aí o destinatário fica sem o relatório e o log da automação diz por quê.
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

/** A frase de negócio quando o pedido passa do contratado; nulo quando cabe. */
export function excessoDeNivel(
  teto: { tier: ReportTier; customer: string } | null,
  pedido: ReportTier
): string | null {
  if (!teto || ORDEM[pedido] <= ORDEM[teto.tier]) return null;
  return (
    `O contrato de ${teto.customer} inclui o relatório ${REPORT_TIER_LABEL[teto.tier]}; ` +
    `o ${REPORT_TIER_LABEL[pedido]} não está contratado.`
  );
}

export async function assertNivelDeRelatorioContratado(
  session: TenantSession,
  membershipId: string | null,
  customerId: string | null,
  pedido: ReportTier
): Promise<void> {
  const teto = await nivelDeRelatorioPermitido(session, membershipId, customerId);
  const excesso = excessoDeNivel(teto, pedido);
  if (teto && excesso) {
    throw new NivelDeRelatorioNaoContratadoError(excesso, {
      contracted_tier: teto.tier,
      requested_tier: pedido,
    });
  }
}

/**
 * O cliente de que o relatório trata: o escolhido, senão o do contrato, senão o do setor. Nulo
 * quando nada aponta um cliente (o relatório é da carteira). Contrato ou setor inexistente não
 * é erro aqui — a montagem do relatório responde 404 por eles.
 */
export async function clienteDoRecorte(
  session: TenantSession,
  r: { customer_id?: string | null; contract_id?: string | null; sector_id?: string | null }
): Promise<string | null> {
  if (r.customer_id) return r.customer_id;
  if (r.contract_id) {
    const [c] = await session.query<{ customer_id: string }>(
      `SELECT customer_id FROM aurora.contracts WHERE id = $1`,
      [r.contract_id]
    );
    if (c) return c.customer_id;
  }
  if (r.sector_id) {
    const [l] = await session.query<{ customer_id: string }>(
      `SELECT customer_id FROM aurora.locations WHERE id = $1 AND deleted_at IS NULL`,
      [r.sector_id]
    );
    if (l) return l.customer_id;
  }
  return null;
}

/**
 * O teto do relatório AGENDADO para um destinatário. Com cliente no recorte, é o contrato desse
 * cliente — quem cria a regra pode não alcançá-lo, e o nível é do cliente, não de quem lê. Sem
 * cliente, é a regra do pedido manual aplicada ao destinatário (restrito a clientes → o menor
 * nível entre os que ele alcança; carteira inteira → sem trava).
 */
export async function tetoDoRelatorioAgendado(
  session: TenantSession,
  destinatario: string,
  customerId: string | null
): Promise<{ tier: ReportTier; customer: string } | null> {
  if (!customerId) return nivelDeRelatorioPermitido(session, destinatario, null);
  const [c] = await session.query<{ name: string; report_tier: ReportTier | null }>(
    `SELECT name, report_tier FROM aurora.customers WHERE id = $1 AND deleted_at IS NULL`,
    [customerId]
  );
  return c?.report_tier ? { tier: c.report_tier, customer: c.name } : null;
}
