/**
 * Aurora — planos de manutenção preventiva (SPEC v0.2 §13 · EPIC-013).
 *
 * O ALVO DA TAREFA É EXPRESSÃO, e não lista — como a cobertura do contrato, e
 * pela mesma razão: "todos os ventiladores da UTI" continua valendo para o que
 * chegar amanhã, e uma lista marcada a mão envelhece no dia seguinte.
 *
 * O CICLO É ANCORADO NO FIM DO ANTERIOR, nunca em "hoje". Ancorar em hoje faz
 * a data escorregar a cada geração atrasada, e em dois anos a preventiva de
 * janeiro está acontecendo em março sem que ninguém tenha decidido isso.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const PLAN_TARGET_KINDS = ['asset', 'asset_category', 'location_subtree'] as const;
/**
 * As unidades que o banco realmente aceita.
 *
 * São SEIS, e não quatro: `quarter` e `semester` existem porque em manutenção
 * predial e hospitalar a periodicidade trimestral e semestral é a regra, e
 * escrevê-las como "a cada 3 meses" perderia a palavra que está no contrato e
 * na norma.
 */
export const PLAN_FREQUENCY_UNITS = ['day', 'week', 'month', 'quarter', 'semester', 'year'] as const;

export const PlanRow = z.object({
  id: Uuid,
  name: z.string(),
  description: z.string().nullable(),
  customer_id: Uuid,
  customer_name: z.string(),
  team_id: Uuid.nullable(),
  is_active: z.boolean(),
  /**
   * Se o ciclo vira ordens de serviço sozinho.
   *
   * Desligado, alguém revisa a lista antes de criar cinquenta OS — que é o que
   * se quer num plano recém-cadastrado, e o oposto do que se quer num plano
   * que roda há dois anos.
   */
  auto_generate: z.boolean(),
  include_late_assets: z.boolean(),
  anchor_date: z.string(),
  /**
   * Quantas tarefas o plano tem.
   *
   * Vem na lista porque plano sem tarefa não gera nada — e é o erro de
   * cadastro mais comum: alguém cria o plano, salva, e descobre três meses
   * depois que nenhuma preventiva foi aberta.
   */
  task_count: z.number().int(),
  /** Quando vence o ciclo aberto mais próximo. Nulo quando não há ciclo aberto. */
  next_cycle_ends_at: Timestamp.nullable(),
});
export type PlanRow = z.infer<typeof PlanRow>;

export const plansList = defineOperation({
  operationId: 'plans.list',
  method: 'GET',
  path: '/maintenance-plans',
  summary: 'Planos de manutenção preventiva',
  permissions: ['maintenance_plan.read'],
  query: z.object({ customer: Uuid.optional() }),
  response: z.object({ items: z.array(PlanRow) }),
});

export const PlanTask = z.object({
  id: Uuid,
  name: z.string(),
  /** A expressão do alvo: um ativo, uma categoria, ou uma subárvore de locais. */
  target_kind: z.enum(PLAN_TARGET_KINDS),
  target_asset_id: Uuid.nullable(),
  target_category_id: Uuid.nullable(),
  target_location_id: Uuid.nullable(),
  work_order_type_id: Uuid.nullable(),
  checklist_template_key: z.string().nullable(),
  /** Procedimentos adicionais da mesma OS (0087, OS-15). */
  extra_checklist_template_keys: z.array(z.string()).optional(),
  /**
   * Filtros sobre o alvo (0055): modelo, fabricante e criticidade, por E lógico.
   * Opcionais no contrato porque respostas capturadas antes da 0055 não os têm.
   */
  filter_asset_model_id: Uuid.nullable().optional(),
  filter_manufacturer_id: Uuid.nullable().optional(),
  filter_criticality_id: Uuid.nullable().optional(),
  trigger: z.string(),
  frequency_unit: z.enum(PLAN_FREQUENCY_UNITS),
  frequency_interval: z.number().int(),
  /** Com quantos dias de antecedência o ciclo abre. */
  lead_time_days: z.number().int(),
  /**
   * Quantos dias depois do vencimento ainda contam como cumprido.
   *
   * É a tolerância que separa "atrasado" de "no prazo" no indicador — e é a
   * conta que se erra quando alguém a faz na mão.
   */
  tolerance_days: z.number().int(),
  estimated_duration_min: z.number().int().nullable(),
  default_team_id: Uuid.nullable(),
  default_assignee_id: Uuid.nullable(),
  position: z.number().int(),

  /* O ciclo ABERTO desta tarefa, quando há um. */
  open_cycle_id: Uuid.nullable(),
  open_cycle_seq: z.number().int().nullable(),
  open_cycle_starts_at: Timestamp.nullable(),
  open_cycle_ends_at: Timestamp.nullable(),
  expected_count: z.number().int().nullable(),
  done_count: z.number().int().nullable(),
});
export type PlanTask = z.infer<typeof PlanTask>;

export const planDetail = defineOperation({
  operationId: 'plans.detail',
  method: 'GET',
  path: '/maintenance-plans/:id',
  summary: 'Plano, com as tarefas e o ciclo aberto de cada uma',
  description:
    'Tarefa sem ciclo aberto NÃO é erro: pode ainda não ter chegado a antecedência de geração. ' +
    'A tela precisa distinguir "ainda não" de "nunca vai".',
  permissions: ['maintenance_plan.read'],
  params: z.object({ id: Uuid }),
  response: z.object({
    plan: z.object({
      id: Uuid,
      name: z.string(),
      description: z.string().nullable(),
      customer_id: Uuid,
      customer_name: z.string(),
      team_id: Uuid.nullable(),
      is_active: z.boolean(),
      auto_generate: z.boolean(),
      include_late_assets: z.boolean(),
      anchor_date: z.string(),
      created_at: Timestamp,
      updated_at: Timestamp,
      /** Última ativação/inativação (0087, PLN-01); o histórico inteiro está na auditoria. */
      active_changed_at: Timestamp.nullable().optional(),
      active_changed_by_name: z.string().nullable().optional(),
      active_change_reason: z.string().nullable().optional(),
    }),
    tasks: z.array(PlanTask),
  }),
  errors: ['not_found'],
});

