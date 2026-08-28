/**
 * Aurora — log estruturado correlacionado por request_id (EPIC-001).
 * JSON de uma linha; nunca imprime segredo nem corpo de requisição.
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const ORDER: Record<LogLevel, number> = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };
const REDACT = /(authorization|password|secret|token|key|cookie)/i;

export interface StructuredLogger {
  fatal(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  child(base: Record<string, unknown>): StructuredLogger;
}

export function createLogger(
  level: LogLevel = 'info',
  base: Record<string, unknown> = {},
  sink: (line: string) => void = (l) => process.stdout.write(l + '\n')
): StructuredLogger {
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] > ORDER[level]) return;
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ ...base, ...fields })) {
      safe[k] = REDACT.test(k) ? '[redacted]' : v;
    }
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...safe }));
  };
  return {
    fatal: (m, f) => emit('fatal', m, f),
    error: (m, f) => emit('error', m, f),
    warn: (m, f) => emit('warn', m, f),
    info: (m, f) => emit('info', m, f),
    debug: (m, f) => emit('debug', m, f),
    child: (extra) => createLogger(level, { ...base, ...extra }, sink),
  };
}
