/**
 * Aurora — tela Hoje: as listas por trás dos contadores de espera (ORC-05).
 *
 * "Aguardando orçamento" e "aguardando peças" eram dois números sem lista. Agora o número e a
 * lista saem da MESMA consulta: o contador é o tamanho da lista com os mesmos recortes, e cada
 * linha aponta para o lugar certo — a OS, ou o orçamento quando ele ainda não tem OS.
 *
 * O QUE CONTA COMO ESPERA
 *
 *   · peças     — OS parada (`waiting`) com o motivo de espera `parts`;
 *   · orçamento — OS parada com o motivo `quote_approval`, OU OS em aberto com orçamento enviado
 *                 e ainda sem resposta (`sent`/`viewed`), OU orçamento enviado sem OS (só para
 *                 quem tem `quote.read`). OS encerrada ou cancelada não espera nada.
 *
 * O escopo do vínculo vale em tudo (cliente e local); o "perfil" é isso — o hospital vê só o dele.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const WAITING_REASONS = ['quote', 'parts'] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];

export const WaitingItem = z.object({
  /** `work_order`: a linha leva à OS. `quote`: orçamento sem OS, leva ao orçamento. */
  kind: z.enum(['work_order', 'quote']),
  reason: z.enum(WAITING_REASONS),
  work_order_id: Uuid.nullable(),
  work_order_number: z.string().nullable(),
  title: z.string(),
  quote_id: Uuid.nullable(),
  quote_number: z.string().nullable(),
  quote_status: z.string().nullable(),
  customer_id: Uuid,
  customer_name: z.string(),
  sector_id: Uuid.nullable(),
  sector_name: z.string().nullable(),
  assignee_membership_id: Uuid.nullable(),
  assignee_name: z.string().nullable(),
  asset_name: z.string().nullable(),
  wait_reason_label: z.string().nullable(),
  /** Desde quando espera: mudança de situação da OS ou envio do orçamento. */
  since: Timestamp.nullable(),
});
export type WaitingItem = z.infer<typeof WaitingItem>;

const Faceta = z.object({ id: Uuid, label: z.string(), total: z.number().int() });

export const todayWaiting = defineOperation({
  operationId: 'today.waiting',
  method: 'GET',
  path: '/today/waiting',
  summary: 'Aguardando orçamento e aguardando peças: contadores e listas com os mesmos recortes',
  description:
    'Recortes combináveis: cliente, setor (um ou vários) e responsável, sempre dentro do escopo do ' +
    'vínculo. `counts` traz os dois totais com os recortes aplicados; `items`, as linhas do motivo ' +
    'pedido (ou dos dois). `facets` lista os clientes, setores e responsáveis presentes, para a ' +
    'tela oferecer só o que existe.',
  permissions: ['work_order.read'],
  query: z.object({
    reason: z.enum(WAITING_REASONS).optional(),
    customer: Uuid.optional(),
    sector: z.union([Uuid, z.array(Uuid).max(50)]).optional(),
    assignee: Uuid.optional(),
  }),
  response: z.object({
    counts: z.object({ quote: z.number().int(), parts: z.number().int() }),
    items: z.array(WaitingItem),
    facets: z.object({
      customers: z.array(Faceta),
      sectors: z.array(Faceta),
      assignees: z.array(Faceta),
    }),
  }),
  errors: ['not_found', 'validation_failed'],
});
