/**
 * Aurora — diretório: clientes e locais (SPEC v0.2 §05, §32 · EPIC-003).
 */
import { defineOperation } from '../registry';
import { z, Uuid, NonEmpty } from '../primitives';

/**
 * Modelo de relatório incluso no contrato do cliente (CLI-05 · 0085) e a situação da vigência
 * (CLI-06). Duplicados de `@aurora/domain` (`REPORT_TIERS`, `CONTRACT_TERM_STATUSES`) de
 * propósito: este pacote não depende de nenhum outro.
 */
export const CUSTOMER_REPORT_TIERS = ['basic', 'advanced', 'expert'] as const;
export type CustomerReportTier = (typeof CUSTOMER_REPORT_TIERS)[number];
export const CUSTOMER_CONTRACT_STATUSES = [
  'active',
  'expiring',
  'expired',
  'not_started',
  'not_informed',
] as const;
export type CustomerContractStatus = (typeof CUSTOMER_CONTRACT_STATUSES)[number];

/** Dia de calendário AAAA-MM-DD. */
const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');

export const Customer = z.object({
  id: Uuid,
  name: NonEmpty,
  trade_name: z.string().nullable(),
  code: z.string().nullable(),
  tax_id: z.string().nullable(),
  /** O cliente que É a própria organização — a clínica que atende a si mesma. */
  is_internal: z.boolean(),
  segment: z.string().nullable(),
  /**
   * EAS (Estabelecimento Assistencial de Saúde) ou empresa corporativa, e o
   * subtipo (hospital, clínica… / engenharia clínica, assistência técnica…).
   * Opcionais: respostas capturadas antes da 0062 (demo) não os têm.
   */
  kind: z.enum(['eas', 'corporate']).optional(),
  subtype: z.string().nullable().optional(),
  status: z.string(),
  location_count: z.number().int(),
  /**
   * Equipamentos do cliente, pelo cadastro — não pelo escopo de locais de quem
   * pergunta. É a mesma régua de `location_count`: um número para dar tamanho
   * ao cliente na lista, e não uma porta para os ativos.
   */
  asset_count: z.number().int(),
  /**
   * Relatório incluso no contrato (CLI-05): basic, advanced ou expert; nulo = não informado.
   * Só o dado — a trava do relatório pelo modelo contratado não mora aqui.
   */
  report_tier: z.enum(CUSTOMER_REPORT_TIERS).nullable().optional(),
  /** Vigência do contrato (CLI-06): início e fim (AAAA-MM-DD), juntos ou nenhum. */
  contract_starts_on: z.string().nullable().optional(),
  contract_ends_on: z.string().nullable().optional(),
  /**
   * Situação DERIVADA no servidor a cada leitura (nunca gravada): vigente, vence em até 30 dias,
   * vencido, a iniciar ou não informado. Opcionais: respostas capturadas antes da 0085 (demo).
   */
  contract_status: z.enum(CUSTOMER_CONTRACT_STATUSES).optional(),
});
export type Customer = z.infer<typeof Customer>;

export const customersList = defineOperation({
  operationId: 'customers.list',
  method: 'GET',
  path: '/customers',
  summary: 'Clientes que esta pessoa enxerga',
  description:
    'A lista já vem restrita pelo escopo do vínculo. `single_customer` diz à interface que ' +
    'não há o que escolher — a clínica que atende só a si mesma não deve ver um seletor de ' +
    'cliente com uma opção.',
  permissions: ['customer.read'],
  response: z.object({
    items: z.array(Customer),
    single_customer: z.boolean(),
  }),
  errors: ['forbidden'],
});

/**
 * Texto opcional do formulário. Vazio vale como "não informado" — o controller
 * grava `null`, e não uma string vazia que depois aparece como "—" num lugar e
 * como nada no outro.
 */
const TextoOpcional = (max: number) => z.string().trim().max(max).optional();

