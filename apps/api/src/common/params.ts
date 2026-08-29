/**
 * Aurora — leitura de parâmetro de rota e de consulta (SPEC v0.2 §35, §36).
 *
 * POR QUE ISTO PASSOU A EXISTIR
 *
 * Havia onze cópias das mesmas três funções, espalhadas por onze controllers,
 * duas delas com nomes diferentes para o mesmo comportamento. Cópia é o que
 * permite a uma delas divergir sem ninguém notar — e foi o que quase
 * aconteceu: quando o Express 5 removeu a regex do parâmetro de rota, quatro
 * rotas ficaram sem NENHUMA validação de identificador, porque a validação
 * delas morava na forma da rota e não no código.
 *
 * O sintoma de uma dessas era 500: o texto "abc" chegava ao PostgreSQL como se
 * fosse uuid e o banco reclamava. 500 é o pior erro possível de dar a quem
 * integra — não diz o que corrigir e parece falha nossa.
 */
import { isUuid, ValidationError } from '@aurora/domain';

/**
 * Um identificador obrigatório.
 *
 * Aceita qualquer UUID bem formado, e não só o v7 que a aplicação gera:
 * recusar um v4 legítimo vindo de importação seria rigor sem ganho.
 */
export function uuidParam(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new ValidationError(`${field} deve ser um identificador válido`, { field });
  }
  return value;
}

/** O mesmo, quando ausente é uma resposta válida. */
export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return uuidParam(value, field);
}

/** Texto com conteúdo, já aparado. Vazio e só-espaços viram `null`. */
export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Um valor de uma lista fechada.
 *
 * A mensagem de erro leva as opções válidas: "source inválido" sozinho manda a
 * pessoa adivinhar, e adivinhar em integração custa uma tarde.
 */
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  fallback?: T
): T {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new ValidationError(`${field} é obrigatório`, { field, allowed });
  }
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${field} inválido`, { field, allowed });
  }
  return value as T;
}
