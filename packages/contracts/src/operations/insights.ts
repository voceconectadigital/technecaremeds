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
import { z, Uuid, Timestamp } from '../primitives';

export const METRIC_UNITS = ['count', 'minutes', 'hours', 'percent', 'days', 'score'] as const;

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
/* Relatórios BASIC / ADVANCED / EXPERT — catálogo, metas e geração            */
/* -------------------------------------------------------------------------- */

export const REPORT_TIER_KEYS = ['basic', 'advanced', 'expert'] as const;
const INDICATOR_STATE_KEYS = ['ACTIVE', 'PROVISIONAL', 'PENDING_DEFINITION'] as const;
const TARGET_DIRECTION_KEYS = ['HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'INFORMATIONAL'] as const;
const INDICATOR_UNIT_KEYS = ['count', 'minutes', 'hours', 'percent', 'score', 'none'] as const;
const LEGACY_STATUS = z.enum(['available', 'awaiting_official_model', 'awaiting_definition']);

const ReportIndicator = z.object({
  /** Código estável. */
  key: z.string(),
  label: z.string(),
  description: z.string(),
  unit: z.enum(INDICATOR_UNIT_KEYS),
  category: z.string(),
  /** Modelos em que pode aparecer. O Expert não herda o Basic nem o Advanced. */
  tiers: z.array(z.enum(REPORT_TIER_KEYS)),
  state: z.enum(INDICATOR_STATE_KEYS),
  target_direction: z.enum(TARGET_DIRECTION_KEYS),
  source: z.string().nullable(),
  pending_kind: z.enum(['DEFINITION', 'DATA_MODEL']).optional(),
  note: z.string().optional(),
  /** Derivada de `state`; mantida por compatibilidade. */
  status: LEGACY_STATUS,
});

export const reportsCatalog = defineOperation({
  operationId: 'reports.catalog',
  method: 'GET',
  path: '/reports/catalog',
  summary: 'Catálogo central de indicadores e os modelos Basic, Advanced e Expert',
  description:
    'Fonte única da definição dos indicadores: código, unidade, categoria, modelos permitidos, situação ' +
    '(ACTIVE, PROVISIONAL, PENDING_DEFINITION) e sentido da meta. Indicador PENDING_DEFINITION aparece ' +
    'só aqui, com o motivo: não entra em relatório e não tem número inventado. Layout dos PDFs: o ' +
    'Advanced segue o modelo do cliente, o Basic o mesmo padrão visual, e o Expert é a casca do IMR.',
  permissions: ['insight.read'],
  response: z.object({
    tiers: z.array(z.object({ key: z.enum(REPORT_TIER_KEYS), label: z.string() })),
    indicators: z.array(ReportIndicator),
    layout_status: z.literal('layouts_defined'),
    layout_note: z.string(),
  }),
});

const SectionTarget = z.object({
  id: Uuid,
  value: z.number(),
  unit: z.string(),
  direction: z.enum(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']),
  scope: z.enum(['contract', 'customer', 'organization']),
  valid_from: z.string(),
  valid_to: z.string().nullable(),
});

export const reportsGenerate = defineOperation({
  operationId: 'reports.generate',
  method: 'POST',
  path: '/reports/generate',
  summary:
    'Gera o relatório (JSON; `?format=pdf` para o PDF, `?format=xlsx` para a planilha) sobre os dados reais do Painel',
  description:
    'Mesmas funções de indicador do Painel, com o filtro escopado pelo vínculo. Período até 400 dias. ' +
    'Sem `indicators`, entram só os ACTIVE; PROVISIONAL só pedido explicitamente (sai marcado); ' +
    'PENDING_DEFINITION nunca entra (422) e é listado em `pending`. A meta de cada indicador é a mais ' +
    'específica em vigor (contrato → cliente → organização) no último dia do período; sem meta, ' +
    '`target_label` = SEM META CONFIGURADA. `contract_id` escolhe a meta do contrato. ' +
    'Indicadores fora do modelo escolhido → 422. Cliente fora do escopo → 404. ' +
    'Em `?format=xlsx` (Excel), as abas são Indicadores, Série mensal (Basic e Advanced) e Filtros; ' +
    'indicador pendente sai como o texto "Pendente de definição", nunca como número.',
  permissions: ['insight.read'],
  body: z
    .object({
      tier: z.enum(REPORT_TIER_KEYS),
      indicators: z.array(z.string()).max(50).optional(),
      from: z.string(),
      to: z.string(),
      customer_id: Uuid.optional(),
      contract_id: Uuid.optional(),
      sector_id: Uuid.optional(),
      plan_kind: z.enum(['preventive', 'calibration', 'electrical_safety', 'qualification']).optional(),
      asset_category_id: Uuid.optional(),
      /** Só para o PDF Basic e Advanced: campos do cabeçalho e das assinaturas. */
      cost_center: z.string().trim().max(60).optional(),
      city: z.string().trim().max(60).optional(),
      signatories: z
        .array(z.object({ name: z.string().trim().max(80), role: z.string().trim().min(1).max(80) }).strict())
        .max(3)
        .optional(),
    })
    .strict(),
  response: z.object({
    tier: z.enum(REPORT_TIER_KEYS),
    generated_at: z.string(),
    layout_status: z.literal('layouts_defined'),
    filters: z.record(z.string(), z.string().nullable()),
    sections: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        state: z.enum(INDICATOR_STATE_KEYS),
        status: LEGACY_STATUS,
        note: z.string().nullable(),
        value: z.number().nullable(),
        unit: z.enum(INDICATOR_UNIT_KEYS),
        samples: z.number().nullable(),
        detail: z.unknown(),
        definition: z.string().nullable(),
        direction: z.enum(TARGET_DIRECTION_KEYS),
        target: SectionTarget.nullable(),
        target_evaluation: z.enum(['met', 'not_met', 'no_value', 'no_target', 'informational']),
        target_label: z.string().nullable(),
      })
    ),
    pending: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        state: z.enum(INDICATOR_STATE_KEYS),
        note: z.string().nullable(),
      })
    ),
  }),
  status: 201,
  errors: ['not_found', 'validation_failed'],
});

