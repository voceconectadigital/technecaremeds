/**
 * Aurora — catálogo de permissões e papéis de fábrica (SPEC v0.2 §21, ADR-007).
 *
 * Por que o catálogo vive em código e não em tabela editável:
 * uma permissão só existe se houver código que a verifique. Deixar o usuário
 * criar permissões produziria linhas que não protegem nada. A tabela do banco é
 * um espelho semeado a partir daqui, e um teste garante que os dois não
 * divergem.
 *
 * A lição que motivou o desenho está na auditoria do sistema de referência:
 * 138 permissões atômicas, grupos entregues vazios, e o resultado observado foi
 * um grupo "Técnico" com 101 delas — incluindo *adicionar empresa*. Aqui os
 * papéis de fábrica são o caminho normal; o editor granular é a exceção.
 */

export type PermissionAction = 'read' | 'create' | 'update' | 'delete' | 'export' | 'manage' | string; // ações especiais nomeadas pelo verbo do negócio

export interface PermissionDefinition {
  readonly key: string;
  readonly resource: string;
  readonly action: PermissionAction;
  readonly description: string;
  /** Permissões de campo são aplicadas na serialização, não na rota. */
  readonly fieldLevel?: boolean;
}

const p = (
  resource: string,
  action: string,
  description: string,
  fieldLevel = false
): PermissionDefinition => ({ key: `${resource}.${action}`, resource, action, description, fieldLevel });

