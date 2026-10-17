/**
 * Aurora — ordens de serviço: categorias, situações e motivos de espera.
 * SPEC v0.2 §09, §10, ADR-003, ADR-004 · EPIC-008
 *
 * ADR-003 — A DECISÃO QUE DESFAZ OS 42 ESTADOS DA REFERÊNCIA
 *
 * Lá, o motivo do bloqueio foi codificado dentro do estado: "Aguardando peças",
 * "Aguardando aprovação do orçamento", "Aguardando liberação da unidade",
 * "Aguardando empresa externa", "Aguardando NF para envio"… Cada combinação de
 * situação e causa virou um estado novo, e a lista explodiu.
 *
 * Aqui são três eixos independentes:
 *
 *   CATEGORIA      fixa na plataforma, nunca editável. É o que o software sabe
 *                  interpretar: se conta como ativo, se o relógio corre, se o
 *                  equipamento está parado.
 *   SITUAÇÃO       configurável pela organização, declarando uma categoria. É o
 *                  vocabulário do cliente.
 *   MOTIVO DE ESPERA  dimensão separada (ADR-004), só faz sentido na categoria
 *                  `waiting`. Diz POR QUE está parado e quem destrava.
 *
 * O ganho não é estético. Com o motivo separado dá para perguntar "quanto tempo
 * perdemos esperando peça?" — pergunta que, na referência, exigiria somar
 * estados escritos de cinco formas diferentes.
 */

/* -------------------------------------------------------------------------- */
/* categorias — fixas                                                          */
/* -------------------------------------------------------------------------- */

