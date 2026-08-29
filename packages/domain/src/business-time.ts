/**
 * Aurora — tempo útil: minutos que contam para o SLA (SPEC v0.2 §11 · EPIC-010).
 *
 * O PROBLEMA, EM UMA FRASE
 *
 * "Quatro horas para atender" não significa quatro horas de relógio. Significa
 * quatro horas dentro do horário coberto pelo contrato, no fuso do LOCAL onde o
 * equipamento está, descontando feriado — inclusive feriado municipal, que
 * existe numa unidade e não na outra.
 *
 * A referência media "% de chamados cumpridos dentro do prazo" com minutos
 * corridos gravados no equipamento. Funciona até o primeiro cliente com horário
 * comercial, e quebra de vez no primeiro feriado.
 *
 * POR QUE SEM BIBLIOTECA DE FUSO
 *
 * `Intl.DateTimeFormat` com `timeZone` já resolve a conversão, e vem no Node.
 * Uma dependência a mais para isso significaria mais uma coisa para atualizar,
 * auditar e explicar — e o que precisamos daqui é pequeno e estável.
 */

export interface BusinessWindow {
  /** 0 = domingo, seguindo `EXTRACT(DOW)` do PostgreSQL. */
  readonly weekday: number;
  /** `HH:MM` no fuso do calendário. */
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface CalendarException {
  /** `AAAA-MM-DD` no fuso do calendário. */
  readonly date: string;
  readonly kind: 'holiday' | 'closed' | 'extended';
  readonly startsAt?: string | null;
  readonly endsAt?: string | null;
}

export interface BusinessCalendar {
  readonly timeZone: string;
  readonly windows: readonly BusinessWindow[];
  readonly exceptions: readonly CalendarException[];
}

/** Um calendário sem janela nenhuma faria o relógio nunca andar. */
export class EmptyCalendarError extends Error {
  constructor(timeZone: string) {
    super(
      `o calendário (${timeZone}) não tem nenhuma janela de atendimento; ` +
        `um relógio de SLA sobre ele nunca venceria`
    );
    this.name = 'EmptyCalendarError';
  }
}

/** Teto de busca: um ano. Além disso, a configuração é que está errada. */
const MAX_DAYS_AHEAD = 366;

function toMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  if (!m) throw new Error(`horário inválido: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Instante → partes locais no fuso informado. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // Alguns ambientes formatam meia-noite como 24; normalizar evita um
    // "24:00" que nenhuma comparação de janela reconheceria.
    hour: hour === 24 ? 0 : hour,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** Deslocamento do fuso, em minutos, no instante dado. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  // Zera segundos e milissegundos dos dois lados para não contaminar a conta.
  const base = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((comoUtc - base) / 60_000);
}

/**
 * Hora local (parede) → instante.
 *
 * Duas passadas porque o deslocamento depende do próprio instante: na virada do
 * horário de verão a primeira estimativa erra por uma hora, e a segunda
 * corrige. Uma hora local que não existe (o salto para a frente) resolve para o
 * primeiro instante válido depois dela, que é o comportamento útil aqui — o
 * relógio de SLA não deve parar porque o país mudou a hora.
 */
export function instantFromZoned(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  minutesOfDay: number
): Date {
  const alvo = Date.UTC(year, month - 1, day, 0, 0, 0, 0) + minutesOfDay * 60_000;
  let instante = new Date(alvo);
  for (let i = 0; i < 2; i++) {
    const off = offsetMinutes(instante, timeZone);
    instante = new Date(alvo - off * 60_000);
  }
  return instante;
}

function dateKey(p: { year: number; month: number; day: number }): string {
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

interface DayWindow {
  readonly from: number;
  readonly to: number;
}

/**
 * Janelas de um dia, já com as exceções aplicadas.
 *
 * `holiday` e `closed` zeram o dia; `extended` substitui as janelas do dia pela
 * janela declarada — é assim que se registra um plantão de sábado sem mexer na
 * grade semanal.
 */
export function windowsForDay(calendar: BusinessCalendar, p: ZonedParts): DayWindow[] {
  const chave = dateKey(p);
  const excecoes = calendar.exceptions.filter((e) => e.date === chave);

  if (excecoes.some((e) => e.kind === 'holiday' || e.kind === 'closed')) return [];

  const estendida = excecoes.find((e) => e.kind === 'extended');
  if (estendida?.startsAt && estendida.endsAt) {
    return [{ from: toMinutes(estendida.startsAt), to: toMinutes(estendida.endsAt) }];
  }

  return calendar.windows
    .filter((w) => w.weekday === p.weekday)
    .map((w) => ({ from: toMinutes(w.startsAt), to: toMinutes(w.endsAt) }))
    .filter((w) => w.to > w.from)
    .sort((a, b) => a.from - b.from);
}

/**
 * Minutos úteis entre dois instantes.
 *
 * Percorre dia a dia no fuso do calendário e soma a interseção de cada janela
 * com o intervalo pedido. Dia a dia, e não por fórmula fechada, porque feriado,
 * plantão e horário de verão quebram qualquer fórmula — e um erro de fórmula
 * aqui viraria SLA cumprido que na verdade estourou.
 */
export function businessMinutesBetween(from: Date, to: Date, calendar: BusinessCalendar): number {
  if (to <= from) return 0;
  if (calendar.windows.length === 0) throw new EmptyCalendarError(calendar.timeZone);

  let total = 0;
  const inicio = zonedParts(from, calendar.timeZone);
  let cursor = { year: inicio.year, month: inicio.month, day: inicio.day };

  for (let dia = 0; dia <= MAX_DAYS_AHEAD; dia++) {
    const meiaNoite = instantFromZoned(calendar.timeZone, cursor.year, cursor.month, cursor.day, 0);
    if (meiaNoite.getTime() > to.getTime()) break;

    const p = zonedParts(meiaNoite, calendar.timeZone);
    for (const janela of windowsForDay(calendar, p)) {
      const abertura = instantFromZoned(calendar.timeZone, p.year, p.month, p.day, janela.from);
      const fechamento = instantFromZoned(calendar.timeZone, p.year, p.month, p.day, janela.to);
      const de = Math.max(abertura.getTime(), from.getTime());
      const ate = Math.min(fechamento.getTime(), to.getTime());
      if (ate > de) total += Math.round((ate - de) / 60_000);
    }

    const proximo = new Date(meiaNoite.getTime() + 36 * 3_600_000);
    const pp = zonedParts(proximo, calendar.timeZone);
    cursor = { year: pp.year, month: pp.month, day: pp.day };
  }

  return total;
}

/**
 * Instante em que se completam N minutos úteis a partir de `from`.
 *
 * É o cálculo do prazo. Se o momento inicial cai fora de janela, a contagem
 * começa na próxima abertura — o relógio "pula" para a próxima janela útil, e
 * não penaliza o cliente pelo que a organização não se comprometeu a atender.
 */
export function addBusinessMinutes(from: Date, minutes: number, calendar: BusinessCalendar): Date {
  if (minutes <= 0) return from;
  if (calendar.windows.length === 0) throw new EmptyCalendarError(calendar.timeZone);

  let restante = minutes;
  const inicio = zonedParts(from, calendar.timeZone);
  let cursor = { year: inicio.year, month: inicio.month, day: inicio.day };

  for (let dia = 0; dia <= MAX_DAYS_AHEAD; dia++) {
    const meiaNoite = instantFromZoned(calendar.timeZone, cursor.year, cursor.month, cursor.day, 0);
    const p = zonedParts(meiaNoite, calendar.timeZone);

    for (const janela of windowsForDay(calendar, p)) {
      const abertura = instantFromZoned(calendar.timeZone, p.year, p.month, p.day, janela.from);
      const fechamento = instantFromZoned(calendar.timeZone, p.year, p.month, p.day, janela.to);
      const de = Math.max(abertura.getTime(), from.getTime());
      if (fechamento.getTime() <= de) continue;

      const disponiveis = Math.round((fechamento.getTime() - de) / 60_000);
      if (disponiveis >= restante) return new Date(de + restante * 60_000);
      restante -= disponiveis;
    }

    const proximo = new Date(meiaNoite.getTime() + 36 * 3_600_000);
    const pp = zonedParts(proximo, calendar.timeZone);
    cursor = { year: pp.year, month: pp.month, day: pp.day };
  }

  throw new Error(
    `não foi possível completar ${minutes} minutos úteis em ${MAX_DAYS_AHEAD} dias; ` +
      `o calendário provavelmente tem janelas curtas demais para este alvo`
  );
}

/** O instante cai dentro de uma janela de atendimento? */
export function isWithinBusinessHours(instant: Date, calendar: BusinessCalendar): boolean {
  const p = zonedParts(instant, calendar.timeZone);
  const minutos = p.hour * 60 + p.minute;
  return windowsForDay(calendar, p).some((w) => minutos >= w.from && minutos < w.to);
}

/**
 * Calendário 24×7 — o padrão de quem não configurou nada.
 *
 * Existe para que uma organização sem calendário configurado tenha SLA que
 * funciona, em vez de SLA que explode. O relógio corre sempre; é o
 * comportamento que a referência tinha, e é um ponto de partida honesto.
 */
export function alwaysOpenCalendar(timeZone = 'UTC'): BusinessCalendar {
  return {
    timeZone,
    windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      startsAt: '00:00',
      endsAt: '24:00',
    })),
    exceptions: [],
  };
}
