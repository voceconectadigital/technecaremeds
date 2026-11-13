/**
 * Aurora — rótulos do contrato no cadastro do cliente (Anderson, 10/11/2026 — 0090).
 *
 * Três conceitos que a tela NUNCA mistura:
 *   · modalidade de atendimento (periodicidade das visitas) e equipes fixas;
 *   · base de precificação (como se calcula o valor) — o `billing_model` do contrato;
 *   · condição de pagamento (quando se paga).
 * Todos são cadastro: nada aqui gera cobrança, fatura ou apuração financeira.
 */
import type { BillingModel, PaymentTerms, ServiceFrequency, SlaSource } from '@aurora/contracts';

export const ROTULO_MODALIDADE: Record<ServiceFrequency, string> = {
  annual: 'Anual',
  semiannual: 'Semestral',
  quarterly: 'Trimestral',
  monthly: 'Mensal',
  biweekly: 'Quinzenal',
  weekly: 'Semanal',
};

export const ROTULO_PRECIFICACAO: Record<BillingModel, string> = {
  fixed_monthly: 'Valor fixo mensal',
  per_call: 'Por demanda (cada acionamento)',
  per_hour: 'Hora técnica',
  per_asset: 'Por equipamento',
  hybrid: 'Misto',
};

export const ROTULO_PAGAMENTO: Record<PaymentTerms, string> = {
  monthly: 'Mensal',
  upfront: 'À vista',
};

/** "Equipe Fixa 1 + Equipe Fixa 10" — só o identificador; a composição não está definida. */
export function rotuloDasEquipes(equipes: readonly number[] | null | undefined): string | null {
  if (!equipes || equipes.length === 0) return null;
  return [...equipes]
    .sort((a, b) => a - b)
    .map((n) => `Equipe Fixa ${n}`)
    .join(' + ');
}

/** De onde vem o SLA que vale para o equipamento — regra geral ou exceção. */
export const ORIGEM_DO_SLA: Record<SlaSource, string> = {
  disabled: 'SLA desligado neste equipamento',
  asset: 'Exceção deste equipamento',
  contract_criticality: 'Regra do contrato para a criticidade do equipamento',
  contract: 'SLA geral do contrato',
  customer: 'Padrão do cliente',
  organization: 'Padrão da organização',
  none: 'Sem política de SLA',
};
