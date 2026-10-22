/**
 * Aurora — motor de automações (SPEC v0.2 §24 · EPIC-024).
 *
 * Os "Robôs" da referência têm 2 modelos, 2 gatilhos e 1 ação real. O problema
 * não é o tamanho: é que uma automação que só sabe fazer uma coisa obriga a
 * organização a pedir desenvolvimento para cada regra nova, e o resultado é que
 * ninguém pede — o trabalho continua sendo feito à mão.
 *
 * Aqui a regra é DADO: gatilho, árvore de condições e lista ordenada de ações.
 *
 * AS SALVAGUARDAS SÃO O PRODUTO
 *   Um motor de regras sem freio é a maneira mais rápida de um sistema perder a
 *   confiança de quem o usa: basta uma regra mal escrita para a equipe inteira
 *   receber trezentos e-mails numa tarde, e depois disso ninguém mais liga
 *   automação nenhuma. Por isso quatro coisas são obrigatórias e não opcionais:
 *   sem recursão, limite por janela, simulação antes de ativar, e log de
 *   execução. Sem o log, automação é caixa-preta — e caixa-preta que age
 *   sozinha no sistema é o que faz o operador desconfiar do próprio dado.
 */
import { REPORT_TIERS, reportSelectionProblem, type ReportTier } from './report-tiers';

/* -------------------------------------------------------------------------- */
/* gatilhos                                                                    */
/* -------------------------------------------------------------------------- */

export const TRIGGER_KINDS = ['event', 'schedule', 'condition_watch'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/* -------------------------------------------------------------------------- */
/* condições                                                                   */
/* -------------------------------------------------------------------------- */

export const OPERATORS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
  'missing',
  'contains',
] as const;
export type Operator = (typeof OPERATORS)[number];

export interface Comparison {
  readonly field: string;
  readonly op: Operator;
  readonly value?: unknown;
}

export interface AllNode {
  readonly all: readonly ConditionNode[];
}
export interface AnyNode {
  readonly any: readonly ConditionNode[];
}
export type ConditionNode = Comparison | AllNode | AnyNode;

function isAll(n: ConditionNode): n is AllNode {
  return Array.isArray((n as AllNode).all);
}
function isAny(n: ConditionNode): n is AnyNode {
  return Array.isArray((n as AnyNode).any);
}

/**
 * Lê um campo do fato, aceitando caminho com ponto.
 *
 * `payload.priority` e `priority` devem chegar ao mesmo lugar quando o fato
 * traz o payload embutido — quem escreve a regra pensa no campo, não na forma
 * como o motor empacotou o evento.
 */
