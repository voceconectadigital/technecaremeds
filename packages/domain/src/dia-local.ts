/**
 * Aurora — o DIA no fuso da organização (pente-fino 17/10/2026, PF-51/PF-72).
 *
 * `toISOString().slice(0, 10)` é o dia em UTC. Em Brasília, das 21 h à
 * meia-noite isso já é "amanhã": um relatório de outubro pedido em 31/10 às
 * 21h30 escolhia a meta de 01/11, e o mês anterior agendado podia cair no mês
 * errado. Aqui o dia é o do calendário LOCAL do fuso informado — por padrão o
 * da organização (`organizations.timezone`, que nasce `America/Sao_Paulo`).
 *
 * Funções puras sobre `Intl.DateTimeFormat` (via `business-time`): nenhuma
 * dependência nova, e o horário de verão — se voltar — é tratado lá.
 */
import { instantFromZoned, zonedParts } from './business-time';

/** O fuso padrão da organização (o mesmo default de `organizations.timezone`). */
export const DEFAULT_ORGANIZATION_TIMEZONE = 'America/Sao_Paulo';

const validos = new Map<string, boolean>();

/** O fuso informado, se o `Intl` o conhece; senão o padrão. Nunca lança. */
export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_ORGANIZATION_TIMEZONE;
  let ok = validos.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    validos.set(tz, ok);
  }
  return ok ? tz : DEFAULT_ORGANIZATION_TIMEZONE;
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

function chave(ano: number, mes: number, dia: number): string {
  return `${String(ano).padStart(4, '0')}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

function partesDoDia(dia: string): { ano: number; mes: number; dia: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) throw new Error(`dia inválido: ${dia}`);
  return { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
}

/** Dia de calendário (YYYY-MM-DD) do instante, no fuso informado. */
export function localDay(instant: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): string {
  const p = zonedParts(instant, safeTimezone(timeZone));
  return chave(p.year, p.month, p.day);
}

/** Soma dias a um dia de calendário (sem fuso: é aritmética de calendário). */
export function addDaysToDay(dia: string, dias: number): string {
  const p = partesDoDia(dia);
  const d = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + dias));
  return chave(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** O instante da meia-noite local do dia, no fuso informado. */
export function startOfLocalDay(dia: string, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): Date {
  const p = partesDoDia(dia);
  return instantFromZoned(safeTimezone(timeZone), p.ano, p.mes, p.dia, 0);
}

/** O último milissegundo do dia local (23:59:59.999), no fuso informado. */
export function endOfLocalDay(dia: string, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): Date {
  return new Date(startOfLocalDay(addDaysToDay(dia, 1), timeZone).getTime() - 1);
}

export interface LocalMonth {
  /** Primeiro dia do mês (YYYY-MM-DD). */
  readonly firstDay: string;
  /** Último dia do mês (YYYY-MM-DD). */
  readonly lastDay: string;
  /** Meia-noite local do primeiro dia. */
  readonly from: Date;
  /** Último milissegundo local do último dia (mesma convenção dos períodos da tela). */
  readonly to: Date;
}

/**
 * O mês CIVIL anterior ao mês local do instante (PF-52).
 *
 * Em 01/11 às 08:00 de Brasília é outubro inteiro, de 01/10 00:00 a 31/10
 * 23:59:59.999 — e não "os últimos 30 dias", que perdem o dia 31 e podem
 * atravessar para o mês seguinte.
 */
export function previousLocalMonth(
  instant: Date,
  timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE
): LocalMonth {
  const tz = safeTimezone(timeZone);
  const p = zonedParts(instant, tz);
  const ano = p.month === 1 ? p.year - 1 : p.year;
  const mes = p.month === 1 ? 12 : p.month - 1;
  const firstDay = chave(ano, mes, 1);
  const lastDay = addDaysToDay(chave(p.year, p.month, 1), -1);
  return {
    firstDay,
    lastDay,
    from: startOfLocalDay(firstDay, tz),
    to: endOfLocalDay(lastDay, tz),
  };
}
