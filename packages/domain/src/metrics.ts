/**
 * Aurora — indicadores (SPEC v0.2 §25 · EPIC-021).
 *
 * A auditoria NÃO conseguiu confirmar as fórmulas do sistema de referência para
 * disponibilidade, MTTR, MTBF e "TMAC": a interface não exibe definição e os
 * botões de ajuda não retornam conteúdo. Isso tem três consequências que este
 * arquivo carrega inteiras.
 *
 * 1. CADA MÉTRICA CARREGA A SUA DEFINIÇÃO
 *    Numerador, denominador, filtros e período viajam JUNTO com o número, no
 *    mesmo objeto. Não é enfeite de interface: um indicador que não se explica
 *    não é confiável, e a primeira pergunta que um gestor faz diante de um
 *    número ruim é "como isso foi calculado". Sem resposta, ele para de usar o
 *    relatório — que é o estado em que a referência está.
 *
 * 2. AS FÓRMULAS AQUI SÃO NOSSA DECISÃO, NÃO CÓPIA
 *    Estão escritas por extenso em `METRIC_DEFINITIONS`. Comparar números com o
 *    sistema antigo numa migração exige obter a fórmula dele com o fornecedor
 *    primeiro — e isso está dito no campo `comparability` de cada uma.
 *
 * 3. "TMAC" NÃO EXISTE AQUI
 *    A sigla só pôde ser inferida pelo formato de duração. No lugar dela há
 *    duas métricas definidas explicitamente: tempo de primeira resposta e MTTR.
 */

