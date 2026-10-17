/**
 * Aurora — modelos de RELATÓRIO: BASIC, ADVANCED, EXPERT (reunião 16/10/2026, Fase 9).
 *
 * São níveis de RELATÓRIO — não confundir com tipo de CONTRATO.
 *
 * Esta rodada entrega só a FUNDAÇÃO, por decisão do cliente: os PDFs oficiais
 * dos três modelos chegam numa rodada dedicada. Até lá:
 *
 *   · cada indicador declara o NÍVEL mínimo e a SITUAÇÃO;
 *   · `available` = calculado com dado real por função que já existe;
 *   · `awaiting_official_model` = AGUARDANDO MODELO PDF OFICIAL (fórmula,
 *     composição ou gráfico ainda não formalizados — não se inventa);
 *   · `awaiting_definition` = depende de definição do cliente (ex.: o que conta
 *     como "parado" para disponibilidade no tempo).
 *
 * O layout final de TODOS os modelos também está AGUARDANDO MODELO PDF OFICIAL:
 * o PDF gerado hoje é provisório e diz isso na faixa de cada página.
 */
export const REPORT_TIERS = ['basic', 'advanced', 'expert'] as const;
export type ReportTier = (typeof REPORT_TIERS)[number];

export const REPORT_TIER_LABEL: Record<ReportTier, string> = {
  basic: 'Basic',
  advanced: 'Advanced',
  expert: 'Expert',
};

export type ReportIndicatorStatus = 'available' | 'awaiting_official_model' | 'awaiting_definition';

export interface ReportIndicator {
  readonly key: string;
  readonly label: string;
  /** Nível MÍNIMO em que aparece (os níveis acima herdam). */
  readonly tier: ReportTier;
  readonly status: ReportIndicatorStatus;
  /** O que está faltando, ou como o número é lido hoje. */
  readonly note?: string;
}

export const REPORT_LAYOUT_STATUS = 'awaiting_official_model' as const;
export const AGUARDANDO_MODELO = 'AGUARDANDO MODELO PDF OFICIAL';

export const REPORT_INDICATORS: readonly ReportIndicator[] = Object.freeze([
  // --- BASIC ---------------------------------------------------------------
  {
    key: 'park_availability_snapshot',
    label: 'Disponibilidade do parque (situação cadastrada, agora)',
    tier: 'basic',
    status: 'available',
    note: 'Fotografia da situação cadastrada dos equipamentos. Disponibilidade NO TEMPO aguarda a definição de "parado".',
  },
  { key: 'mttr', label: 'MTTR', tier: 'basic', status: 'available' },
  { key: 'mtbf', label: 'MTBF', tier: 'basic', status: 'available' },
  { key: 'work_orders_opened', label: 'Chamados abertos (OS)', tier: 'basic', status: 'available' },
  { key: 'work_orders_completed', label: 'Chamados concluídos (OS)', tier: 'basic', status: 'available' },
  { key: 'compliance_preventive', label: 'Conformidade de preventivas', tier: 'basic', status: 'available' },
  { key: 'compliance_calibration', label: 'Conformidade de calibrações', tier: 'basic', status: 'available' },
  {
    key: 'compliance_electrical_safety',
    label: 'Conformidade de TSE',
    tier: 'basic',
    status: 'available',
    note: 'Execução no prazo dos planos de TSE. Não é veredito elétrico: limites de TSE seguem bloqueados (especialista).',
  },
  {
    key: 'compliance_qualification',
    label: 'Conformidade de qualificações',
    tier: 'basic',
    status: 'available',
  },
  // --- ADVANCED ------------------------------------------------------------
  { key: 'sla_compliance', label: 'SLA', tier: 'advanced', status: 'available' },
  {
    key: 'work_order_evolution',
    label: 'Evolução dos chamados (abertos × concluídos)',
    tier: 'advanced',
    status: 'available',
  },
  { key: 'backlog', label: 'Backlog', tier: 'advanced', status: 'available' },
  { key: 'work_orders_by_status', label: 'OS por situação (agora)', tier: 'advanced', status: 'available' },
  { key: 'preventive_vs_corrective', label: 'Preventiva × corretiva', tier: 'advanced', status: 'available' },
  {
    key: 'obsolescence',
    label: 'Obsolescência',
    tier: 'advanced',
    status: 'awaiting_definition',
    note: 'Sem critério de obsolescência definido pelo cliente (idade? fim de suporte do fabricante? custo?).',
  },
  // --- EXPERT --------------------------------------------------------------
  {
    key: 'fhemig_indicators',
    label: 'Indicadores no modelo FHEMIG',
    tier: 'expert',
    status: 'awaiting_official_model',
    note: `${AGUARDANDO_MODELO}: fórmulas e composição ainda não entregues.`,
  },
  {
    key: 'availability_over_time',
    label: 'Disponibilidade no tempo',
    tier: 'expert',
    status: 'awaiting_definition',
    note: 'Depende da definição de "tempo parado" pelo cliente.',
  },
  {
    key: 'expert_advanced_indicators',
    label: 'Indicadores avançados do modelo Expert',
    tier: 'expert',
    status: 'awaiting_official_model',
    note: `${AGUARDANDO_MODELO}.`,
  },
]);

const ORDEM: Record<ReportTier, number> = { basic: 0, advanced: 1, expert: 2 };

/** Indicadores de um nível: os dele e os dos níveis abaixo. */
export function indicatorsForTier(tier: ReportTier): ReportIndicator[] {
  return REPORT_INDICATORS.filter((i) => ORDEM[i.tier] <= ORDEM[tier]);
}

export function isReportTier(v: unknown): v is ReportTier {
  return typeof v === 'string' && (REPORT_TIERS as readonly string[]).includes(v);
}
