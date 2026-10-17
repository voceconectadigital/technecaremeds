/**
 * Aurora — Zod para JSON Schema.
 *
 * A conversão é a do próprio Zod (`zod/v4`), não uma biblioteca à parte: uma
 * segunda implementação de "o que este esquema significa" é mais uma peça para
 * divergir, e divergiria justamente nos casos difíceis — união, refinamento,
 * transformação.
 *
 * `io: 'input'` importa: um esquema com `.default()` ou `.transform()` tem duas
 * formas, a de entrada e a de saída. O documento descreve o que o cliente
 * ENVIA, então é a de entrada que vale para corpo e consulta. Para a resposta,
 * `output` — e é por isso que a função recebe qual das duas se quer.
 */
import { z } from './zod';

export type JsonSchema = Record<string, unknown>;

export function toJsonSchema(schema: z.ZodTypeAny, io: 'input' | 'output' = 'input'): JsonSchema {
  return z.toJSONSchema(schema, {
    io,
    // O documento é lido por gente e por gerador de cliente; referência
    // circular não resolvida vira `{}` silencioso, que é pior do que o erro.
    unrepresentable: 'any',
    target: 'draft-2020-12',
  }) as JsonSchema;
}
