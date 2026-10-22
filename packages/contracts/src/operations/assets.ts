/**
 * Aurora — ativos e locais (SPEC v0.2 §06, §07 · EPIC-005).
 *
 * O NOME DA COISA É DA ORGANIZAÇÃO, e não nosso.
 *
 * A lista devolve `asset_label` junto com os itens porque "Ativo" é o rótulo
 * de fábrica e não serve para todo mundo: um hospital diz "Equipamento", uma
 * frota diz "Veículo", uma administradora diz "Elevador". Fixar a palavra na
 * interface obriga a organização inteira a traduzir mentalmente, em toda tela,
 * o dia inteiro — e é o tipo de atrito que faz um sistema parecer estrangeiro
 * ao trabalho de quem o usa.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const ASSET_STATUSES = [
  'active',
  'under_maintenance',
  'standby',
  'loaned',
  'decommissioned',
  'disposed',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_OWNERSHIPS = ['owned', 'leased', 'loaned', 'rented', 'service_only'] as const;
export type AssetOwnership = (typeof ASSET_OWNERSHIPS)[number];

/* -------------------------------------------------------------------------- */
/* Lista                                                                      */
/* -------------------------------------------------------------------------- */

export const AssetRow = z.object({
  id: Uuid,
  name: z.string(),
  tag: z.string().nullable(),
  serial_number: z.string().nullable(),
  asset_number: z.string().nullable(),
  qr_token: z.string().nullable(),
  status: z.enum(ASSET_STATUSES),
  location_id: Uuid.nullable(),
  /**
   * O caminho materializado do local.
   *
   * Serve para filtrar a subárvore sem consulta recursiva: "tudo dentro da UTI"
   * é um `LIKE` no prefixo, e não sete idas ao banco descendo nível a nível.
   */
  location_path: z.string().nullable(),
  location_name: z.string().nullable(),
  customer_id: Uuid,
  asset_category_id: Uuid,
  category_name: z.string(),
  asset_model_id: Uuid.nullable(),
  model_name: z.string().nullable(),
  manufacturer_name: z.string().nullable(),
  warranty_until: z.string().nullable(),
  /**
   * Família (Suporte à vida, Diagnóstico…) e identificação física (chip
   * geolocalizador, RFID…) — reunião 16/10/2026. Opcionais: capturas da demo
   * anteriores à 0063 não os têm.
   */
  family_key: z.string().nullable().optional(),
  family_name: z.string().nullable().optional(),
  criticality_id: Uuid.nullable().optional(),
  criticality_name: z.string().nullable().optional(),
  tracker_kind: z.string().nullable().optional(),
  tracker_tag: z.string().nullable().optional(),
});
export type AssetRow = z.infer<typeof AssetRow>;

export const assetsList = defineOperation({
  operationId: 'assets.list',
  method: 'GET',
  path: '/assets',
  summary: 'Ativos visíveis para esta pessoa',
  description:
    'O recorte por local NÃO é filtro de conveniência: a lista já vem limitada aos locais que o ' +
    'vínculo alcança. Um filtro que a tela aplicasse depois seria um filtro que a tela pode ' +
    'esquecer de aplicar.',
  permissions: ['asset.read'],
  query: z.object({
    /** Restringe à subárvore deste local, e não só aos filhos diretos. */
    location: Uuid.optional(),
    /** Só os equipamentos deste cliente (dentro do escopo). */
    customer: Uuid.optional(),
    status: z.enum(ASSET_STATUSES).optional(),
    /** Família: chave (`life_support`…). */
    family: z.string().max(40).optional(),
    /** Tipo (categoria). */
    category: Uuid.optional(),
    model: Uuid.optional(),
    /** Nome do fabricante, exato. */
    manufacturer: z.string().max(200).optional(),
    criticality: Uuid.optional(),
    /** `yes` = com chip/etiqueta de localização; `no` = sem. */
    tracker: z.enum(['yes', 'no']).optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  }),
  response: z.object({
    items: z.array(AssetRow),
    /** Como ESTA organização chama a coisa: "Equipamento", "Veículo", "Elevador". */
    asset_label: z.string(),
  }),
});

