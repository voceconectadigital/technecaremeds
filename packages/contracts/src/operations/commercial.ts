/**
 * Aurora — orçamentos e contratos (SPEC v0.2 §16, §17 · EPIC-016, EPIC-017).
 *
 * DINHEIRO NUNCA VIAJA COMO `number`.
 *
 * Valor de orçamento é `bigint` em centavos; valor de contrato é `numeric`. Os
 * dois viajam como texto pela mesma razão: em JavaScript, `bigint` acima de
 * 2^53 perde precisão em silêncio e `numeric` vira ponto flutuante. Um sistema
 * que fecha o mês com três centavos de diferença consome uma tarde de alguém
 * toda vez, e a origem nunca está onde se procura.
 *
 * A SITUAÇÃO EFETIVA VEM SEPARADA DA GRAVADA.
 *
 * Um orçamento vence pela DATA, não pela varredura. `status` é o que está na
 * linha; `effective_status` é o que vale agora. A tela precisa dos dois: dizer
 * "vencido" antes de a varredura rodar, e saber que a linha ainda diz outra
 * coisa — senão o botão "aprovar" aparece num orçamento que já não pode ser
 * aprovado.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

/* -------------------------------------------------------------------------- */
/* Orçamentos                                                                 */
/* -------------------------------------------------------------------------- */

export const QUOTE_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'approved',
  'rejected',
  'expired',
  'in_execution',
  'invoiced',
  'closed',
  'cancelled',
  'superseded',
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QuoteRow = z.object({
  id: Uuid,
  /** O número é estável entre versões; a versão é que muda. */
  number: z.string(),
  version: z.number().int(),
  status: z.enum(QUOTE_STATUSES),
  customer_id: Uuid,
  work_order_id: Uuid.nullable(),
  valid_until: z.string().nullable(),
  /** Centavos, como texto: `bigint` acima de 2^53 perde precisão em JavaScript. */
  total_cents: z.string(),
  created_at: Timestamp,
});
export type QuoteRow = z.infer<typeof QuoteRow>;

export const quotesList = defineOperation({
  operationId: 'quotes.list',
  method: 'GET',
  path: '/quotes',
  summary: 'Orçamentos, dos mais recentes para os mais antigos',
  permissions: ['quote.read'],
  query: z.object({
    customerId: Uuid.optional(),
    status: z.enum(QUOTE_STATUSES).optional(),
  }),
  response: z.object({ items: z.array(QuoteRow) }),
});

export const QuoteItem = z.object({
  id: Uuid,
  position: z.number().int(),
  kind: z.string(),
  item_id: Uuid.nullable(),
  description: z.string(),
  unit: z.string().nullable(),
  quantity: z.string(),
  unit_price_cents: z.string(),
  discount_cents: z.string(),
  net_cents: z.string(),
  /**
   * De onde veio o preço: tabela do contrato, tabela padrão, ou digitado.
   *
   * Aparece na linha porque muda a conversa: preço de tabela é discutido com o
   * comercial; preço digitado é discutido com quem digitou.
   */
  price_source: z.string().nullable(),
});
export type QuoteItem = z.infer<typeof QuoteItem>;

export const QuoteTransition = z.object({
  to: z.enum(QUOTE_STATUSES),
  label: z.string(),
  permission: z.string(),
});

export const quoteDetail = defineOperation({
  operationId: 'quotes.detail',
  method: 'GET',
  path: '/quotes/:id',
  summary: 'Orçamento, com itens e transições possíveis',
  description:
    '`effective_status` vem separado de `quote.status`: o orçamento vence pela DATA, e não pela ' +
    'varredura. A tela precisa dizer "vencido" antes de a varredura rodar, e saber que a linha ' +
    'ainda diz outra coisa.',
  permissions: ['quote.read'],
  params: z.object({ id: Uuid }),
  response: z.object({
    quote: z.object({
      id: Uuid,
      number: z.string(),
      version: z.number().int(),
      status: z.enum(QUOTE_STATUSES),
      customer_id: Uuid,
      work_order_id: Uuid.nullable(),
      valid_until: z.string().nullable(),
      approver_contact_id: Uuid.nullable(),
      total_cents: z.string(),
    }),
    effective_status: z.enum(QUOTE_STATUSES),
    items: z.array(QuoteItem),
    transitions: z.array(QuoteTransition),
  }),
  errors: ['not_found'],
});

