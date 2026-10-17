/**
 * Aurora — automação AGENDADA (reunião 16/10/2026, Fase 10).
 *
 * O motor de automações (§24) já tinha a espécie de gatilho `schedule` no
 * esquema, mas nada que a fizesse rodar. Aqui está o que faltava, sem motor
 * novo: ler a expressão cron de cinco campos NO FUSO da regra e dizer qual
 * passada está devida.
 *
 * A PASSADA É A UNIDADE DE IDEMPOTÊNCIA
 *   Cada disparo tem um instante nominal (`slot`) — "segunda 08:00 de Brasília".
 *   O banco guarda (regra, slot) como único: duas varreduras simultâneas, ou a
 *   retentativa de uma que caiu, não disparam a mesma passada duas vezes.
 *
 * NÃO HÁ RECUPERAÇÃO EM MASSA
 *   Se o agendador ficou parado três dias, roda-se só a passada MAIS RECENTE
 *   (até `MAX_LOOKBACK_MINUTES` atrás). Disparar três relatórios atrasados de
 *   uma vez seria a inundação que as salvaguardas do §24 existem para impedir.
 */

const CAMPOS = [
  { nome: 'minuto', min: 0, max: 59 },
  { nome: 'hora', min: 0, max: 23 },
  { nome: 'dia do mês', min: 1, max: 31 },
  { nome: 'mês', min: 1, max: 12 },
  { nome: 'dia da semana', min: 0, max: 7 },
] as const;

export interface CronSpec {
  readonly minute: ReadonlySet<number>;
  readonly hour: ReadonlySet<number>;
  readonly dayOfMonth: ReadonlySet<number>;
  readonly month: ReadonlySet<number>;
  readonly dayOfWeek: ReadonlySet<number>;
  /** Com os dois dias restritos, vale um OU outro (semântica do cron clássico). */
  readonly domRestricted: boolean;
  readonly dowRestricted: boolean;
}

export const DEFAULT_AUTOMATION_TIMEZONE = 'America/Sao_Paulo';
/** Quanto para trás o agendador procura uma passada devida. */
export const MAX_LOOKBACK_MINUTES = 36 * 60;

function campo(texto: string, i: number): Set<number> | string {
  const { nome, min, max } = CAMPOS[i]!;
  const valores = new Set<number>();
  for (const parte of texto.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(parte);
    if (!m) return `${nome}: "${parte}" não é um valor de cron`;
    const passo = m[4] === undefined ? 1 : Number(m[4]);
    if (passo < 1) return `${nome}: passo precisa ser ≥ 1`;
    let de: number = min;
    let ate: number = max;
    if (m[1] !== '*') {
      de = Number(m[2]);
      ate = m[3] === undefined ? (m[4] === undefined ? de : max) : Number(m[3]);
    }
    if (de < min || ate > max || de > ate) return `${nome}: fora do intervalo ${min}–${max}`;
    for (let v = de; v <= ate; v += passo) valores.add(i === 4 && v === 7 ? 0 : v);
  }
  return valores;
}

/** Lê a expressão. Devolve a especificação ou a mensagem de erro. */
export function parseCron(expr: string): CronSpec | string {
  const partes = expr.trim().split(/\s+/);
  if (partes.length !== 5) return 'a expressão cron tem cinco campos: minuto hora dia mês dia-da-semana';
  const lidos: Set<number>[] = [];
  for (const [i, p] of partes.entries()) {
    const r = campo(p, i);
    if (typeof r === 'string') return r;
    lidos.push(r);
  }
  return {
    minute: lidos[0]!,
    hour: lidos[1]!,
    dayOfMonth: lidos[2]!,
    month: lidos[3]!,
    dayOfWeek: lidos[4]!,
    domRestricted: partes[2] !== '*',
    dowRestricted: partes[4] !== '*',
  };
}

export function validateCron(expr: string): string[] {
  const r = parseCron(expr);
  return typeof r === 'string' ? [r] : [];
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatadores = new Map<string, Intl.DateTimeFormat>();
const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface Relogio {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
}

function relogioLocal(instante: Date, tz: string): Relogio {
  let f = formatadores.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatadores.set(tz, f);
  }
  const r: Relogio = { minute: 0, hour: 0, day: 1, month: 1, weekday: 0 };
  for (const p of f.formatToParts(instante)) {
    if (p.type === 'minute') r.minute = Number(p.value);
    else if (p.type === 'hour') r.hour = Number(p.value);
    else if (p.type === 'day') r.day = Number(p.value);
    else if (p.type === 'month') r.month = Number(p.value);
    else if (p.type === 'weekday') r.weekday = DIAS[p.value] ?? 0;
  }
  return r;
}

