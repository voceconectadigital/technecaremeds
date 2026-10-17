/**
 * Aurora — motor de checklists (SPEC v0.2 §14, ADR-012 · EPIC-011).
 *
 * A referência guarda o checklist como um array JSON numa coluna. Aqui ele é
 * relacional e versionado, porque **a resposta de um checklist é evidência** —
 * e evidência que muda depois do fato deixa de ser evidência.
 *
 * Este arquivo contém o que decide sozinho, sem banco: o veredito automático, a
 * visibilidade condicional e o cálculo de completude. São as três regras que
 * precisam valer igual na web, no aplicativo de campo e no servidor — e três
 * implementações da mesma regra divergem na primeira mudança.
 */
import { roundedMoneyProduct } from './contracts';

export const CHECKLIST_ITEM_KINDS = [
  'text',
  'number',
  'boolean',
  'option',
  'multi_option',
  'photo',
  'date',
  /**
   * Ponto de medição de um protocolo metrológico (0052 · gap V2 P2.3).
   *
   * Registra leituras com unidade, ao lado do nominal e das tolerâncias COMO
   * DADO. O veredito é SEMPRE `na`: comparar a leitura com a tolerância exige
   * critério de aceitação e regra de arredondamento, duas das cinco decisões
   * bloqueadas (`AURORA-METROLOGIA-FRONTEIRA.md`).
   */
  'measurement',
] as const;
export type ChecklistItemKind = (typeof CHECKLIST_ITEM_KINDS)[number];

export type Verdict = 'pass' | 'fail' | 'na';
export type PhotoRequirement = 'never' | 'always' | 'on_fail';
export type FailAction = 'none' | 'flag' | 'block_completion' | 'create_work_order';

export interface ChecklistItem {
  readonly id: string;
  readonly kind: ChecklistItemKind;
  readonly label: string;
  readonly required: boolean;
  readonly options?: readonly string[];
  readonly failingOptions?: readonly string[];
  readonly minValue?: number | null;
  readonly maxValue?: number | null;
  readonly unit?: string | null;
  readonly expectedBoolean?: boolean | null;
  readonly minSelections?: number | null;
  readonly maxSelections?: number | null;
  readonly minPhotos?: number | null;
  readonly requiresPhotoWhen: PhotoRequirement;
  readonly failAction: FailAction;
  readonly conditionItemId?: string | null;
  readonly conditionEquals?: string | null;
  /** Ponto de medição — só em `measurement`, e só como dado declarado. */
  readonly nominalValue?: number | null;
  readonly toleranceMinus?: number | null;
  readonly tolerancePlus?: number | null;
  readonly toleranceMode?: 'absolute' | 'percent' | null;
  readonly readingsRequired?: number | null;
}

export interface AnswerValue {
  readonly text?: string | null;
  readonly number?: number | null;
  readonly boolean?: boolean | null;
  readonly options?: readonly string[] | null;
  readonly date?: string | null;
  readonly photoCount?: number;
  /** As leituras de um ponto `measurement`, na ordem em que foram feitas. */
  readonly readings?: readonly number[] | null;
}

/**
 * Representação canônica do valor de uma resposta, para comparação condicional.
 *
 * Existe porque a condição é declarada como texto (`condition_equals`) e o valor
 * pode ser número, booleano ou lista. Sem uma forma canônica, comparar `"true"`
 * com `true` daria falso e a condição nunca dispararia — silenciosamente.
 */
export function canonicalValue(value: AnswerValue | undefined): string | null {
  if (!value) return null;
  if (value.text != null) return value.text;
  if (value.number != null) return String(value.number);
  if (value.boolean != null) return value.boolean ? 'true' : 'false';
  if (value.options != null && value.options.length > 0) return [...value.options].sort().join(',');
  if (value.date != null) return value.date;
  if (value.readings != null && value.readings.length > 0) return value.readings.map(String).join(';');
  return null;
}

/**
 * O item está visível, dadas as respostas já dadas?
 *
 * Item oculto não é obrigatório e não entra no cálculo de completude (§14). Sem
 * essa regra, um checklist com lógica condicional nunca ficaria completo — a
 * pessoa veria "faltam 3 itens" e não acharia nenhum dos três na tela.
 */
export function isVisible(item: ChecklistItem, answers: Readonly<Record<string, AnswerValue>>): boolean {
  if (!item.conditionItemId) return true;
  return canonicalValue(answers[item.conditionItemId]) === item.conditionEquals;
}

