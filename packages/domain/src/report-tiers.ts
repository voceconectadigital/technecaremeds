/**
 * Aurora — CATÁLOGO CENTRAL de indicadores e modelos de RELATÓRIO
 * (BASIC / ADVANCED / EXPERT — reunião 16/10/2026; auditoria 17/10/2026).
 *
 * É a ÚNICA fonte de definição dos indicadores. O Painel, o relatório gerado e
 * o relatório agendado das automações leem daqui: nenhum dos três redefine
 * nome, unidade, sentido de meta ou situação.
 *
 * Modelos de relatório não são tipos de contrato.
 *
 *   · BASIC e ADVANCED compartilham indicadores — um indicador lista em `tiers`
 *     os modelos em que pode aparecer;
 *   · EXPERT NÃO herda o Basic nem o Advanced: o conjunto dele é o contratual
 *     do FHEMIG (IMR, 16 itens). Por isso `tiers` é uma lista explícita, e não
 *     um "nível mínimo".
 *
 * SITUAÇÃO (`state`)
 *
 *   · ACTIVE — definição segura; entra sozinho no relatório;
 *   · PROVISIONAL — o sistema calcula, mas a definição ainda não foi confirmada
 *     pelo cliente; só entra se for pedido explicitamente e sai marcado;
 *   · PENDING_DEFINITION — falta definição ou dado; NÃO entra em relatório
 *     (aparece só no catálogo, com o motivo). Nada aqui é inventado: a
 *     fórmula de um indicador pendente não existe no código.
 *
 * LAYOUT DOS PDFs (29/10/2026): o Advanced segue o modelo "Completo" do cliente, o
 * Basic usa o mesmo padrão visual (painel de cartões + gráficos de 12 meses; o
 * modelo Basic do cliente não foi enviado) e o Expert é a casca do IMR. Nenhum
 * deles sai mais com a faixa de "aguardando modelo".
 */
import { isRetired, type AssetStatus } from './assets';

export const REPORT_TIERS = ['basic', 'advanced', 'expert'] as const;
export type ReportTier = (typeof REPORT_TIERS)[number];

export const REPORT_TIER_LABEL: Record<ReportTier, string> = {
  basic: 'Basic',
  advanced: 'Advanced',
  expert: 'Expert',
};

export const INDICATOR_STATES = ['ACTIVE', 'PROVISIONAL', 'PENDING_DEFINITION'] as const;
export type IndicatorState = (typeof INDICATOR_STATES)[number];