export function cronMatches(spec: CronSpec, instante: Date, tz = DEFAULT_AUTOMATION_TIMEZONE): boolean {
  const r = relogioLocal(instante, tz);
  if (!spec.minute.has(r.minute) || !spec.hour.has(r.hour) || !spec.month.has(r.month)) return false;
  const dom = spec.dayOfMonth.has(r.day);
  const dow = spec.dayOfWeek.has(r.weekday);
  if (spec.domRestricted && spec.dowRestricted) return dom || dow;
  return dom && dow;
}

const MINUTO = 60_000;
const noMinuto = (d: Date): number => Math.floor(d.getTime() / MINUTO) * MINUTO;

/**
 * A passada devida: o instante mais recente ≤ `now` que casa com a expressão
 * e é POSTERIOR a `after` (a última passada já executada, ou a ativação).
 * Nulo quando não há passada devida.
 */
export function dueSlot(
  expr: string,
  tz: string | null | undefined,
  now: Date,
  after: Date | null
): Date | null {
  const spec = parseCron(expr);
  if (typeof spec === 'string') return null;
  const fuso = tz || DEFAULT_AUTOMATION_TIMEZONE;
  const limite = Math.max(after ? after.getTime() : -Infinity, now.getTime() - MAX_LOOKBACK_MINUTES * MINUTO);
  for (let t = noMinuto(now); t > limite; t -= MINUTO) {
    const d = new Date(t);
    if (cronMatches(spec, d, fuso)) return d;
  }
  return null;
}

/** As próximas passadas a partir de `from` (exclusive), até `horizonDays`. */
export function nextRuns(
  expr: string,
  tz: string | null | undefined,
  from: Date,
  max = 5,
  horizonDays = 31
): Date[] {
  const spec = parseCron(expr);
  if (typeof spec === 'string') return [];
  const fuso = tz || DEFAULT_AUTOMATION_TIMEZONE;
  const fim = from.getTime() + horizonDays * 1440 * MINUTO;
  const saida: Date[] = [];
  for (let t = noMinuto(from) + MINUTO; t <= fim && saida.length < max; t += MINUTO) {
    const d = new Date(t);
    if (cronMatches(spec, d, fuso)) saida.push(d);
  }
  return saida;
}

/** Quantas passadas cabem em `days` dias a partir de `from` — a "simulação" da regra agendada. */
export function countRuns(expr: string, tz: string | null | undefined, from: Date, days = 30): number {
  return nextRuns(expr, tz, from, Number.MAX_SAFE_INTEGER, days).length;
}

/* -------------------------------------------------------------------------- */
/* periodicidade em linguagem de gente                                         */
/* -------------------------------------------------------------------------- */

export type Periodicity =
  | { kind: 'daily'; hour: number; minute?: number }
  | { kind: 'weekly'; hour: number; minute?: number; weekday: number }
  | { kind: 'monthly'; hour: number; minute?: number; dayOfMonth: number };

/** A periodicidade escolhida na tela vira a expressão que o motor lê. */
export function cronFromPeriodicity(p: Periodicity): string {
  const m = p.minute ?? 0;
  if (p.kind === 'daily') return `${m} ${p.hour} * * *`;
  if (p.kind === 'weekly') return `${m} ${p.hour} * * ${p.weekday}`;
  return `${m} ${p.hour} ${p.dayOfMonth} * *`;
}

/* -------------------------------------------------------------------------- */
/* modelos de "Nova automação"                                                 */
/* -------------------------------------------------------------------------- */

export const AUTOMATION_TEMPLATES = [
  {
    key: 'scheduled_report',
    label: 'Relatório agendado',
    action: 'send_report',
    description:
      'Gera o relatório Basic/Advanced/Expert na periodicidade escolhida e entrega na caixa de entrada; o e-mail fica na fila até existir transporte configurado.',
  },
  {
    key: 'reminder',
    label: 'Lembrete',
    action: 'reminder',
    description: 'Avisa as pessoas escolhidas, na periodicidade escolhida.',
  },
  {
    key: 'task',
    label: 'Tarefa',
    action: 'create_task',
    description: 'Cria uma tarefa para um responsável, com prazo, na periodicidade escolhida.',
  },
  {
    key: '5w2h',
    label: '5W2H',
    action: 'create_task',
    description: 'Cria o plano de ação 5W2H: o quê, por quê, onde, quando, quem, como e quanto.',
  },
  {
    key: 'pdca',
    label: 'PDCA',
    action: 'create_task',
    description: 'Cria a ação de ciclo PDCA, começando na fase Planejar.',
  },
] as const;
export type AutomationTemplateKey = (typeof AUTOMATION_TEMPLATES)[number]['key'];

export const TASK_METHODS = ['task', '5w2h', 'pdca'] as const;
export type TaskMethod = (typeof TASK_METHODS)[number];
export const PDCA_PHASES = ['plan', 'do', 'check', 'act'] as const;
export type PdcaPhase = (typeof PDCA_PHASES)[number];
export const TASK_STATES = ['open', 'done', 'cancelled'] as const;