/**
 * Veredito automático de uma resposta.
 *
 * `na` quando não há o que julgar — item de texto, foto, data. `fail` quando o
 * valor sai da faixa, contraria o esperado ou cai numa opção marcada como
 * reprovação. É o mecanismo que transforma uma ronda de inspeção em geradora de
 * demanda: um número fora da faixa vira, conforme `fail_action`, exigência de
 * foto, bloqueio da conclusão ou uma OS corretiva.
 */
export function computeVerdict(item: ChecklistItem, value: AnswerValue): Verdict {
  switch (item.kind) {
    case 'number': {
      if (value.number == null || !Number.isFinite(value.number)) return 'na';
      const abaixo = item.minValue != null && value.number < item.minValue;
      const acima = item.maxValue != null && value.number > item.maxValue;
      if (item.minValue == null && item.maxValue == null) return 'na';
      return abaixo || acima ? 'fail' : 'pass';
    }
    case 'boolean': {
      if (value.boolean == null) return 'na';
      if (item.expectedBoolean == null) return 'na';
      return value.boolean === item.expectedBoolean ? 'pass' : 'fail';
    }
    case 'option': {
      if (!value.text) return 'na';
      if (!item.failingOptions || item.failingOptions.length === 0) return 'na';
      return item.failingOptions.includes(value.text) ? 'fail' : 'pass';
    }
    case 'multi_option': {
      const escolhidas = value.options ?? [];
      if (escolhidas.length === 0) return 'na';
      const reprova = (item.failingOptions ?? []).some((o) => escolhidas.includes(o));
      if (reprova) return 'fail';
      const min = item.minSelections;
      const max = item.maxSelections;
      if ((min != null && escolhidas.length < min) || (max != null && escolhidas.length > max)) {
        return 'fail';
      }
      return item.failingOptions && item.failingOptions.length > 0 ? 'pass' : 'na';
    }
    case 'photo': {
      const exigidas = item.minPhotos ?? 1;
      if (value.photoCount == null) return 'na';
      return value.photoCount >= exigidas ? 'pass' : 'fail';
    }
    case 'measurement':
      /*
       * NÃO HÁ VEREDITO AUTOMÁTICO PARA MEDIÇÃO, e isto não é esquecimento.
       *
       * Decidir se uma leitura está dentro da tolerância exige escolher se a
       * incerteza entra, se arredonda antes de comparar e como o percentual
       * vira limite — o critério de aceitação e o arredondamento da fronteira
       * metrológica. Até um metrologista validar a regra com casos de
       * referência no limite, o ponto é registrado e NÃO julgado.
       */
      return 'na';
    default:
      return 'na';
  }
}

export interface AnswerIssue {
  readonly itemId: string;
  readonly label: string;
  readonly message: string;
}

/** O valor preenche o item? Sem julgar aprovação — só forma. */
export function validateAnswer(item: ChecklistItem, value: AnswerValue): AnswerIssue[] {
  const issues: AnswerIssue[] = [];
  const add = (message: string) => issues.push({ itemId: item.id, label: item.label, message });

  switch (item.kind) {
    case 'text':
      if (value.text != null && typeof value.text !== 'string') add('esperado texto');
      break;
    case 'number':
      if (value.number != null && !Number.isFinite(value.number)) add('esperado número');
      break;
    case 'boolean':
      if (value.boolean != null && typeof value.boolean !== 'boolean') add('esperado sim ou não');
      break;
    case 'option':
      if (value.text != null && !(item.options ?? []).includes(value.text)) {
        add(`"${value.text}" não está entre as opções`);
      }
      break;
    case 'multi_option': {
      const escolhidas = value.options ?? [];
      const fora = escolhidas.filter((o) => !(item.options ?? []).includes(o));
      if (fora.length > 0) add(`opções fora da lista: ${fora.join(', ')}`);
      if (new Set(escolhidas).size !== escolhidas.length) add('há opções repetidas');
      break;
    }
    case 'date':
      if (value.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
        add('esperada data no formato AAAA-MM-DD');
      }
      break;
    case 'photo':
      if ((value.photoCount ?? 0) < 0) add('quantidade de fotos inválida');
      break;
    case 'measurement': {
      // Conferência de FORMA, e só de forma: quantas leituras, e se são números.
      if (value.number != null) add('ponto de medição recebe leituras (readings), não um número solto');
      const leituras = value.readings;
      if (leituras == null) break;
      if (!Array.isArray(leituras) || leituras.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        add('as leituras precisam ser números finitos');
        break;
      }
      const exigidas = item.readingsRequired ?? 1;
      if (leituras.length !== exigidas) {
        add(`este ponto exige ${exigidas} leitura(s) e vieram ${leituras.length}`);
      }
      break;
    }
  }
  return issues;
}

