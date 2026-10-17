/**
 * Aurora — indicadores (SPEC v0.2 §25 · EPIC-021).
 *
 * NENHUM NÚMERO SAI SOZINHO.
 *
 * Todo indicador chega embrulhado com a DEFINIÇÃO — o que entra no numerador,
 * o que entra no denominador, o que ficou de fora e por quê, e um aviso sobre
 * comparar com o sistema antigo. Isso não é enfeite: um percentual de SLA sem
 * denominador declarado é um número que duas pessoas leem de dois jeitos, e a
 * reunião inteira discute a métrica em vez do problema.
 *
 * E CHEGA COM A COBERTURA.
 *
 * `coverage` diz quantos registros entraram na conta e quantos ficaram de fora
 * por falta de dado. Um painel que mostra 92% de SLA calculado sobre 40% das
 * ordens está mentindo por omissão — e é exatamente o tipo de mentira que
 * ninguém detecta olhando o painel.
 */
import { defineOperation } from '../registry';
import { z, Uuid } from '../primitives';

export const METRIC_UNITS = ['count', 'minutes', 'hours', 'percent', 'days'] as const;

export const MetricDefinition = z.object({
  key: z.string(),
  label: z.string(),
  /** O que o indicador serve para responder. */
  purpose: z.string(),
  numerator: z.string(),
  /** Nulo quando é contagem simples e não tem denominador. */
  denominator: z.string().nullable(),
  unit: z.enum(METRIC_UNITS),
  /** O que fica DE FORA, e por quê — a parte que costuma faltar. */
  exclusions: z.array(z.string()),
  /**
   * Aviso sobre comparar com o sistema antigo.
   *
   * Existe porque a auditoria não conseguiu confirmar a fórmula da referência
   * para várias métricas. Comparar exige obter a fórmula com o fornecedor — e
   * dizer isso no próprio indicador é o que impede a comparação ingênua que
   * termina em "o sistema novo está errado".
   */
  comparability: z.string(),
});
export type MetricDefinition = z.infer<typeof MetricDefinition>;

export const Coverage = z.object({
  included: z.number().int(),
  excluded: z.number().int(),
  /** Nulo quando não havia universo — e nulo é diferente de zero. */
  percent: z.number().nullable(),
  /** Frase pronta: "calculado sobre 78% dos ativos". */
  note: z.string().nullable(),
});
export type Coverage = z.infer<typeof Coverage>;

/**
 * O envelope de qualquer indicador.
 *
 * `data` fica solto de propósito: cada métrica tem a sua forma — contagem,
 * média, distribuição, série. Amarrar todas numa forma só faria as
 * distribuições virarem contagens com um campo extra, ou as contagens
 * carregarem cinco campos nulos.
 */
const envelope = (data: z.ZodTypeAny) =>
  z.object({
    metric: z.string(),
    definition: MetricDefinition,
    period: z.object({ from: z.string(), to: z.string() }),
    filters: z.record(z.string(), z.string().nullable()),
    coverage: Coverage.nullable(),
    data,
  });

const Contagem = z.object({ count: z.number().int() });

/**
 * O que MTTR e primeira resposta DEVOLVEM: o valor (minutos) e quantas amostras
 * o compuseram. O contrato descrevia `count/average/median/p90`, que a API
 * nunca mandou — a tela já lia `value/samples`. Corrigido para a forma real.
 */
const ValorMedio = z.object({
  value: z.number().nullable(),
  samples: z.number().int(),
});

/** Tempo por motivo de espera: uma linha por motivo, em minutos e ocorrências. */
const PorMotivo = z.array(
  z.object({
    key: z.string(),
    label: z.string(),
    responsible: z.string(),
    pausesSla: z.boolean(),
    minutes: z.number(),
    occurrences: z.number().int(),
  })
);

/** Mantido para leitura de quem já importava o nome; nenhuma rota o usa. */
export const MediaEstatistica = z.object({
  count: z.number().int(),
  average: z.number().nullable(),
  /**
   * A mediana vem junto da média porque as duas contam histórias diferentes.
   *
   * Um MTTR médio de 6 horas com mediana de 40 minutos significa que quase
   * tudo é rápido e três casos arrastaram o número — e a ação para isso é
   * olhar os três, não acelerar o time inteiro.
   */
  median: z.number().nullable(),
  p90: z.number().nullable(),
});