export const PERMISSIONS: readonly PermissionDefinition[] = Object.freeze([
  // --- organização e plataforma -------------------------------------------
  p('organization', 'read', 'Ver dados da organização'),
  p('organization', 'update', 'Editar dados da organização'),
  p('organization', 'manage_members', 'Convidar, suspender e remover membros'),
  p('organization', 'manage_roles', 'Criar e editar papéis e permissões'),
  p('organization', 'manage_catalogs', 'Editar catálogos e taxonomias'),
  // Separada de `manage_catalogs` porque são riscos diferentes: mexer num
  // rótulo de catálogo afeta uma lista; criar campo personalizado obrigatório
  // afeta todo formulário daquela entidade, para todo mundo, a partir do
  // próximo salvamento.
  p('organization', 'manage_custom_fields', 'Criar e editar campos personalizados'),
  p('organization', 'manage_billing', 'Gerenciar plano, assentos e faturamento'),
  p('organization', 'manage_integrations', 'Gerenciar chaves de API e webhooks'),

  // --- diretório ------------------------------------------------------------
  p('customer', 'read', 'Ver clientes'),
  p('customer', 'create', 'Cadastrar clientes'),
  p('customer', 'update', 'Editar clientes'),
  p('customer', 'delete', 'Arquivar clientes'),
  p('location', 'read', 'Ver locais'),
  p('location', 'create', 'Cadastrar locais'),
  p('location', 'update', 'Editar locais'),
  p('location', 'delete', 'Arquivar locais'),
  p('location', 'move', 'Mover subárvores de locais'),
  p('supplier', 'read', 'Ver fornecedores'),
  p('supplier', 'create', 'Cadastrar fornecedores'),
  p('supplier', 'update', 'Editar fornecedores'),
  p('team', 'read', 'Ver equipes'),
  p('team', 'manage', 'Gerenciar equipes e composição'),

  // --- ativos ---------------------------------------------------------------
  p('asset', 'read', 'Ver ativos'),
  p('asset', 'create', 'Cadastrar ativos'),
  // Separada de `create` porque são atos diferentes com riscos diferentes: o
  // técnico cadastra o ativo que achou em campo, e isso é bom. Importar uma
  // planilha cria milhares de registros de uma vez, cria fabricante e modelo
  // sob demanda e é o caminho mais rápido para duplicar um acervo inteiro.
  p('asset', 'import', 'Importar ativos em massa por planilha'),
  p('asset', 'update', 'Editar ativos'),
  p('asset', 'delete', 'Arquivar ativos'),
  p('asset', 'transfer', 'Transferir e emprestar ativos'),
  p('asset', 'decommission', 'Descomissionar ativos'),
  p('asset', 'print_label', 'Imprimir etiquetas e QR Code'),
  // A observação interna do EQUIPAMENTO existe pela mesma razão que a da
  // ordem de serviço: "este aparelho já voltou três vezes pelo mesmo defeito"
  // é contexto de manutenção, e "o cliente contesta toda fatura deste parque"
  // não é coisa que se mostre no portal. A coluna existe desde o começo, e
  // até agora nada a protegia — `a.*` devolvia para qualquer um.
  p('asset', 'read_internal_notes', 'Ver observações internas do ativo', true),
  p('asset', 'read_financials', 'Ver valores e depreciação do ativo', true),

  // --- solicitações ---------------------------------------------------------
  p('service_request', 'read', 'Ver solicitações'),
  p('service_request', 'create', 'Abrir solicitações'),
  p('service_request', 'update', 'Editar solicitações'),
  p('service_request', 'triage', 'Assumir a triagem'),
  p('service_request', 'accept', 'Aceitar e converter em ordem de serviço'),
  p('service_request', 'reject', 'Recusar solicitações'),
  p('service_request', 'merge', 'Marcar como duplicada'),

  // --- ordens de serviço ----------------------------------------------------
  p('work_order', 'read', 'Ver ordens de serviço'),
  p('work_order', 'create', 'Criar ordens de serviço'),
  p('work_order', 'update', 'Editar ordens de serviço'),
  p('work_order', 'delete', 'Excluir ordens de serviço'),
  p('work_order', 'assign', 'Atribuir responsável e executores'),
  p('work_order', 'schedule', 'Agendar e reagendar'),
  p('work_order', 'execute', 'Executar as ordens atribuídas a si'),
  p('work_order', 'execute_any', 'Executar qualquer ordem'),
  p('work_order', 'complete', 'Concluir ordens de serviço'),
  p('work_order', 'validate', 'Validar ou solicitar retrabalho'),
  p('work_order', 'close', 'Fechar ordens de serviço'),
  p('work_order', 'reopen', 'Reabrir ordens fechadas'),
  p('work_order', 'cancel', 'Cancelar ordens de serviço'),
  p('work_order', 'edit_closed', 'Editar ordem fechada ou cancelada'),
  p('work_order', 'edit_dates', 'Editar datas de criação e conclusão'),
  // Comentar é ESCRITA, e por isso tem chave própria.
  //
  // A tentação era guardar a rota com `work_order.read`, já que qualquer um
  // que enxerga a OS deveria poder falar sobre ela. Mas aí um perfil de
  // consulta — auditoria, cliente interno, integração de leitura — passaria a
  // poder escrever no histórico do atendimento, e a checagem do gerador de
  // OpenAPI acusou exatamente isso: "escrita guardada por permissão de
  // leitura". A checagem estava certa.
  p('work_order', 'comment', 'Comentar em ordens de serviço'),
  p('work_order', 'read_costs', 'Ver custos da ordem de serviço', true),
  p('work_order', 'read_internal_notes', 'Ver observações internas', true),

  // --- execução -------------------------------------------------------------
  p('time_entry', 'read', 'Ver apontamentos de hora'),
  p('time_entry', 'create', 'Apontar horas'),
  p('time_entry', 'update', 'Editar apontamentos'),
  p('time_entry', 'delete', 'Excluir apontamentos'),
  p('time_entry', 'create_for_others', 'Apontar horas para outra pessoa'),
  p('time_entry', 'create_future', 'Apontar horas com data futura'),
  p('time_entry', 'approve', 'Aprovar apontamentos'),

  // --- planejamento ---------------------------------------------------------
  p('maintenance_plan', 'read', 'Ver planos de manutenção'),
  p('maintenance_plan', 'create', 'Criar planos'),
  p('maintenance_plan', 'update', 'Editar planos'),
  p('maintenance_plan', 'delete', 'Arquivar planos'),
  p('maintenance_plan', 'generate_cycle', 'Gerar ciclo e ordens'),
  p('maintenance_plan', 'skip_item', 'Dispensar item do ciclo'),
  p('maintenance_plan', 'finish', 'Finalizar plano'),
  p('procedure', 'read', 'Ver procedimentos e checklists'),
  p('procedure', 'create', 'Criar procedimentos e checklists'),
  p('procedure', 'update', 'Editar procedimentos e checklists'),
  p('procedure', 'publish', 'Publicar versão de checklist'),

  // --- engenharia clínica / metrologia N0 (0051–0053) ------------------------
  //
  // Instrumento é PAPEL de ativo: ver e cadastrar o ativo continua em `asset.*`.
  // Estas cobrem o que só instrumento tem — interface, firmware, limitações — e
  // o registro do certificado EXTERNO, que é ato de quem responde pela
  // rastreabilidade (metrologista, gestor), não de quem só executa a OS.
  p('instrument', 'read', 'Ver instrumentos de medição e seus certificados'),
  p('instrument', 'manage', 'Cadastrar instrumentos e registrar ou revogar certificados externos'),

  // --- estoque --------------------------------------------------------------
  p('inventory', 'read', 'Ver estoque'),
  p('inventory', 'create', 'Cadastrar itens'),
  p('inventory', 'update', 'Editar itens'),
  p('inventory', 'move', 'Movimentar estoque'),
  p('inventory', 'adjust', 'Ajustar saldo com justificativa'),
  p('inventory', 'count', 'Realizar inventário'),
  p('inventory', 'read_costs', 'Ver custos de estoque', true),

  // --- comercial ------------------------------------------------------------
  p('quote', 'read', 'Ver orçamentos'),
  p('quote', 'create', 'Criar orçamentos'),
  p('quote', 'update', 'Editar orçamentos'),
  p('quote', 'delete', 'Excluir orçamentos'),
  p('quote', 'send', 'Enviar orçamento ao cliente'),
  p('quote', 'approve', 'Aprovar ou reprovar orçamento'),
  p('quote', 'invoice', 'Faturar orçamento'),
  p('contract', 'read', 'Ver contratos'),
  p('contract', 'create', 'Criar contratos'),
  p('contract', 'update', 'Editar contratos'),
  p('contract', 'read_financials', 'Ver valores do contrato', true),
  p('contract', 'close_period', 'Fechar período de medição'),

  // --- oportunidade (núcleo, gap V2 P1.7 · PLAT §4/§5) -----------------------
  //
  // AUTORIZAR é separado de criar e editar: a autorização comercial é o ato
  // que o PLAT §5 nomeia, tem trilha própria, e quem registra a necessidade em
  // campo não deveria poder autorizá-la sozinho.
  p('opportunity', 'read', 'Ver oportunidades'),
  p('opportunity', 'create', 'Registrar oportunidades'),
  p('opportunity', 'update', 'Editar e encaminhar oportunidades'),
  p('opportunity', 'authorize', 'Autorizar comercialmente uma oportunidade'),

  // --- documentos -----------------------------------------------------------
  p('document', 'read', 'Ver documentos'),
  p('document', 'create', 'Criar rascunhos de documento'),
  p('document', 'update', 'Editar documentos'),
  p('document', 'issue', 'Emitir documento'),
  p('document', 'sign', 'Assinar documento'),
  p('document', 'release_to_customer', 'Liberar documento ao cliente'),

  // --- leitura analítica ----------------------------------------------------
  p('insight', 'read', 'Ver indicadores'),
  p('insight', 'read_financial_metrics', 'Ver indicadores financeiros', true),
  p('insight', 'manage_dashboards', 'Criar e compartilhar painéis'),

  // --- automação e auditoria ------------------------------------------------
  p('automation', 'read', 'Ver automações'),
  p('automation', 'create', 'Criar automações'),
  p('automation', 'update', 'Editar automações'),
  p('automation', 'delete', 'Excluir automações'),
  p('automation', 'run_now', 'Executar automação manualmente'),
  p('audit', 'read', 'Ver trilha de auditoria'),

  // --- entrega de notificação -----------------------------------------------
  //
  // Marcar uma entrega como enviada ou falha é ESCRITA, e era guardada por
  // `audit.read` — que o papel Auditor tem, e sobre o qual a §21 diz "somente
  // leitura em tudo. Nenhuma escrita". Um auditor podia marcar como enviada uma
  // notificação que nunca saiu, e um "enviado" falso some sem deixar rastro.
  //
  // Fica fora de todo papel de fábrica exceto Proprietário e Administrador (que
  // recebem tudo): quem usa isto é o adaptador de transporte, não uma pessoa.
  p('notification', 'deliver', 'Registrar o resultado do envio de uma notificação'),
]);