export const planTaskAssets = defineOperation({
  operationId: 'plans.targets',
  method: 'GET',
  path: '/maintenance-plans/tasks/:taskId/assets',
  summary: 'Os ativos que a expressão da tarefa alcança hoje',
  description:
    'Quem cadastra precisa ver quantos equipamentos a expressão pega ANTES de ligar a geração ' +
    'automática — senão descobre no dia em que cinquenta ordens aparecem.',
  permissions: ['maintenance_plan.read'],
  params: z.object({ taskId: Uuid }),
  response: z.object({
    items: z.array(z.object({ id: Uuid, name: z.string(), location_path: z.string().nullable() })),
  }),
});

/**
 * Como um item do ciclo está, aplicada a tolerância.
 *
 * SÃO SEIS, e não quatro. A distinção entre "started" e "not_started" é a que
 * muda a decisão de quem coordena: uma preventiva atrasada que JÁ está sendo
 * feita precisa de paciência; uma atrasada em que ninguém tocou precisa de
 * alguém agora. Colapsá-las num "atrasado" só faria a lista dizer menos do que
 * o servidor sabe.
 *
 * A tolerância é o que separa `late` de `on_time`: uma preventiva executada um
 * dia depois do previsto não é não conformidade, e contá-la como tal destrói a
 * credibilidade do número — as pessoas passam a ignorar o relatório em vez de
 * agir sobre ele.
 */
export const COMPLIANCE_STATES = [
  'done',
  'skipped',
  'on_time_started',
  'on_time_not_started',
  'late_started',
  'late_not_started',
] as const;
export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

/**
 * O resumo do ciclo.
 *
 * `rate` exclui as dispensadas do denominador: um ativo emprestado a outro
 * hospital não podia receber a preventiva, e contá-lo como falha puniria a
 * equipe por algo que ela não podia fazer. É nulo quando não sobra denominador
 * — e nulo é diferente de zero, que diria "nada foi cumprido".
 */
export const ComplianceSummary = z.object({
  expected: z.number().int(),
  done: z.number().int(),
  skipped: z.number().int(),
  late: z.number().int(),
  pending: z.number().int(),
  rate: z.number().nullable(),
});
export type ComplianceSummary = z.infer<typeof ComplianceSummary>;

export const cycleCompliance = defineOperation({
  operationId: 'plans.compliance',
  method: 'GET',
  path: '/maintenance-plans/cycles/:cycleId/compliance',
  summary: 'Cumprimento de um ciclo: o resumo e os itens',
  description:
    'Os dois juntos. Só o resumo ("83% em dia") não diz QUAL equipamento ficou para trás; só os ' +
    'itens obrigam quem olha a contar na mão — e a conta com tolerância é justamente a que se ' +
    'erra contando na mão.',
  permissions: ['maintenance_plan.read'],
  params: z.object({ cycleId: Uuid }),
  response: z.object({
    summary: ComplianceSummary,
    items: z.array(
      z.object({
        id: Uuid,
        asset_name: z.string(),
        due_at: Timestamp,
        state: z.enum(COMPLIANCE_STATES),
      })
    ),
  }),
});

export const planGenerateCycle = defineOperation({
  operationId: 'plans.generate',
  method: 'POST',
  path: '/maintenance-plans/tasks/:taskId/cycles',
  summary: 'Abre o próximo ciclo desta tarefa',
  description:
    'A varredura faz isso sozinha na antecedência configurada. Esta rota é para antecipar — e é ' +
    'por tarefa, e não "gerar tudo": gerar o plano inteiro à mão é como se produz cinquenta ' +
    'ordens duplicadas num clique.',
  permissions: ['maintenance_plan.generate_cycle'],
  params: z.object({ taskId: Uuid }),
  response: z.object({
    cycle: z.object({
      id: Uuid,
      seq: z.number().int(),
      starts_at: Timestamp,
      ends_at: Timestamp,
      items: z.number().int(),
      work_orders: z.number().int(),
    }),
  }),
  status: 201,
  errors: ['validation_failed'],
});

export const planMaterialize = defineOperation({
  operationId: 'plans.materialize',
  method: 'POST',
  path: '/maintenance-plans/cycles/:cycleId/materialize',
  summary: 'Cria as ordens de serviço de um ciclo aberto',
  permissions: ['maintenance_plan.generate_cycle'],
  params: z.object({ cycleId: Uuid }),
  response: z.object({ work_orders: z.number().int() }),
  status: 201,
});

export const planSkipItem = defineOperation({
  operationId: 'plans.skip',
  method: 'POST',
  path: '/maintenance-plans/cycle-items/:itemId/skip',
  summary: 'Pula um item do ciclo, com motivo obrigatório',
  description:
    'Pular sem motivo transforma o indicador de cumprimento numa medida do que alguém teve ' +
    'vontade de fazer. Com motivo, "equipamento devolvido" e "não deu tempo" viram coisas ' +
    'distinguíveis — e é a distinção que faz o número significar algo.',
  permissions: ['maintenance_plan.skip_item'],
  params: z.object({ itemId: Uuid }),
  body: z.object({ reason: z.string().min(5) }),
  response: z.object({ ok: z.literal(true) }),
  status: 201,
  errors: ['validation_failed'],
});
