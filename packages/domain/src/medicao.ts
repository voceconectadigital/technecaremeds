/**
 * Aurora — o envelope neutro de medição e a porta de fonte
 * (gap V2 §23 e P2.5 · PLAT §6.1 N0–N4 e §14 critérios 4 e 7 · CART §3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UM MODELO, VÁRIAS ORIGENS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O critério de aceite 4 do cliente diz que "medição manual e integrada usam o
 * mesmo modelo". A forma de cumprir isso sem construir a integração agora é
 * separar DUAS coisas que hoje andavam juntas:
 *
 *   · a FONTE, que sabe ler o que chega (um formulário, um CSV de analisador,
 *     a mensagem de um gateway, a chamada de um SDK) — uma por origem;
 *   · o ENVELOPE, que é o que o núcleo grava — um só, para todas.
 *
 * Toda fonte produz o mesmo envelope. O núcleo (`registerMeasurement`, em
 * `packages/db/src/metrology.ts`) só conhece o envelope. Acrescentar o N1
 * (arquivo) amanhã é escrever um adaptador que devolve envelopes — sem mudar
 * tabela, rota de gravação, histórico ou idempotência.
 *
 * NESTA RODADA SÓ EXISTE A FONTE MANUAL (N0). As outras origens estão no
 * vocabulário (`MEASUREMENT_SOURCES`) e não têm adaptador — e `fonteDe` diz
 * isso em vez de fingir.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE O ENVELOPE NÃO CARREGA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Veredito, incerteza, correção, valor arredondado. Nenhuma fonte calcula
 * ciência — nem a manual, nem as futuras. O envelope transporta o que foi
 * LIDO; julgar é a fronteira metrológica, e ela continua fechada.
 */
import { ValidationError } from './errors';

export const MEASUREMENT_SOURCES = ['manual', 'file', 'gateway', 'instrument', 'api', 'sdk'] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

/** O que o núcleo grava, venha de onde vier. */
export interface EnvelopeDeMedicao {
  readonly origem: MeasurementSource;
  /** A resposta de checklist (= sessão de medição) a que o ponto pertence. */
  readonly respostaId: string;
  /** O ponto de medição do protocolo. */
  readonly itemId: string;
  /** As leituras, na ordem em que foram feitas. Nunca arredondadas aqui. */
  readonly leituras: readonly number[];
  /**
   * A unidade em que as leituras vieram, quando a fonte a informa.
   *
   * O núcleo NÃO converte: se a unidade não for a do protocolo, recusa.
   * Converter é aritmética com consequência metrológica (fator, arredondamento)
   * e fica para quem validar.
   */
  readonly unidade: string | null;
  /** O instrumento do ponto, quando não é o da sessão. */
  readonly instrumentoId: string | null;
  /** O relógio do aparelho, guardado AO LADO do servidor, nunca no lugar dele. */
  readonly medidoEmNoAparelho: string | null;
  /** Por que este valor substitui um anterior (correção). */
  readonly motivoDaCorrecao: string | null;
}

/**
 * A porta. Cada origem é um adaptador que sabe transformar o que chega num
 * envelope — e só isso.
 */
export interface FonteDeMedicao<Entrada = unknown> {
  readonly origem: MeasurementSource;
  normalizar(entrada: Entrada): EnvelopeDeMedicao;
}

/** O formulário do técnico (web ou campo), como a rota de resposta o recebe. */
export interface EntradaManual {
  readonly response_id: string;
  readonly item_id: string;
  readonly readings: unknown;
  readonly unit?: unknown;
  readonly instrument_id?: unknown;
  readonly measured_at?: unknown;
  readonly correction_reason?: unknown;
}

const UUID = /^[0-9a-fA-F-]{36}$/;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * A fonte manual — N0.
 *
 * Confere FORMA: leituras são números finitos, identificadores são
 * identificadores, o instante do aparelho tem fuso. Não confere ciência.
 * Número vindo como texto ("12,5") é RECUSADO e não convertido: adivinhar a
 * vírgula decimal é como um 12,5 vira 125 sem ninguém ver.
 */
export const fonteManual: FonteDeMedicao<EntradaManual> = Object.freeze({
  origem: 'manual' as const,
  normalizar(entrada: EntradaManual): EnvelopeDeMedicao {
    if (!UUID.test(String(entrada.response_id ?? ''))) {
      throw new ValidationError('identificador da resposta inválido', { field: 'response_id' });
    }
    if (!UUID.test(String(entrada.item_id ?? ''))) {
      throw new ValidationError('identificador do ponto inválido', { field: 'item_id' });
    }
    const leituras = entrada.readings;
    if (!Array.isArray(leituras) || leituras.length === 0) {
      throw new ValidationError('informe ao menos uma leitura', { field: 'readings' });
    }
    if (leituras.length > 50) {
      throw new ValidationError('no máximo 50 leituras por ponto', { field: 'readings' });
    }
    if (leituras.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new ValidationError('cada leitura precisa ser um número (sem texto, sem vírgula decimal)', {
        field: 'readings',
      });
    }

    const unidade = entrada.unit === undefined || entrada.unit === null ? null : String(entrada.unit).trim();
    if (unidade !== null && unidade.length === 0) {
      throw new ValidationError('unidade vazia', { field: 'unit' });
    }

    let instrumentoId: string | null = null;
    if (entrada.instrument_id !== undefined && entrada.instrument_id !== null) {
      if (!UUID.test(String(entrada.instrument_id))) {
        throw new ValidationError('identificador do instrumento inválido', { field: 'instrument_id' });
      }
      instrumentoId = String(entrada.instrument_id);
    }

    let medidoEm: string | null = null;
    if (entrada.measured_at !== undefined && entrada.measured_at !== null) {
      if (typeof entrada.measured_at !== 'string' || !INSTANTE.test(entrada.measured_at)) {
        throw new ValidationError('o instante do aparelho precisa estar em ISO 8601 com fuso', {
          field: 'measured_at',
        });
      }
      medidoEm = entrada.measured_at;
    }

    const motivo =
      typeof entrada.correction_reason === 'string' && entrada.correction_reason.trim()
        ? entrada.correction_reason.trim()
        : null;

    return {
      origem: 'manual',
      respostaId: String(entrada.response_id),
      itemId: String(entrada.item_id),
      leituras: [...(leituras as number[])],
      unidade,
      instrumentoId,
      medidoEmNoAparelho: medidoEm,
      motivoDaCorrecao: motivo,
    };
  },
});

/** As fontes com adaptador nesta versão. Só a manual — e isso é dito. */
export const FONTES_DISPONIVEIS: readonly FonteDeMedicao[] = Object.freeze([fonteManual as FonteDeMedicao]);

/**
 * A fonte de uma origem — ou o aviso de que ela ainda não tem adaptador.
 *
 * Recusar alto é melhor do que aceitar uma medição "de gateway" que na verdade
 * passou por um caminho que ninguém escreveu.
 */
export function fonteDe(origem: MeasurementSource): FonteDeMedicao {
  const f = FONTES_DISPONIVEIS.find((x) => x.origem === origem);
  if (!f) {
    throw new ValidationError(
      `a origem "${origem}" está prevista no modelo e ainda não tem adaptador nesta versão (só N0 manual)`,
      { field: 'source', available: FONTES_DISPONIVEIS.map((x) => x.origem) }
    );
  }
  return f;
}