export const METRIC_KEYS = [
  'work_orders_opened',
  'work_orders_completed',
  'backlog',
  'backlog_age',
  'mttr',
  'mtbf',
  'sla_compliance',
  'time_by_status',
  'time_by_wait_reason',
  'preventive_vs_corrective',
  'plan_compliance',
  'productivity',
  'labor_hours',
  'first_response_time',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface MetricDefinition {
  readonly key: MetricKey;
  readonly label: string;
  /** O que o indicador serve para responder. */
  readonly purpose: string;
  readonly numerator: string;
  /** `null` quando a métrica é contagem simples e não tem denominador. */
  readonly denominator: string | null;
  readonly unit: 'count' | 'minutes' | 'hours' | 'percent' | 'days';
  /** O que fica DE FORA, e por quê — a parte que costuma faltar. */
  readonly exclusions: readonly string[];
  /** Aviso sobre comparar com o sistema antigo. */
  readonly comparability: string;
}

const NAO_CONFIRMADA =
  'a fórmula da referência não pôde ser confirmada na auditoria; comparar exige obtê-la com o fornecedor';
const NOSSA = 'definição nossa, sem equivalente conhecido na referência';

export const METRIC_DEFINITIONS: Readonly<Record<MetricKey, MetricDefinition>> = Object.freeze({
  work_orders_opened: {
    key: 'work_orders_opened',
    label: 'OS abertas',
    purpose: 'Volume de demanda no período',
    numerator: 'ordens de serviço cuja abertura caiu dentro do período',
    denominator: null,
    unit: 'count',
    exclusions: ['rascunhos, que ainda não foram abertos'],
    comparability: 'contagem simples; comparável',
  },
  work_orders_completed: {
    key: 'work_orders_completed',
    label: 'OS concluídas',
    purpose: 'Volume de entrega no período',
    numerator: 'ordens de serviço cuja conclusão caiu dentro do período',
    denominator: null,
    unit: 'count',
    exclusions: ['canceladas, que não representam entrega'],
    comparability: 'contagem simples; comparável',
  },
  backlog: {
    key: 'backlog',
    label: 'Backlog',
    purpose: 'Trabalho acumulado ainda não concluído',
    numerator: 'ordens de serviço em situação ativa na data de corte',
    denominator: null,
    unit: 'count',
    exclusions: ['concluídas, fechadas e canceladas'],
    comparability: NOSSA,
  },
  backlog_age: {
    key: 'backlog_age',
    label: 'Idade do backlog',
    purpose: 'Envelhecimento da fila',
    numerator: 'dias entre a abertura e a data de corte, por OS ativa',
    denominator: null,
    unit: 'days',
    exclusions: ['as mesmas do backlog'],
    comparability: NOSSA,
  },
  mttr: {
    key: 'mttr',
    label: 'MTTR — tempo médio de reparo',
    purpose: 'Velocidade de resolução',
    numerator: 'soma dos minutos entre abertura e conclusão das OS corretivas concluídas no período',
    denominator: 'quantidade dessas OS',
    unit: 'minutes',
    exclusions: [
      'OS não corretivas: preventiva planejada não mede velocidade de reparo',
      'OS ainda não concluídas: incluí-las com o tempo até agora empurraria a média para baixo todo dia',
      'OS canceladas',
    ],
    comparability: NAO_CONFIRMADA,
  },
  mtbf: {
    key: 'mtbf',
    label: 'MTBF — tempo médio entre falhas',
    purpose: 'Confiabilidade do ativo',
    numerator: 'soma dos intervalos entre aberturas consecutivas de OS corretivas do mesmo ativo',
    denominator: 'quantidade de intervalos (falhas − 1, por ativo)',
    unit: 'minutes',
    exclusions: [
      'ativos com uma única corretiva: uma falha não produz intervalo, e contá-la como zero afundaria a média',
      'OS não corretivas',
    ],
    comparability: NAO_CONFIRMADA,
  },
  sla_compliance: {
    key: 'sla_compliance',
    label: 'Cumprimento de SLA',
    purpose: 'Aderência contratual',
    numerator: 'relógios encerrados dentro do prazo',
    denominator: 'relógios encerrados no período',
    unit: 'percent',
    exclusions: [
      'OS sem política de SLA: não têm prazo, e inventar um produziria meta fictícia',
      'relógios ainda correndo',
    ],
    comparability: 'a referência mede "% de chamados cumpridos"; o recorte por alvo é nosso',
  },
  time_by_status: {
    key: 'time_by_status',
    label: 'Tempo por situação',
    purpose: 'Onde o fluxo trava',
    numerator: 'soma da permanência em cada situação',
    denominator: null,
    unit: 'minutes',
    exclusions: ['a situação corrente, cuja permanência ainda não terminou'],
    comparability: NAO_CONFIRMADA,
  },
  time_by_wait_reason: {
    key: 'time_by_wait_reason',
    label: 'Tempo por motivo de espera',
    purpose: 'Causa raiz do travamento',
    numerator: 'soma da permanência em espera, agrupada pelo motivo declarado',
    denominator: null,
    unit: 'minutes',
    exclusions: ['esperas sem motivo declarado, que a máquina de estados não permite criar'],
    comparability: NOSSA,
  },
  preventive_vs_corrective: {
    key: 'preventive_vs_corrective',
    label: 'Preventiva × corretiva',
    purpose: 'Maturidade da manutenção',
    numerator: 'OS preventivas concluídas',
    denominator: 'OS preventivas + corretivas concluídas',
    unit: 'percent',
    exclusions: ['naturezas que não são nem preventiva nem corretiva, que não dizem nada sobre maturidade'],
    comparability: NOSSA,
  },
  plan_compliance: {
    key: 'plan_compliance',
    label: 'Conformidade de plano',
    purpose: 'Aderência ao programa preventivo',
    numerator: 'itens de ciclo concluídos',
    denominator: 'itens previstos menos os dispensados com justificativa',
    unit: 'percent',
    exclusions: [
      'itens dispensados: o ativo não podia receber a preventiva, e contá-los puniria a equipe por algo que ela não podia fazer',
    ],
    comparability: NAO_CONFIRMADA,
  },
  productivity: {
    key: 'productivity',
    label: 'Produtividade',
    purpose: 'Entrega por técnico',
    numerator: 'OS concluídas e horas apontadas, por pessoa',
    denominator: null,
    unit: 'count',
    exclusions: ['apontamentos sem fim marcado, que ainda estão correndo'],
    comparability: NOSSA,
  },
  labor_hours: {
    key: 'labor_hours',
    label: 'Horas gastas',
    purpose: 'Capacidade consumida',
    numerator: 'soma dos apontamentos encerrados no período',
    denominator: null,
    unit: 'hours',
    exclusions: ['apontamentos abertos'],
    comparability: 'contagem simples; comparável',
  },
  first_response_time: {
    key: 'first_response_time',
    label: 'Tempo de primeira resposta',
    purpose: 'Percepção de atendimento',
    numerator: 'soma dos minutos entre o envio da solicitação e a primeira triagem humana',
    denominator: 'quantidade de solicitações triadas no período',
    unit: 'minutes',
    exclusions: ['solicitações ainda não triadas'],
    comparability:
      'substitui a sigla "TMAC" da referência, cujo significado só pôde ser inferido e cuja fórmula não foi confirmada',
  },
});

/* -------------------------------------------------------------------------- */
/* cobertura                                                                   */
/* -------------------------------------------------------------------------- */

export interface Coverage {
  /** Registros que entraram no cálculo. */
  readonly included: number;
  /** Registros que existiam e ficaram de fora por falta de dado. */
  readonly excluded: number;
  /** Percentual do universo coberto. `null` quando não havia universo. */
  readonly percent: number | null;
  /** Frase pronta: "calculado sobre 78 % dos ativos". */
  readonly note: string | null;
}

/**
 * A cobertura do cálculo, dita por extenso.
 *
 * O §25 chama isto de denominador honesto. Um painel que mostra 92 % de SLA
 * calculado sobre um terço das OS não está errado — está incompleto, e a
 * diferença entre as duas coisas é a frase. Sem ela, o gestor age sobre um
 * número que descreve outra realidade.
 */
export function coverage(included: number, excluded: number, noun = 'registros'): Coverage {
  const universo = included + excluded;
  if (universo === 0) {
    return { included, excluded, percent: null, note: null };
  }
  const pct = Number(((included / universo) * 100).toFixed(1));
  return {
    included,
    excluded,
    percent: pct,
    note:
      excluded === 0
        ? `calculado sobre todos os ${universo} ${noun}`
        : `calculado sobre ${pct} % dos ${noun} (${included} de ${universo})`,
  };
}

/* -------------------------------------------------------------------------- */
/* faixas de idade                                                             */
/* -------------------------------------------------------------------------- */

export const AGE_BUCKETS = ['0-7', '8-30', '31-90', '90+'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/**
 * A faixa de idade de uma OS do backlog (§25).
 *
 * As faixas são as da SPEC e não uma escala contínua porque a decisão que elas
 * apoiam é discreta: até uma semana é fila normal, até um mês é acúmulo, acima
 * de noventa dias é trabalho que provavelmente não vai acontecer e precisa ser
 * cancelado ou repriorizado — e ver isso exige o corte.
 */
export function ageBucket(days: number): AgeBucket {
  if (days <= 7) return '0-7';
  if (days <= 30) return '8-30';
  if (days <= 90) return '31-90';
  return '90+';
}

export function bucketize(ages: readonly number[]): Record<AgeBucket, number> {
  const contagem: Record<AgeBucket, number> = { '0-7': 0, '8-30': 0, '31-90': 0, '90+': 0 };
  for (const idade of ages) contagem[ageBucket(idade)]++;
  return contagem;
}

/* -------------------------------------------------------------------------- */
/* médias com denominador honesto                                              */
/* -------------------------------------------------------------------------- */

export interface Average {
  readonly value: number | null;
  readonly samples: number;
}

/**
 * Média que devolve `null` quando não há amostra.
 *
 * Zero e "não há dados" são coisas diferentes, e um painel que mostra MTTR de
 * 0 min para um mês sem nenhuma corretiva concluída está afirmando uma
 * excelência que não aconteceu.
 */
export function average(values: readonly number[]): Average {
  if (values.length === 0) return { value: null, samples: 0 };
  const soma = values.reduce((a, b) => a + b, 0);
  return { value: Number((soma / values.length).toFixed(2)), samples: values.length };
}

/**
 * Intervalos entre falhas consecutivas de um mesmo ativo, em minutos.
 *
 * Um ativo com UMA falha não produz intervalo nenhum, e é isso que o §25 quer
 * dizer com "primeira falha não gera MTBF". Tratar a única falha como intervalo
 * zero afundaria a média de confiabilidade do parque inteiro — e o equipamento
 * que falhou uma vez em cinco anos apareceria como o menos confiável de todos.
 */
export function failureIntervals(failureTimes: readonly Date[]): number[] {
  if (failureTimes.length < 2) return [];
  const ordenadas = [...failureTimes].sort((a, b) => a.getTime() - b.getTime());
  const intervalos: number[] = [];
  for (let i = 1; i < ordenadas.length; i++) {
    intervalos.push(Math.round((ordenadas[i]!.getTime() - ordenadas[i - 1]!.getTime()) / 60_000));
  }
  return intervalos;
}

/* -------------------------------------------------------------------------- */
/* período                                                                     */
/* -------------------------------------------------------------------------- */

export interface Period {
  readonly from: Date;
  readonly to: Date;
}

export interface MetricResult<T> {
  readonly metric: MetricKey;
  readonly definition: MetricDefinition;
  readonly period: { from: string; to: string };
  readonly filters: Readonly<Record<string, string | null>>;
  readonly coverage: Coverage | null;
  readonly data: T;
}

/**
 * Embrulha um número com a sua definição, período, filtros e cobertura.
 *
 * É a função que faz o §25 ser cumprido em vez de prometido: nenhum indicador
 * sai daqui sem dizer como foi calculado e sobre o que.
 */
export function withDefinition<T>(
  metric: MetricKey,
  period: Period,
  filters: Readonly<Record<string, string | null>>,
  data: T,
  cov: Coverage | null = null
): MetricResult<T> {
  return {
    metric,
    definition: METRIC_DEFINITIONS[metric],
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    filters,
    coverage: cov,
    data,
  };
}