export const PERMISSION_KEYS: readonly string[] = Object.freeze(PERMISSIONS.map((x) => x.key));
const PERMISSION_SET = new Set(PERMISSION_KEYS);

export function isKnownPermission(key: string): boolean {
  return PERMISSION_SET.has(key);
}

export const FIELD_LEVEL_PERMISSIONS: readonly string[] = Object.freeze(
  PERMISSIONS.filter((x) => x.fieldLevel).map((x) => x.key)
);

/* ==========================================================================
   Papéis de fábrica — o caminho normal (ADR-007)
   ========================================================================== */

export type SeatType = 'staff' | 'portal';

export interface RoleDefinition {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly seatType: SeatType;
  /** `*` concede tudo, exceto o que estiver em `except`. */
  readonly permissions: readonly string[] | '*';
  readonly except?: readonly string[];
}

const ALL_READ = PERMISSION_KEYS.filter((k) => k.endsWith('.read'));

export const FACTORY_ROLES: readonly RoleDefinition[] = Object.freeze([
  {
    key: 'owner',
    name: 'Proprietário',
    description: 'Responde pela conta. Único que gerencia faturamento e titularidade.',
    seatType: 'staff',
    permissions: '*',
  },
  {
    key: 'admin',
    name: 'Administrador',
    description: 'Tudo, exceto faturamento e titularidade.',
    seatType: 'staff',
    permissions: '*',
    except: ['organization.manage_billing'],
  },
  {
    key: 'maintenance_manager',
    name: 'Gestor de manutenção',
    description: 'Responde por conformidade e indicadores. Assina documentos técnicos.',
    seatType: 'staff',
    permissions: [
      ...ALL_READ,
      // Curadoria de taxonomia fica com quem entende de manutenção, não só com
      // quem administra a conta. Deixar isso restrito ao administrador foi
      // parte do que produziu, na referência, 360 "problemas relatados" que
      // ninguém do domínio podia arrumar. Campos personalizados, esses sim,
      // continuam com o administrador: mudam a estrutura do formulário.
      'organization.manage_catalogs',
      'customer.create',
      'customer.update',
      'location.create',
      'location.update',
      'location.move',
      'supplier.create',
      'supplier.update',
      'team.manage',
      'asset.create',
      'asset.import',
      'asset.update',
      'asset.transfer',
      'asset.decommission',
      'asset.print_label',
      'asset.read_financials',
      'service_request.triage',
      'service_request.accept',
      'service_request.reject',
      'service_request.merge',
      'work_order.create',
      'work_order.update',
      'work_order.comment',
      'work_order.assign',
      'work_order.schedule',
      'work_order.execute_any',
      'work_order.complete',
      'work_order.validate',
      'work_order.close',
      'work_order.reopen',
      'work_order.cancel',
      'work_order.edit_closed',
      'work_order.edit_dates',
      'work_order.read_costs',
      'work_order.read_internal_notes',
      'asset.read_internal_notes',
      'time_entry.approve',
      'time_entry.create_for_others',
      'maintenance_plan.create',
      'maintenance_plan.update',
      'maintenance_plan.delete',
      'maintenance_plan.generate_cycle',
      'maintenance_plan.skip_item',
      'maintenance_plan.finish',
      'procedure.create',
      'procedure.update',
      'procedure.publish',
      'instrument.manage',
      'opportunity.create',
      'opportunity.update',
      'opportunity.authorize',
      'document.create',
      'document.issue',
      'document.sign',
      'document.release_to_customer',
      'contract.create',
      'contract.update',
      'contract.read_financials',
      'insight.read_financial_metrics',
      'insight.manage_dashboards',
      'audit.read',
      'inventory.read_costs',
    ],
  },
  {
    key: 'coordinator',
    name: 'Coordenador',
    description: 'Faz triagem, distribui trabalho e programa a agenda.',
    seatType: 'staff',
    permissions: [
      ...ALL_READ,
      'service_request.triage',
      'service_request.accept',
      'service_request.reject',
      'service_request.merge',
      'work_order.create',
      'work_order.update',
      'work_order.comment',
      'work_order.assign',
      'work_order.schedule',
      'work_order.execute_any',
      'work_order.complete',
      'work_order.validate',
      'work_order.cancel',
      'work_order.read_costs',
      'work_order.read_internal_notes',
      'asset.read_internal_notes',
      'time_entry.create',
      'time_entry.update',
      'time_entry.approve',
      'asset.update',
      'asset.print_label',
      'maintenance_plan.generate_cycle',
      'maintenance_plan.skip_item',
      'opportunity.create',
      'opportunity.update',
    ],
  },
  {
    key: 'technician',
    name: 'Técnico',
    description: 'Executa as ordens atribuídas a si ou à sua equipe.',
    seatType: 'staff',
    permissions: [
      'organization.read',
      'customer.read',
      'location.read',
      'team.read',
      'asset.read',
      'asset.create',
      'asset.print_label',
      'service_request.read',
      'service_request.create',
      'work_order.read',
      'work_order.execute',
      'work_order.complete',
      'work_order.comment',
      'work_order.read_internal_notes',
      'asset.read_internal_notes',
      'time_entry.read',
      'time_entry.create',
      'time_entry.update',
      'procedure.read',
      // O técnico escolhe o instrumento da sessão de medição em campo.
      'instrument.read',
      // E registra a necessidade que viu no equipamento — autorizar, não.
      'opportunity.read',
      'opportunity.create',
      'inventory.read',
      'inventory.move',
      'document.read',
      'insight.read',
    ],
  },
  {
    key: 'metrologist',
    name: 'Metrologista',
    description: 'Emite e libera certificados; gerencia padrões.',
    seatType: 'staff',
    permissions: [
      'organization.read',
      'customer.read',
      'location.read',
      'team.read',
      'asset.read',
      'asset.update',
      'asset.print_label',
      'service_request.read',
      'work_order.read',
      'work_order.execute',
      'work_order.execute_any',
      'work_order.complete',
      'time_entry.read',
      'time_entry.create',
      'procedure.read',
      'procedure.create',
      'procedure.update',
      'procedure.publish',
      'instrument.read',
      'instrument.manage',
      'document.read',
      'document.create',
      'document.issue',
      'document.sign',
      'document.release_to_customer',
      'document.update',
      'inventory.read',
      'insight.read',
    ],
  },
  {
    key: 'storekeeper',
    name: 'Almoxarife',
    description: 'Controla estoque, entradas, reservas e inventário.',
    seatType: 'staff',
    permissions: [
      'organization.read',
      'customer.read',
      'location.read',
      'supplier.read',
      'supplier.create',
      'supplier.update',
      'asset.read',
      'work_order.read',
      'service_request.read',
      'inventory.read',
      'inventory.create',
      'inventory.update',
      'inventory.move',
      'inventory.adjust',
      'inventory.count',
      'inventory.read_costs',
      'insight.read',
    ],
  },
  {
    key: 'finance',
    name: 'Financeiro',
    description: 'Orçamentos, contratos, medição e faturamento.',
    seatType: 'staff',
    permissions: [
      ...ALL_READ,
      'quote.create',
      'quote.update',
      'quote.send',
      'quote.approve',
      'quote.invoice',
      'quote.delete',
      'opportunity.update',
      'opportunity.authorize',
      'contract.create',
      'contract.update',
      'contract.read_financials',
      'contract.close_period',
      'work_order.read_costs',
      'inventory.read_costs',
      'asset.read_financials',
      'insight.read_financial_metrics',
    ],
  },
  {
    key: 'auditor',
    name: 'Auditor',
    description: 'Somente leitura em tudo, incluindo a trilha de auditoria.',
    seatType: 'staff',
    permissions: [...ALL_READ, 'audit.read'],
  },
  {
    key: 'requester',
    name: 'Solicitante',
    description: 'Abre e acompanha solicitações dos locais do seu escopo.',
    seatType: 'portal',
    permissions: [
      'organization.read',
      'asset.read',
      'location.read',
      'service_request.read',
      'service_request.create',
      'work_order.read',
      'document.read',
      'quote.read',
      'quote.approve',
      'maintenance_plan.read',
    ],
  },
  {
    key: 'customer_manager',
    name: 'Gestor do cliente',
    description: 'Acompanha indicadores e documentos de todo o seu cliente.',
    seatType: 'portal',
    permissions: [
      'organization.read',
      'asset.read',
      'location.read',
      'customer.read',
      'service_request.read',
      'service_request.create',
      'work_order.read',
      'document.read',
      'quote.read',
      'quote.approve',
      'maintenance_plan.read',
      'insight.read',
      'contract.read',
    ],
  },
]);