export const TARGET_DIRECTIONS = ['HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'INFORMATIONAL'] as const;
export type TargetDirection = (typeof TARGET_DIRECTIONS)[number];

export type IndicatorUnit = 'count' | 'minutes' | 'hours' | 'percent' | 'score' | 'none';

export type IndicatorCategory =
  'volume' | 'time' | 'compliance' | 'quality' | 'service_level' | 'availability' | 'park' | 'contractual';

/** Por que um indicador pendente está pendente. */
export type PendingKind = 'DEFINITION' | 'DATA_MODEL';

/**
 * Situação legada do indicador, mantida na resposta da API porque os relatórios
 * agendados já gravados (`automation_report_outputs.sections`) e a tela de
 * tarefas a leem. Derivada de `state`; não é fonte de verdade.
 */
export type LegacyIndicatorStatus = 'available' | 'awaiting_official_model' | 'awaiting_definition';

export interface ReportIndicator {
  /** Código estável. Nunca é reutilizado nem renomeado. */
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly unit: IndicatorUnit;
  readonly category: IndicatorCategory;
  /** Modelos em que o indicador pode aparecer. Lista explícita: Expert não herda. */
  readonly tiers: readonly ReportTier[];
  readonly state: IndicatorState;
  readonly targetDirection: TargetDirection;
  /** Fonte de cálculo (função/tabela) — ou `null` quando não há cálculo. */
  readonly source: string | null;
  /** Só para `PENDING_DEFINITION`. */
  readonly pendingKind?: PendingKind;
  /** O que está faltando, ou como o número é lido hoje. */
  readonly note?: string;
  /**
   * Versão da fórmula (REL-07), quando difere da derivada da situação — ver `formulaInfo`.
   * Só se declara aqui quando a fórmula MUDOU depois de entrar no catálogo.
   */
  readonly formulaVersion?: string;
  /** Data (AAAA-MM-DD) em que a definição em uso entrou no catálogo, quando não é a da Fase 1. */
  readonly definedOn?: string;
  /** De onde veio a definição em uso, quando não é a da Fase 1. */
  readonly definitionSource?: string;
}

/* -------------------------------------------------------------------------- */
/* versionamento das fórmulas (REL-07, 29/10/2026)                              */
/* -------------------------------------------------------------------------- */

/**
 * A primeira versão do catálogo: reunião de 16/10/2026 e Fase 1 de indicadores (auditoria de
 * 17/10/2026). É a data e a fonte de toda definição que não declara outra.
 */
export const FORMULA_BASELINE_DATE = '2026-10-17';
export const FORMULA_BASELINE_SOURCE =
  'Catálogo de indicadores: reunião de 16/10/2026 e Fase 1 de indicadores (auditoria de 17/10/2026)';

/** Versão de quem ainda não tem fórmula: NADA é versionado como se existisse. */
export const FORMULA_VERSION_PENDING = 'pendente';

export interface FormulaInfo {
  /** `v1` (confirmada), `v1-provisoria` (calculada, a confirmar) ou `pendente` (sem fórmula). */
  version: string;
  /** Quando a definição em uso entrou no catálogo; nulo para pendente (não há definição). */
  definedOn: string | null;
  /** De onde veio a definição em uso — ou o que falta, para pendente. */
  source: string;
}

/**
 * A versão da fórmula de um indicador. Derivada da situação, a menos que o catálogo declare outra:
 *
 *   · ACTIVE → `v1`; PROVISIONAL → `v1-provisoria` (a conta existe, a definição do cliente não);
 *   · PENDING_DEFINITION → `pendente`, sem data — não há fórmula para versionar.
 *
 * Mudar a conta de um indicador é declarar `formulaVersion`, `definedOn` e `definitionSource`
 * no item; o relatório agendado guarda, em cada seção, a versão com que foi gerado.
 */
export function formulaInfo(i: ReportIndicator): FormulaInfo {
  if (i.state === 'PENDING_DEFINITION') {
    return { version: FORMULA_VERSION_PENDING, definedOn: null, source: 'Aguardando definição do cliente' };
  }
  return {
    version: i.formulaVersion ?? (i.state === 'PROVISIONAL' ? 'v1-provisoria' : 'v1'),
    definedOn: i.definedOn ?? FORMULA_BASELINE_DATE,
    source: i.definitionSource ?? FORMULA_BASELINE_SOURCE,
  };
}

/**
 * Situação do layout dos PDFs. Era `awaiting_official_model` até 29/10/2026 (REL-08), quando o
 * Basic ganhou o padrão visual do Advanced. O valor antigo continua só como `status` legado das
 * seções gravadas em relatórios agendados antigos.
 */
export const REPORT_LAYOUT_STATUS = 'layouts_defined' as const;

export function legacyStatusOf(state: IndicatorState): LegacyIndicatorStatus {
  return state === 'PENDING_DEFINITION' ? 'awaiting_definition' : 'available';
}

const BA: readonly ReportTier[] = ['basic', 'advanced'];
const A: readonly ReportTier[] = ['advanced'];
const BAE: readonly ReportTier[] = ['basic', 'advanced', 'expert'];
const BE: readonly ReportTier[] = ['basic', 'expert'];
const E: readonly ReportTier[] = ['expert'];

// Sem o nome do órgão: a nota aparece na tela de escolha do relatório (REL-16, 19/10/2026).
const IMR = 'Indicador do IMR — fórmula aguardando definição do cliente.';

export const REPORT_INDICATORS: readonly ReportIndicator[] = Object.freeze([
  // --- volume --------------------------------------------------------------
  {
    key: 'work_orders_opened',
    label: 'Chamados abertos (OS)',
    description: 'Ordens de serviço abertas no período.',
    unit: 'count',
    category: 'volume',
    tiers: BA,
    state: 'ACTIVE',
    targetDirection: 'INFORMATIONAL',
    source: 'metrics.workOrdersOpened',
  },
  {
    key: 'work_orders_completed',
    label: 'Chamados concluídos (OS)',
    description: 'Ordens de serviço concluídas no período (canceladas não contam).',
    unit: 'count',
    category: 'volume',
    tiers: BA,
    state: 'ACTIVE',
    targetDirection: 'INFORMATIONAL',
    source: 'metrics.workOrdersCompleted',
  },
  {
    key: 'opened_vs_closed',
    label: 'Chamados Abertos x Encerrados',
    description:
      'OS encerradas no período ÷ OS abertas no período × 100. Fluxos do período, não coorte: pode passar de 100 %. Não é o ICRS.',
    unit: 'percent',
    category: 'volume',
    tiers: A,
    state: 'ACTIVE',
    targetDirection: 'HIGHER_IS_BETTER',
    source: 'metrics.openedVsClosed',
    note: 'Auditoria 17/10, classe B: valores acima de 100 % do modelo oficial só são possíveis com fluxos do período.',
  },
  {
    key: 'work_order_evolution',
    label: 'Evolução dos chamados (abertos × concluídos)',
    description: 'Abertas e concluídas por fatia do período.',
    unit: 'none',
    category: 'volume',
    tiers: A,
    state: 'ACTIVE',
    targetDirection: 'INFORMATIONAL',
    source: 'painel.workOrderSeries',
  },
  {
    key: 'backlog',
    label: 'Backlog',
    description: 'OS ainda não concluídas na data de corte, por idade.',
    unit: 'count',
    category: 'volume',
    tiers: A,
    state: 'ACTIVE',
    targetDirection: 'LOWER_IS_BETTER',
    source: 'metrics.backlog',
  },
  {
    key: 'work_orders_by_status',
    label: 'OS por situação (agora)',
    description: 'OS abertas agora, por situação.',
    unit: 'count',
    category: 'volume',
    tiers: A,
    state: 'ACTIVE',
    targetDirection: 'INFORMATIONAL',
    source: 'painel.openWorkOrdersSnapshot',
  },
  {
    key: 'preventive_vs_corrective',
    label: 'Preventiva × corretiva',
    description: 'Mistura de OS concluídas entre preventiva e corretiva.',
    unit: 'none',
    category: 'volume',
    tiers: A,
    state: 'ACTIVE',
    targetDirection: 'INFORMATIONAL',
    source: 'metrics.preventiveVsCorrective',
  },
  {
    key: 'requests_fulfilled_ratio',
    label: 'Chamados realizados/solicitados (ICRS)',
    description: 'Realizados ÷ solicitados × 100.',
    unit: 'percent',
    category: 'volume',
    tiers: BE,
    state: 'PENDING_DEFINITION',
    pendingKind: 'DEFINITION',
    targetDirection: 'HIGHER_IS_BETTER',
    source: null,
    note:
      'A razão está comprovada no Data Studio (1.713 ÷ 1.967 = 87,09 %), mas a população de "solicitados" e ' +
      '"realizados" não foi confirmada (P-04). O cálculo está pronto, mas nenhum registro é contado até essa definição.',
  },
  // --- tempos --------------------------------------------------------------
  {
    key: 'mttr',
    label: 'MTTR',
    description: 'Tempo médio de reparo das corretivas concluídas (tempo corrido abertura → conclusão).',
    unit: 'minutes',
    category: 'time',
    tiers: BA,
    state: 'PROVISIONAL',
    targetDirection: 'LOWER_IS_BETTER',
    source: 'metrics.mttr',
    note: 'Definição do sistema (tempo corrido). O PDF Basic fala em tempo "em atendimento": aguarda P-01 e P-12.',
  },
  {
    key: 'mtbf',
    label: 'MTBF',
    description: 'Tempo médio entre falhas por equipamento, dentro do período.',
    unit: 'minutes',
    category: 'time',
    tiers: BA,
    state: 'PROVISIONAL',
    targetDirection: 'HIGHER_IS_BETTER',
    source: 'metrics.mtbf',
    note: 'Calculado em minutos (como o Painel). Unidade e janela divergem entre os documentos do cliente: aguarda P-02 e P-12.',
  },
  // --- conformidade --------------------------------------------------------
  {
    key: 'compliance_preventive',
    label: 'Conformidade de preventivas',
    description: 'Itens de plano preventivo realizados ÷ (programados − dispensados), no período.',
    unit: 'percent',
    category: 'compliance',
    tiers: BAE,
    state: 'PROVISIONAL',
    targetDirection: 'HIGHER_IS_BETTER',
    source: 'plan-board.byKind',
    note: 'É o ACM do Data Studio (razão comprovada). Falta confirmar se preventiva feita com atraso conta como realizada (P-06, P-07).',
  },
  {
    key: 'compliance_calibration',
    label: 'Conformidade de calibrações',
    description: 'Itens de plano de calibração realizados ÷ (programados − dispensados), no período.',
    unit: 'percent',
    category: 'compliance',
    tiers: BA,
    state: 'ACTIVE',
    targetDirection: 'HIGHER_IS_BETTER',
    source: 'plan-board.byKind',
    note: 'Separada das demais por decisão da reunião; o PDF Basic agrega MP+CAL+TSE (P-10).',
  },
  {
    key: 'compliance_electrical_safety',
    label: 'Conformidade de TSE',
    description: 'Itens de plano de TSE realizados ÷ (programados − dispensados), no período.',
    unit: 'percent',
    category: 'compliance',
    tiers: BA,
    state: 'ACTIVE',
    targetDirection: 'HIGHER_IS_BETTER',
    source: 'plan-board.byKind',
    note: 'Execução dos planos de TSE (o item feito com atraso conta como realizado; P-06/P-07 em aberto). Não é veredito elétrico: limites de TSE seguem bloqueados (especialista).',
  },
  {
    key: 'compliance_qualification',
    label: 'Conformidade de qualificações',
    description: 'Itens de plano de qualificação realizados ÷ (programados − dispensados), no período.',
    unit: 'percent',
    category: 'compliance',
    tiers: BA,
    state: 'ACTIVE',
    targetDirection: 'HIGHER_IS_BETTER',
    source: 'plan-board.byKind',
  },
  // --- nível de serviço e qualidade ---------------------------------------
  {
    key: 'sla_compliance',
    label: 'SLA',
    description: 'Relógios de SLA cumpridos ÷ (cumpridos + violados), no período.',
    unit: 'percent',
    category: 'service_level',
    tiers: A,
    state: 'ACTIVE',
    targetDirection: 'HIGHER_IS_BETTER',
    source: 'metrics.slaCompliance',
  },
  {
    key: 'work_order_rating',
    label: 'Avaliação das ordens de serviço',
    description:
      'Média das notas de 1 a 5 que o solicitante deu e assinou a cada OS concluída, no período, com a distribuição.',
    unit: 'score',
    category: 'quality',
    tiers: A,
    state: 'ACTIVE',
    targetDirection: 'HIGHER_IS_BETTER',
    source: 'metrics.workOrderRating',
    definedOn: '2026-10-21',
    definitionSource: 'Conversa com o cliente, 21/10/2026 ("gerar um indicador de avaliação de OS")',
    note: 'É por OS (a de "Avaliação da qualidade dos serviços" é por solicitação) e só conta OS avaliadas e assinadas.',
  },
  {
    key: 'service_rating',
    label: 'Avaliação da qualidade dos serviços',
    description: 'Média das avaliações de 1 a 5 dadas pelo solicitante, no período, com a distribuição.',
    unit: 'score',
    category: 'quality',
    tiers: BAE,
    state: 'ACTIVE',
    targetDirection: 'HIGHER_IS_BETTER',
    source: 'metrics.serviceRating',
    note: 'Conta as solicitações encerradas no período e já avaliadas. A inconsistência 64 × 67 do PDF Basic não é reproduzida.',
  },
  {
    key: 'training_ratio',
    label: 'Treinamentos realizados/solicitados',
    description: 'Treinamentos realizados ÷ solicitados × 100, no período.',
    unit: 'percent',
    category: 'compliance',
    tiers: BE,
    state: 'PENDING_DEFINITION',
    pendingKind: 'DATA_MODEL',
    targetDirection: 'HIGHER_IS_BETTER',
    source: null,
    note:
      'Sem vínculo seguro entre solicitado e realizado: uma solicitação de treinamento pode gerar OS de ' +
      'qualquer tipo, a OS de treinamento não aponta para o treinamento solicitado, e não há critério de ' +
      '"realizado" nem cadastro de educação continuada.',
  },
  // --- parque e disponibilidade -------------------------------------------
  {
    key: 'park_availability_snapshot',
    label: 'Disponibilidade do parque (situação cadastrada, agora)',
    description: 'Equipamentos em operação ou reserva ÷ equipamentos cadastrados, na situação de agora.',
    unit: 'percent',
    category: 'park',
    tiers: BA,
    state: 'PROVISIONAL',
    targetDirection: 'HIGHER_IS_BETTER',
    source: 'painel.parkSnapshot',
    note: 'Fotografia da situação cadastrada. Disponibilidade NO TEMPO aguarda a definição de "parado" (P-09).',
  },
  {
    key: 'obsolescence',
    label: 'Obsolescência',
    description: 'Equipamentos obsoletos no parque.',
    unit: 'count',
    category: 'park',
    tiers: A,
    state: 'PENDING_DEFINITION',
    pendingKind: 'DEFINITION',
    targetDirection: 'LOWER_IS_BETTER',
    source: null,
    note: 'Sem critério de obsolescência definido pelo cliente (idade? fim de suporte? custo?) — P-16.',
  },
  // --- EXPERT: os 16 itens do IMR (FHEMIG) ---------------------------------
  {
    key: 'first_response_time',
    label: 'Tempo médio para o primeiro atendimento (TMPA)',
    description: 'Tempo médio até o primeiro atendimento da corretiva.',
    unit: 'hours',
    category: 'time',
    tiers: E,
    state: 'PENDING_DEFINITION',
    pendingKind: 'DEFINITION',
    targetDirection: 'LOWER_IS_BETTER',
    source: null,
    // Texto que vai ao cliente (PDF e tela): sem identificador de código.
    note:
      'Falta definir o que encerra a contagem (há cinco momentos possíveis) e se ela é em horas corridas ou ' +
      'úteis (P-03). O tempo de primeira resposta mostrado no Painel é outra medida e não substitui este.',
  },
  ...(
    [
      ['internal', 'Interno'],
      ['external', 'Externo'],
      ['global', 'Global'],
    ] as const
  ).flatMap(([sufixo, rotulo]) => [
    {
      key: `availability_${sufixo}`,
      label: `Disponibilidade — ${rotulo}`,
      description: `Disponibilidade temporal do parque (${rotulo.toLowerCase()}).`,
      unit: 'percent' as const,
      category: 'availability' as const,
      tiers: E,
      state: 'PENDING_DEFINITION' as const,
      pendingKind: 'DATA_MODEL' as const,
      targetDirection: 'HIGHER_IS_BETTER' as const,
      source: null,
      note: `${IMR} Falta a definição de "parado" (P-09), a classificação interno × externo (P-08) e a relação do Global (P-05).`,
    },
    {
      key: `tmrg_${sufixo}`,
      label: `TMRG — ${rotulo}`,
      description: `Tempo médio de resolutividade geral (${rotulo.toLowerCase()}).`,
      unit: 'hours' as const,
      category: 'time' as const,
      tiers: E,
      state: 'PENDING_DEFINITION' as const,
      pendingKind: 'DATA_MODEL' as const,
      targetDirection: 'LOWER_IS_BETTER' as const,
      source: null,
      note: `${IMR} Falta classificar a OS como interna/externa (P-08), o relógio e a relação do Global (P-05).`,
    },
    {
      key: `critical_resolution_${sufixo}`,
      label: `Resolutividade crítica — ${rotulo}`,
      description: `Tempo médio de atendimento e resolutividade dos chamados críticos (${rotulo.toLowerCase()}).`,
      unit: 'hours' as const,
      category: 'time' as const,
      tiers: E,
      state: 'PENDING_DEFINITION' as const,
      pendingKind: 'DEFINITION' as const,
      targetDirection: 'LOWER_IS_BETTER' as const,
      source: null,
      note: `${IMR} Falta definir "crítica" (prioridade × criticidade do equipamento, P-11) e interno/externo (P-08).`,
    },
  ]),
  {
    key: 'quality_activities_on_time',
    label: 'Adesão às atividades propostas pela qualidade dentro do prazo',
    description: 'Atividades da qualidade concluídas no prazo ÷ propostas.',
    unit: 'percent',
    category: 'contractual',
    tiers: E,
    state: 'PENDING_DEFINITION',
    pendingKind: 'DATA_MODEL',
    targetDirection: 'HIGHER_IS_BETTER',
    source: null,
    note: `${IMR} O sistema não tem o dado de "atividade proposta pela qualidade" (P-15).`,
  },
  {
    key: 'attendance',
    label: 'Assiduidade nos postos de trabalho',
    description: 'Presença registrada ÷ escala prevista.',
    unit: 'percent',
    category: 'contractual',
    tiers: E,
    state: 'PENDING_DEFINITION',
    pendingKind: 'DATA_MODEL',
    targetDirection: 'HIGHER_IS_BETTER',
    source: null,
    note: `${IMR} O sistema não tem escala nem presença (P-15).`,
  },
  {
    key: 'imr_penalty',
    label: 'Glosa / desconto do IMR',
    description: 'Desconto contratual calculado a partir do resultado dos indicadores do IMR.',
    unit: 'none',
    category: 'contractual',
    tiers: E,
    state: 'PENDING_DEFINITION',
    pendingKind: 'DEFINITION',
    targetDirection: 'INFORMATIONAL',
    source: null,
    note: 'BLOQUEADO — CLIENTE: o IMR de exemplo tem todos os descontos zerados; faixas, pesos, teto e regra cumulativa não existem (P-14). Não se aplica desconto.',
  },
]);

/**
 * Indicadores que PODEM aparecer no modelo, qualquer que seja a situação.
 * Serve ao catálogo; quem monta relatório usa `reportableIndicatorsForTier`.
 */
export function indicatorsForTier(tier: ReportTier): ReportIndicator[] {
  return REPORT_INDICATORS.filter((i) => i.tiers.includes(tier));
}

/** Entra em relatório: tudo menos o que está pendente de definição. */
export function isReportable(i: ReportIndicator): boolean {
  return i.state !== 'PENDING_DEFINITION';
}

/** O que um relatório do modelo inclui quando ninguém escolheu nada: só ACTIVE. */
export function defaultIndicatorsForTier(tier: ReportTier): ReportIndicator[] {
  return indicatorsForTier(tier).filter((i) => i.state === 'ACTIVE');
}

/**
 * Confere uma seleção explícita de indicadores contra o modelo: fora do modelo
 * ou PENDING_DEFINITION é erro (a mensagem diz quais). Devolve `null` quando a
 * seleção pode entrar. O relatório sob demanda e a regra agendada (ao SALVAR,
 * e não só na execução — pente-fino 17/10/2026) usam a mesma conferência.
 */
export function reportSelectionProblem(tier: ReportTier, keys: readonly string[]): string | null {
  const doModelo = indicatorsForTier(tier);
  const fora = [...new Set(keys)].filter((k) => !doModelo.some((i) => i.key === k));
  if (fora.length > 0) {
    return `indicadores fora do modelo ${REPORT_TIER_LABEL[tier]}: ${fora.join(', ')}`;
  }
  const pendentes = doModelo.filter((i) => keys.includes(i.key) && !isReportable(i)).map((i) => i.key);
  if (pendentes.length > 0) {
    return `indicadores aguardando definição não entram em relatório: ${pendentes.join(', ')}`;
  }
  return null;
}

export function findIndicator(key: string): ReportIndicator | undefined {
  return REPORT_INDICATORS.find((i) => i.key === key);
}

export function isReportTier(v: unknown): v is ReportTier {
  return typeof v === 'string' && (REPORT_TIERS as readonly string[]).includes(v);
}

/* -------------------------------------------------------------------------- */
/* Relatório PATRIMONIAL (REL-11, WhatsApp 19/10/2026)                         */
/* -------------------------------------------------------------------------- */

/** Rótulo pt-BR da situação cadastrada do ativo (o mesmo da lista e da ficha). */
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  active: 'Em operação',
  under_maintenance: 'Em manutenção',
  standby: 'Reserva',
  loaned: 'Emprestado',
  decommissioned: 'Baixado',
  disposed: 'Descartado',
};