export const STATUS_CATEGORIES = [
  'draft',
  'open',
  'scheduled',
  'in_progress',
  'waiting',
  'review',
  'done',
  'closed',
  'cancelled',
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export interface CategorySemantics {
  /** Conta como trabalho em andamento na carteira. */
  readonly active: boolean;
  /** O relógio de resolução corre nesta categoria. */
  readonly slaRunning: boolean;
  /** Em `waiting`, quem decide é o motivo — por isso o valor é `null`. */
  readonly assetDown: boolean | null;
  /** Estado do qual não se sai sem permissão especial. */
  readonly terminal: boolean;
}

/**
 * A semântica de cada categoria, declarada uma vez.
 *
 * Isto é o que a plataforma sabe fazer com uma situação que ela nunca viu: uma
 * organização pode criar "Aguardando peça importada", e o produto continua
 * sabendo que o relógio corre e o ativo está parado, porque a categoria diz.
 */
export const CATEGORY_SEMANTICS: Readonly<Record<StatusCategory, CategorySemantics>> = Object.freeze({
  draft: { active: false, slaRunning: false, assetDown: false, terminal: false },
  open: { active: true, slaRunning: true, assetDown: null, terminal: false },
  scheduled: { active: true, slaRunning: true, assetDown: null, terminal: false },
  in_progress: { active: true, slaRunning: true, assetDown: true, terminal: false },
  // Em `waiting` o relógio depende do MOTIVO, não da categoria — é o ponto
  // inteiro do ADR-004. `slaRunning: true` aqui é o padrão que o motivo pode
  // derrubar; ver `slaRunsIn`.
  waiting: { active: true, slaRunning: true, assetDown: true, terminal: false },
  review: { active: true, slaRunning: false, assetDown: false, terminal: false },
  done: { active: false, slaRunning: false, assetDown: false, terminal: false },
  closed: { active: false, slaRunning: false, assetDown: false, terminal: true },
  cancelled: { active: false, slaRunning: false, assetDown: false, terminal: true },
});

/**
 * O relógio de resolução corre?
 *
 * Assinatura com o motivo junto porque em `waiting` a categoria sozinha não
 * responde. Ter uma função em vez de ler `CATEGORY_SEMANTICS.slaRunning` direto
 * impede o erro de esquecer o motivo — que produziria um SLA que nunca pausa.
 */
export function slaRunsIn(category: StatusCategory, waitPausesSla = false): boolean {
  if (category === 'waiting') return !waitPausesSla;
  return CATEGORY_SEMANTICS[category].slaRunning;
}

export function isActiveCategory(category: StatusCategory): boolean {
  return CATEGORY_SEMANTICS[category].active;
}

export function isTerminalCategory(category: StatusCategory): boolean {
  return CATEGORY_SEMANTICS[category].terminal;
}

/* -------------------------------------------------------------------------- */
/* situações de fábrica                                                        */
/* -------------------------------------------------------------------------- */

export interface StatusDefinition {
  readonly key: string;
  readonly label: string;
  readonly category: StatusCategory;
  readonly color: string;
  readonly position: number;
  /**
   * Exigir motivo é propriedade da SITUAÇÃO, não da categoria.
   *
   * "Pausada" e "Aguardando" têm a mesma categoria — mesma semântica de SLA e de
   * parada do ativo —, mas pausar é interrupção interna, sem dependência externa
   * a nomear. Exigir motivo ali obrigaria a inventar um, e motivo inventado
   * envenena o relatório que o ADR-004 existe para produzir.
   */
  readonly requiresWaitReason?: boolean;
  /** Coluna no quadro. Ausente = sim. */
  readonly visibleOnBoard?: boolean;
  /**
   * Como esta situação aparece no PORTAL do cliente (SPEC §19).
   *
   * Nasce aqui e não só na migration porque toda organização nova provisiona
   * as situações de fábrica: semear o rótulo apenas na migration daria
   * vocabulário de cliente às organizações que já existiam e deixaria as
   * futuras sem nenhum — e o portal delas mostraria a palavra da equipe.
   *
   * Ausente é deliberado em `draft`: uma OS em rascunho ainda não é
   * compromisso com ninguém, e a consulta do portal exclui quem não tem
   * rótulo.
   */
  readonly customerLabel?: string;
}

/** Reproduz a tabela de situações padrão da SPEC §10, sem acrescentar nada. */
export const FACTORY_STATUSES: readonly StatusDefinition[] = Object.freeze([
  // `draft` sem `customerLabel`: rascunho não é compromisso, e o portal o exclui.
  // Fora do quadro desde 16/10/2026: o cliente pediu que "rascunho" deixasse de
  // existir como conceito visível. A situação continua no grafo para o histórico.
  {
    key: 'draft',
    label: 'Rascunho',
    category: 'draft',
    color: '#9aa0a6',
    position: 0,
    visibleOnBoard: false,
  },
  {
    key: 'open',
    label: 'Aberta',
    category: 'open',
    color: '#1a73e8',
    position: 1,
    customerLabel: 'Recebido',
  },
  {
    key: 'scheduled',
    label: 'Agendada',
    category: 'scheduled',
    color: '#7b1fa2',
    position: 2,
    customerLabel: 'Agendado',
  },
  {
    // Entre agendar e executar: a OS está sendo avaliada (diagnóstico, triagem
    // técnica) antes de alguém pôr a mão no equipamento. Categoria `open`:
    // conta como ativa, o relógio corre, e o ativo não é dado como parado só
    // por estar em análise.
    key: 'in_analysis',
    label: 'Em análise',
    category: 'open',
    color: '#b06000',
    position: 3,
    customerLabel: 'Em análise',
  },
  {
    key: 'in_progress',
    label: 'Em execução',
    category: 'in_progress',
    color: '#f9ab00',
    position: 4,
    customerLabel: 'Em atendimento',
  },
  {
    key: 'waiting',
    label: 'Aguardando',
    category: 'waiting',
    color: '#e8710a',
    position: 5,
    requiresWaitReason: true,
    // Só "Aguardando": o QUE se aguarda vem do motivo, que tem o rótulo dele.
    customerLabel: 'Aguardando',
  },
  {
    key: 'paused',
    label: 'Pausada',
    category: 'waiting',
    color: '#c5221f',
    position: 6,
    // "Pausada" é vocabulário de operação — para quem espera, o que está
    // acontecendo é análise.
    customerLabel: 'Em análise',
  },
  {
    key: 'completed',
    label: 'Concluída',
    category: 'review',
    color: '#188038',
    position: 7,
    customerLabel: 'Concluído',
  },
  {
    key: 'validated',
    label: 'Validada',
    category: 'done',
    color: '#0d652d',
    position: 8,
    // "Validada" é etapa nossa; para o cliente, concluído é concluído.
    customerLabel: 'Concluído',
  },
  {
    key: 'closed',
    label: 'Fechada',
    category: 'closed',
    color: '#3c4043',
    position: 9,
    customerLabel: 'Encerrado',
  },
  {
    key: 'cancelled',
    label: 'Cancelada',
    category: 'cancelled',
    color: '#5f6368',
    position: 10,
    customerLabel: 'Cancelado',
  },
  {
    // NEGADA (reunião 16/10/2026) não é cancelada: cancelar é desistir de um
    // trabalho; negar é recusar o atendimento (fora de cobertura, orçamento
    // reprovado, pedido indevido). Terminal, com motivo, e o cliente lê "Negado".
    key: 'denied',
    label: 'Negada',
    category: 'cancelled',
    color: '#a50e0e',
    position: 11,
    customerLabel: 'Negado',
  },
]);

/* -------------------------------------------------------------------------- */
/* motivos de espera de fábrica                                                */
/* -------------------------------------------------------------------------- */

export interface WaitReasonDefinition {
  readonly key: string;
  readonly label: string;
  readonly pausesSla: boolean;
  readonly responsible: 'customer' | 'supplier' | 'internal' | 'manager';
  /**
   * Como este motivo aparece no portal.
   *
   * Nenhuma frase NOMEIA fornecedor: dizer que há um terceiro envolvido é
   * verdade e é útil; quem é esse terceiro é informação comercial nossa, e a
   * SPEC §19 a lista entre o que não vaza.
   */
  readonly customerLabel?: string;
}

/**
 * Motivos de fábrica (SPEC §10).
 *
 * A decisão que vale sublinhar: **falta de peça NÃO pausa o SLA**. Falta de
 * peça é responsabilidade da organização, não do cliente, e um relógio que
 * pausa aí perdoaria o próprio atraso. A organização pode inverter por política
 * — `pauses_sla` é configurável —, mas o padrão de fábrica não perdoa.
 *
 * Cada linha aqui substitui várias da referência: `parts` cobre "Aguardando
 * peças" (789 OS), "Aguardando chegada das peças" (44), "AGUARDANDO PRODUTO" e
 * "PEÇA DISPONÍVEL P/ COLETA" — quatro estados que sempre significaram a mesma
 * coisa e nunca puderam ser somados.
 */
/**
 * Os motivos de espera de fábrica, com o rótulo que o cliente lê.
 *
 * DUAS COLUNAS DE TEXTO, e a diferença entre elas é o produto:
 *
 *   · `label` fala com a equipe: "Aguardando orçamento do fornecedor" diz
 *     exatamente onde o processo parou.
 *   · `customerLabel` fala com quem espera: "Aguardando orçamento de
 *     terceiro" diz a mesma verdade sem nomear com quem trabalhamos.
 *
 * A regra que governa o segundo texto é responder à única pergunta que o
 * cliente faz olhando para um chamado parado: "a bola é minha ou de vocês?".
 * "Aguardando sua aprovação" e "Aguardando você" respondem; "Aguardando"
 * sozinho transfere para a equipe a ligação de "e aí, como está?" — inclusive
 * quando a resposta é "esperando você".
 */
export const FACTORY_WAIT_REASONS: readonly WaitReasonDefinition[] = Object.freeze([
  {
    key: 'parts',
    label: 'Aguardando peça',
    pausesSla: false,
    responsible: 'internal',
    customerLabel: 'Aguardando peça',
  },
  {
    key: 'quote_approval',
    label: 'Aguardando aprovação de orçamento',
    pausesSla: true,
    responsible: 'customer',
    customerLabel: 'Aguardando sua aprovação',
  },
  {
    key: 'quote_preparation',
    label: 'Aguardando elaboração de orçamento',
    pausesSla: false,
    responsible: 'internal',
    customerLabel: 'Preparando orçamento',
  },
  {
    key: 'customer_response',
    label: 'Aguardando o cliente',
    pausesSla: true,
    responsible: 'customer',
    customerLabel: 'Aguardando você',
  },
  {
    key: 'asset_release',
    label: 'Aguardando liberação do equipamento',
    pausesSla: true,
    responsible: 'customer',
    customerLabel: 'Aguardando liberação do equipamento',
  },
  {
    key: 'external_service',
    label: 'Em serviço externo',
    pausesSla: false,
    responsible: 'supplier',
    customerLabel: 'Em serviço externo',
  },
  {
    key: 'external_quote',
    label: 'Aguardando orçamento do fornecedor',
    pausesSla: false,
    responsible: 'supplier',
    customerLabel: 'Aguardando orçamento de terceiro',
  },
  {
    key: 'warranty',
    label: 'Em acionamento de garantia',
    pausesSla: false,
    responsible: 'supplier',
    customerLabel: 'Em acionamento de garantia',
  },
  {
    key: 'internal_approval',
    label: 'Aguardando aprovação interna',
    pausesSla: false,
    responsible: 'internal',
    customerLabel: 'Em análise',
  },
  {
    key: 'scheduling',
    label: 'Aguardando janela de agendamento',
    pausesSla: true,
    responsible: 'customer',
    customerLabel: 'Aguardando janela para agendar',
  },
  {
    key: 'transport',
    label: 'Em deslocamento / transporte',
    pausesSla: false,
    responsible: 'internal',
    customerLabel: 'Em deslocamento',
  },
  {
    key: 'documentation',
    label: 'Aguardando documento fiscal',
    pausesSla: false,
    responsible: 'internal',
    customerLabel: 'Aguardando documento fiscal',
  },
  {
    key: 'calibration',
    label: 'Aguardando calibração',
    pausesSla: false,
    responsible: 'internal',
    customerLabel: 'Aguardando calibração',
  },
  {
    key: 'unrepairable',
    label: 'Sem reparo viável',
    pausesSla: true,
    responsible: 'manager',
    customerLabel: 'Sem reparo viável',
  },
]);

/* -------------------------------------------------------------------------- */
/* grafo de transições                                                         */
/* -------------------------------------------------------------------------- */

export interface TransitionDefinition {
  readonly from: string;
  readonly to: string;
  readonly permission: string;
  readonly requires?: readonly string[];
  readonly note: string;
}

/**
 * Transições de fábrica, reproduzindo a tabela da SPEC §10.
 *
 * `cancelled` é alcançável de qualquer situação ativa, e é gerado abaixo em vez
 * de escrito dez vezes — escrever à mão convidaria a esquecer uma situação
 * nova, e o esquecimento apareceria como "não consigo cancelar esta OS".
 */
const CORE_TRANSITIONS: readonly TransitionDefinition[] = [
  {
    from: 'draft',
    to: 'open',
    permission: 'work_order.update',
    requires: ['customer_id', 'location_id', 'work_order_type_id'],
    note: 'publica a OS: gera número e inicia o SLA',
  },
  {
    from: 'open',
    to: 'scheduled',
    permission: 'work_order.assign',
    requires: ['assignee', 'scheduled_start'],
    note: 'tem responsável e janela',
  },
  { from: 'open', to: 'in_progress', permission: 'work_order.execute', note: 'atendimento imediato' },
  { from: 'scheduled', to: 'in_progress', permission: 'work_order.execute', note: 'início do atendimento' },
  { from: 'scheduled', to: 'open', permission: 'work_order.schedule', note: 'desagendamento' },
  { from: 'open', to: 'in_analysis', permission: 'work_order.execute', note: 'início da análise' },
  { from: 'scheduled', to: 'in_analysis', permission: 'work_order.execute', note: 'início da análise' },
  { from: 'in_analysis', to: 'in_progress', permission: 'work_order.execute', note: 'análise concluída' },
  { from: 'in_analysis', to: 'scheduled', permission: 'work_order.schedule', note: 'volta para a agenda' },
  {
    from: 'in_progress',
    to: 'waiting',
    permission: 'work_order.execute',
    requires: ['wait_reason_id'],
    note: 'bloqueio por dependência externa',
  },
  { from: 'waiting', to: 'in_progress', permission: 'work_order.execute', note: 'desbloqueio' },
  {
    from: 'in_progress',
    to: 'paused',
    permission: 'work_order.execute',
    note: 'interrupção sem dependência externa',
  },
  { from: 'paused', to: 'in_progress', permission: 'work_order.execute', note: 'retomada' },
  {
    from: 'in_progress',
    to: 'completed',
    permission: 'work_order.complete',
    requires: ['resolution'],
    note: 'trabalho técnico terminado',
  },
  {
    from: 'completed',
    to: 'in_progress',
    permission: 'work_order.validate',
    requires: ['rework_reason'],
    note: 'reprovado na validação',
  },
  { from: 'completed', to: 'validated', permission: 'work_order.validate', note: 'aprovado internamente' },
  { from: 'validated', to: 'closed', permission: 'work_order.close', note: 'encerramento administrativo' },
  {
    from: 'closed',
    to: 'in_progress',
    permission: 'work_order.reopen',
    requires: ['reopen_reason'],
    note: 'reabertura com justificativa',
  },
];

/**
 * Situações a partir das quais cancelar faz sentido: todas as ativas, mais o
 * rascunho.
 *
 * `completed` entra na lista, e vale dizer por quê: a SPEC §10 diz "qualquer
 * ativo → cancelled", e `review` é categoria ativa. Parece estranho cancelar um
 * trabalho já executado — mas o caso real existe: a OS foi aberta em duplicata
 * e alguém executou as duas. Cancelar com motivo obrigatório é a forma honesta
 * de registrar isso; a alternativa, forçar a validar e fechar algo que não
 * deveria existir, sujaria todo indicador de produtividade.
 *
 * `validated` fica de fora: depois de aprovada, a saída é fechar ou reabrir.
 */
const CANCELLABLE_FROM = [
  'draft',
  'open',
  'scheduled',
  'in_analysis',
  'in_progress',
  'waiting',
  'paused',
  'completed',
] as const;

/** Situações a partir das quais se nega o atendimento: antes de executar, ou aguardando (orçamento). */
const DENIABLE_FROM = ['open', 'scheduled', 'in_analysis', 'waiting'] as const;

export const FACTORY_TRANSITIONS: readonly TransitionDefinition[] = Object.freeze([
  ...CORE_TRANSITIONS,
  ...DENIABLE_FROM.map((from) => ({
    from,
    to: 'denied',
    permission: 'work_order.cancel',
    requires: ['cancellation_reason'],
    note: 'atendimento negado, com motivo obrigatório',
  })),
  ...CANCELLABLE_FROM.map((from) => ({
    from,
    to: 'cancelled',
    permission: 'work_order.cancel',
    requires: ['cancellation_reason'],
    note: 'cancelamento com motivo obrigatório',
  })),
]);

/* -------------------------------------------------------------------------- */
/* avaliação de transição                                                      */
/* -------------------------------------------------------------------------- */

export interface StatusRef {
  readonly key: string;
  readonly label: string;
  readonly category: StatusCategory;
  readonly requiresWaitReason?: boolean;
}

export interface TransitionEvaluation {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly missing?: readonly string[];
  readonly allowedTargets: readonly string[];
}

export interface EvaluateInput {
  readonly from: StatusRef;
  readonly to: StatusRef;
  readonly graph: readonly TransitionDefinition[];
  readonly permissions: ReadonlySet<string>;
  readonly fields?: Readonly<Record<string, unknown>>;
}

/**
 * A transição é possível?
 *
 * O grafo vem de fora porque cada organização tem o seu (ADR-003) — a função é
 * o motor, não a regra. O que ela garante é uniforme: a mesma decisão vale na
 * API, no Kanban e no aplicativo de campo, e a recusa sempre nomeia as saídas
 * possíveis em vez de dizer "erro".
 */
export function evaluateTransition(input: EvaluateInput): TransitionEvaluation {
  const saidas = input.graph.filter((t) => t.from === input.from.key);
  const permitidas = saidas.filter((t) => input.permissions.has(t.permission)).map((t) => t.to);

  const regra = saidas.find((t) => t.to === input.to.key);
  if (!regra) {
    return {
      allowed: false,
      allowedTargets: permitidas,
      reason:
        saidas.length === 0
          ? `"${input.from.label}" é uma situação final; não há transição a partir dela`
          : `de "${input.from.label}" só é possível ir para: ${saidas.map((t) => t.to).join(', ')}`,
    };
  }

  if (!input.permissions.has(regra.permission)) {
    return {
      allowed: false,
      allowedTargets: permitidas,
      reason: `esta transição exige a permissão ${regra.permission}`,
    };
  }

  // Situação que exige motivo, sem motivo, é rejeitada aqui E por constraint no
  // banco (§10). Não é redundância: é a mesma regra valendo para dois caminhos
  // de escrita.
  const exigidos = [...(regra.requires ?? [])];
  if (input.to.requiresWaitReason && !exigidos.includes('wait_reason_id')) {
    exigidos.push('wait_reason_id');
  }

  const campos = input.fields ?? {};
  const faltando = exigidos.filter((f) => {
    const v = campos[f];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });
  if (faltando.length > 0) {
    return {
      allowed: false,
      allowedTargets: permitidas,
      reason: `a transição para "${input.to.label}" exige: ${faltando.join(', ')}`,
      missing: faltando,
    };
  }

  return { allowed: true, allowedTargets: permitidas };
}

/* -------------------------------------------------------------------------- */
/* bloco de conclusão                                                          */
/* -------------------------------------------------------------------------- */

export const COMPLETION_REQUIREMENTS = [
  'checklist_complete',
  'failed_items_have_photo',
  'hours_logged',
  'resolution_filled',
  'cause_code_filled',
  'photo_before_after',
  'customer_signature',
  'parts_confirmed',
] as const;
export type CompletionRequirement = (typeof COMPLETION_REQUIREMENTS)[number];

const REQUIREMENT_LABELS: Record<CompletionRequirement, string> = {
  checklist_complete: 'checklist preenchido por completo',
  failed_items_have_photo: 'foto de evidência nos itens reprovados',
  hours_logged: 'horas apontadas',
  resolution_filled: 'descrição da resolução',
  cause_code_filled: 'causa identificada',
  photo_before_after: 'fotos de antes e depois',
  customer_signature: 'assinatura do cliente',
  parts_confirmed: 'peças consumidas confirmadas',
};

export interface CompletionFacts {
  readonly checklistTotal: number;
  readonly checklistAnswered: number;
  readonly failedItemsWithoutPhoto: number;
  readonly loggedMinutes: number;
  readonly resolution: string | null;
  readonly causeFailureCodeId: string | null;
  readonly photosBefore: number;
  readonly photosAfter: number;
  readonly hasCustomerSignature: boolean;
  readonly partsPending: number;
}

export interface CompletionCheck {
  readonly ok: boolean;
  /** Cada pendência com o rótulo legível e a chave técnica. */
  readonly missing: ReadonlyArray<{ requirement: CompletionRequirement; label: string; detail: string }>;
}

/**
 * O guarda mais importante do sistema (SPEC §10).
 *
 * A regra de ouro está no critério de aceite: **nunca "Erro!"**. Cada
 * pendência volta nomeada e com o detalhe do que falta — porque quem está
 * lendo isso está de pé, ao lado do equipamento, tentando fechar a OS.
 */
export function checkCompletion(
  required: readonly CompletionRequirement[],
  facts: CompletionFacts
): CompletionCheck {
  const missing: Array<{ requirement: CompletionRequirement; label: string; detail: string }> = [];
  const falta = (requirement: CompletionRequirement, detail: string) =>
    missing.push({ requirement, label: REQUIREMENT_LABELS[requirement], detail });

  for (const r of required) {
    switch (r) {
      case 'checklist_complete':
        if (facts.checklistAnswered < facts.checklistTotal) {
          falta(
            r,
            `${facts.checklistTotal - facts.checklistAnswered} de ${facts.checklistTotal} itens sem resposta`
          );
        }
        break;
      case 'failed_items_have_photo':
        if (facts.failedItemsWithoutPhoto > 0) {
          falta(r, `${facts.failedItemsWithoutPhoto} item(ns) reprovado(s) sem foto`);
        }
        break;
      case 'hours_logged':
        if (facts.loggedMinutes <= 0) falta(r, 'nenhuma hora apontada nesta OS');
        break;
      case 'resolution_filled':
        if (!facts.resolution || facts.resolution.trim().length < 10) {
          falta(r, 'descreva em ao menos 10 caracteres o que foi feito');
        }
        break;
      case 'cause_code_filled':
        if (!facts.causeFailureCodeId) falta(r, 'selecione a causa identificada');
        break;
      case 'photo_before_after':
        if (facts.photosBefore === 0 && facts.photosAfter === 0) falta(r, 'nenhuma foto anexada');
        else if (facts.photosBefore === 0) falta(r, 'falta a foto de antes');
        else if (facts.photosAfter === 0) falta(r, 'falta a foto de depois');
        break;
      case 'customer_signature':
        if (!facts.hasCustomerSignature) falta(r, 'colha a assinatura do cliente');
        break;
      case 'parts_confirmed':
        if (facts.partsPending > 0) falta(r, `${facts.partsPending} peça(s) sem confirmação de consumo`);
        break;
    }
  }

  return { ok: missing.length === 0, missing };
}

/** Número visível da OS: série própria, separada da de solicitações. */
export function formatWorkOrderNumber(year: number, sequence: number): string {
  return `WO-${year}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Evento de domínio de uma transição.
 *
 * Derivado do PAR (origem, destino), e não só do destino. `in_progress` pode ser
 * alcançado de três lugares com significados diferentes: de `scheduled` é
 * início, de `waiting` é desbloqueio, de `closed` é reabertura. Publicar
 * `work_order.started` nos três casos faria a automação de "OS iniciada"
 * disparar toda vez que alguém destravasse uma peça.
 *
 * `null` quando o par não tem evento próprio no catálogo (§31) — pausar, por
 * exemplo, é registro interno e não notícia para o mundo de fora.
 */
export function eventForTransition(from: StatusRef, to: StatusRef): string | null {
  if (to.category === 'cancelled') return 'work_order.cancelled';
  if (to.category === 'closed') return 'work_order.closed';
  if (to.category === 'done') return 'work_order.validated';
  if (to.category === 'review') return 'work_order.completed';
  if (to.category === 'scheduled') return 'work_order.scheduled';
  if (to.category === 'open' && from.category === 'draft') return 'work_order.opened';

  if (to.category === 'in_progress') {
    if (from.category === 'waiting') return 'work_order.unblocked';
    if (from.category === 'closed') return 'work_order.reopened';
    if (from.category === 'review') return 'work_order.rework_requested';
    return 'work_order.started';
  }

  // `waiting` com motivo é bloqueio; sem motivo exigido é pausa, que não vira
  // notícia — quem pausa para almoçar não gera evento de domínio.
  if (to.category === 'waiting') {
    return to.requiresWaitReason ? 'work_order.blocked' : null;
  }

  return null;
}
