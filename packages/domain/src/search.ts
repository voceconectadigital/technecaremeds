/**
 * Aurora — busca global (SPEC v0.2 §27 · EPIC-025).
 *
 * A ausência de busca global é uma das lacunas mais custosas da referência:
 * para achar "patrimônio 7737" é preciso saber em qual lista procurar. O
 * técnico com o equipamento na frente sabe o número que está na etiqueta e não
 * sabe se aquilo é uma TAG, um patrimônio ou uma série — e nem deveria precisar
 * saber. Aqui a busca é a primeira tecla.
 *
 * DUAS REGRAS QUE MUDAM O RESULTADO
 *
 * 1. IDENTIFICADOR EXATO VEM SEMPRE PRIMEIRO
 *    Quem digita "7737" está com a etiqueta na mão. Devolver primeiro a OS cujo
 *    texto menciona 7737 e só depois o ativo de patrimônio 7737 é tecnicamente
 *    defensável e praticamente inútil.
 *
 * 2. PERMISSÃO E ESCOPO SE APLICAM NO ÍNDICE, NÃO NA EXIBIÇÃO
 *    Um resultado fora do escopo do usuário NÃO EXISTE para ele. Filtrar depois
 *    de buscar vaza a existência do registro — o contador diz "12 resultados" e
 *    a tela mostra 3, e a diferença é informação sobre dados que a pessoa não
 *    deveria saber que existem.
 */
import { normalizeForSearch } from './directory';

export const SEARCH_SCOPES = [
  'asset',
  'work_order',
  'service_request',
  'customer',
  'location',
  'inventory_item',
  'document',
  'quote',
  'person',
] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export const SCOPE_LABELS: Record<SearchScope, string> = {
  asset: 'Ativos',
  work_order: 'Ordens de serviço',
  service_request: 'Solicitações',
  customer: 'Clientes',
  location: 'Locais',
  inventory_item: 'Itens de estoque',
  document: 'Documentos',
  quote: 'Orçamentos',
  person: 'Pessoas',
};

/* -------------------------------------------------------------------------- */
/* interpretação da consulta                                                   */
/* -------------------------------------------------------------------------- */

export interface ParsedQuery {
  /** O texto já normalizado, sem o prefixo. */
  readonly term: string;
  /** Termo original, para casar identificador sem perder maiúsculas. */
  readonly raw: string;
  /** Escopos a consultar. Vazio significa todos. */
  readonly scopes: readonly SearchScope[];
  /** A paleta deve oferecer comandos em vez de registros? */
  readonly commandMode: boolean;
  /** O termo parece um identificador (TAG, patrimônio, série, número de OS)? */
  readonly looksLikeIdentifier: boolean;
}

/**
 * Um termo "parece identificador" quando não é uma frase.
 *
 * O critério é: sem espaço, e com dígito ou hífen. "7737" e "VENT-01" passam;
 * "ventilador" não. É grosseiro de propósito — o objetivo não é classificar
 * corretamente, é decidir se vale procurar por igualdade antes de procurar por
 * texto, e o custo de errar para mais é uma consulta a mais que não acha nada.
 */
export function looksLikeIdentifier(raw: string): boolean {
  const t = raw.trim();
  if (t.length === 0 || /\s/.test(t)) return false;
  return /\d/.test(t) || t.includes('-');
}

/**
 * Interpreta a consulta digitada, incluindo os prefixos contextuais do §27.
 *
 * `#` restringe a OS, `@` a pessoas, `>` vira paleta de comandos. São
 * convenções de teclado, não sintaxe de busca: quem não conhece nunca as digita
 * e a busca funciona igual.
 */
export function parseQuery(input: string): ParsedQuery {
  const bruto = input.trim();

  if (bruto.startsWith('>')) {
    const resto = bruto.slice(1).trim();
    return {
      term: normalizeForSearch(resto),
      raw: resto,
      scopes: [],
      commandMode: true,
      looksLikeIdentifier: false,
    };
  }

  if (bruto.startsWith('#')) {
    const resto = bruto.slice(1).trim();
    return {
      term: normalizeForSearch(resto),
      raw: resto,
      scopes: ['work_order', 'service_request'],
      commandMode: false,
      looksLikeIdentifier: looksLikeIdentifier(resto),
    };
  }

  if (bruto.startsWith('@')) {
    const resto = bruto.slice(1).trim();
    return {
      term: normalizeForSearch(resto),
      raw: resto,
      scopes: ['person'],
      commandMode: false,
      looksLikeIdentifier: false,
    };
  }

  return {
    term: normalizeForSearch(bruto),
    raw: bruto,
    scopes: [],
    commandMode: false,
    looksLikeIdentifier: looksLikeIdentifier(bruto),
  };
}

/** Abaixo disto a busca não vale a pena: devolveria meio banco. */
export const MIN_TERM_LENGTH = 2;