/* -------------------------------------------------------------------------- */
/* Ficha                                                                      */
/* -------------------------------------------------------------------------- */

export const AssetTransfer = z.object({
  id: Uuid,
  kind: z.string(),
  from_location_id: Uuid.nullable(),
  to_location_id: Uuid.nullable(),
  reason: z.string().nullable(),
  occurred_at: Timestamp,
  due_back_at: Timestamp.nullable(),
  returned_at: Timestamp.nullable(),
});
export type AssetTransfer = z.infer<typeof AssetTransfer>;

export const AssetDetail = z.object({
  id: Uuid,
  name: z.string(),
  tag: z.string().nullable(),
  serial_number: z.string().nullable(),
  asset_number: z.string().nullable(),
  barcode: z.string().nullable(),
  qr_token: z.string().nullable(),
  status: z.enum(ASSET_STATUSES),
  ownership: z.enum(ASSET_OWNERSHIPS),

  asset_category_id: Uuid,
  category_name: z.string(),
  asset_model_id: Uuid.nullable(),
  model_name: z.string().nullable(),
  manufacturer_name: z.string().nullable(),
  family_key: z.string().nullable().optional(),
  family_name: z.string().nullable().optional(),
  tracker_kind: z.string().nullable().optional(),
  tracker_tag: z.string().nullable().optional(),
  customer_id: Uuid,
  /** Opcional: respostas capturadas antes desta rodada (demo) não o têm. */
  customer_name: z.string().optional(),
  location_id: Uuid.nullable(),
  location_name: z.string().nullable(),
  location_path: z.string().nullable(),
  parent_asset_id: Uuid.nullable(),

  criticality_id: Uuid.nullable(),
  operational_risk: z.string().nullable(),
  default_priority: z.string().nullable(),
  risk_class: z.string().nullable(),
  anvisa_registration: z.string().nullable(),
  inmetro_ordinance: z.string().nullable(),
  requires_calibration: z.boolean(),
  requires_electrical_test: z.boolean(),

  manufactured_at: z.string().nullable(),
  acquired_at: z.string().nullable(),
  installed_at: z.string().nullable(),
  warranty_until: z.string().nullable(),
  useful_life_years: z.number().int().nullable(),
  decommissioned_at: Timestamp.nullable(),
  decommission_reason: z.string().nullable(),
  /**
   * Substituição (0056): quem ficou no lugar deste, e quem este substituiu.
   * Opcionais no contrato porque respostas capturadas antes da 0056 não os têm.
   */
  replaced_by_asset_id: Uuid.nullable().optional(),
  replaces_asset_id: Uuid.nullable().optional(),

  owner_supplier_id: Uuid.nullable(),
  sla_policy_id: Uuid.nullable(),

  /**
   * As especificações RESOLVIDAS: as do modelo, com as do ativo por cima.
   *
   * A combinação acontece no servidor. Deixá-la para a interface significaria
   * que cada tela a faria de um jeito, e a que errasse mostraria a
   * especificação do modelo num aparelho que teve a sua trocada.
   */
  specs: z.record(z.string(), z.unknown()),
  /** Quais chaves o ativo sobrescreveu — para a tela poder marcar. */
  specs_overridden: z.array(z.string()),
  custom: z.record(z.string(), z.unknown()).nullable(),
  show_on_work_order: z.array(z.string()).nullable(),
  notes: z.string().nullable(),

  /**
   * Nulo para quem não tem `asset.read_internal_notes`.
   *
   * Nulo é a ausência REAL: o campo sai da consulta, não da renderização.
   */
  internal_notes: z.string().nullable().optional(),
  /** Nulos para quem não tem `asset.read_financials`. */
  purchase_value: z.string().nullable().optional(),
  residual_value: z.string().nullable().optional(),
  replacement_value: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  /** Nº da nota fiscal de aquisição (0078): dado financeiro, só para `asset.read_financials`. */
  acquisition_invoice: z.string().nullable().optional(),

  /** Calculado no servidor a partir de `warranty_until` e da data de hoje. */
  under_warranty: z.boolean(),
  /**
   * Idade em anos, da primeira data que existir: instalação, aquisição,
   * fabricação. Nula quando nenhuma das três foi informada — e nula é
   * diferente de zero, que diria "novo".
   */
  age_years: z.number().nullable(),
  transfers: z.array(AssetTransfer),

  created_at: Timestamp,
  updated_at: Timestamp,
});
export type AssetDetail = z.infer<typeof AssetDetail>;