/* --- relatório patrimonial (REL-11) ------------------------------------- */

export const ASSET_REPORT_SITUATION_KEYS = ['all', 'active', 'maintenance', 'obsolete'] as const;
const ASSET_STATUS_KEYS = [
  'active',
  'under_maintenance',
  'standby',
  'loaned',
  'decommissioned',
  'disposed',
] as const;

const AssetReportTotals = z.object({
  currency: z.string(),
  assets_with_value: z.number(),
  purchase_value: z.number(),
  book_value: z.number(),
  assets_without_depreciation: z.number(),
});

export const reportsAssets = defineOperation({
  operationId: 'reports.assets',
  method: 'POST',
  path: '/reports/assets',
  summary:
    'Relatório patrimonial: ativos, em manutenção e obsoletos, com depreciação (JSON; `?format=pdf` ou `?format=xlsx`)',
  description:
    'O inventário no MESMO recorte da lista de equipamentos (escopo do vínculo), filtrado por cliente e ' +
    'situação. "Ativos" = em operação, reserva ou emprestados; "em manutenção" = situação cadastrada; ' +
    '"obsoletos" = baixados ou descartados (com o laudo OBC quando a baixa veio dele). Valor de compra, ' +
    'residual, NF, depreciação acumulada, valor contábil e os totais em dinheiro só saem com ' +
    '`asset.read_financials` (a mesma regra da ficha do ativo); sem ela, são nulos e `totals` vem vazio. ' +
    'Cliente fora do escopo → 404. A geração é leitura: nada é gravado.',
  permissions: ['insight.read', 'asset.read'],
  body: z
    .object({
      customer_id: Uuid.optional(),
      situation: z.enum(ASSET_REPORT_SITUATION_KEYS).optional(),
    })
    .strict(),
  response: z.object({
    generated_at: z.string(),
    filters: z.object({
      customer: z.string().nullable(),
      situation: z.enum(ASSET_REPORT_SITUATION_KEYS),
    }),
    counts: z.object({
      active: z.number(),
      maintenance: z.number(),
      obsolete: z.number(),
      total: z.number(),
    }),
    by_status: z.record(z.string(), z.number()),
    financials_visible: z.boolean(),
    totals: z.array(AssetReportTotals),
    assets_without_value: z.number().nullable(),
    /** Na tela, as primeiras linhas; o PDF e o Excel trazem o recorte inteiro. */
    items_truncated: z.boolean(),
    items: z.array(
      z.object({
        id: Uuid,
        name: z.string(),
        tag: z.string().nullable(),
        serial_number: z.string().nullable(),
        asset_number: z.string().nullable(),
        customer_name: z.string(),
        location_name: z.string().nullable(),
        category_name: z.string(),
        manufacturer_name: z.string().nullable(),
        model_name: z.string().nullable(),
        status: z.enum(ASSET_STATUS_KEYS),
        situation: z.enum(['active', 'maintenance', 'obsolete']),
        acquired_at: z.string().nullable(),
        useful_life_years: z.number().nullable(),
        decommissioned_at: z.string().nullable(),
        decommission_reason: z.string().nullable(),
        obsolescence_report: z.string().nullable(),
        percent_depreciated: z.number().nullable(),
        currency: z.string().nullable(),
        acquisition_invoice: z.string().nullable(),
        purchase_value: z.number().nullable(),
        residual_value: z.number().nullable(),
        accumulated_depreciation: z.number().nullable(),
        book_value: z.number().nullable(),
      })
    ),
  }),
  status: 201,
  errors: ['not_found', 'validation_failed'],
});

