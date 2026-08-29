/**
 * Aurora — diretório: árvore de locais, calendários e normalização de busca.
 * SPEC v0.2 §05, §32, ADR-005, ADR-026, ADR-027 · EPIC-003
 *
 * O que está aqui é o que dá para decidir sem tocar no banco: interpretar um
 * caminho materializado, comparar janelas de horário, normalizar texto.
 *
 * O que NÃO está aqui, de propósito: a regra de aninhamento entre tipos de
 * local e o cálculo do caminho. Ambos vivem na migration 0009, como gatilho.
 * Repetir a regra aqui daria uma segunda fonte de verdade que fatalmente
 * divergiria da primeira — e a que vale é a do banco, porque é a única que
 * também vale para importação, correção manual e migração futura.
 */

/** Profundidade máxima da árvore (SPEC §32; a mesma constante da migration 0009). */
export const LOCATION_MAX_DEPTH = 8;

/**
 * Caminho materializado de um local: `/<raiz>/.../<próprio id>/`.
 *
 * É composto só de uuid e barra. Duas consequências aproveitadas em todo lugar:
 * não contém caractere curinga de `LIKE`, então o prefixo é literal e usa
 * índice; e não muda quando o local é renomeado, só quando é movido.
 */
export function buildLocationPath(parentPath: string | null, id: string): string {
  if (parentPath === null || parentPath === '') return `/${id}/`;
  if (!parentPath.startsWith('/') || !parentPath.endsWith('/')) {
    throw new Error(`caminho de pai malformado: ${JSON.stringify(parentPath)}`);
  }
  return `${parentPath}${id}/`;
}

/** Ids do caminho, da raiz até o próprio local (inclusive). */
export function locationPathIds(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/** Profundidade implícita no caminho. Deve bater com a coluna `depth`. */
export function locationDepth(path: string): number {
  return locationPathIds(path).length;
}

/** Id do pai, ou `null` para um local raiz. */
export function parentIdFromPath(path: string): string | null {
  const ids = locationPathIds(path);
  return ids.length >= 2 ? ids[ids.length - 2]! : null;
}

/**
 * `path` está dentro da subárvore de `ancestorPath`?
 * Um local é sua própria subárvore — é o comportamento que o escopo por local
 * precisa: quem tem acesso à unidade tem acesso à unidade e a tudo abaixo dela.
 */
export function isWithinSubtree(path: string, ancestorPath: string): boolean {
  return path.startsWith(ancestorPath);
}

/**
 * Prefixo a usar em `LIKE` para varrer uma subárvore.
 * Existe para que a montagem do prefixo tenha um lugar só e o `%` não seja
 * esquecido nem duplicado nas chamadas.
 */
export function subtreePrefix(ancestorPath: string): string {
  return `${ancestorPath}%`;
}

/**
 * Reescreve um caminho de descendente quando a raiz da subárvore se move.
 * Espelha em TypeScript exatamente o que a migration 0009 faz em SQL; serve
 * para prever o resultado em teste sem consultar o banco.
 */
export function rewriteSubtreePath(descendantPath: string, oldRoot: string, newRoot: string): string {
  if (!descendantPath.startsWith(oldRoot)) {
    throw new Error('o caminho informado não pertence à subárvore de origem');
  }
  return newRoot + descendantPath.slice(oldRoot.length);
}

/* -------------------------------------------------------------------------- */
/* calendários                                                                 */
/* -------------------------------------------------------------------------- */

/** 0 = domingo, seguindo `EXTRACT(DOW)` do PostgreSQL. */
export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

export interface TimeWindow {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** `HH:MM` ou `HH:MM:SS` em minutos desde a meia-noite. */
export function timeToMinutes(time: string): number {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!m) throw new Error(`horário inválido: ${JSON.stringify(time)}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`horário fora de faixa: ${time}`);
  return h * 60 + min;
}

/**
 * Duas janelas do mesmo dia se sobrepõem?
 *
 * Encostar não é sobrepor: 08:00–12:00 e 12:00–18:00 convivem. É o intervalo
 * meio-aberto `[início, fim)`, que é como um turno seguido de outro funciona
 * na prática.
 */
export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return (
    timeToMinutes(a.startsAt) < timeToMinutes(b.endsAt) && timeToMinutes(b.startsAt) < timeToMinutes(a.endsAt)
  );
}

/** Janela válida: fim depois do início. Virada de meia-noite se declara em duas. */
export function isValidWindow(w: TimeWindow): boolean {
  return timeToMinutes(w.endsAt) > timeToMinutes(w.startsAt);
}

/* -------------------------------------------------------------------------- */
/* busca                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Forma normalizada de um texto para indexação e comparação (ADR-027).
 *
 * Sem `pg_trgm` disponível, a tolerância a variação de digitação vem daqui: o
 * índice guarda a forma sem acento, sem pontuação, sem espaço redundante e em
 * caixa baixa. Isso resolve o caso real e frequente — `SN-4471/A`, `sn 4471 a`
 * e `SN4471A` são o mesmo número de série — e não resolve erro de digitação de
 * verdade, que continua dependendo de trigrama onde ele existir.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Forma compacta, sem separador: casa `SN-4471/A` com `sn4471a`. */
export function normalizeIdentifier(text: string): string {
  return normalizeForSearch(text).replace(/ /g, '');
}