/** CNPJ (14 dígitos) ou CPF (11), com ou sem pontuação. */
const Documento = z
  .string()
  .trim()
  .max(32)
  .refine((v) => v === '' || [11, 14].includes(v.replace(/\D/g, '').length), {
    message: 'informe o CNPJ com 14 dígitos (ou o CPF, com 11)',
  })
  .optional();

export const customersCreate = defineOperation({
  operationId: 'customers.create',
  method: 'POST',
  path: '/customers',
  summary: 'Cadastra um cliente — o hospital, a clínica ou a unidade atendida',
  description:
    'Ativos, solicitações, ordens e contratos penduram-se num cliente. O cliente interno (a ' +
    'organização que atende a si mesma) não nasce por aqui: ele é um só por organização e ' +
    'vem do provisionamento. Nome e código repetidos são recusados com 409.',
  permissions: ['customer.create'],
  body: z
    .object({
      name: z.string().trim().min(2).max(200),
      trade_name: TextoOpcional(200),
      code: TextoOpcional(60),
      tax_id: Documento,
      segment: TextoOpcional(60),
      kind: z.enum(['eas', 'corporate']).optional(),
      subtype: z.string().trim().max(40).nullable().optional(),
      report_tier: z.enum(CUSTOMER_REPORT_TIERS).nullable().optional(),
      contract_starts_on: Dia.nullable().optional(),
      contract_ends_on: Dia.nullable().optional(),
    })
    .strict(),
  response: Customer,
  errors: ['conflict'],
});

export const customersUpdate = defineOperation({
  operationId: 'customers.update',
  method: 'PATCH',
  path: '/customers/:id',
  summary: 'Edita o cadastro de um cliente',
  description:
    'Nome, nome fantasia, código, documento, classificação (EAS × empresa corporativa), subtipo, ' +
    'relatório incluso no contrato e vigência do contrato. Só o que vier no corpo muda; `null` ' +
    'limpa. Cliente fora do escopo responde 404. O subtipo precisa ser da lista do tipo escolhido. ' +
    'A vigência tem início e fim juntos (ou nenhum), e o fim vem depois do início.',
  permissions: ['customer.update'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      name: z.string().trim().min(2).max(200).optional(),
      trade_name: TextoOpcional(200),
      code: TextoOpcional(60),
      tax_id: Documento,
      kind: z.enum(['eas', 'corporate']).optional(),
      subtype: z.string().trim().max(40).nullable().optional(),
      report_tier: z.enum(CUSTOMER_REPORT_TIERS).nullable().optional(),
      contract_starts_on: Dia.nullable().optional(),
      contract_ends_on: Dia.nullable().optional(),
    })
    .strict(),
  response: Customer,
  errors: ['not_found', 'conflict'],
});

export const CustomerLocation = z.object({
  id: Uuid,
  parent_id: Uuid.nullable(),
  name: z.string(),
  code: z.string().nullable(),
  path: z.string(),
  depth: z.number().int(),
  location_type_id: Uuid.nullable(),
  location_type_key: z.string().nullable(),
  location_type_name: z.string().nullable(),
  /** Opcionais: respostas capturadas antes desta rodada (demo) não os têm. */
  allows_assets: z.boolean().optional(),
  /** Equipamentos na subárvore do local, pelo cadastro. */
  asset_count: z.number().int().optional(),
});
export type CustomerLocation = z.infer<typeof CustomerLocation>;

export const customersDetail = defineOperation({
  operationId: 'customers.detail',
  method: 'GET',
  path: '/customers/:id',
  summary: 'Um cliente e os locais dele que esta pessoa enxerga',
  description:
    'Cliente fora do escopo do vínculo responde 404, e não 403: confirmar que ele existe já ' +
    'seria dizer demais. Os locais vêm recortados pelo escopo de locais, como em `/locations`.',
  permissions: ['customer.read'],
  params: z.object({ id: Uuid }),
  response: z.object({
    customer: Customer,
    locations: z.array(CustomerLocation),
  }),
  errors: ['forbidden', 'not_found'],
});