export function readField(facts: Readonly<Record<string, unknown>>, path: string): unknown {
  let atual: unknown = facts;
  for (const parte of path.split('.')) {
    if (atual === null || typeof atual !== 'object') return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

/**
 * Avalia uma comparação.
 *
 * Duas decisões que valem ser ditas:
 *
 * **`eq` compara valores, não tipos.** O payload de um evento chega do banco
 * com números virando texto, e uma regra que diz `prioridade = 3` deixaria de
 * funcionar em silêncio se a comparação fosse estrita. Silêncio é a pior falha
 * possível numa automação: ninguém percebe que ela parou.
 *
 * **Campo ausente NUNCA satisfaz uma comparação**, exceto `missing`. Uma regra
 * que diz "cliente ∈ [X, Y]" não deve disparar para um evento sem cliente, e
 * `undefined == undefined` faria exatamente isso.
 */
export function evaluateComparison(facts: Readonly<Record<string, unknown>>, c: Comparison): boolean {
  const valor = readField(facts, c.field);

  if (c.op === 'exists') return valor !== undefined && valor !== null;
  if (c.op === 'missing') return valor === undefined || valor === null;
  if (valor === undefined || valor === null) return false;

  const texto = (v: unknown): string => String(v).toLowerCase();
  const numero = (v: unknown): number => Number(v);

  switch (c.op) {
    case 'eq':
      return texto(valor) === texto(c.value);
    case 'neq':
      return texto(valor) !== texto(c.value);
    case 'in':
      return Array.isArray(c.value) && c.value.some((v) => texto(v) === texto(valor));
    case 'not_in':
      return Array.isArray(c.value) && !c.value.some((v) => texto(v) === texto(valor));
    case 'contains':
      return texto(valor).includes(texto(c.value));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = numero(valor);
      const b = numero(c.value);
      // Comparação de grandeza sobre coisa que não é número não é falsa: é
      // pergunta sem sentido. Devolver `false` esconderia a regra mal escrita.
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return c.op === 'gt' ? a > b : c.op === 'gte' ? a >= b : c.op === 'lt' ? a < b : a <= b;
    }
    default:
      return false;
  }
}

/**
 * Avalia a árvore inteira.
 *
 * `all` vazio é VERDADEIRO e `any` vazio é FALSO — as identidades de cada
 * operação. Uma regra sem condição nenhuma (`{ all: [] }`) dispara sempre, que
 * é o comportamento esperado de "sem filtro"; um `any` vazio nunca dispara, o
 * que faz a regra incompleta ficar inerte em vez de sair atirando.
 */
export function evaluateConditions(
  facts: Readonly<Record<string, unknown>>,
  node: ConditionNode | null
): boolean {
  if (node === null) return true;
  if (isAll(node)) return node.all.every((n) => evaluateConditions(facts, n));
  if (isAny(node)) return node.any.some((n) => evaluateConditions(facts, n));
  return evaluateComparison(facts, node);
}

/** Valida a forma da árvore antes de gravar — regra torta não vai para o banco. */
export function validateConditions(node: unknown, path = 'conditions'): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node !== 'object') return [`${path}: condição deve ser um objeto`];

  const n = node as Record<string, unknown>;

  if (Array.isArray(n.all) || Array.isArray(n.any)) {
    const filhos = (n.all ?? n.any) as unknown[];
    const rotulo = Array.isArray(n.all) ? 'all' : 'any';
    return filhos.flatMap((f, i) => validateConditions(f, `${path}.${rotulo}[${i}]`));
  }

  const erros: string[] = [];
  if (typeof n.field !== 'string' || n.field.length === 0) {
    erros.push(`${path}: "field" é obrigatório`);
  }
  if (typeof n.op !== 'string' || !OPERATORS.includes(n.op as Operator)) {
    erros.push(`${path}: "op" deve ser um de: ${OPERATORS.join(', ')}`);
  }
  if ((n.op === 'in' || n.op === 'not_in') && !Array.isArray(n.value)) {
    erros.push(`${path}: "${String(n.op)}" exige uma lista em "value"`);
  }
  return erros;
}

/* -------------------------------------------------------------------------- */
/* ações                                                                       */
/* -------------------------------------------------------------------------- */

