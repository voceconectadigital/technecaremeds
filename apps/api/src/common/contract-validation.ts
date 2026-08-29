/**
 * Aurora — validar a entrada com o CONTRATO, e não com uma cópia dele.
 *
 * O controller não redeclara o formato do corpo: ele chama o mesmo esquema que
 * gera o OpenAPI e que tipa o cliente do frontend. É o que faz "fonte única"
 * significar alguma coisa — sem isto, `@aurora/contracts` seria documentação
 * que envelhece, e a validação de verdade continuaria espalhada em dezenas de
 * `typeof body.x !== 'string'`.
 *
 * A tradução do erro importa tanto quanto a validação. A §35 pede erro que
 * ENSINA: a resposta diz qual campo, com que valor, e o que era esperado —
 * porque "dados inválidos" manda a pessoa procurar sozinha.
 */
import type { z } from 'zod/v4';
import { ValidationError } from '@aurora/domain';

/**
 * Valida e devolve o valor já normalizado.
 *
 * O retorno é o valor de SAÍDA do esquema, não o de entrada: `Email` corta
 * espaços e baixa a caixa, e é essa forma que deve seguir para o domínio. Usar
 * o corpo cru depois de validar joga fora metade do trabalho do esquema.
 */
export function parseWith<T extends z.ZodTypeAny>(schema: T, valor: unknown): z.infer<T> {
  const r = schema.safeParse(valor);
  if (r.success) return r.data;

  const primeiro = r.error.issues[0];
  const campo = primeiro?.path.join('.') || undefined;

  throw new ValidationError(mensagem(r.error), {
    ...(campo ? { field: campo } : {}),
    // Todas as falhas, não só a primeira: um formulário com três campos errados
    // deve acender os três de uma vez, e não um por tentativa.
    issues: r.error.issues.map((i) => ({
      field: i.path.join('.') || null,
      message: i.message,
      code: i.code,
    })),
  });
}

function mensagem(erro: z.ZodError): string {
  const partes = erro.issues.map((i) => {
    const campo = i.path.join('.');
    return campo ? `${campo}: ${i.message}` : i.message;
  });
  return partes.join('; ');
}
