/**
 * Aurora — o pacote do dia (SPEC v0.2 §20 · EPIC-014).
 *
 * ESTE CONTRATO É O QUE O APARELHO GRAVA NA BASE LOCAL.
 *
 * Em toda outra tela, um campo divergente aparece como um espaço em branco que
 * alguém reporta. Aqui ele é gravado no IndexedDB e sobrevive à sessão: o
 * técnico desce para o subsolo com um dado torto e só descobre no fim do dia,
 * quando já não dá para consertar. É por isso que este é o contrato que mais
 * merece ser conferido campo a campo.
 *
 * TUDO É NULLABLE ONDE O BANCO PERMITE NULO, e nada é opcional.
 *
 * A diferença importa: um campo opcional deixa o cliente decidir se lê; um
 * campo nulável obriga a decidir o que mostrar quando não há valor. A segunda
 * pergunta é a que produz uma tela honesta.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

/** Um item de checklist, com tudo que o motor de veredito precisa offline. */
export const FieldChecklistItem = z.object({
  id: Uuid,
  section_id: Uuid.nullable(),
  label: z.string(),
  help_text: z.string().nullable(),
  kind: z.string(),
  required: z.boolean(),
  options: z.unknown().nullable(),
  failing_options: z.unknown().nullable(),
  min_value: z.number().nullable(),
  max_value: z.number().nullable(),
  unit: z.string().nullable(),
  expected_boolean: z.boolean().nullable(),
  min_photos: z.number().int().nullable(),
  requires_photo_when: z.string().nullable(),
  fail_action: z.string().nullable(),
  condition_item_id: Uuid.nullable(),
  condition_equals: z.string().nullable(),
  position: z.number().int(),
});

export const FieldChecklistTemplate = z.object({
  id: Uuid,
  key: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  version: z.number().int(),
  published_at: Timestamp.nullable(),
  items: z.array(FieldChecklistItem),
});

export const FieldWorkOrder = z.object({
  id: Uuid,
  number: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  priority: z.string(),
  customer_id: Uuid,
  asset_id: Uuid.nullable(),
  location_id: Uuid.nullable(),
  location_name_snapshot: z.string().nullable(),
  asset_name_snapshot: z.string().nullable(),
  scheduled_start: Timestamp.nullable(),
  scheduled_end: Timestamp.nullable(),
  created_at: Timestamp,
  updated_at: Timestamp,
  /**
   * A versão é o que permite ao aparelho perceber que o servidor mudou.
   *
   * Sem ela, a única forma de descobrir seria tentar — e "tentar" em campo
   * significa descobrir no estacionamento.
   */
  version: z.number().int(),
  status_key: z.string(),
  status_label: z.string(),
  status_color: z.string().nullable(),
  wait_reason_key: z.string().nullable(),
  wait_reason_label: z.string().nullable(),
});

export const FieldAsset = z.object({
  id: Uuid,
  tag: z.string().nullable(),
  asset_number: z.string().nullable(),
  name: z.string(),
  serial_number: z.string().nullable(),
  status: z.string(),
  customer_id: Uuid,
  location_id: Uuid.nullable(),
  asset_category_id: Uuid.nullable(),
  asset_model_id: Uuid.nullable(),
  /** O que o leitor de QR resolve offline, sem ida ao servidor. */
  qr_token: z.string().nullable(),
  requires_calibration: z.boolean(),
  requires_electrical_test: z.boolean(),
  notes: z.string().nullable(),
  updated_at: Timestamp,
  manufacturer_name: z.string().nullable(),
  model_name: z.string().nullable(),
  category_name: z.string().nullable(),
});

export const FieldLocation = z.object({
  id: Uuid,
  name: z.string(),
  code: z.string().nullable(),
  parent_id: Uuid.nullable(),
  customer_id: Uuid,
  location_type_id: Uuid.nullable(),
  path: z.string(),
  depth: z.number().int(),
});