export const assetDetail = defineOperation({
  operationId: 'assets.detail',
  method: 'GET',
  path: '/assets/:id',
  summary: 'Ficha do ativo, com especificações resolvidas e movimentações',
  description:
    'Observação interna e valores financeiros saem da CONSULTA para quem não tem a permissão — ' +
    'não da tela. Escondido na renderização, o valor de compra do parque já teria trafegado.',
  permissions: ['asset.read'],
  params: z.object({ id: Uuid }),
  response: AssetDetail,
  errors: ['not_found'],
});

/* -------------------------------------------------------------------------- */
/* Locais                                                                     */
/* -------------------------------------------------------------------------- */

export const LocationRow = z.object({
  id: Uuid,
  name: z.string(),
  code: z.string().nullable(),
  parent_id: Uuid.nullable(),
  /**
   * O caminho materializado, do topo até aqui.
   *
   * É ele que permite montar a árvore inteira a partir de uma lista plana, sem
   * consulta recursiva e sem N idas ao banco por nível.
   */
  path: z.string(),
  depth: z.number().int(),
  location_type_id: Uuid.nullable(),
  location_type_name: z.string().nullable(),
  /** A chave do tipo (`setor`, `sala`…). Opcional: respostas antigas da demo não a têm. */
  location_type_key: z.string().nullable().optional(),
  customer_id: Uuid.nullable(),
  is_mobile: z.boolean(),
  status: z.string(),
});
export type LocationRow = z.infer<typeof LocationRow>;

export const locationsList = defineOperation({
  operationId: 'locations.list',
  method: 'GET',
  path: '/locations',
  summary: 'Locais visíveis para esta pessoa, em lista plana',
  description:
    'Plana, e não aninhada: `path` e `depth` bastam para montar a árvore no cliente, e uma ' +
    'estrutura aninhada obrigaria a percorrer tudo para achar um nó pelo id.',
  permissions: ['location.read'],
  query: z.object({
    /**
     * Restringe à subárvore deste local — não aos filhos diretos.
     *
     * O nome é `root` e não `parent` de propósito: `parent` prometeria um
     * nível, e a rota devolve a descendência inteira.
     */
    root: Uuid.optional(),
  }),
  response: z.object({ items: z.array(LocationRow) }),
});

/* -------------------------------------------------------------------------- */
/* linha do tempo (gap V2 P1.3 · critério 3)                                   */
/* -------------------------------------------------------------------------- */

export const ASSET_TIMELINE_KINDS = [
  'registered',
  'manufactured',
  'acquired',
  'installed',
  'transferred',
  'work_order_opened',
  'work_order_completed',
  'measurement_session',
  'document_issued',
  'document_released',
  'decommissioned',
  'replaced',
  'replaces',
] as const;

export const AssetTimelineEvent = z.object({
  kind: z.enum(ASSET_TIMELINE_KINDS),
  /** Instante ISO, ou data civil AAAA-MM-DD quando o fato é de um dia (fabricação, aquisição). */
  at: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  ref: z
    .object({
      type: z.enum(['work_order', 'document', 'measurement_session', 'asset', 'transfer']),
      id: Uuid,
    })
    .nullable(),
});
export type AssetTimelineEvent = z.infer<typeof AssetTimelineEvent>;

export const assetsTimeline = defineOperation({
  operationId: 'assets.timeline',
  method: 'GET',
  path: '/assets/:id/timeline',
  summary:
    'A vida do equipamento numa lista: ciclo de vida, transferências, OS, medições, documentos, substituição',
  description:
    'Leitura composta, mais recente primeiro. OS e sessões de medição só entram para quem tem ' +
    '`work_order.read`; documentos, para quem tem `document.read` — a linha do tempo não é atalho ' +
    'para atravessar permissão. Nenhum valor financeiro.',
  permissions: ['asset.read'],
  params: z.object({ id: Uuid }),
  query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }),
  response: z.object({ items: z.array(AssetTimelineEvent) }),
  errors: ['not_found'],
});

