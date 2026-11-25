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
  /**
   * Quanto da linha já tinha sido lançado em campo, na OS, quando o orçamento
   * foi aprovado (PF-34): essa parte não foi reservada de novo. Não muda o
   * valor cobrado. "0.000" em toda linha não aprovada.
   */
  field_consumed_qty: z.string().optional(),
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
    note: z.string().nullable().optional(),
    /** Obrigatório para REPROVAR: motivo do catálogo `rejection_reason`. */
    rejectionReasonId: Uuid.optional(),
    acceptanceNote: z.string().nullable().optional(),
  }),
  response: z.object({ status: z.enum(QUOTE_STATUSES) }),
  status: 201,
  errors: ['validation_failed', 'forbidden', 'not_found'],
});

/* -------------------------------------------------------------------------- */
/* Contratos                                                                  */
/* -------------------------------------------------------------------------- */

export const CONTRACT_STATUSES = ['draft', 'active', 'suspended', 'expired', 'terminated'] as const;
/** D-4: as duas retenções que alguém aciona no contrato (o vencimento é a data). */
export const SERVICE_HOLDS = ['suspended', 'blocked'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/**
 * Contrato no cadastro do cliente (Anderson, 10/11/2026 — 0090). TRÊS CONCEITOS SEPARADOS:
 * modalidade de atendimento (+ equipes fixas), base de precificação (`billing_model`) e
 * condição de pagamento. Tudo cadastro: nenhum faturamento lê estes campos.
 */
export const CONTRACT_KINDS = [
  'full_service',
  'preventive_only',
  'on_demand',
  'rental',
  'loan',
  'warranty',
] as const;
export const BILLING_MODELS = ['fixed_monthly', 'per_asset', 'per_call', 'per_hour', 'hybrid'] as const;
export type BillingModel = (typeof BILLING_MODELS)[number];
export const SERVICE_FREQUENCIES = [
  'annual',
  'semiannual',
  'quarterly',
  'monthly',
  'biweekly',
  'weekly',
] as const;
export type ServiceFrequency = (typeof SERVICE_FREQUENCIES)[number];
export const PAYMENT_TERMS = ['monthly', 'upfront'] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];
export const FIXED_TEAM_PACKAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const ContractRow = z.object({
  id: Uuid,
  number: z.string(),
  /** Nulo é permitido: há contrato identificado só pelo número. */
  title: z.string().nullable(),
  customer_id: Uuid,
  kind: z.string(),
  status: z.enum(CONTRACT_STATUSES),
  starts_on: z.string(),
  ends_on: z.string().nullable(),
  auto_renew: z.boolean(),
  billing_model: z.string(),
  /** Falso = ninguém escolheu: `fixed_monthly` é só o padrão antigo e a tela mostra "não informada". */
  billing_model_informed: z.boolean().optional(),
  sla_policy_id: Uuid.nullable().optional(),
  /** O SLA GERAL do contrato: vale para todo equipamento coberto sem exceção própria. */
  sla_policy_name: z.string().nullable().optional(),
  service_frequency: z.enum(SERVICE_FREQUENCIES).nullable().optional(),
  fixed_team_packages: z.array(z.number().int()).nullable().optional(),
  payment_terms: z.enum(PAYMENT_TERMS).nullable().optional(),
  /** Cobertura `customer`: todos os equipamentos do cliente. */
  covers_all_assets: z.boolean().optional(),
  /**
   * D-4 (24/11/2026): atendimento SUSPENSO ou BLOQUEADO por quem administra. Nulo = livre.
   * Com retenção (ou vencido), ninguém abre, executa nem conclui chamado/OS do contrato.
   */
  service_hold: z.enum(SERVICE_HOLDS).nullable().optional(),
  service_hold_reason: z.string().nullable().optional(),
  service_hold_at: Timestamp.nullable().optional(),
  /** Quantas vezes a vigência foi renovada (D-7). */
  renewal_count: z.number().int().optional(),
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
      kind: z.string(),
      status: z.enum(CONTRACT_STATUSES),
      starts_on: z.string(),
      ends_on: z.string().nullable(),
      auto_renew: z.boolean(),
      renewal_notice_days: z.number().int().nullable(),
      adjustment_index: z.string().nullable(),
      sla_policy_id: Uuid.nullable(),
      sla_policy_name: z.string().nullable().optional(),
      service_frequency: z.enum(SERVICE_FREQUENCIES).nullable().optional(),
      fixed_team_packages: z.array(z.number().int()).nullable().optional(),
      payment_terms: z.enum(PAYMENT_TERMS).nullable().optional(),
      price_list_id: Uuid.nullable(),
      billing_model: z.string(),
      billing_model_informed: z.boolean().optional(),
      included_calls: z.number().int().nullable(),
      included_hours: z.string().nullable(),
      sla_target_percent: z.string().nullable(),
      plan_target_percent: z.string().nullable(),
      notes: z.string().nullable(),
      archived_at: Timestamp.nullable(),
      created_at: Timestamp,
      updated_at: Timestamp,
      service_hold: z.enum(SERVICE_HOLDS).nullable().optional(),
      service_hold_reason: z.string().nullable().optional(),
      service_hold_at: Timestamp.nullable().optional(),
      service_hold_by_name: z.string().nullable().optional(),
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
        /** Desligado: nenhum relógio de SLA abre para o equipamento. */
        sla_enabled: z.boolean().optional(),
        /** EXCEÇÃO: o equipamento tem política própria e não segue o SLA geral do contrato. */
        has_own_sla: z.boolean().optional(),
      })
    ),
  }),
});

const DataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data como AAAA-MM-DD');

/** O que o cadastro do cliente grava no contrato (0090). Ausente = não muda; nulo = apaga. */
const CamposDoContrato = {
  title: z.string().max(200).nullable().optional(),
  endsOn: DataIso.nullable().optional(),
  autoRenew: z.boolean().optional(),
  slaPolicyId: Uuid.nullable().optional(),
  billingModel: z.enum(BILLING_MODELS).optional(),
  serviceFrequency: z.enum(SERVICE_FREQUENCIES).nullable().optional(),
  fixedTeamPackages: z.array(z.number().int().min(1).max(10)).max(10).nullable().optional(),
  paymentTerms: z.enum(PAYMENT_TERMS).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
};

export const contractsCreate = defineOperation({
  operationId: 'contracts.create',
  method: 'POST',
  path: '/contracts',
  summary: 'Cria o contrato do cliente (rascunho, ou já vigente)',
  description:
    'Com `coverAllAssets`, o contrato cobre todos os equipamentos do cliente (cobertura `customer`) — ' +
    'é o que faz o SLA GERAL valer para eles. Com `activate`, ativa na mesma transação. ' +
    'Recusa 409 se algum equipamento ficaria em dois contratos ao mesmo tempo.',
  permissions: ['contract.create'],
  body: z.object({
    customerId: Uuid,
    kind: z.enum(CONTRACT_KINDS),
    startsOn: DataIso,
    ...CamposDoContrato,
    coverAllAssets: z.boolean().optional(),
    activate: z.boolean().optional(),
  }),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['validation_failed', 'forbidden', 'conflict'],
});

export const contractsUpdate = defineOperation({
  operationId: 'contracts.update',
  method: 'PATCH',
  path: '/contracts/:id',
  summary: 'Edita vigência, SLA geral, modalidade e condições cadastrais do contrato',
  description:
    'Encerrado ou expirado não se edita (409). O início só muda em rascunho. Trocar o SLA geral vale ' +
    'para o que nascer depois — o relógio já aberto guarda a política dele.',
  permissions: ['contract.update'],
  params: z.object({ id: Uuid }),
  body: z.object({ startsOn: DataIso.optional(), ...CamposDoContrato }),
  response: z.object({ id: Uuid }),
  errors: ['validation_failed', 'forbidden', 'not_found', 'conflict'],
});

