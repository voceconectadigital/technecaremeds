/**
 * Aurora — identificador externo (0048 · gap V2 P0.3 · PLAT §12).
 *
 * Um registro migrado ou sincronizado carrega DE ONDE veio (`source`) e QUEM
 * era lá (`id`). As duas coisas andam juntas — a mesma regra do CHECK do banco,
 * repetida aqui para o erro chegar com o nome do campo em vez de um código de
 * restrição.
 *
 * O identificador externo NUNCA vira chave interna: a chave continua sendo o
 * UUID v7 gerado aqui. Ele serve para reconciliar, não para referenciar.
 */
import { ValidationError } from './errors';

export interface ExternalRef {
  readonly source: string;
  readonly id: string;
}

const FONTE = /^[a-z][a-z0-9_.-]{1,40}$/;

/**
 * Normaliza e confere um par (origem, identificador).
 *
 * Devolve `null` quando nenhum dos dois veio — o caso comum de quem cadastra à
 * mão. Recusa quando só um veio: um sem o outro não reconcilia nada.
 */
export function normalizeExternalRef(
  source: string | null | undefined,
  id: string | number | null | undefined
): ExternalRef | null {
  const fonte = typeof source === 'string' ? source.trim().toLowerCase() : '';
  const ident = id === null || id === undefined ? '' : String(id).trim();

  if (!fonte && !ident) return null;
  if (!fonte || !ident) {
    throw new ValidationError('identificador externo exige origem e identificador juntos', {
      field: fonte ? 'external_id' : 'external_source',
    });
  }
  if (!FONTE.test(fonte)) {
    throw new ValidationError(
      'a origem externa deve ser um nome curto em minúsculas (ex.: arkmeds), de 2 a 41 caracteres',
      { field: 'external_source' }
    );
  }
  if (ident.length > 200) {
    throw new ValidationError('o identificador externo passa de 200 caracteres', { field: 'external_id' });
  }
  return { source: fonte, id: ident };
}