/* -------------------------------------------------------------------------- */
/* cadastro e edição: Cliente → Setor → Equipamento                            */
/* -------------------------------------------------------------------------- */

export const assetsFormOptions = defineOperation({
  operationId: 'assets.formOptions',
  method: 'GET',
  path: '/assets/form-options',
  summary: 'Categorias, modelos e criticidades para o cadastro de equipamento',
  description:
    'Os catálogos da organização que o formulário precisa. Cliente e setor NÃO vêm aqui: vêm de ' +
    '`/customers` e `/customers/:id`, já recortados pelo escopo de quem cadastra.',
  permissions: ['asset.read'],
  response: z.object({
    /**
     * Famílias (`family_key` preenchido, raiz) e tipos (filhos de uma família,
     * ou raiz sem família — cadastro anterior à 0063).
     */
    categories: z.array(
      z.object({
        id: Uuid,
        name: z.string(),
        parent_id: Uuid.nullable(),
        family_key: z.string().nullable().optional(),
      })
    ),
    models: z.array(
      z.object({
        id: Uuid,
        name: z.string(),
        manufacturer_name: z.string().nullable(),
        asset_category_id: Uuid.nullable(),
      })
    ),
    criticalities: z.array(z.object({ id: Uuid, name: z.string(), score: z.number() })),
  }),
});

const CamposDoEquipamento = {
  name: z.string().trim().min(2).max(200),
  asset_category_id: Uuid,
  asset_model_id: Uuid.nullable().optional(),
  criticality_id: Uuid.nullable().optional(),
  tag: z.string().trim().max(80).nullable().optional(),
  serial_number: z.string().trim().max(120).nullable().optional(),
  asset_number: z.string().trim().max(80).nullable().optional(),
  /** Chip geolocalizador / etiqueta de localização: tipo + identificador, juntos ou nenhum. */
  tracker_kind: z.enum(['gps', 'ble', 'rfid', 'nfc', 'outro']).nullable().optional(),
  tracker_tag: z.string().trim().min(2).max(80).nullable().optional(),
  /** Registro na ANVISA (conversa com o cliente, 21/10/2026). */
  anvisa_registration: z.string().trim().max(40).nullable().optional(),
  /** Data de aquisição (AAAA-MM-DD) e vida útil em anos: base da depreciação automática. */
  acquired_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD')
    .nullable()
    .optional(),
  useful_life_years: z.number().int().min(1).max(100).nullable().optional(),
  /** Valor do bem e nº da NF: só quem tem `asset.read_financials` pode informar. */
  purchase_value: z.number().min(0).max(1_000_000_000_000).nullable().optional(),
  acquisition_invoice: z.string().trim().max(60).nullable().optional(),
};

export const assetsCreate = defineOperation({
  operationId: 'assets.create',
  method: 'POST',
  path: '/assets',
  summary: 'Cadastra um equipamento num setor de um cliente',
  description:
    'Cliente e setor são conferidos no SERVIDOR: o setor precisa ser do cliente informado, estar ' +
    'no escopo de quem cadastra e ser de um tipo de local que aceita equipamento. Identificador ' +
    'de outro cliente ou de outra organização é recusado.',
  permissions: ['asset.create'],
  body: z.object({
    ...CamposDoEquipamento,
    // Tag obrigatória no cadastro (conversa com o cliente, 21/10/2026). Na EDIÇÃO segue
    // opcional: o parque já cadastrado sem tag continua editável.
    tag: z.string().trim().min(1, 'a tag é obrigatória').max(80),
    customer_id: Uuid,
    location_id: Uuid,
  }),
  response: z.object({ id: Uuid }),
  errors: ['not_found', 'validation_failed', 'conflict'],
});

