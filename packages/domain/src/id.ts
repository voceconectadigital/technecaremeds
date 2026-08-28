/**
 * Aurora — fábrica única de identificadores (SPEC v0.2 §37, ADR-024).
 *
 * Regra do projeto: NENHUM módulo importa biblioteca de UUID diretamente e
 * NENHUMA coluna de chave de negócio tem DEFAULT de geração no banco. Toda a
 * plataforma passa por aqui.
 *
 * Por que v7 e não v4:
 *   v7 é ordenável por tempo (48 bits de timestamp em milissegundos no prefixo),
 *   o que mantém a inserção no fim do índice B-tree. Em tabelas de alto volume
 *   — ordens de serviço, eventos, auditoria — v4 espalha as inserções por toda a
 *   árvore e fragmenta o índice.
 *
 * Por que na aplicação e não no banco:
 *   `gen_random_uuid()` é v4. `uuidv7()` nativo só existe a partir do
 *   PostgreSQL 18 e o alvo declarado é 16+. Depender dele quebraria o ambiente.
 *
 * Formato — RFC 9562:
 *   unix_ts_ms (48 bits) | ver=7 (4) | rand_a (12) | var=0b10 (2) | rand_b (62)
 *
 * Monotonicidade dentro do mesmo milissegundo:
 *   `rand_a` é usado como contador de sequência, semeado aleatoriamente a cada
 *   novo milissegundo. Isso garante ordenação estável para ids gerados no mesmo
 *   milissegundo sem sacrificar imprevisibilidade. Se o contador estourar
 *   (4096 ids no mesmo milissegundo), avançamos o timestamp em 1 ms — o id
 *   continua monotônico e o desvio é irrelevante.
 */
import { randomFillSync } from 'node:crypto';

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

let lastMs = -1;
let seq = 0;

/** Estado interno exposto apenas para teste determinístico. */
export function __resetIdFactory(): void {
  lastMs = -1;
  seq = 0;
}

/**
 * Gera um UUID versão 7.
 * @param now injetável para teste; em produção use o padrão.
 */
export function newId(now: number = Date.now()): string {
  let ms = now;

  if (ms === lastMs) {
    seq += 1;
    if (seq > 0x0fff) {
      // estouro do contador de 12 bits: empurra 1 ms para preservar monotonicidade
      ms = lastMs + 1;
      lastMs = ms;
      seq = randomSeq();
    }
  } else if (ms < lastMs) {
    // relógio andou para trás (NTP, virtualização): não regride o id
    ms = lastMs;
    seq += 1;
    if (seq > 0x0fff) {
      ms = lastMs + 1;
      lastMs = ms;
      seq = randomSeq();
    }
  } else {
    lastMs = ms;
    seq = randomSeq();
  }

  const bytes = new Uint8Array(16);

  // 48 bits de timestamp, big-endian
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;

  // versão 7 + 12 bits de sequência
  bytes[6] = 0x70 | ((seq >>> 8) & 0x0f);
  bytes[7] = seq & 0xff;

  // 62 bits aleatórios com variante RFC 4122/9562 (0b10)
  const rand = new Uint8Array(8);
  randomFillSync(rand);
  rand[0] = (rand[0]! & 0x3f) | 0x80;
  bytes.set(rand, 8);

  return format(bytes);
}

function randomSeq(): number {
  const b = new Uint8Array(2);
  randomFillSync(b);
  return ((b[0]! << 8) | b[1]!) & 0x0fff;
}

function format(b: Uint8Array): string {
  const h = (i: number) => HEX[b[i]!]!;
  return (
    h(0) +
    h(1) +
    h(2) +
    h(3) +
    '-' +
    h(4) +
    h(5) +
    '-' +
    h(6) +
    h(7) +
    '-' +
    h(8) +
    h(9) +
    '-' +
    h(10) +
    h(11) +
    h(12) +
    h(13) +
    h(14) +
    h(15)
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida o formato geral de um UUID (qualquer versão). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Valida especificamente um UUID v7 com variante correta. */
export function isUuidV7(value: unknown): value is string {
  if (!isUuid(value)) return false;
  const v = value as string;
  const variant = parseInt(v[19]!, 16);
  return v[14] === '7' && variant >= 0x8 && variant <= 0xb;
}

/** Extrai o instante de criação embutido em um UUID v7. */
export function timestampOf(id: string): Date {
  if (!isUuidV7(id)) throw new TypeError(`não é um UUID v7: ${id}`);
  const hex = id.replace(/-/g, '').slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}