/* --- metas dos indicadores ---------------------------------------------- */

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');

export const IndicatorTargetView = z.object({
  id: Uuid,
  indicator_key: z.string(),
  customer_id: Uuid.nullable(),
  contract_id: Uuid.nullable(),
  scope: z.enum(['contract', 'customer', 'organization']),
  valid_from: IsoDay,
  valid_to: IsoDay.nullable(),
  value: z.number(),
  unit: z.enum(['count', 'minutes', 'hours', 'percent', 'score']),
  direction: z.enum(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']),
  /** Vigência em relação a hoje: em vigor, futura ou expirada. */
  timeline: z.enum(['active', 'future', 'expired']),
  note: z.string().nullable(),
  created_at: Timestamp,
  updated_at: Timestamp,
});

export const indicatorTargetsList = defineOperation({
  operationId: 'indicatorTargets.list',
  method: 'GET',
  path: '/indicator-targets',
  summary: 'Metas configuradas dos indicadores',
  description:
    'A meta da organização é visível a todos; meta de cliente ou contrato só a quem alcança o cliente. ' +
    'Indicador sem linha aqui está SEM META CONFIGURADA — nunca zero.',
  permissions: ['insight.read'],
  query: z.object({
    indicator_key: z.string().optional(),
    customer_id: Uuid.optional(),
    contract_id: Uuid.optional(),
  }),
  response: z.object({ items: z.array(IndicatorTargetView) }),
});

const TargetBody = z.object({
  indicator_key: z.string().min(2).max(64),
  customer_id: Uuid.nullish(),
  contract_id: Uuid.nullish(),
  valid_from: IsoDay,
  valid_to: IsoDay.nullish(),
  value: z.number().nonnegative(),
  direction: z.enum(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']),
  /** Opcional: se vier, precisa ser a unidade do indicador no catálogo. */
  unit: z.enum(['count', 'minutes', 'hours', 'percent', 'score']).optional(),
  note: z.string().max(500).nullish(),
});

export const indicatorTargetsCreate = defineOperation({
  operationId: 'indicatorTargets.create',
  method: 'POST',
  path: '/indicator-targets',
  summary: 'Configura a meta de um indicador (organização, cliente ou contrato)',
  description:
    'Sem cliente = meta da organização (exige acesso a todos os clientes). Com contrato, o cliente é o do ' +
    'contrato. O sentido e a unidade precisam ser os do indicador no catálogo; indicador informativo não ' +
    'tem meta. Vigências do mesmo escopo não se sobrepõem (409).',
  permissions: ['insight.manage_targets'],
  body: TargetBody.strict(),
  response: IndicatorTargetView,
  status: 201,
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const indicatorTargetsUpdate = defineOperation({
  operationId: 'indicatorTargets.update',
  method: 'PATCH',
  path: '/indicator-targets/:id',
  summary: 'Altera valor, vigência, sentido ou observação de uma meta',
  description: 'Indicador, cliente e contrato não mudam: outra meta é outro registro.',
  permissions: ['insight.manage_targets'],
  params: z.object({ id: Uuid }),
  body: TargetBody.pick({ valid_from: true, valid_to: true, value: true, direction: true, note: true })
    .partial()
    .strict(),
  response: IndicatorTargetView,
  status: 200,
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const indicatorTargetsArchive = defineOperation({
  operationId: 'indicatorTargets.archive',
  method: 'DELETE',
  path: '/indicator-targets/:id',
  summary: 'Arquiva uma meta (não apaga: a trilha de auditoria permanece)',
  permissions: ['insight.manage_targets'],
  params: z.object({ id: Uuid }),
  response: z.object({ ok: z.literal(true) }),
  status: 200,
  errors: ['not_found'],
});