/**
 * As três situações do relatório patrimonial ("opção de ativos, em manutenção e obsoletos"),
 * derivadas da situação CADASTRADA do ativo — nada é inferido:
 *
 *   · ativos — em uso: em operação, reserva ou emprestado;
 *   · em manutenção — a situação cadastrada "em manutenção" (não se deduz de OS aberta);
 *   · obsoletos — fora de operação: baixado ou descartado (pelo laudo de obsolescência OBC ou
 *     por baixa direta; o relatório mostra o número do laudo quando a baixa veio dele).
 */
export const ASSET_REPORT_SITUATIONS = ['all', 'active', 'maintenance', 'obsolete'] as const;
export type AssetReportSituation = (typeof ASSET_REPORT_SITUATIONS)[number];

export const ASSET_REPORT_SITUATION_STATUSES: Record<
  Exclude<AssetReportSituation, 'all'>,
  readonly AssetStatus[]
> = {
  active: ['active', 'standby', 'loaned'],
  maintenance: ['under_maintenance'],
  obsolete: ['decommissioned', 'disposed'],
};

export const ASSET_REPORT_SITUATION_LABELS: Record<AssetReportSituation, string> = {
  all: 'Todos',
  active: 'Ativos',
  maintenance: 'Em manutenção',
  obsolete: 'Obsoletos',
};

/** A frase que o relatório imprime para explicar a derivação. */
export const ASSET_REPORT_SITUATION_NOTE =
  'Ativos: em operação, reserva ou emprestados. Em manutenção: situação cadastrada "em manutenção". ' +
  'Obsoletos: fora de operação (baixados ou descartados), com o laudo OBC quando a baixa veio dele.';

export function assetReportSituationOf(status: AssetStatus): Exclude<AssetReportSituation, 'all'> {
  if (status === 'under_maintenance') return 'maintenance';
  return isRetired(status) ? 'obsolete' : 'active';
}