export const ACTION_KINDS = [
  'notify',
  'assign',
  'change_status',
  'add_comment',
  'create_work_order',
  // Reunião 16/10/2026 (Fase 10): ações das regras AGENDADAS.
  'send_report',
  'reminder',
  'create_task',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface ActionDefinition {
  readonly kind: ActionKind;
  readonly label: string;
  /** Parâmetros obrigatórios. */
  readonly required: readonly string[];
  /** A permissão que o ator de sistema precisa carregar para executá-la. */
  readonly permission: string;
  /**
   * Em que espécie de gatilho a ação faz sentido. As ações que agem SOBRE a OS
   * do evento (atribuir, mudar situação, comentar) não têm OS nenhuma numa
   * regra de relógio — aceitá-las seria a regra que falha calada toda semana.
   */
  readonly triggers: readonly TriggerKind[];
}

/**
 * As ações implementadas.
 *
 * A lista do §24 é maior, e o que ficou de fora ficou por razão, não por
 * pressa: `call_webhook` faz chamada externa e exige lista de destinos
 * autorizados e revisão de segurança própria; `escalate` depende de agendador
 * durável; `issue_document` e `create_service_request` entram junto com o
 * consumidor que os justifique. Declarar uma ação que não funciona seria pior
 * que não ter: a organização montaria a regra e ela falharia calada.
 */
export const ACTIONS: readonly ActionDefinition[] = Object.freeze([
  {
    kind: 'notify',
    label: 'Notificar',
    required: ['audience'],
    permission: 'work_order.read',
    triggers: ['event'],
  },
  {
    kind: 'assign',
    label: 'Atribuir',
    required: [],
    permission: 'work_order.assign',
    triggers: ['event'],
  },
  {
    kind: 'change_status',
    label: 'Mudar situação',
    required: ['statusKey'],
    permission: 'work_order.update',
    triggers: ['event'],
  },
  {
    kind: 'add_comment',
    label: 'Comentar',
    required: ['text'],
    // Comentar é editar a OS: não existe permissão própria para comentário, e
    // inventar uma aqui criaria uma chave que o RBAC não conhece — a ação
    // ficaria permanentemente sem poder executar, calada.
    permission: 'work_order.update',
    triggers: ['event'],
  },
  {
    kind: 'create_work_order',
    label: 'Abrir OS',
    required: ['workOrderTypeId', 'title'],
    permission: 'work_order.create',
    // A OS aberta pelo relógio cai no quadro de OS existente: é a tarefa
    // operacional com correspondência real no Kanban (Fase 10).
    triggers: ['event', 'schedule'],
  },
  {
    kind: 'send_report',
    label: 'Enviar relatório',
    required: ['recipients', 'tier'],
    permission: 'insight.read',
    triggers: ['schedule'],
  },
  {
    kind: 'reminder',
    label: 'Lembrete',
    required: ['recipients', 'title'],
    permission: 'automation.read',
    // Por relógio (lembrete periódico) ou por evento (aviso imediato, p.ex. OS aguardando peça).
    triggers: ['schedule', 'event'],
  },
  {
    kind: 'create_task',
    label: 'Criar tarefa (tarefa, 5W2H, PDCA)',
    required: ['method', 'title', 'ownerMembershipId'],
    permission: 'automation.read',
    triggers: ['schedule'],
  },
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Períodos nomeados do relatório agendado. Sem `periodo`, vale `periodDays`
 * (últimos N dias até a passada) — as regras antigas não mudam.
 */
export const REPORT_PERIODS = ['mes_anterior'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** Checagens de forma das ações novas — além do "obrigatório" genérico. */
function validarParametros(kind: string, p: Record<string, unknown>, path: string): string[] {
  const erros: string[] = [];
  if (kind === 'send_report' || kind === 'reminder') {
    const r = p.recipients;
    if (
      !Array.isArray(r) ||
      r.length === 0 ||
      r.length > 50 ||
      !r.every((x) => typeof x === 'string' && UUID.test(x))
    ) {
      erros.push(`${path}: "recipients" é uma lista de 1 a 50 pessoas (vínculos)`);
    }
  }
  if (kind === 'send_report') {
    const tierValido = (REPORT_TIERS as readonly string[]).includes(String(p.tier));
    if (!tierValido) {
      erros.push(`${path}: "tier" é basic, advanced ou expert`);
    }
    /*
     * Período: "os últimos N dias até a passada" (`periodDays`, o de sempre) OU
     * o MÊS CIVIL anterior no fuso da organização (`periodo: 'mes_anterior'`,
     * pente-fino 17/10/2026, PF-52). Os dois juntos seriam ambíguos.
     */
    if (p.periodo !== undefined && p.periodo !== null && !REPORT_PERIODS.includes(p.periodo as never)) {
      erros.push(`${path}: "periodo" é ${REPORT_PERIODS.join(' ou ')}`);
    }
    if (p.periodo === 'mes_anterior' && p.periodDays !== undefined && p.periodDays !== null) {
      erros.push(`${path}: use "periodDays" ou "periodo", não os dois`);
    }
    const dias = p.periodDays === undefined || p.periodDays === null ? 30 : Number(p.periodDays);
    if (!Number.isInteger(dias) || dias < 1 || dias > 366) {
      erros.push(`${path}: "periodDays" é de 1 a 366`);
    }
    /*
     * A lista de indicadores é conferida AO SALVAR, com a mesma regra do
     * relatório sob demanda (pente-fino 17/10/2026): fora do modelo ou
     * aguardando definição era aceito aqui e só falhava na execução — a regra
     * ficava "ligada" e falhando todo mês.
     */
    if (p.indicators !== undefined && p.indicators !== null) {
      const lista = p.indicators;
      if (
        !Array.isArray(lista) ||
        lista.length > 50 ||
        !lista.every((x) => typeof x === 'string' && x.length > 0)
      ) {
        erros.push(`${path}: "indicators" é uma lista de até 50 códigos de indicador`);
      } else if (tierValido && lista.length > 0) {
        const problema = reportSelectionProblem(p.tier as ReportTier, lista as string[]);
        if (problema) erros.push(`${path}: ${problema}`);
      }
    }
    for (const k of ['customerId', 'sectorId', 'assetCategoryId']) {
      if (p[k] !== undefined && p[k] !== null && (typeof p[k] !== 'string' || !UUID.test(p[k] as string))) {
        erros.push(`${path}: "${k}" inválido`);
      }
    }
  }
  if (kind === 'create_task') {
    if (!['task', '5w2h', 'pdca'].includes(String(p.method))) {
      erros.push(`${path}: "method" é task, 5w2h ou pdca`);
    }
    if (typeof p.ownerMembershipId === 'string' && !UUID.test(p.ownerMembershipId)) {
      erros.push(`${path}: "ownerMembershipId" inválido`);
    }
    const prazo = p.dueInDays === undefined ? 7 : Number(p.dueInDays);
    if (!Number.isInteger(prazo) || prazo < 0 || prazo > 365) {
      erros.push(`${path}: "dueInDays" é de 0 a 365`);
    }
    if (p.method === '5w2h') {
      for (const k of ['why', 'where', 'how']) {
        if (typeof p[k] !== 'string' || (p[k] as string).trim() === '') {
          erros.push(`${path}: o 5W2H exige "${k}"`);
        }
      }
      if (
        p.howMuch !== undefined &&
        p.howMuch !== null &&
        !/^\d{1,12}(,\d{1,2}|\.\d{1,2})?$/.test(String(p.howMuch))
      ) {
        erros.push(`${path}: "howMuch" é valor em reais, como 1500,00`);
      }
    }
  }
  return erros;
}

/** As ações da regra cabem na espécie de gatilho dela? */
export function validateActionsForTrigger(
  trigger: TriggerKind,
  actions: ReadonlyArray<{ kind?: unknown }>
): string[] {
  const erros = actions.flatMap((a, i) => {
    const def = typeof a.kind === 'string' ? actionDefinition(a.kind) : undefined;
    if (!def || def.triggers.includes(trigger)) return [];
    return [
      `actions[${i}]: "${def.label}" não se aplica a gatilho ${trigger === 'schedule' ? 'agendado' : 'de evento'}`,
    ];
  });
  /*
   * UMA tarefa por execução (pente-fino 17/10/2026). A ocorrência é a chave da
   * tarefa (`automation_tasks`: regra + horário, 0067). Duas ações "criar tarefa"
   * na mesma regra batiam nessa unicidade em TODA execução: a primeira tarefa
   * ficava, a segunda falhava, e a regra aparecia como falha para sempre.
   */
  if (actions.filter((a) => a.kind === 'create_task').length > 1) {
    erros.push('uma regra cria no máximo uma tarefa por execução; use uma regra para cada tarefa');
  }
  return erros;
}

export function actionDefinition(kind: string): ActionDefinition | undefined {
  return ACTIONS.find((a) => a.kind === kind);
}

export interface ActionSpec {
  readonly kind: ActionKind;
  readonly params: Readonly<Record<string, unknown>>;
}

export function validateAction(action: unknown, path = 'action'): string[] {
  if (action === null || typeof action !== 'object') return [`${path}: ação deve ser um objeto`];
  const a = action as { kind?: unknown; params?: unknown };

  const def = typeof a.kind === 'string' ? actionDefinition(a.kind) : undefined;
  if (!def) {
    return [`${path}: ação desconhecida; disponíveis: ${ACTIONS.map((x) => x.kind).join(', ')}`];
  }

  const params = (a.params ?? {}) as Record<string, unknown>;
  const faltando = def.required
    .filter((r) => params[r] === undefined || params[r] === null || params[r] === '')
    .map((r) => `${path}: "${r}" é obrigatório para a ação ${def.kind}`);
  return faltando.length > 0 ? faltando : validarParametros(def.kind, params, path);
}

/* -------------------------------------------------------------------------- */
/* salvaguardas                                                                */
/* -------------------------------------------------------------------------- */

/** Profundidade máxima de cadeia causal (§24) — a mesma do barramento. */
export const MAX_CHAIN_DEPTH = 3;

/**
 * A regra pode reagir a este evento?
 *
 * Duas travas, e as duas importam por motivos diferentes:
 *
 * **Não reage ao que ela mesma causou.** Sem isso, uma regra que comenta ao
 * mudar de situação e outra que muda de situação ao comentar giram para sempre
 * — e o primeiro sinal seria a fatura do banco de dados.
 *
 * **Não reage abaixo de certa profundidade.** Mesmo sem laço direto, cadeias
 * longas de automação encadeada produzem efeitos que ninguém consegue explicar
 * olhando o resultado. Três degraus é o que cabe na cabeça de quem depura.
 */
export function canReact(
  ruleId: string,
  event: { causedByRuleId?: string | null; causationDepth?: number }
): { ok: boolean; reason: 'ok' | 'self_caused' | 'too_deep' } {
  if (event.causedByRuleId && event.causedByRuleId === ruleId) {
    return { ok: false, reason: 'self_caused' };
  }
  if ((event.causationDepth ?? 0) >= MAX_CHAIN_DEPTH) {
    return { ok: false, reason: 'too_deep' };
  }
  return { ok: true, reason: 'ok' };
}

export interface RateLimit {
  /** Execuções permitidas na janela. */
  readonly max: number;
  readonly windowMinutes: number;
}

export const DEFAULT_RATE_LIMIT: RateLimit = Object.freeze({ max: 100, windowMinutes: 60 });

export interface QuarantineDecision {
  readonly allowed: boolean;
  readonly shouldQuarantine: boolean;
  readonly detail: string | null;
}

/**
 * A regra estourou o limite da janela?
 *
 * Quem estoura entra em QUARENTENA em vez de continuar sendo barrada em
 * silêncio. A diferença é a mesma de sempre entre um sistema que se explica e
 * um que não: uma regra barrada silenciosamente parece funcionar e não
 * funciona; uma regra em quarentena aparece na tela com o motivo, e alguém
 * decide se corrige ou desliga.
 */
export function checkRateLimit(
  executionsInWindow: number,
  limit: RateLimit = DEFAULT_RATE_LIMIT
): QuarantineDecision {
  if (executionsInWindow < limit.max) {
    return { allowed: true, shouldQuarantine: false, detail: null };
  }
  return {
    allowed: false,
    shouldQuarantine: true,
    detail: `a regra executou ${executionsInWindow} vezes em ${limit.windowMinutes} minutos, acima do limite de ${limit.max}`,
  };
}

export interface SimulationResult {
  readonly matched: number;
  readonly evaluated: number;
  /** Frase pronta para a tela de ativação. */
  readonly summary: string;
  /** A regra inundaria a caixa de entrada se ativada? */
  readonly floodRisk: boolean;
}

/** Acima disto em 30 dias, ativar sem olhar é inundar a equipe. */
export const FLOOD_THRESHOLD = 200;

/**
 * O resultado da simulação obrigatória antes de ativar (§24).
 *
 * A frase é o produto aqui, não o número: "esta regra teria disparado 412 vezes
 * nos últimos 30 dias" é o que impede a regra que inunda a caixa de entrada de
 * toda a equipe — e é impossível de ignorar, ao contrário de um contador
 * pequeno num canto da tela.
 */
export function summarizeSimulation(matched: number, evaluated: number, days = 30): SimulationResult {
  const risco = matched >= FLOOD_THRESHOLD;
  const base = `esta regra teria disparado ${matched} vez(es) nos últimos ${days} dias, sobre ${evaluated} evento(s) avaliado(s)`;
  return {
    matched,
    evaluated,
    floodRisk: risco,
    summary: risco
      ? `${base} — volume alto: confira as condições antes de ativar`
      : matched === 0
        ? `${base}. Nenhum evento correspondeu: a regra pode estar filtrando demais`
        : base,
  };
}