/** O recorte comum a todos os indicadores. */
const recorte = z.object({
  from: z.string(),
  to: z.string(),
  customerId: Uuid.optional(),
  /**
   * Prefixo do caminho de local — texto, e não uuid.
   *
   * O filtro é por SUBÁRVORE: "tudo abaixo da UTI" cabe num parâmetro só
   * porque o caminho é materializado.
   */
  locationPath: z.string().optional(),
  assetCategoryId: Uuid.optional(),
  teamId: Uuid.optional(),
  membershipId: Uuid.optional(),
});

export const metricDefinitions = defineOperation({
  operationId: 'insights.definitions',
  method: 'GET',
  path: '/insights/definitions',
  summary: 'O catálogo de definições, sem consultar nada',
  description:
    'Permite montar os textos de ajuda antes de haver período escolhido — a §25 exige que cada ' +
    'métrica exiba sua definição, e a tela de configuração do painel ainda não tem número.',
  permissions: ['insight.read'],
  response: z.object({ items: z.array(MetricDefinition) }),
});

export const insightWorkOrdersOpened = defineOperation({
  operationId: 'insights.opened',
  method: 'GET',
  path: '/insights/work-orders/opened',
  summary: 'Ordens abertas no período',
  permissions: ['insight.read'],
  query: recorte,
  response: envelope(Contagem),
});

export const insightWorkOrdersCompleted = defineOperation({
  operationId: 'insights.completed',
  method: 'GET',
  path: '/insights/work-orders/completed',
  summary: 'Ordens concluídas no período',
  permissions: ['insight.read'],
  query: recorte,
  response: envelope(Contagem),
});

export const insightBacklog = defineOperation({
  operationId: 'insights.backlog',
  method: 'GET',
  path: '/insights/backlog',
  summary: 'O que está em aberto agora',
  description:
    'Fotografia, e não período: backlog é um estado num instante. O parâmetro `to` escolhe o ' +
    'instante; sem ele, agora.',
  permissions: ['insight.read'],
  query: recorte.partial({ from: true }),
  response: envelope(z.record(z.string(), z.unknown())),
});

export const insightMttr = defineOperation({
  operationId: 'insights.mttr',
  method: 'GET',
  path: '/insights/mttr',
  summary: 'Tempo médio de reparo (corretivas)',
  permissions: ['insight.read'],
  query: recorte,
  response: envelope(ValorMedio),
});

export const insightMtbf = defineOperation({
  operationId: 'insights.mtbf',
  method: 'GET',
  path: '/insights/mtbf',
  summary: 'Tempo médio entre falhas',
  permissions: ['insight.read'],
  query: recorte,
  response: envelope(z.record(z.string(), z.unknown())),
});

export const insightSla = defineOperation({
  operationId: 'insights.sla',
  method: 'GET',
  path: '/insights/sla',
  summary: 'Cumprimento de SLA',
  permissions: ['insight.read'],
  query: recorte,
  response: envelope(z.record(z.string(), z.unknown())),
});

export const insightTimeByWaitReason = defineOperation({
  operationId: 'insights.byWaitReason',
  method: 'GET',
  path: '/insights/time-by-wait-reason',
  summary: 'Tempo perdido por motivo de espera',
  description:
    'A pergunta que o ADR-004 destravou e que a referência não conseguia responder: lá, ' +
    '"aguardando peça" estava escrito de quatro formas em quatro estados diferentes, e somá-los ' +
    'exigia adivinhar quais eram os mesmos.',
  permissions: ['insight.read'],
  query: recorte,
  response: envelope(PorMotivo),
});

export const insightPreventiveVsCorrective = defineOperation({
  operationId: 'insights.mix',
  method: 'GET',
  path: '/insights/preventive-vs-corrective',
  summary: 'Proporção entre preventiva e corretiva',
  permissions: ['insight.read'],
  query: recorte,
  response: envelope(z.record(z.string(), z.unknown())),
});