/** Resolve `*`/`except` para a lista concreta de chaves de um papel. */
export function permissionsOfRole(role: RoleDefinition): string[] {
  const base = role.permissions === '*' ? [...PERMISSION_KEYS] : [...role.permissions];
  const except = new Set(role.except ?? []);
  const resolved = base.filter((k) => !except.has(k));
  const unknown = resolved.filter((k) => !PERMISSION_SET.has(k));
  if (unknown.length > 0) {
    throw new Error(`papel "${role.key}" referencia permissões inexistentes: ${unknown.join(', ')}`);
  }
  return [...new Set(resolved)].sort();
}

/* ==========================================================================
   Resolução efetiva
   ========================================================================== */

export type OverrideEffect = 'grant' | 'deny';

export interface PermissionOverride {
  readonly permission: string;
  readonly effect: OverrideEffect;
}

/**
 * Permissões efetivas de um vínculo.
 *
 * Regra da SPEC §21, aplicada literalmente: papéis se somam, e **revogação
 * individual vence sobre qualquer concessão**. `deny` é sempre a última
 * palavra, inclusive contra o papel de Proprietário — é o que permite suspender
 * uma capacidade específica sem desmontar o papel.
 */
export function effectivePermissions(
  rolePermissionSets: readonly (readonly string[])[],
  overrides: readonly PermissionOverride[] = []
): ReadonlySet<string> {
  const effective = new Set<string>();
  for (const set of rolePermissionSets) for (const key of set) effective.add(key);
  for (const o of overrides) if (o.effect === 'grant') effective.add(o.permission);
  for (const o of overrides) if (o.effect === 'deny') effective.delete(o.permission);
  return effective;
}

/**
 * Um papel não pode conceder o que quem concede não possui (§21).
 * Devolve as permissões que o concedente não tem — vazio significa autorizado.
 */
export function escalationCheck(
  granterPermissions: ReadonlySet<string>,
  requested: readonly string[]
): string[] {
  return requested.filter((k) => !granterPermissions.has(k));
}

/**
 * Sinal de papel excessivamente permissivo (§21).
 * O sistema de referência acabou com um "Técnico" detendo 73 % das permissões.
 */
export const OVER_PERMISSIVE_RATIO = 0.7;

export function isOverPermissive(permissions: readonly string[]): boolean {
  return permissions.length / PERMISSION_KEYS.length > OVER_PERMISSIVE_RATIO;
}
