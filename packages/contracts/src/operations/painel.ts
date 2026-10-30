/**
 * Aurora — Painel de Controle (SPEC v0.2 §25 · EPIC-021).
 *
 * UMA ROTA PARA O PAINEL, E NÃO UMA FÓRMULA NOVA.
 *
 * O painel (e o Modo Exibição, que é a mesma resposta em tela cheia) pede
 * tudo de uma vez porque é exibido numa televisão que se atualiza sozinha: dez
 * idas ao servidor a cada minuto, por tela, é o tipo de carga que não aparece
 * em teste e derruba a API num hospital com cinco monitores.
 *
 * Cada número é uma das métricas de `/insights/*` — a mesma função, a mesma
 * definição, o mesmo envelope com cobertura. As séries são essas mesmas
 * definições aplicadas a fatias do período. A fotografia do parque é a
 * contagem do status cadastrado, e NÃO disponibilidade (sem definição do
 * cliente — AI-HANDOFF §15-A).
 *
 * O escopo é o do vínculo: hospital vê o próprio cliente; filtro de cliente
 * fora do escopo responde 404.
 */
import { defineOperation } from '../registry';
import { z, Uuid } from '../primitives';
import { Coverage, MetricDefinition } from './insights';

const Envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    metric: z.string(),
    definition: MetricDefinition,
    period: z.object({ from: z.string(), to: z.string() }),
    filters: z.record(z.string(), z.string().nullable()),
    coverage: Coverage.nullable(),
    data,
  });

/** Uma meta resolvida (mesma forma da meta da seção do relatório). */
export const PanelTarget = z.object({
  id: Uuid,
  value: z.number(),
  unit: z.string(),
  direction: z.enum(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']),
  scope: z.enum(['contract', 'customer', 'organization']),
  valid_from: z.string(),
  valid_to: z.string().nullable(),
});
export type PanelTarget = z.infer<typeof PanelTarget>;

const Media = z.object({ value: z.number().nullable(), samples: z.number().int() }).passthrough();

export const ControlPanelPoint = z.object({
  start: z.string(),
  end: z.string(),
  opened: z.number().int(),
  completed: z.number().int(),
  completedPreventive: z.number().int(),
  completedCorrective: z.number().int(),
  backlog: z.number().int(),
  /** MTTR da fatia (corretivas concluídas nela). Nulo = sem amostra, nunca zero. */
  mttrMinutes: z.number().nullable().optional(),
  mttrSamples: z.number().int().optional(),
});
export type ControlPanelPoint = z.infer<typeof ControlPanelPoint>;

export const ControlPanel = z.object({
  generated_at: z.string(),
  granularity: z.enum(['day', 'week', 'month']),
  /** O que o filtro de cliente pode oferecer a ESTA pessoa. */
  customers: z.array(z.object({ id: Uuid, name: z.string() })),
  sectors: z.array(z.object({ id: Uuid, name: z.string(), customer_id: Uuid })),
  kpis: z.object({
    opened: Envelope(z.object({ count: z.number().int() })),
    completed: Envelope(z.object({ count: z.number().int() })),
    backlog: Envelope(
      z.object({
        count: z.number().int(),
        buckets: z.record(z.string(), z.number().int()),
        oldestDays: z.number().int().nullable(),
      })
    ),
    mttr: Envelope(Media),
    mtbf: Envelope(Media.extend({ assetsWithInterval: z.number().int() })),
    sla: Envelope(
      z.object({
        met: z.number().int(),
        breached: z.number().int(),
        rate: z.number().nullable(),
        byKind: z.record(
          z.string(),
          z.object({ met: z.number().int(), breached: z.number().int(), rate: z.number().nullable() })
        ),
      })
    ),
    mix: Envelope(
      z.object({
        preventive: z.number().int(),
        corrective: z.number().int(),
        preventiveShare: z.number().nullable(),
      })
    ),
    plan_compliance: Envelope(
      z.object({
        expected: z.number().int(),
        done: z.number().int(),
        skipped: z.number().int(),
        rate: z.number().nullable(),
      })
    ),
    /**
     * Avaliação das OS (REL-14): média de 1 a 5 das notas dadas e assinadas no período, uma por
     * OS. Nula sem avaliação — nunca zero. Opcional: capturas antigas da demo não têm.
     */
    work_order_rating: Envelope(
      z.object({
        average: z.number().nullable(),
        count: z.number().int(),
        distribution: z.record(z.string(), z.number().int()),
      })
    ).optional(),
    productivity: Envelope(
      z.array(
        z.object({
          membershipId: Uuid,
          name: z.string().nullable(),
          completed: z.number().int(),
          laborMinutes: z.number().int(),
        })
      )
    ),
  }),
  series: z.array(ControlPanelPoint),
  open_now: z.object({
    byStatus: z.record(z.string(), z.number().int()),
    byPriority: z.record(z.string(), z.number().int()),
  }),
  /**
   * Preventivas do período: itens de ciclo EXISTENTES com vencimento no
   * período (mesma régua de `/maintenance-plans/board`). Opcional: capturas
   * anteriores da demo não o têm.
   */
  preventives: z
    .object({
      totals: z.object({
        scheduled: z.number().int(),
        done: z.number().int(),
        pending: z.number().int(),
        late: z.number().int(),
        skipped: z.number().int(),
      }),
      rate: z.number().nullable(),
      byMonth: z.array(
        z.object({
          key: z.string(),
          done: z.number().int(),
          pending: z.number().int(),
          late: z.number().int(),
          skipped: z.number().int(),
        })
      ),
    })
    .optional(),
  park: z.object({
    total: z.number().int(),
    byStatus: z.record(z.string(), z.number().int()),
    bySector: z.array(
      z.object({ location_id: Uuid, name: z.string(), customer_name: z.string(), assets: z.number().int() })
    ),
    withoutSector: z.number().int(),
  }),
  /**
   * Metas configuradas que valem neste recorte (contrato → cliente →
   * organização; vínculo de um cliente só usa a meta desse cliente), por código
   * de indicador do catálogo. Nulo = SEM META CONFIGURADA: a tela usa cor
   * neutra, e não um limiar fixo. Opcional: capturas antigas da demo não têm.
   */
  targets: z
    .object({
      target_day: z.string(),
      items: z.record(z.string(), PanelTarget.nullable()),
    })
    .optional(),
});
export type ControlPanel = z.infer<typeof ControlPanel>;

export const insightControlPanel = defineOperation({
  operationId: 'insights.controlPanel',
  method: 'GET',
  path: '/insights/control-panel',
  summary: 'Painel de Controle: indicadores, séries e fotografias numa resposta',
  description:
    'Cada indicador é o mesmo de `/insights/*`, com definição e cobertura. As séries aplicam ' +
    'as mesmas definições a fatias do período (dia até 31 dias, semana até 120, mês acima). ' +
    'O parque é a contagem do status cadastrado — não é disponibilidade. Tudo recortado pelo ' +
    'escopo do vínculo; cliente fora do escopo responde 404.',
  permissions: ['insight.read'],
  query: z.object({
    from: z.string(),
    to: z.string(),
    customerId: Uuid.optional(),
    /** Setor (local): recorta pela subárvore dele. */
    sectorId: Uuid.optional(),
  }),
  response: ControlPanel,
  errors: ['not_found', 'validation_failed'],
});
