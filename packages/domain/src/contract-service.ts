/**
 * Aurora — atendimento retido por contrato e renovação da vigência.
 *
 * Respostas do Anderson de 24/11/2026:
 *
 *   D-4 "Quando o contrato vence ou é apertado o botão suspender atendimento ou
 *       bloquear atendimento, tudo para e fica somente consulta, ninguém abre
 *       nem fecha chamado nestes casos."
 *   D-7 "No cadastro do cliente informamos data de início e data de término de
 *       cada contrato." "Se possuir renovação automática, renova o ciclo se
 *       ninguém bloquear ou suspender."
 *
 * Funções puras: o banco guarda a retenção e o histórico; aqui mora a conta
 * do próximo ciclo e o texto que explica o bloqueio para quem esbarrou nele.
 */
import { addDaysToDay } from './dia-local';

/** Por que o atendimento está retido. */
export const SERVICE_BLOCK_REASONS = ['suspended', 'blocked', 'expired'] as const;
export type ServiceBlockReason = (typeof SERVICE_BLOCK_REASONS)[number];

/** As duas retenções que alguém aciona (o vencimento é a data, não um botão). */
export const SERVICE_HOLDS = ['suspended', 'blocked'] as const;
export type ServiceHold = (typeof SERVICE_HOLDS)[number];

export const SERVICE_BLOCK_LABELS: Record<ServiceBlockReason, string> = {
  suspended: 'atendimento suspenso',
  blocked: 'atendimento bloqueado',
  expired: 'contrato vencido',
};

export interface ServiceBlock {
  contractId: string;
  contractNumber: string;
  reason: ServiceBlockReason;
  heldAt: string | null;
  holdReason: string | null;
  endsOn: string | null;
}

function dataBr(dia: string): string {
  const [a, m, d] = dia.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/**
 * A frase que a pessoa lê quando a operação é recusada. Diz o contrato, o
 * motivo, desde quando e o que ainda pode ser feito — "só consulta".
 */
export function describeServiceBlock(b: ServiceBlock): string {
  const motivo =
    b.reason === 'expired'
      ? `o contrato ${b.contractNumber} venceu${b.endsOn ? ` em ${dataBr(b.endsOn)}` : ''}`
      : `o contrato ${b.contractNumber} está com o ${SERVICE_BLOCK_LABELS[b.reason]}` +
        (b.heldAt ? ` desde ${dataBr(b.heldAt)}` : '') +
        (b.holdReason ? ` (${b.holdReason})` : '');
  return (
    `Atendimento parado: ${motivo}. Enquanto isso, fica somente consulta — ninguém abre, executa ` +
    'nem conclui chamado ou ordem de serviço deste contrato. Regularize o contrato para voltar a atender.'
  );
}

/* -------------------------------------------------------------------------- */
/* renovação                                                                   */
/* -------------------------------------------------------------------------- */

/** Prazo contratado: em meses quando as datas fecham meses inteiros; senão em dias. */
export type RenewalTerm = { months: number } | { days: number };

function partes(dia: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia);
  if (!m) throw new RangeError(`data inválida: ${dia}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function chave(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Soma meses a um dia de calendário; o dia 31 vira o último dia do mês de destino. */
export function addMonthsToDay(dia: string, meses: number): string {
  const [a, m, d] = partes(dia);
  const ultimo = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  return chave(new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimo))));
}

function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = partes(de);
  const [a2, m2, d2] = partes(ate);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

/**
 * O prazo da vigência ORIGINAL (início → término contratados, inclusive).
 * 01/01 → 31/12 é "12 meses", e não "365 dias": o ano bissexto não pode
 * empurrar a renovação um dia para o lado.
 */
export function renewalTerm(startsOn: string, endsOn: string): RenewalTerm {
  const dias = diasEntre(startsOn, endsOn) + 1;
  if (dias <= 0) throw new RangeError('o término precisa ser depois do início');
  const depois = addDaysToDay(endsOn.slice(0, 10), 1);
  const [a1, m1] = partes(startsOn);
  const [a2, m2] = partes(depois);
  const meses = (a2 - a1) * 12 + (m2 - m1);
  if (meses >= 1 && addMonthsToDay(startsOn.slice(0, 10), meses) === depois) return { months: meses };
  return { days: dias };
}

/** O término do próximo ciclo: o dia seguinte ao fim atual, mais o prazo, menos um dia. */
export function nextRenewalEnd(currentEndsOn: string, term: RenewalTerm): string {
  const inicio = addDaysToDay(currentEndsOn.slice(0, 10), 1);
  if ('months' in term) return addDaysToDay(addMonthsToDay(inicio, term.months), -1);
  return addDaysToDay(inicio, term.days - 1);
}

/**
 * O contrato renova sozinho HOJE?
 *
 * Renova no último dia da vigência (ou depois, se a varredura falhou), e só se
 * estiver vigente, com renovação automática e SEM retenção. Contrato já
 * marcado como vencido não renova sozinho: a renovação dele é ato de quem
 * administra (rota manual), para que a ativação de uma regra nova nunca mexa
 * em datas de contrato já encerrado.
 */
export function shouldAutoRenew(
  c: {
    status: string;
    autoRenew: boolean;
    serviceHold: string | null;
    endsOn: string | null;
  },
  today: string
): boolean {
  if (c.status !== 'active' || !c.autoRenew || c.serviceHold !== null || c.endsOn === null) return false;
  return diasEntre(c.endsOn, today) >= 0;
}
