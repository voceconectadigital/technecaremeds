import { normalizeForSearch } from './directory';

/**
 * Aurora — catálogos governados (SPEC v0.2 §08, §11, §41 · EPIC-004).
 *
 * Quais catálogos existem é decisão de código, não de configuração — mesmo
 * princípio de `permissions.ts`. Um catálogo só faz sentido se houver tela que
 * o consuma e indicador que dependa dele; deixar a organização inventar
 * catálogos novos seria reabrir exatamente a porta pela qual entraram os 651
 * tipos de equipamento da referência.
 *
 * O que a organização controla é o CONTEÚDO de cada catálogo: os itens, seus
 * rótulos, sua ordem, o que arquiva e o que mescla.
 */

export interface CatalogDefinition {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** Aceita subitens (no máximo dois níveis; ver migration 0011). */
  readonly isHierarchical: boolean;
  /**
   * Itens que a plataforma espera encontrar por `system_key` para calcular
   * indicador. Renomear o rótulo é livre; o `system_key` é o que sobrevive.
   */
  readonly systemKeys?: readonly string[];
}

export const CATALOGS: readonly CatalogDefinition[] = [
  {
    key: 'work_order_type',
    name: 'Natureza da OS',
    description:
      'Natureza do trabalho: corretiva, preventiva, calibração, inspeção. Não é sintoma nem serviço vendido.',
    isHierarchical: false,
    // A separação preventiva/corretiva é a base de metade dos indicadores de
    // manutenção. Sem chave estável, renomear "Corretiva" para "Reparo" zeraria
    // o histórico do indicador — foi o que a auditoria viu acontecer.
    systemKeys: ['corrective', 'preventive', 'calibration', 'inspection', 'installation'],
  },
  {
    key: 'failure_symptom',
    name: 'Sintoma relatado',
    description: 'O que quem abriu percebeu. Primeiro eixo da taxonomia de falha.',
    isHierarchical: true,
  },
  {
    key: 'failure_cause',
    name: 'Causa identificada',
    description: 'O que de fato causou a falha, preenchido no encerramento. Segundo eixo.',
    isHierarchical: true,
  },
  {
    key: 'failure_action',
    name: 'Ação executada',
    description: 'O que foi feito para resolver. Terceiro eixo — é a trinca que permite causa raiz.',
    isHierarchical: false,
  },
  {
    key: 'rejection_reason',
    name: 'Motivo de recusa',
    description: 'Por que uma solicitação foi recusada. Recusa sem motivo catalogado não vira aprendizado.',
    isHierarchical: false,
  },
  {
    key: 'customer_segment',
    name: 'Segmento de cliente',
    description: 'Agrupamento comercial do cliente, usado como dimensão de análise.',
    isHierarchical: false,
  },
] as const;

export const CATALOG_KEYS: readonly string[] = CATALOGS.map((c) => c.key);

export function catalogByKey(key: string): CatalogDefinition | undefined {
  return CATALOGS.find((c) => c.key === key);
}

/**
 * Forma normalizada de um rótulo de catálogo.
 *
 * Precisa concordar exatamente com `aurora.normalize_label` (migration 0011),
 * que é quem de fato impede o duplicado. Esta versão existe para a interface
 * poder avisar antes de enviar — e um teste compara as duas sobre a mesma lista
 * de entradas, porque duas implementações da mesma regra divergem sozinhas se
 * ninguém estiver olhando.
 */
export function normalizeLabel(label: string): string {
  return normalizeForSearch(label);
}

/** Duas grafias que o banco vai tratar como o mesmo item. */
export function labelsCollide(a: string, b: string): boolean {
  return normalizeLabel(a) === normalizeLabel(b) && normalizeLabel(a).length > 0;
}

export type MergeReason = 'mesma_forma_normalizada' | 'um_contem_o_outro' | 'grafia_proxima';

export interface MergeSuggestion<T> {
  readonly a: T;
  readonly b: T;
  readonly reason: MergeReason;
  /** 1 = certeza; abaixo disso, quanto mais alto mais parecidos. */
  readonly score: number;
}

