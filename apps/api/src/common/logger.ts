/**
 * Aurora — log estruturado correlacionado por request_id (EPIC-001).
 * JSON de uma linha; nunca imprime segredo nem corpo de requisição.
 *
 * MINIMIZAÇÃO (OPS-07 · LGPD). Além dos segredos, o log não leva dado pessoal que não serve para
 * depurar: CPF, telefone, registro profissional (CRM, CREA, COREN…) e as coordenadas do check-in.
 * Três camadas, porque o dado chega por caminhos diferentes:
 *
 *   1. pela CHAVE — campo com nome de segredo vira `[redacted]`; campo com nome de dado pessoal
 *      (cpf, phone/telefone, registration/registro, latitude/longitude/coords…) vira `[masked]`;
 *   2. em PROFUNDIDADE — objetos e listas aninhados passam pelas mesmas regras (um `{ user: { cpf } }`
 *      não escapa por estar um nível abaixo);
 *   3. pelo VALOR — um CPF escrito no meio de um texto (a mensagem de um erro, por exemplo) é
 *      trocado por `***.***.***-**`.
 *
 * O que fica: identificadores opacos (uuid, request_id), rota, método, código e situação HTTP —
 * o necessário para correlacionar um problema, sem identificar a pessoa.
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const ORDER: Record<LogLevel, number> = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };
const REDACT = /(authorization|password|secret|token|key|cookie)/i;
/** Dado pessoal pelo NOME do campo (em inglês e em português). */
const MASK =
  /(cpf|phone|telefone|celular|whatsapp|registration|registro|crm|crea|coren|crefito|latitude|longitude|^lat$|^lng$|^lon$|coords|coordenadas|geoloc|accuracy|precisao)/i;
/** CPF com ou sem pontuação, isolado (não pega pedaço de uuid nem de número maior). */
const CPF_NO_TEXTO = /(?<![\w.-])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\w-])/g;
/** Até onde descer em objetos aninhados — log não é lugar de árvore funda, e ciclo não trava. */
const PROFUNDIDADE_MAXIMA = 6;

export interface StructuredLogger {
  fatal(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  child(base: Record<string, unknown>): StructuredLogger;
}

/** Troca CPF escrito em texto livre pela máscara. */
export function maskPersonalDataInText(texto: string): string {
  return texto.replace(CPF_NO_TEXTO, '***.***.***-**');
}

/** Aplica as três camadas a um valor qualquer do log. Exportado para o teste. */
export function sanitizeLogValue(chave: string, valor: unknown, profundidade = 0): unknown {
  if (REDACT.test(chave)) return '[redacted]';
  if (MASK.test(chave)) return valor === null || valor === undefined ? valor : '[masked]';
  if (typeof valor === 'string') return maskPersonalDataInText(valor);
  if (valor === null || typeof valor !== 'object') return valor;
  if (profundidade >= PROFUNDIDADE_MAXIMA) return '[…]';
  if (valor instanceof Date) return valor;
  if (Array.isArray(valor)) return valor.map((v) => sanitizeLogValue('', v, profundidade + 1));
  if (valor instanceof Error) {
    return { name: valor.name, message: maskPersonalDataInText(valor.message) };
  }
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    saida[k] = sanitizeLogValue(k, v, profundidade + 1);
  }
  return saida;
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
      safe[k] = sanitizeLogValue(k, v);
    }
    sink(
      JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg: maskPersonalDataInText(msg), ...safe })
    );
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