/* -------------------------------------------------------------------------- */
/* tipos de local e criação de local                                           */
/* -------------------------------------------------------------------------- */

export const LocationType = z.object({
  id: Uuid,
  key: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  can_be_root: z.boolean(),
  allows_assets: z.boolean(),
  position: z.number().int(),
  allowed_parent_type_ids: z.array(Uuid),
  allowed_parent_names: z.array(z.string()),
});
export type LocationType = z.infer<typeof LocationType>;

export const locationTypesList = defineOperation({
  operationId: 'locationTypes.list',
  method: 'GET',
  path: '/location-types',
  summary: 'Tipos de local, com as regras de aninhamento resolvidas em nomes',
  permissions: ['location.read'],
  response: z.object({ items: z.array(LocationType) }),
});

export const locationsCreate = defineOperation({
  operationId: 'locations.create',
  method: 'POST',
  path: '/locations',
  summary: 'Cria um local na árvore de um cliente',
  description:
    'Quem decide se o tipo cabe sob o pai é o banco, pela regra do tipo — e a recusa chega ' +
    'como 422 dizendo quais pais são aceitos. Sem `parent_id`, o local nasce na raiz, o que ' +
    'só vale para tipo que aceita ficar na raiz (a Unidade, na escada inicial).',
  permissions: ['location.create'],
  body: z.object({
    customer_id: Uuid,
    parent_id: Uuid.nullable().optional(),
    location_type_id: Uuid,
    name: z.string().trim().min(1).max(200),
    code: z.string().trim().max(60).nullable().optional(),
    is_mobile: z.boolean().optional(),
  }),
  response: z.object({ id: Uuid }),
  errors: ['not_found'],
});

export const locationsUpdate = defineOperation({
  operationId: 'locations.update',
  method: 'PATCH',
  path: '/locations/:id',
  summary: 'Renomeia um local (setor, sala, unidade)',
  description:
    'Só nome e código. Mudar de pai é `POST /locations/:id/move` (outra permissão); mudar de ' +
    'cliente não existe. Local fora do escopo de quem edita responde 404.',
  permissions: ['location.update'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      code: z.string().trim().max(60).nullable().optional(),
    })
    .strict(),
  response: z.object({ ok: z.literal(true) }),
  errors: ['not_found', 'validation_failed', 'conflict'],
});

/* -------------------------------------------------------------------------- */
/* contatos do cliente — o aprovador do orçamento (reunião 16/10/2026)         */
/* -------------------------------------------------------------------------- */

export const CustomerContact = z.object({
  id: Uuid,
  name: z.string(),
  role_title: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  is_primary: z.boolean(),
});
export type CustomerContact = z.infer<typeof CustomerContact>;

export const customersContacts = defineOperation({
  operationId: 'customers.contacts',
  method: 'GET',
  path: '/customers/:id/contacts',
  summary: 'Contatos do cliente (quem aprova orçamento, quem recebe aviso)',
  permissions: ['customer.read'],
  params: z.object({ id: Uuid }),
  response: z.object({ items: z.array(CustomerContact) }),
  errors: ['not_found'],
});

export const customersAddContact = defineOperation({
  operationId: 'customers.addContact',
  method: 'POST',
  path: '/customers/:id/contacts',
  summary: 'Cadastra um contato do cliente (e-mail ou telefone obrigatório)',
  description: 'Exige `customer.update` ou `quote.create` — quem orça precisa indicar o aprovador.',
  permissions: ['customer.read'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      name: z.string().trim().min(2).max(160),
      role_title: z.string().trim().max(80).nullable().optional(),
      email: z.string().trim().email().max(200).nullable().optional(),
      phone: z.string().trim().min(8).max(32).nullable().optional(),
    })
    .strict()
    .refine((v) => Boolean(v.email || v.phone), { message: 'informe e-mail ou telefone', path: ['email'] }),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['not_found', 'validation_failed'],
});