export const assetsUpdate = defineOperation({
  operationId: 'assets.update',
  method: 'PATCH',
  path: '/assets/:id',
  summary: 'Edita os dados cadastrais do equipamento',
  description:
    'Cliente e setor NÃO mudam por aqui: mudar de lugar é transferência, com motivo, ' +
    '(`POST /assets/:id/transfer`) — o banco recusa a edição direta (0015).',
  permissions: ['asset.update'],
  params: z.object({ id: Uuid }),
  body: z.object(CamposDoEquipamento).partial().strict(),
  response: z.object({ ok: z.literal(true) }),
  errors: ['not_found', 'validation_failed', 'conflict'],
});

export const assetsTransfer = defineOperation({
  operationId: 'assets.transfer',
  method: 'POST',
  path: '/assets/:id/transfer',
  summary: 'Transfere o equipamento para outro setor/local, com motivo',
  description:
    'É o ÚNICO caminho para mudar o equipamento de lugar (ou de cliente, pelo local de destino). ' +
    'Motivo obrigatório: movimentação sem motivo não explica nada depois.',
  permissions: ['asset.transfer'],
  params: z.object({ id: Uuid }),
  body: z.object({
    to_location_id: Uuid,
    reason: z.string().trim().min(5).max(500),
    kind: z.enum(['transfer', 'loan', 'return']).optional(),
    due_back_at: z.string().optional(),
  }),
  response: z.object({ transfer_id: Uuid }),
  errors: ['not_found', 'validation_failed'],
});

/* -------------------------------------------------------------------------- */
/* catálogo de equipamento: tipos e modelos (reunião 16/10/2026, Fase 3)      */
/* -------------------------------------------------------------------------- */

export const assetCategoriesCreate = defineOperation({
  operationId: 'assetCategories.create',
  method: 'POST',
  path: '/asset-categories',
  summary: 'Cadastra um TIPO de equipamento dentro de uma família',
  description:
    'Tipo ("Ventilador pulmonar") é a categoria-filha; a família (Suporte à vida, Diagnóstico, ' +
    'Terapia, Tratamento, Equipamentos de apoio) é a raiz. Nome repetido → 409.',
  permissions: ['organization.manage_catalogs'],
  body: z
    .object({
      name: z.string().trim().min(2).max(120),
      family_id: Uuid,
      requires_calibration: z.boolean().optional(),
      requires_electrical_test: z.boolean().optional(),
    })
    .strict(),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const assetCategoriesSetFamily = defineOperation({
  operationId: 'assetCategories.setFamily',
  method: 'PATCH',
  path: '/asset-categories/:id',
  summary: 'Põe um tipo antigo (sem família) dentro de uma família',
  description:
    'Para o cadastro anterior às famílias: o tipo passa a ser filho da família escolhida. Família ' +
    'não vira filha de nada.',
  permissions: ['organization.manage_catalogs'],
  params: z.object({ id: Uuid }),
  body: z.object({ family_id: Uuid }).strict(),
  response: z.object({ ok: z.literal(true) }),
  errors: ['not_found', 'validation_failed'],
});

export const assetModelsCreate = defineOperation({
  operationId: 'assetModels.create',
  method: 'POST',
  path: '/asset-models',
  summary: 'Cadastra um modelo de equipamento (e o fabricante, se ainda não existir)',
  permissions: ['organization.manage_catalogs'],
  body: z
    .object({
      name: z.string().trim().min(1).max(160),
      manufacturer: z.string().trim().min(1).max(160),
      asset_category_id: Uuid,
    })
    .strict(),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['not_found', 'validation_failed'],
});

export const assetsLinkQr = defineOperation({
  operationId: 'assets.linkQr',
  method: 'POST',
  path: '/assets/:id/qr',
  summary: 'Vincula uma etiqueta de QR JÁ EXISTENTE (pré-impressa) ao equipamento',
  description:
    'Aceita o código lido da etiqueta — o token puro ou a URL pública `…/q/<token>`. A etiqueta ' +
    'anterior do equipamento deixa de valer na hora (como na rotação). Código já usado por outro ' +
    'equipamento → 409; formato inválido → 422.',
  permissions: ['asset.print_label'],
  params: z.object({ id: Uuid }),
  body: z.object({ code: z.string().trim().min(10).max(300) }).strict(),
  response: z.object({ previous_token: z.string(), qr_token: z.string() }),
  status: 201,
  errors: ['not_found', 'conflict', 'validation_failed'],
});
