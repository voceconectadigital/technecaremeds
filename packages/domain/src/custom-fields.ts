/**
 * Aurora — campos personalizados (SPEC v0.2 §29, ADR-009 · EPIC-004).
 *
 * A referência guardava o checklist como JSON solto numa coluna: barato de
 * escrever, impossível de validar, de listar em coluna e de usar em relatório.
 * Aqui o valor continua em `jsonb` — porque coluna real por organização é
 * inviável com centenas de tenants — mas cada campo tem uma DEFINIÇÃO tipada, e
 * é a definição que manda.
 *
 * Este arquivo é puro de propósito. A validação precisa rodar no servidor
 * (§29: "nunca só no formulário"), e também precisa rodar no formulário para o
 * erro aparecer enquanto a pessoa digita. Uma implementação só, nos dois
 * lugares, é a única forma de as duas concordarem.
 */

export type CustomFieldKind =
  'text' | 'number' | 'boolean' | 'date' | 'select' | 'multi_select' | 'user' | 'asset' | 'currency' | 'url';

export const CUSTOM_FIELD_KINDS: readonly CustomFieldKind[] = [
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'multi_select',
  'user',
  'asset',
  'currency',
  'url',
];

/** Entidades que aceitam campos personalizados. */
export const CUSTOM_FIELD_ENTITIES = [
  'asset',
  'work_order',
  'customer',
  'location',
  'service_request',
  'supplier',
] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

/** Limite por entidade por organização (§29): defesa contra o formulário de 200 campos. */
export const MAX_CUSTOM_FIELDS_PER_ENTITY = 50;

export interface CustomFieldDefinition {
  readonly key: string;
  readonly label: string;
  readonly kind: CustomFieldKind;
  readonly required?: boolean;
  readonly options?: readonly string[];
  readonly min?: number | null;
  readonly max?: number | null;
  readonly regex?: string | null;
  readonly unit?: string | null;
  readonly defaultValue?: unknown;
  /** Condição de aplicabilidade; campo não aplicável não é exigido nem validado. */
  readonly appliesWhen?: Readonly<Record<string, unknown>> | null;
}

export interface FieldIssue {
  readonly key: string;
  readonly message: string;
}

const KEY_FORMAT = /^[a-z][a-z0-9_]{1,48}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A definição faz sentido?
 *
 * Vale a pena recusar definição inconsistente na criação e não na hora de
 * validar valor: uma definição quebrada só se manifestaria quando alguém
 * tentasse preencher o campo, provavelmente semanas depois, e o erro apareceria
 * para a pessoa errada.
 */
export function validateDefinition(def: CustomFieldDefinition): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const add = (message: string) => issues.push({ key: def.key, message });

  if (!KEY_FORMAT.test(def.key)) {
    add('a chave deve começar com letra minúscula e conter apenas letras, números e sublinhado');
  }
  if (def.label.trim().length === 0) add('o rótulo é obrigatório');
  if (!CUSTOM_FIELD_KINDS.includes(def.kind)) add(`tipo desconhecido: ${def.kind}`);

  const usaOpcoes = def.kind === 'select' || def.kind === 'multi_select';
  if (usaOpcoes) {
    if (!def.options || def.options.length === 0) {
      add('campo de seleção precisa de ao menos uma opção');
    } else if (new Set(def.options).size !== def.options.length) {
      add('há opções repetidas');
    }
  } else if (def.options && def.options.length > 0) {
    add(`opções só fazem sentido em select e multi_select, não em ${def.kind}`);
  }

  const usaFaixa = def.kind === 'number' || def.kind === 'currency' || def.kind === 'text';
  if (!usaFaixa && (def.min != null || def.max != null)) {
    add(`mínimo e máximo não se aplicam a ${def.kind}`);
  }
  if (def.min != null && def.max != null && def.min > def.max) {
    add('o mínimo é maior que o máximo');
  }

  if (def.regex != null) {
    if (def.kind !== 'text') add('expressão regular só se aplica a texto');
    else {
      try {
        new RegExp(def.regex);
      } catch {
        add('a expressão regular é inválida');
      }
    }
  }

  if (def.defaultValue !== undefined && def.defaultValue !== null) {
    const problemas = validateValue(def, def.defaultValue);
    for (const p of problemas) add(`valor padrão inválido: ${p.message}`);
  }

  return issues;
}

