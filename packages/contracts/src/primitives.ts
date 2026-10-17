/**
 * Aurora — as peças que aparecem em quase toda rota.
 *
 * Usamos a API v4 do Zod (`zod/v4`), que é o mesmo pacote já instalado e traz
 * `toJSONSchema` nativo. Sem isso, gerar OpenAPI exigiria uma segunda
 * biblioteca traduzindo esquema para esquema — mais uma peça para divergir.
 *
 * `packages/config` continua na API clássica; migra quando for tocado. São o
 * mesmo pacote e a mesma instalação, não dois sistemas de tipos.
 */
import { z } from './zod';

/**
 * Identificador. UUID v7 gerado pela aplicação (§37).
 *
 * A validação é de FORMATO, não de versão: recusar um v4 legítimo por causa do
 * dígito de versão quebraria dados importados sem ganho nenhum de segurança.
 */
export const Uuid = z.string().uuid().describe('Identificador UUID');

/**
 * Dinheiro, sempre em centavos e sempre inteiro.
 *
 * Nunca `number` com casa decimal: 0.1 + 0.2 não é 0.3 em ponto flutuante, e
 * um centavo perdido por linha vira discussão com o cliente no fechamento do
 * contrato. O nome do campo deixa a unidade explícita para quem lê a resposta.
 */
export const Cents = z.number().int().describe('Valor em centavos');

/** Instante em ISO 8601 com fuso. Nunca data sem fuso: a agenda depende disso. */
export const Timestamp = z.string().describe('Instante em ISO 8601 com fuso horário');

/** Texto que precisa ter conteúdo — espaço em branco não conta. */
export const NonEmpty = z.string().trim().min(1);

export const Email = z.string().trim().toLowerCase().pipe(z.email());

/**
 * Página de resultados.
 *
 * `total` é opcional de propósito: contar tudo numa lista de 100 mil OS custa
 * caro, e a lista virtualizada do EPIC-009 não precisa do total para rolar.
 * Quando o número existe, ele vem; quando contá-lo seria caro, a lista ainda
 * funciona.
 */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().optional(),
    next_cursor: z.string().nullable().optional(),
  });
}

/** Resposta de comando que não devolve corpo útil. */
export const Ok = z.object({ ok: z.literal(true) });

/** O que toda criação devolve, no mínimo. */
export const Created = z.object({ id: Uuid });

export { z };