/** Distância de edição, com corte antecipado quando já passou do limite. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let melhorNaLinha = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + custo);
      cur.push(v);
      if (v < melhorNaLinha) melhorNaLinha = v;
    }
    if (melhorNaLinha > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Sugere pares candidatos à mesclagem.
 *
 * ESTA FUNÇÃO MUDOU DEPOIS DE UM TESTE VERMELHO, e a razão vale registro.
 *
 * A primeira versão agrupava por forma normalizada — "Fechada" com "fechada".
 * O teste mostrou que esse par é impossível de existir no Aurora: o índice
 * único sobre `normalized_label` (migration 0011) impede que o segundo seja
 * criado. A sugestão por igualdade normalizada, portanto, nunca acharia nada.
 * Era código que parecia resolver o problema e não resolvia nenhum.
 *
 * O duplicado que de fato sobrevive é o que a normalização NÃO pega:
 * "Empréstimo" ao lado de "Empréstimo de equipamento", "Reposição de Oxigênio"
 * ao lado de "Reposicao Oxigenio", "Ventilador" ao lado de "Ventliador". São
 * esses que a auditoria encontrou às centenas, e são esses que só uma pessoa
 * pode decidir se são a mesma coisa. O trabalho automatizável é colocá-los lado
 * a lado com o motivo à vista; a decisão continua sendo humana.
 *
 * Sem `pg_trgm` (ADR-027), a comparação é feita aqui: a lista de um catálogo
 * cabe em memória com folga, mesmo nos 651 itens do caso real.
 */
export function suggestMergeGroups<T extends { id: string; label: string }>(
  items: readonly T[],
  opts: { minScore?: number; limit?: number } = {}
): Array<MergeSuggestion<T>> {
  const minScore = opts.minScore ?? 0.8;
  const limite = opts.limit ?? 100;

  const preparados = items
    .map((item) => ({ item, norm: normalizeLabel(item.label) }))
    .filter((p) => p.norm.length > 0)
    .map((p) => ({ ...p, tokens: new Set(p.norm.split(' ')) }));

  const sugestoes: Array<MergeSuggestion<T>> = [];

  for (let i = 0; i < preparados.length; i++) {
    for (let j = i + 1; j < preparados.length; j++) {
      const x = preparados[i]!;
      const y = preparados[j]!;

      if (x.norm === y.norm) {
        sugestoes.push({ a: x.item, b: y.item, reason: 'mesma_forma_normalizada', score: 1 });
        continue;
      }

      // Um contém o outro em palavras inteiras: "emprestimo" dentro de
      // "emprestimo de equipamento". Comparar por token e não por substring
      // evita casar "cabo" com "cabografia".
      const menor = x.tokens.size <= y.tokens.size ? x : y;
      const maior = menor === x ? y : x;
      const contido = [...menor.tokens].every((tk) => maior.tokens.has(tk));
      if (contido) {
        sugestoes.push({
          a: x.item,
          b: y.item,
          reason: 'um_contem_o_outro',
          score: menor.tokens.size / maior.tokens.size,
        });
        continue;
      }

      // Grafia próxima. Rótulo curto fica de fora: em três ou quatro letras
      // uma diferença já é outra palavra, e o ruído afogaria as sugestões boas.
      const maxLen = Math.max(x.norm.length, y.norm.length);
      if (maxLen < 5) continue;
      // O teto serve só para o corte antecipado do cálculo; quem decide é o
      // score. Filtrar pelo teto arredondado deixaria passar pares abaixo do
      // mínimo pedido — e "mínimo" que não é mínimo é pior que não ter.
      const teto = Math.ceil(maxLen * (1 - minScore));
      const dist = editDistance(x.norm, y.norm, teto);
      const score = 1 - dist / maxLen;
      if (dist <= teto && score >= minScore) {
        sugestoes.push({
          a: x.item,
          b: y.item,
          reason: 'grafia_proxima',
          score,
        });
      }
    }
  }

  return sugestoes.sort((p, q) => q.score - p.score).slice(0, limite);
}