/** Um valor isolado contra sua definição. Não trata obrigatoriedade. */
function validateValue(def: CustomFieldDefinition, value: unknown): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const add = (message: string) => issues.push({ key: def.key, message: `${def.label}: ${message}` });

  switch (def.kind) {
    case 'text': {
      if (typeof value !== 'string') return [{ key: def.key, message: `${def.label}: esperado texto` }];
      if (def.min != null && value.length < def.min) add(`precisa de ao menos ${def.min} caracteres`);
      if (def.max != null && value.length > def.max) add(`passa de ${def.max} caracteres`);
      if (def.regex != null && !new RegExp(def.regex).test(value)) add('não está no formato esperado');
      break;
    }
    case 'number':
    case 'currency': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return [{ key: def.key, message: `${def.label}: esperado número` }];
      }
      if (def.min != null && value < def.min) add(`não pode ser menor que ${def.min}`);
      if (def.max != null && value > def.max) add(`não pode ser maior que ${def.max}`);
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') add('esperado verdadeiro ou falso');
      break;
    case 'date':
      if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
        add('esperada data no formato AAAA-MM-DD');
      }
      break;
    case 'select':
      if (typeof value !== 'string') add('esperada uma opção');
      else if (!def.options?.includes(value)) add(`"${value}" não está entre as opções`);
      break;
    case 'multi_select': {
      if (!Array.isArray(value)) {
        return [{ key: def.key, message: `${def.label}: esperada uma lista de opções` }];
      }
      const fora = value.filter((v) => typeof v !== 'string' || !def.options?.includes(v));
      if (fora.length > 0) add(`opções fora da lista: ${fora.join(', ')}`);
      if (new Set(value).size !== value.length) add('há opções repetidas');
      break;
    }
    case 'user':
    case 'asset':
      // Referência a outra entidade. Aqui só a forma; a existência é verificada
      // no banco por chave estrangeira, que é onde a resposta é confiável.
      if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) add('esperado um identificador');
      break;
    case 'url':
      if (typeof value !== 'string') {
        add('esperado um endereço');
      } else {
        try {
          const u = new URL(value);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') add('o endereço precisa ser http ou https');
        } catch {
          add('o endereço não é válido');
        }
      }
      break;
  }
  return issues;
}

/**
 * Avalia `appliesWhen` contra o registro que está sendo salvo.
 *
 * Formato deliberadamente pobre: igualdade, ou pertencimento quando o valor
 * esperado é lista. `{ "asset_category_id": "abc" }` ou
 * `{ "work_order_type_id": ["a", "b"] }`. Uma linguagem de condição mais rica
 * aqui viraria um motor de regras que ninguém consegue depurar pela interface —
 * e a condição composta de verdade é assunto do EPIC-024, com simulação antes
 * de ativar.
 */
export function fieldApplies(def: CustomFieldDefinition, record: Readonly<Record<string, unknown>>): boolean {
  if (!def.appliesWhen) return true;
  for (const [campo, esperado] of Object.entries(def.appliesWhen)) {
    const atual = record[campo];
    if (Array.isArray(esperado)) {
      if (!esperado.includes(atual as never)) return false;
    } else if (atual !== esperado) {
      return false;
    }
  }
  return true;
}

export interface ValidationOutcome {
  readonly issues: readonly FieldIssue[];
  /** Valores aceitos, já com padrões aplicados e campos não aplicáveis removidos. */
  readonly values: Record<string, unknown>;
}

/**
 * Valida o conjunto de valores personalizados de um registro.
 *
 * Três decisões que valem ser ditas:
 *
 * 1. **Chave desconhecida é erro, não é ignorada em silêncio.** Aceitar e
 *    descartar faria a pessoa achar que salvou. Aceitar e guardar traria de
 *    volta o `jsonb` livre que o ADR-009 recusa.
 * 2. **Campo não aplicável é removido**, não zerado nem mantido. Se a natureza
 *    da OS mudou e o campo deixou de valer, o valor antigo pendurado ali
 *    apareceria em relatório como se ainda significasse algo.
 * 3. **Obrigatório só é exigido se for aplicável.** Exigir campo que a
 *    condição desligou é o defeito clássico de formulário condicional.
 */
export function validateCustomValues(
  definitions: readonly CustomFieldDefinition[],
  input: Readonly<Record<string, unknown>>,
  record: Readonly<Record<string, unknown>> = {}
): ValidationOutcome {
  const issues: FieldIssue[] = [];
  const values: Record<string, unknown> = {};
  const conhecidas = new Map(definitions.map((d) => [d.key, d]));

  for (const chave of Object.keys(input)) {
    if (!conhecidas.has(chave)) {
      issues.push({ key: chave, message: `campo "${chave}" não existe nesta organização` });
    }
  }

  for (const def of definitions) {
    if (!fieldApplies(def, record)) continue;

    const bruto = input[def.key];
    const ausente = bruto === undefined || bruto === null || bruto === '';
    const valor = ausente ? def.defaultValue : bruto;

    if (valor === undefined || valor === null || valor === '') {
      if (def.required) issues.push({ key: def.key, message: `${def.label} é obrigatório` });
      continue;
    }

    const problemas = validateValue(def, valor);
    if (problemas.length > 0) issues.push(...problemas);
    else values[def.key] = valor;
  }

  return { issues, values };
}