export const contractsAddCoverage = defineOperation({
  operationId: 'contracts.addCoverage',
  method: 'POST',
  path: '/contracts/:id/coverages',
  summary: 'Acrescenta cobertura ao contrato (ex.: todos os equipamentos do cliente)',
  description:
    'É o passo que permite ATIVAR depois um contrato criado sem cobertura. Recusa 409 se algum ' +
    'equipamento ficaria em dois contratos ao mesmo tempo.',
  permissions: ['contract.update'],
  params: z.object({ id: Uuid }),
  body: z.object({
    kind: z.enum(['customer', 'location_subtree', 'asset_category', 'asset']),
    assetId: Uuid.optional(),
    locationId: Uuid.optional(),
    assetCategoryId: Uuid.optional(),
  }),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['validation_failed', 'forbidden', 'not_found', 'conflict'],
});

export const contractsActivate = defineOperation({
  operationId: 'contracts.activate',
  method: 'POST',
  path: '/contracts/:id/activate',
  summary: 'Ativa o contrato em rascunho (exige cobertura)',
  permissions: ['contract.update'],
  params: z.object({ id: Uuid }),
  response: z.object({ status: z.literal('active') }),
  status: 201,
  errors: ['validation_failed', 'forbidden', 'not_found', 'conflict'],
});

/* -------------------------------------------------------------------------- */
/* D-4 — suspender / bloquear / reativar o atendimento                         */
/* -------------------------------------------------------------------------- */

export const contractsHoldService = defineOperation({
  operationId: 'contracts.holdService',
  method: 'POST',
  path: '/contracts/:id/service-hold',
  summary: 'Suspende ou bloqueia o atendimento do contrato (tudo para, fica só consulta)',
  description:
    'Anderson, 24/11/2026: "tudo para e fica somente consulta, ninguém abre nem fecha chamado". ' +
    'Vale na API para abrir, executar, concluir ou mudar a situação de solicitações e OS do contrato, ' +
    'para a geração de planos e para as automações. Só contrato vigente; motivo obrigatório. ' +
    'Suspenso ou bloqueado, o contrato não renova sozinho.',
  permissions: ['contract.update'],
  params: z.object({ id: Uuid }),
  body: z.object({ hold: z.enum(SERVICE_HOLDS), reason: z.string().trim().min(10).max(500) }).strict(),
  response: z.object({ changed: z.boolean() }),
  status: 201,
  errors: ['validation_failed', 'forbidden', 'not_found', 'conflict'],
});

export const contractsReleaseService = defineOperation({
  operationId: 'contracts.releaseService',
  method: 'POST',
  path: '/contracts/:id/service-release',
  summary: 'Reativa o atendimento do contrato (tira a suspensão ou o bloqueio)',
  permissions: ['contract.update'],
  params: z.object({ id: Uuid }),
  body: z.object({ reason: z.string().trim().max(500).nullable().optional() }).strict(),
  response: z.object({ changed: z.boolean() }),
  status: 201,
  errors: ['validation_failed', 'forbidden', 'not_found'],
});

/* -------------------------------------------------------------------------- */
/* D-7 — renovação                                                             */
/* -------------------------------------------------------------------------- */

export const ContractRenewal = z.object({
  id: Uuid,
  seq: z.number().int(),
  previous_ends_on: z.string(),
  new_ends_on: z.string(),
  mode: z.enum(['automatic', 'manual']),
  note: z.string().nullable(),
  created_at: Timestamp,
  created_by_name: z.string().nullable(),
});
export type ContractRenewal = z.infer<typeof ContractRenewal>;

export const contractsRenewals = defineOperation({
  operationId: 'contracts.renewals',
  method: 'GET',
  path: '/contracts/:id/renewals',
  summary: 'Histórico das renovações da vigência (automáticas e manuais)',
  permissions: ['contract.read'],
  params: z.object({ id: Uuid }),
  response: z.object({ items: z.array(ContractRenewal) }),
  errors: ['not_found'],
});