export const QuoteVersion = z.object({
  id: Uuid,
  version: z.number().int(),
  status: z.enum(QUOTE_STATUSES),
  total_cents: z.string(),
  created_at: Timestamp,
  decided_at: Timestamp.nullable(),
});

export const quoteVersions = defineOperation({
  operationId: 'quotes.versions',
  method: 'GET',
  path: '/quotes/:id/versions',
  summary: 'As versões deste orçamento, da mais nova para a mais velha',
  description:
    'Revisar não sobrescreve: cria uma versão nova e marca a anterior como substituída. O que o ' +
    'cliente aprovou continua existindo exatamente como era quando ele aprovou.',
  permissions: ['quote.read'],
  params: z.object({ id: Uuid }),
  response: z.object({ items: z.array(QuoteVersion) }),
});

export const quoteTransition = defineOperation({
  operationId: 'quotes.transition',
  method: 'POST',
  path: '/quotes/:id/transitions',
  summary: 'Move o orçamento de estado',
  permissions: ['quote.read'],
  params: z.object({ id: Uuid }),
  body: z.object({
    to: z.enum(QUOTE_STATUSES),
    reason: z.string().nullable().optional(),
  }),
  response: z.object({ status: z.enum(QUOTE_STATUSES) }),
  status: 201,
  errors: ['validation_failed', 'forbidden', 'not_found'],
});

/* -------------------------------------------------------------------------- */
/* Contratos                                                                  */
/* -------------------------------------------------------------------------- */

