/**
 * Aurora — papéis, permissões e a explicação (SPEC v0.2 §04, §05 · EPIC-002).
 *
 * O CONTRATO DA EXPLICAÇÃO É O QUE FAZ A TELA SER POSSÍVEL.
 *
 * `PermissionOrigin` obriga a resposta a dizer DE ONDE cada permissão veio.
 * Um contrato que devolvesse só `string[]` permitiria a mesma tela existir com
 * metade da informação — e a metade que falta é justamente a que responde à
 * pergunta que alguém abre a tela para fazer.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const PermissionInfo = z.object({
  key: z.string(),
  resource: z.string(),
  action: z.string(),
  description: z.string(),
  /**
   * Aplicada na SERIALIZAÇÃO, e não na rota.
   *
   * Custo da OS, nota interna, valor do ativo. Conceder uma delas não abre uma
   * tela nova — muda o que aparece dentro das telas que a pessoa já vê, e a
   * tela de papéis precisa dizer isso, senão parece que a caixa não fez nada.
   */
  field_level: z.boolean(),
});
export type PermissionInfo = z.infer<typeof PermissionInfo>;

export const permissionCatalog = defineOperation({
  operationId: 'roles.permissions',
  method: 'GET',
  path: '/permissions',
  summary: 'Todas as permissões que existem no produto',
  permissions: ['organization.manage_roles'],
  response: z.object({ items: z.array(PermissionInfo) }),
});

export const Role = z.object({
  id: Uuid,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  seat_type: z.string(),
  /** De fábrica: não se apaga nem se renomeia a chave — copia-se. */
  is_system: z.boolean(),
  /** De qual papel de fábrica este foi copiado, quando foi. */
  copied_from_key: z.string().nullable(),
  permission_count: z.number().int(),
  /**
   * Quantas pessoas têm este papel hoje.
   *
   * Vem na lista porque muda a decisão: mexer num papel com uma pessoa e mexer
   * num papel com quarenta são operações de risco diferente, e quem edita
   * precisa saber qual das duas está fazendo ANTES de clicar.
   */
  member_count: z.number().int(),
});
export type Role = z.infer<typeof Role>;

export const rolesList = defineOperation({
  operationId: 'roles.list',
  method: 'GET',
  path: '/roles',
  summary: 'Papéis desta organização',
  permissions: ['organization.manage_roles'],
  response: z.object({ items: z.array(Role) }),
});

export const rolePermissionsList = defineOperation({
  operationId: 'roles.ofRole',
  method: 'GET',
  path: '/roles/:id/permissions',
  summary: 'O que um papel concede',
  permissions: ['organization.manage_roles'],
  params: z.object({ id: Uuid }),
  response: z.object({ items: z.array(z.string()) }),
});

/* -------------------------------------------------------------------------- */

export const PermissionOrigin = z.object({
  permission_key: z.string(),
  /**
   * `grant` concede; `deny` retira.
   *
   * A palavra é a que a coluna guarda desde a migration 0005. Traduzir para
   * "allow" na fronteira criaria dois vocabulários para a mesma coisa.
   */
  effect: z.enum(['grant', 'deny']),
  source: z.enum(['role', 'override']),
  role_key: z.string().nullable(),
  role_name: z.string().nullable(),
  reason: z.string().nullable(),
  expires_at: Timestamp.nullable(),
});
export type PermissionOrigin = z.infer<typeof PermissionOrigin>;

export const membershipPermissions = defineOperation({
  operationId: 'roles.explain',
  method: 'GET',
  path: '/memberships/:id/permissions',
  summary: 'Por que esta pessoa pode o que pode',
  description:
    'Devolve a procedência de cada permissão, e não só a lista. Sem procedência, quem administra ' +
    'corrige no lugar errado: tira o papel, o acesso continua por outro, e a saída habitual é ' +
    'empilhar uma exceção de negação por cima.',
  permissions: ['organization.manage_members'],
  params: z.object({ id: Uuid }),
  response: z.object({
    /**
     * O resultado da conta, já com `deny` aplicado.
     *
     * Calculado a partir das MESMAS linhas de `items`, e não numa segunda
     * consulta: duas consultas dariam respostas diferentes se uma exceção
     * vencesse entre elas, e a tela mostraria uma explicação que não bate com
     * a lista — o pior resultado possível para uma tela cujo trabalho é
     * explicar.
     */
    effective: z.array(z.string()),
    items: z.array(PermissionOrigin),
  }),
});

export const membershipPermissionSet = defineOperation({
  operationId: 'roles.override',
  method: 'PUT',
  path: '/memberships/:id/permissions/:key',
  summary: 'Abre uma exceção pontual de permissão',
  description:
    'PUT porque a exceção é única por (pessoa, permissão) — é a chave primária da tabela — e ' +
    'escrever duas vezes tem de dar o mesmo resultado.',
  permissions: ['organization.manage_roles'],
  params: z.object({ id: Uuid, key: z.string() }),
  body: z.object({
    effect: z.enum(['grant', 'deny']),
    /** Ao menos cinco caracteres; o banco também recusa menos. */
    reason: z.string().min(5),
    /**
     * Nulo é permanente — e permanente deveria ser raro.
     *
     * A exceção existe para a substituição de duas semanas. A exceção
     * permanente é um papel que ninguém teve coragem de criar, e que, ao
     * contrário do papel, não aparece em nenhuma lista de quem tem o quê.
     */
    expires_at: z.string().nullable().optional(),
  }),
  response: z.object({ ok: z.literal(true) }),
  errors: ['validation_failed'],
});

export const membershipPermissionClear = defineOperation({
  operationId: 'roles.clearOverride',
  method: 'DELETE',
  path: '/memberships/:id/permissions/:key',
  summary: 'Remove uma exceção pontual',
  permissions: ['organization.manage_roles'],
  params: z.object({ id: Uuid, key: z.string() }),
  response: z.object({ ok: z.literal(true) }),
});

export const membershipRolesSet = defineOperation({
  operationId: 'roles.roleSet',
  method: 'PUT',
  path: '/memberships/:id/roles',
  summary: 'Troca o conjunto de papéis de uma pessoa',
  description:
    'O corpo traz o conjunto INTEIRO, e não "adicione este": assim a operação é idempotente e ' +
    'duas telas abertas não somam papéis que ninguém pediu junto — a última a salvar ganha, inteira.',
  permissions: ['organization.manage_members'],
  params: z.object({ id: Uuid }),
  body: z.object({ role_ids: z.array(Uuid) }),
  response: z.object({ ok: z.literal(true) }),
  errors: ['validation_failed'],
});