export const contractsRenew = defineOperation({
  operationId: 'contracts.renew',
  method: 'POST',
  path: '/contracts/:id/renew',
  summary: 'Renova a vigência à mão (inclusive de contrato vencido, para regularizar)',
  description:
    'Sem `newEndsOn`, renova pelo prazo ORIGINAL do contrato (12 meses continuam 12 meses). ' +
    'Prazo indeterminado não tem ciclo (409). A renovação automática é da varredura diária: ' +
    'acontece no último dia da vigência, se ninguém suspendeu nem bloqueou.',
  permissions: ['contract.update'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      newEndsOn: DataIso.nullable().optional(),
      note: z.string().trim().max(500).nullable().optional(),
    })
    .strict(),
  response: z.object({ previous_ends_on: z.string(), new_ends_on: z.string() }),
  status: 201,
  errors: ['validation_failed', 'forbidden', 'not_found', 'conflict'],
});

/* -------------------------------------------------------------------------- */
/* D-3 — horas técnicas (só apuração; nenhuma tarifa, nenhum valor)            */
/* -------------------------------------------------------------------------- */

export const TECHNICAL_HOUR_GROUPS = ['preventive', 'corrective', 'other'] as const;

export const contractsTechnicalHours = defineOperation({
  operationId: 'contracts.technicalHours',
  method: 'GET',
  path: '/contracts/:id/technical-hours',
  summary: 'Horas de preventiva e de corretiva das OS do contrato, pela hora de início e de término',
  description:
    'D-3 (Anderson, 24/11/2026): a hora técnica é controlada pela hora de início e de término da OS. ' +
    'Conta as OS do contrato cujo atendimento terminou no período; separa preventiva, corretiva e ' +
    'outras naturezas. OS sem as duas horas (as antigas) aparecem à parte, como "não informadas" — ' +
    'nunca como zero. Só apuração: nenhuma tarifa nem valor é calculado.',
  permissions: ['contract.read'],
  params: z.object({ id: Uuid }),
  query: z.object({ from: DataIso, to: DataIso }),
  response: z.object({
    period: z.object({ from: z.string(), to: z.string() }),
    totals: z.array(
      z.object({
        group: z.enum(TECHNICAL_HOUR_GROUPS),
        work_orders: z.number().int(),
        minutes: z.number().int(),
      })
    ),
    /** OS concluídas no período sem hora de início/término (anteriores à regra). */
    without_hours: z.number().int(),
    items: z.array(
      z.object({
        work_order_id: Uuid,
        number: z.string().nullable(),
        title: z.string(),
        work_order_type: z.string().nullable(),
        group: z.enum(TECHNICAL_HOUR_GROUPS),
        service_started_at: Timestamp,
        service_ended_at: Timestamp,
        minutes: z.number().int(),
      })
    ),
  }),
  errors: ['validation_failed', 'not_found'],
});

export const contractsOptions = defineOperation({
  operationId: 'contracts.options',
  method: 'GET',
  path: '/contracts/options',
  summary: 'As políticas de SLA disponíveis para o SLA geral do contrato',
  permissions: ['contract.read'],
  response: z.object({
    sla_policies: z.array(z.object({ id: Uuid, name: z.string(), is_default: z.boolean() })),
  }),
});

export const SLA_SOURCES = [
  'disabled',
  'asset',
  'contract_criticality',
  'contract',
  'customer',
  'organization',
  'none',
] as const;
export type SlaSource = (typeof SLA_SOURCES)[number];

export const assetEffectiveSla = defineOperation({
  operationId: 'assets.effectiveSla',
  method: 'GET',
  path: '/assets/:id/effective-sla',
  summary: 'O SLA que vale para o equipamento hoje, e de onde ele vem',
  description:
    'A mesma cascata dos relógios: SLA desligado → exceção do equipamento → criticidade no contrato → ' +
    'SLA geral do contrato → padrão do cliente → padrão da organização.',
  permissions: ['asset.read'],
  params: z.object({ id: Uuid }),
  response: z.object({
    source: z.enum(SLA_SOURCES),
    policy_id: Uuid.nullable(),
    policy_name: z.string().nullable(),
    contract_id: Uuid.nullable(),
    contract_number: z.string().nullable(),
  }),
  errors: ['not_found'],
});