export const CONTRACT_STATUSES = ['draft', 'active', 'suspended', 'expired', 'terminated'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/**
 * O PERFIL é a classificação do contrato — básico, completo ou expert, e só
 * isso (confirmado pelo cliente). O título é texto livre e não classifica
 * nada. Repetido de `@aurora/domain` (paridade em `paridade-contratos.test`).
 */
export const CONTRACT_PROFILES = ['basic', 'complete', 'expert'] as const;
export type ContractProfile = (typeof CONTRACT_PROFILES)[number];
export const CONTRACT_PROFILE_LABELS: Record<ContractProfile, string> = {
  basic: 'Básico',
  complete: 'Completo',
  expert: 'Expert',
};

export const ContractRow = z.object({
  id: Uuid,
  number: z.string(),
  /** Nulo é permitido: há contrato identificado só pelo número. */
  title: z.string().nullable(),
  customer_id: Uuid,
  customer_name: z.string(),
  /** Natureza do acordo (locação, comodato…). Opcional — não é o tipo. */
  kind: z.string().nullable(),
  /** Nulo nos contratos anteriores à 0060: o perfil nunca é inferido. */
  profile: z.enum(CONTRACT_PROFILES).nullable(),
  status: z.enum(CONTRACT_STATUSES),
  starts_on: z.string(),
  ends_on: z.string().nullable(),
  auto_renew: z.boolean(),
  billing_model: z.string(),
});
export type ContractRow = z.infer<typeof ContractRow>;

export const contractsList = defineOperation({
  operationId: 'contracts.list',
  method: 'GET',
  path: '/contracts',
  summary: 'Contratos vigentes e encerrados',
  permissions: ['contract.read'],
  query: z.object({
    customerId: Uuid.optional(),
    status: z.enum(CONTRACT_STATUSES).optional(),
    /** `none` = contratos ainda sem perfil definido. */
    profile: z.enum([...CONTRACT_PROFILES, 'none']).optional(),
  }),
  response: z.object({ items: z.array(ContractRow) }),
});

export const ContractCoverage = z.object({
  id: Uuid,
  /** `asset`, `location` ou `asset_category` — a expressão, não a lista. */
  kind: z.string(),
  asset_id: Uuid.nullable(),
  location_id: Uuid.nullable(),
  asset_category_id: Uuid.nullable(),
  /**
   * Quão de perto esta cobertura nomeia o ativo.
   *
   * É o desempate quando duas coberturas alcançam o mesmo equipamento: vence
   * quem nomeia mais de perto. Devolver as duas e deixar a aplicação escolher
   * faria a política de SLA depender da ordem de leitura do banco — pior que
   * uma regra discutível, porque seria uma regra invisível.
   */
  specificity: z.number().int(),
});
export type ContractCoverage = z.infer<typeof ContractCoverage>;

export const contractDetail = defineOperation({
  operationId: 'contracts.detail',
  method: 'GET',
  path: '/contracts/:id',
  summary: 'Contrato, com coberturas e serviços',
  description:
    'Valor mensal, taxas de excedente e percentuais de glosa saem da CONSULTA para quem não tem ' +
    '`contract.read_financials`. O coordenador precisa saber o que o contrato COBRE; o que ele ' +
    'custa é conversa comercial.',
  permissions: ['contract.read'],
  params: z.object({ id: Uuid }),
  response: z.object({
    contract: z.object({
      id: Uuid,
      number: z.string(),
      title: z.string().nullable(),
      customer_id: Uuid,
      kind: z.string().nullable(),
      profile: z.enum(CONTRACT_PROFILES).nullable(),
      status: z.enum(CONTRACT_STATUSES),
      starts_on: z.string(),
      ends_on: z.string().nullable(),
      auto_renew: z.boolean(),
      renewal_notice_days: z.number().int().nullable(),
      adjustment_index: z.string().nullable(),
      sla_policy_id: Uuid.nullable(),
      price_list_id: Uuid.nullable(),
      billing_model: z.string(),
      included_calls: z.number().int().nullable(),
      included_hours: z.string().nullable(),
      sla_target_percent: z.string().nullable(),
      plan_target_percent: z.string().nullable(),
      notes: z.string().nullable(),
      archived_at: Timestamp.nullable(),
      created_at: Timestamp,
      updated_at: Timestamp,
      /* Só para quem tem `contract.read_financials`. */
      monthly_value: z.string().nullable().optional(),
      currency: z.string().nullable().optional(),
      overage_call_rate: z.string().nullable().optional(),
      overage_hour_rate: z.string().nullable().optional(),
      penalty_percent_per_breach: z.string().nullable().optional(),
      penalty_cap_percent: z.string().nullable().optional(),
    }),
    coverages: z.array(ContractCoverage),
    services: z.array(
      z.object({
        work_order_type_id: Uuid,
        /**
         * Três respostas, e não duas: incluído, incluído mas faturado à parte,
         * e fora do escopo. Colapsar as duas últimas perderia de vista o
         * serviço que o contrato prevê E cobra — que é o que entra na fatura
         * como excedente.
         */
        billed_separately: z.boolean(),
      })
    ),
  }),
  errors: ['not_found', 'validation_failed'],
});

export const contractAssets = defineOperation({
  operationId: 'contracts.assets',
  method: 'GET',
  path: '/contracts/:id/assets',
  summary: 'Os ativos que a cobertura alcança HOJE',
  description:
    'A cobertura é expressão, e não lista: "todos os ventiladores da UTI" continua valendo para o ' +
    'ventilador que chegar amanhã. Esta rota resolve a expressão contra o parque de agora — a ' +
    'pergunta que o operador faz antes de ativar.',
  permissions: ['contract.read'],
  params: z.object({ id: Uuid }),
  response: z.object({
    items: z.array(
      z.object({
        id: Uuid,
        name: z.string(),
        location_path: z.string().nullable(),
      })
    ),
  }),
});