export const insightPlanCompliance = defineOperation({
  operationId: 'insights.plans',
  method: 'GET',
  path: '/insights/plan-compliance',
  summary: 'Cumprimento do plano preventivo',
  permissions: ['insight.read'],
  query: recorte,
  response: envelope(z.record(z.string(), z.unknown())),
});

export const insightFirstResponse = defineOperation({
  operationId: 'insights.firstResponse',
  method: 'GET',
  path: '/insights/first-response',
  summary: 'Tempo até a primeira resposta',
  permissions: ['insight.read'],
  query: recorte,
  response: envelope(ValorMedio),
});

export const insightLaborHours = defineOperation({
  operationId: 'insights.hours',
  method: 'GET',
  path: '/insights/labor-hours',
  summary: 'Horas apontadas no período',
  permissions: ['insight.read'],
  query: recorte,
  response: envelope(z.record(z.string(), z.unknown())),
});

export const insightTimeByStatus = defineOperation({
  operationId: 'insights.byStatus',
  method: 'GET',
  path: '/insights/time-by-status',
  summary: 'Tempo gasto em cada situação',
  permissions: ['insight.read'],
  query: recorte,
  response: envelope(z.record(z.string(), z.unknown())),
});

/* -------------------------------------------------------------------------- */
/* Relatórios BASIC / ADVANCED / EXPERT — fundação (reunião 16/10/2026)        */
/* -------------------------------------------------------------------------- */

export const REPORT_TIER_KEYS = ['basic', 'advanced', 'expert'] as const;

const ReportIndicator = z.object({
  key: z.string(),
  label: z.string(),
  tier: z.enum(REPORT_TIER_KEYS),
  status: z.enum(['available', 'awaiting_official_model', 'awaiting_definition']),
  note: z.string().optional(),
});

export const reportsCatalog = defineOperation({
  operationId: 'reports.catalog',
  method: 'GET',
  path: '/reports/catalog',
  summary: 'Modelos de relatório (Basic, Advanced, Expert) e a situação de cada indicador',
  description:
    'Fundação: o layout final dos três modelos está AGUARDANDO MODELO PDF OFICIAL. Indicador sem ' +
    'fórmula ou definição aparece com a situação, e nunca com número inventado.',
  permissions: ['insight.read'],
  response: z.object({
    tiers: z.array(z.object({ key: z.enum(REPORT_TIER_KEYS), label: z.string() })),
    indicators: z.array(ReportIndicator),
    layout_status: z.literal('awaiting_official_model'),
    layout_note: z.string(),
  }),
});

export const reportsGenerate = defineOperation({
  operationId: 'reports.generate',
  method: 'POST',
  path: '/reports/generate',
  summary: 'Gera o relatório (JSON; `?format=pdf` para o PDF provisório) sobre os dados reais do Painel',
  description:
    'Mesmas funções de indicador do Painel, com o filtro escopado pelo vínculo. Período até 400 dias. ' +
    'Indicadores fora do modelo escolhido → 422. Cliente fora do escopo → 404.',
  permissions: ['insight.read'],
  body: z
    .object({
      tier: z.enum(REPORT_TIER_KEYS),
      indicators: z.array(z.string()).max(50).optional(),
      from: z.string(),
      to: z.string(),
      customer_id: Uuid.optional(),
      sector_id: Uuid.optional(),
      plan_kind: z.enum(['preventive', 'calibration', 'electrical_safety', 'qualification']).optional(),
      asset_category_id: Uuid.optional(),
    })
    .strict(),
  response: z.object({
    tier: z.enum(REPORT_TIER_KEYS),
    generated_at: z.string(),
    layout_status: z.literal('awaiting_official_model'),
    filters: z.record(z.string(), z.string().nullable()),
    sections: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        status: z.enum(['available', 'awaiting_official_model', 'awaiting_definition']),
        note: z.string().nullable(),
        value: z.number().nullable(),
        unit: z.enum(['count', 'minutes', 'hours', 'percent', 'none']),
        samples: z.number().nullable(),
        detail: z.unknown(),
        definition: z.string().nullable(),
      })
    ),
  }),
  status: 201,
  errors: ['not_found', 'validation_failed'],
});