export interface CompletenessResult {
  readonly total: number;
  readonly answered: number;
  readonly complete: boolean;
  /** Itens visíveis, obrigatórios e sem resposta. */
  readonly pending: ReadonlyArray<{ itemId: string; label: string }>;
  /** Reprovações que exigem foto e não têm. */
  readonly missingPhotos: ReadonlyArray<{ itemId: string; label: string }>;
  /** Reprovações que bloqueiam a conclusão da OS. */
  readonly blocking: ReadonlyArray<{ itemId: string; label: string }>;
  /** Reprovações que devem gerar OS corretiva derivada. */
  readonly generatesWorkOrder: ReadonlyArray<{ itemId: string; label: string }>;
}

/**
 * Completude e consequências de um checklist respondido.
 *
 * Só conta o que está visível: item oculto por condição não é obrigatório e não
 * entra na conta. E devolve as consequências separadas — falta de resposta,
 * falta de foto, bloqueio, geração de OS — porque cada uma leva a uma ação
 * diferente de quem está lendo.
 */
export function evaluateChecklist(
  items: readonly ChecklistItem[],
  answers: Readonly<Record<string, AnswerValue>>
): CompletenessResult {
  const pending: Array<{ itemId: string; label: string }> = [];
  const missingPhotos: Array<{ itemId: string; label: string }> = [];
  const blocking: Array<{ itemId: string; label: string }> = [];
  const generatesWorkOrder: Array<{ itemId: string; label: string }> = [];

  let total = 0;
  let answered = 0;

  for (const item of items) {
    if (!isVisible(item, answers)) continue;
    const value = answers[item.id];
    const temResposta = canonicalValue(value) !== null || (value?.photoCount ?? 0) > 0;

    if (item.required) {
      total += 1;
      if (temResposta) answered += 1;
      else pending.push({ itemId: item.id, label: item.label });
    }

    if (!temResposta) continue;

    const verdict = computeVerdict(item, value!);
    const precisaFoto =
      item.requiresPhotoWhen === 'always' || (item.requiresPhotoWhen === 'on_fail' && verdict === 'fail');
    if (precisaFoto && (value!.photoCount ?? 0) === 0) {
      missingPhotos.push({ itemId: item.id, label: item.label });
    }
    if (verdict === 'fail') {
      if (item.failAction === 'block_completion') blocking.push({ itemId: item.id, label: item.label });
      if (item.failAction === 'create_work_order') {
        generatesWorkOrder.push({ itemId: item.id, label: item.label });
      }
    }
  }

  return {
    total,
    answered,
    complete: pending.length === 0 && missingPhotos.length === 0,
    pending,
    missingPhotos,
    blocking,
    generatesWorkOrder,
  };
}

/* -------------------------------------------------------------------------- */
/* horas                                                                       */
/* -------------------------------------------------------------------------- */

export interface TimeInterval {
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** Dois apontamentos da mesma pessoa que se sobrepõem no tempo. */
export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  const aStart = new Date(a.startedAt).getTime();
  const bStart = new Date(b.startedAt).getTime();
  const aEnd = a.endedAt ? new Date(a.endedAt).getTime() : Number.POSITIVE_INFINITY;
  const bEnd = b.endedAt ? new Date(b.endedAt).getTime() : Number.POSITIVE_INFINITY;
  return aStart < bEnd && bStart < aEnd;
}

/** Minutos de um apontamento fechado; zero enquanto o cronômetro corre. */
export function entryMinutes(entry: TimeInterval): number {
  if (!entry.endedAt) return 0;
  const ms = new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : 0;
}

/**
 * Custo de um apontamento, com o valor/hora congelado nele.
 *
 * Recebe o custo em vez de buscá-lo: o valor que vale é o vigente quando a hora
 * foi apontada, não o de hoje. Calcular por junção com a tabela de custo faria
 * um reajuste reescrever o custo de OS fechadas mês passado — e fechamento de
 * mês que muda sozinho é fechamento que ninguém assina.
 */
export function entryCost(entry: TimeInterval, hourlyCost: number | null): number | null {
  if (hourlyCost == null) return null;
  // minutos × valor/hora ÷ 60, arredondado a centavos uma vez, sem float
  // (`(minutos / 60) * custo` com `toFixed(2)` perdia o meio centavo).
  return roundedMoneyProduct([entryMinutes(entry), hourlyCost], 60);
}
