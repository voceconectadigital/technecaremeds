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

/**
 * Dias de calendário de `hoje` até o último dia da vigência (AAAA-MM-DD), sem
 * passar por fuso. O último dia CONTA: 0 é "vence hoje", negativo é vencido —
 * a mesma regra de `contractTermStatus` no servidor. `new Date('2026-11-23')`
 * é meia-noite UTC (21 h do dia 22 em Brasília) e fazia o contrato aparecer
 * "Vencido" ao lado de "Vigente" no próprio dia final.
 */
export function diasAteOFimDaVigencia(endsOn: string, hoje: string): number {
  const ms = (d: string) =>
    Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(endsOn.slice(0, 10)) - ms(hoje.slice(0, 10))) / 86_400_000);
}