/* -------------------------------------------------------------------------- */
/* Gerar orçamento a partir da OS (reunião 16/10/2026, Fase 7)                 */
/* -------------------------------------------------------------------------- */

/** Dinheiro como TEXTO decimal ("150.50"): nunca float entre a tela e o banco. */
const Dinheiro = z
  .string()
  .trim()
  .regex(/^\d{1,12}([.,]\d{1,2})?$/, 'valor como "1234.56"');

export const quotesCreate = defineOperation({
  operationId: 'quotes.create',
  method: 'POST',
  path: '/quotes',
  summary: 'Cria um orçamento (em elaboração), opcionalmente ligado a uma OS',
  permissions: ['quote.create'],
  body: z.object({
    customerId: Uuid,
    workOrderId: Uuid.nullable().optional(),
    nature: z.enum(['parts', 'services', 'parts_and_services']).optional(),
    validUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    paymentTerms: z.string().nullable().optional(),
    customerNotes: z.string().nullable().optional(),
    internalNotes: z.string().nullable().optional(),
  }),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['not_found', 'validation_failed'],
});

export const quotesAddItem = defineOperation({
  operationId: 'quotes.addItem',
  method: 'POST',
  path: '/quotes/:id/items',
  summary: 'Acrescenta uma linha: serviço/hora técnica ou peça, quantidade e valor unitário',
  description: 'Totais calculados no servidor, em centavos. Valor unitário como texto decimal.',
  permissions: ['quote.update'],
  params: z.object({ id: Uuid }),
  body: z.object({
    kind: z.enum(['part', 'service']),
    itemId: Uuid.nullable().optional(),
    description: z.string().trim().min(2).max(300).optional(),
    quantity: z.number().positive(),
    unitPrice: z.union([Dinheiro, z.number().min(0)]).optional(),
    unit: z.string().trim().max(20).optional(),
  }),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['not_found', 'validation_failed', 'conflict'],
});

/** Uma linha do orçamento gerado da OS — o mesmo formato de `quotes.addItem`. */
export const LinhaDoOrcamentoDaOs = z
  .object({
    kind: z.enum(['part', 'service']),
    itemId: Uuid.nullable().optional(),
    description: z.string().trim().min(2).max(300).optional(),
    quantity: z.number().positive(),
    unitPrice: z.union([Dinheiro, z.number().min(0)]).optional(),
    unit: z.string().trim().max(20).optional(),
  })
  .refine((l) => l.kind !== 'part' || !!l.itemId, {
    message: 'peça precisa do item do catálogo',
    path: ['itemId'],
  });

export const quotesCreateFromWorkOrder = defineOperation({
  operationId: 'quotes.createFromWorkOrder',
  method: 'POST',
  path: '/work-orders/:id/quotes',
  summary: 'Gera o orçamento da OS já com as linhas, numa transação só',
  description:
    'Cabeçalho e linhas nascem juntos ou não nascem: uma linha recusada desfaz o orçamento inteiro ' +
    '(a mensagem diz qual linha). O cliente é o da OS. `clientRequestId` é gerado pela tela antes da ' +
    'primeira tentativa: reenviar o MESMO pedido devolve o mesmo orçamento, sem criar outro; o mesmo ' +
    'identificador com outro conteúdo, depois de um sucesso, é 409. Exige `quote.create` e ' +
    '`quote.update` (o mesmo que criar e acrescentar linha), e a OS no escopo de quem pede.',
  permissions: ['quote.create', 'quote.update'],
  params: z.object({ id: Uuid }),
  body: z.object({
    clientRequestId: Uuid,
    nature: z.enum(['parts', 'services', 'parts_and_services']).optional(),
    validUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    approverContactId: Uuid.nullable().optional(),
    paymentTerms: z.string().nullable().optional(),
    customerNotes: z.string().nullable().optional(),
    internalNotes: z.string().nullable().optional(),
    items: z.array(LinhaDoOrcamentoDaOs).min(1).max(200),
  }),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['not_found', 'validation_failed', 'conflict'],
});