export const FieldCatalogItem = z.object({
  catalog_key: z.string(),
  id: Uuid,
  key: z.string(),
  label: z.string(),
  system_key: z.string().nullable(),
  color: z.string().nullable(),
  position: z.number().int(),
});

export const FieldStatus = z.object({
  id: Uuid,
  key: z.string(),
  label: z.string(),
  customer_label: z.string().nullable(),
  category: z.string(),
  color: z.string().nullable(),
  position: z.number().int(),
  visible_on_board: z.boolean(),
  requires_wait_reason: z.boolean(),
});

/**
 * O grafo, para o aparelho recusar na hora.
 *
 * Sem ele a tela offline não sabe quais botões oferecer e só resta oferecer
 * todos — e aí metade das ações do dia volta como conflito horas depois. Com
 * ele, a recusa acontece quando a pessoa ainda está na frente do equipamento.
 */
export const FieldTransition = z.object({
  from_key: z.string(),
  to_key: z.string(),
  permission_key: z.string().nullable(),
  required_fields: z.unknown().nullable(),
  note: z.string().nullable(),
});

export const FieldWaitReason = z.object({
  id: Uuid,
  key: z.string(),
  label: z.string(),
  customer_label: z.string().nullable(),
  pauses_sla: z.boolean(),
  requires_note: z.boolean(),
});

/**
 * O saldo é INDICATIVO, e a SPEC diz isso com todas as letras.
 *
 * O técnico vê 3 filtros às 8h; às 11h outra pessoa levou os 3. Prometer o
 * saldo faria o aparelho aceitar um consumo que o servidor vai recusar, e a
 * recusa chegaria no estacionamento.
 */
export const FieldStockBalance = z.object({
  item_id: Uuid,
  warehouse_id: Uuid,
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  /*
   * TEXTO, e não número — a mesma decisão de `inventory.ts`.
   *
   * A quantidade é `numeric` no banco de propósito: peça fracionada somada em
   * ponto flutuante produz diferença de inventário que ninguém consegue
   * explicar, e o erro aparece meses depois, no fechamento. Convertê-la para
   * `number` na fronteira desfaria essa decisão em silêncio.
   *
   * Escrevi `z.number()` aqui na primeira versão. A conferência estrita do
   * pacote pegou — foi ela que apontou que este contrato divergia de uma
   * decisão que o projeto já tinha tomado.
   */
  on_hand: z.string(),
  reserved: z.string(),
  warehouse_name: z.string(),
});

export const fieldSync = defineOperation({
  operationId: 'field.sync',
  method: 'GET',
  path: '/field/sync',
  summary: 'O escopo do dia, numa ida só',
  public: false,
  permissions: ['work_order.read'],
  query: z.object({
    /**
     * SEMPRE o `synced_at` que o servidor devolveu, e nunca o relógio do
     * aparelho. A SPEC lista "relógio do dispositivo errado" entre os casos de
     * borda: um celular adiantado pediria "o que mudou desde 2027" e iria a
     * campo com o pacote vazio, achando que está em dia.
     */
    since: Timestamp.optional(),
    horizon: z.coerce.number().int().min(1).max(90).optional(),
  }),
  response: z.object({
    synced_at: Timestamp,
    incremental: z.boolean(),
    work_orders: z.array(FieldWorkOrder),
    assets: z.array(FieldAsset),
    locations: z.array(FieldLocation),
    checklist_templates: z.array(FieldChecklistTemplate),
    catalogs: z.array(FieldCatalogItem),
    statuses: z.array(FieldStatus),
    transitions: z.array(FieldTransition),
    wait_reasons: z.array(FieldWaitReason),
    stock: z.array(FieldStockBalance),
    /**
     * As contagens existem para a tela DIZER o que baixou.
     *
     * "Sincronizado" sozinho não distingue um pacote cheio de um pacote vazio
     * por engano — e essa distinção é a diferença entre descer para o subsolo
     * preparado ou não.
     */
    counts: z.record(z.string(), z.number().int()),
  }),
});
