/**
 * Aurora — saúde, identidade e organização corrente.
 *
 * São as três rotas que o shell da interface chama antes de qualquer outra:
 * "estou de pé?", "quem é você?", "onde você está?".
 */
import { defineOperation } from '../registry';
import { z, Uuid, NonEmpty } from '../primitives';

export const HealthStatus = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(z.string(), z.string()).optional(),
});

export const healthLive = defineOperation({
  operationId: 'health.live',
  method: 'GET',
  path: '/health/live',
  summary: 'O processo está de pé',
  description: 'Não toca no banco. É a sonda de vida, não a de prontidão.',
  public: true,
  response: HealthStatus,
});

export const healthReady = defineOperation({
  operationId: 'health.ready',
  method: 'GET',
  path: '/health/ready',
  summary: 'A aplicação pode receber tráfego',
  description: 'Verifica a dependência crítica. É esta que o balanceador deve olhar.',
  public: true,
  response: HealthStatus,
});

/**
 * Uma organização em que a pessoa tem vínculo ativo.
 *
 * Esta é a resposta da única rota que existe ANTES de haver organização no
 * contexto — é ela que alimenta o seletor. Sem ela, quem tem dois vínculos
 * recebe 403 pedindo para escolher e não tem como saber entre o quê.
 */
export const OrganizationOption = z.object({
  organization_id: Uuid,
  slug: NonEmpty,
  name: NonEmpty,
  seat_type: z.enum(['staff', 'portal']),
  is_owner: z.boolean(),
});
export type OrganizationOption = z.infer<typeof OrganizationOption>;

export const meOrganizations = defineOperation({
  operationId: 'me.organizations',
  method: 'GET',
  path: '/me/organizations',
  summary: 'Organizações em que o portador da credencial tem vínculo ativo',
  description:
    'Responde antes de existir organização no contexto — resolve a identidade por conta ' +
    'própria. Trocar de organização é ação explícita (§05), nunca implícita por URL.',
  response: z.object({ items: z.array(OrganizationOption) }),
  errors: ['unauthenticated'],
});

export const Organization = z.object({
  id: Uuid,
  slug: NonEmpty,
  name: NonEmpty,
  locale: z.string(),
  timezone: z.string(),
  /**
   * Como esta organização chama o que mantém: "Equipamento", "Ativo", "Frota".
   * A interface usa este rótulo em vez de um nome fixo — a palavra do cliente
   * é a que a pessoa reconhece na tela.
   */
  asset_label: NonEmpty,
  plan: z.string(),
  seat_limit: z.number().int(),
  seats_used: z.number().int(),
  status: z.enum(['active', 'suspended', 'archived']),
});
export type Organization = z.infer<typeof Organization>;

export const organizationsCurrent = defineOperation({
  operationId: 'organizations.current',
  method: 'GET',
  path: '/organizations/current',
  summary: 'A organização do contexto',
  description:
    'Não existe rota por identificador. A organização vem do vínculo — aceitar um id por ' +
    'parâmetro convidaria a tratá-lo como autorização (§37).',
  permissions: ['organization.read'],
  response: Organization,
  errors: ['not_found'],
});