/* -------------------------------------------------------------------------- */
/* ranqueamento                                                               */
/* -------------------------------------------------------------------------- */

export const MATCH_KINDS = ['identifier_exact', 'identifier_prefix', 'text'] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export interface SearchHit {
  readonly scope: SearchScope;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly matchKind: MatchKind;
  /** Última interação conhecida — usada no desempate por recência. */
  readonly touchedAt: Date | null;
}

const PESO: Record<MatchKind, number> = {
  identifier_exact: 1000,
  identifier_prefix: 500,
  text: 100,
};

/**
 * Pontua um resultado.
 *
 * A ordem do §27 é: identificador exato, depois recência, depois relevância
 * textual. A recência entra como fração de um ponto para nunca ultrapassar a
 * classe de correspondência — um ativo tocado hoje não deve passar na frente do
 * ativo cujo patrimônio a pessoa acabou de digitar.
 */
export function scoreHit(hit: SearchHit, now: Date): number {
  const base = PESO[hit.matchKind];
  if (hit.touchedAt === null) return base;

  const dias = Math.max(0, (now.getTime() - hit.touchedAt.getTime()) / 86_400_000);
  // Decai pela metade a cada 30 dias, e vale no máximo 1 ponto: recência
  // desempata, não decide.
  return base + Math.pow(0.5, dias / 30);
}

export function rankHits(hits: readonly SearchHit[], now: Date = new Date()): SearchHit[] {
  return [...hits].sort((a, b) => {
    const d = scoreHit(b, now) - scoreHit(a, now);
    if (d !== 0) return d;
    // Empate técnico resolve pelo título, para a lista não dançar entre
    // consultas iguais — resultado que muda de ordem sozinho parece defeito.
    return a.title.localeCompare(b.title);
  });
}

/* -------------------------------------------------------------------------- */
/* comandos                                                                    */
/* -------------------------------------------------------------------------- */

export interface CommandDefinition {
  readonly key: string;
  readonly label: string;
  /** Para onde leva, ou o que abre. */
  readonly action: string;
  /** `null` quando qualquer pessoa autenticada pode. */
  readonly permission: string | null;
  readonly keywords: readonly string[];
}

/**
 * A paleta também executa (§27).
 *
 * Filtrada por permissão, e o filtro é de EXISTÊNCIA: o comando que a pessoa
 * não pode executar não aparece desabilitado, não aparece. Mostrar cinzento
 * ensina o que existe do outro lado da parede sem oferecer nada em troca.
 */
export const COMMANDS: readonly CommandDefinition[] = Object.freeze([
  {
    key: 'new_work_order',
    label: 'Nova ordem de serviço',
    action: '/work-orders/new',
    permission: 'work_order.create',
    keywords: ['os', 'ordem', 'nova', 'abrir'],
  },
  {
    key: 'new_request',
    label: 'Abrir solicitação',
    action: '/requests/new',
    permission: 'service_request.create',
    keywords: ['solicitacao', 'chamado', 'pedir'],
  },
  {
    key: 'go_schedule',
    label: 'Ir para a agenda',
    action: '/schedule',
    permission: 'work_order.read',
    keywords: ['agenda', 'calendario', 'programacao'],
  },
  {
    key: 'go_assets',
    label: 'Ir para ativos',
    action: '/assets',
    permission: 'asset.read',
    keywords: ['ativos', 'equipamentos', 'parque'],
  },
  {
    key: 'go_insights',
    label: 'Ir para indicadores',
    action: '/insights',
    permission: 'insight.read',
    keywords: ['indicadores', 'painel', 'metricas', 'relatorio'],
  },
  {
    key: 'switch_organization',
    label: 'Trocar de organização',
    action: 'switch-organization',
    permission: null,
    keywords: ['organizacao', 'trocar', 'empresa'],
  },
  {
    key: 'toggle_theme',
    label: 'Alternar tema',
    action: 'toggle-theme',
    permission: null,
    keywords: ['tema', 'escuro', 'claro'],
  },
]);

/**
 * Os comandos que esta pessoa pode executar, filtrados pelo termo.
 *
 * Casa por rótulo E por palavras-chave: quem digita "chamado" quer abrir
 * solicitação, mesmo que a palavra não esteja no rótulo. É a diferença entre
 * uma paleta que serve e uma que exige decorar o nome exato do botão.
 */
export function matchCommands(term: string, permissions: ReadonlySet<string>): CommandDefinition[] {
  const t = normalizeForSearch(term);
  return COMMANDS.filter((c) => c.permission === null || permissions.has(c.permission)).filter(
    (c) =>
      t.length === 0 ||
      normalizeForSearch(c.label).includes(t) ||
      c.keywords.some((k) => k.includes(t) || t.includes(k))
  );
}
