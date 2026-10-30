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

/**
 * A versão do código em execução. Existe para conferir, SEM LOGIN, se a API
 * de um ambiente está no commit esperado antes de publicar um front que
 * depende dela (ver tools/imagem/versao.mjs).
 */
export const HealthVersion = z.object({
  /** Commit da imagem, quando o build o recebe; nulo fora da imagem ou sem .git. */
  commit: z.string().nullable(),
  /** sha-256 (12 hex) do código da API — comparável com `node tools/imagem/versao.mjs`. */
  impressao: z.string().nullable(),
  construido_em: z.string().nullable(),
});

export const healthVersion = defineOperation({
  operationId: 'health.version',
  method: 'GET',
  path: '/health/version',
  summary: 'Qual código está rodando',
  description:
    'Commit e impressão digital do código da API, gravados no build da imagem. Pública, como as outras de saúde.',
  public: true,
  response: HealthVersion,
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

/**
 * Modo de uso e recursos habilitados (gap V2 P0.4 · PLAT §2 e §4).
 *
 * Uma plataforma, configuração diferente. O padrão é TUDO habilitado: quais
 * módulos cada modo usa por padrão é decisão do cliente ainda não tomada, e
 * ninguém deve perder uma tela por uma escolha que não fez.
 */
export const ORGANIZATION_USAGE_MODES = [
  'service_provider',
  'hospital',
  'manufacturer',
  'consultancy',
  'laboratory',
] as const;
export const ORGANIZATION_FEATURES = [
  'assets',
  'service_requests',
  'work_orders',
  'maintenance_plans',
  'metrology',
  'documents',
  'inventory',
  'contracts',
  'quotes',
  'portal',
  'insights',
  'opportunities',
  'imports',
  'automations',
] as const;

const OrganizationConfigurationShape = {
  usage_mode: z.enum(ORGANIZATION_USAGE_MODES),
  /** A lista EFETIVA: nunca configurada, vem com os módulos do modo (hospital: sem `quotes`). */
  enabled_features: z.array(z.enum(ORGANIZATION_FEATURES)),
  /** `false` enquanto ninguém escolheu — tudo habilitado por padrão. */
  features_customized: z.boolean(),
  /** Concluir a OS de equipamento exige o parecer LIBERADO/PARADO (PF-41, OS-16). `true` por padrão. */
  require_operational_result: z.boolean(),
};
export const OrganizationConfiguration = z.object(OrganizationConfigurationShape);

export const organizationsUpdateConfiguration = defineOperation({
  operationId: 'organizations.updateConfiguration',
  method: 'PATCH',
  path: '/organizations/current/configuration',
  summary: 'Muda o modo de uso e os recursos habilitados da organização do contexto',
  description:
    '`enabled_features: null` volta ao padrão do modo (tudo, menos `quotes` no modo hospital). Lista vazia é recusada. ' +
    'Recurso habilitado não é permissão: o RBAC continua decidindo quem pode o quê.',
  permissions: ['organization.update'],
  body: z
    .object({
      usage_mode: z.enum(ORGANIZATION_USAGE_MODES).optional(),
      enabled_features: z.array(z.enum(ORGANIZATION_FEATURES)).min(1).nullable().optional(),
      /** Liga/desliga a exigência do parecer na conclusão da OS (PF-41). */
      require_operational_result: z.boolean().optional(),
    })
    .strict(),
  response: OrganizationConfiguration,
  status: 200,
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
  ...OrganizationConfigurationShape,
  /** Marca do negócio (Fase 11). Opcional: respostas da demonstração não a têm. */
  branding: z
    .object({
      display_name: z.string().nullable().optional(),
      primary_color: z.string().nullable().optional(),
      support_email: z.string().nullable().optional(),
    })
    .optional(),
  /** Domínio pedido; `pending_dns` = apontamento/certificado não automatizados (BLOQUEADO — INFRA). */
  domain: z.object({ host: z.string(), status: z.string() }).nullable().optional(),
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

/* -------------------------------------------------------------------------- */
/* Novo Negócio — tenants (reunião 16/10/2026, Fase 11)                        */
/* -------------------------------------------------------------------------- */

export const platformMe = defineOperation({
  operationId: 'platform.me',
  method: 'GET',
  path: '/platform/me',
  summary: 'Esta pessoa é admin global de plataforma?',
  description: 'Concedido só por ato de DBA (tabela platform_admins); não há rota que conceda.',
  response: z.object({ platform_admin: z.boolean() }),
});

export const TenantSummary = z.object({
  id: Uuid,
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  created_at: z.union([z.string(), z.date()]),
  branding: z.object({
    display_name: z.string().nullable().optional(),
    primary_color: z.string().nullable().optional(),
    support_email: z.string().nullable().optional(),
  }),
  domain: z.object({ host: z.string(), status: z.string() }).nullable(),
});
export type TenantSummary = z.infer<typeof TenantSummary>;

export const platformTenantsList = defineOperation({
  operationId: 'platform.tenantsList',
  method: 'GET',
  path: '/platform/tenants',
  summary: 'O registro de negócios (tenants) — só o admin global',
  description:
    'Só o REGISTRO (nome, slug, situação, marca). Dado de negócio de outra organização continua atrás ' +
    'da RLS, inclusive para o admin de plataforma.',
  response: z.object({ items: z.array(TenantSummary) }),
  errors: ['forbidden'],
});

export const platformTenantsCreate = defineOperation({
  operationId: 'platform.tenantsCreate',
  method: 'POST',
  path: '/platform/tenants',
  summary: 'Novo negócio: organização, base de fábrica, marca e primeiro administrador',
  description:
    'Um código só; o negócio novo é dado. Domínio fica pedido (pending_dns) — DNS e certificado não ' +
    'são automatizados (BLOQUEADO — INFRA). Sem preço nem cobrança.',
  body: z.object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    name: NonEmpty,
    tax_id: z.string().max(32).nullable().optional(),
    branding: z
      .object({
        display_name: z.string().max(120).nullable().optional(),
        primary_color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullable()
          .optional(),
        support_email: z.string().email().nullable().optional(),
      })
      .optional(),
    domain: z.string().max(253).nullable().optional(),
    admin: z.object({ email: z.string().email(), name: NonEmpty }),
  }),
  response: z.object({ organization_id: Uuid, admin_membership_id: Uuid, reused_user: z.boolean() }),
  status: 201,
  errors: ['validation_failed', 'forbidden', 'conflict'],
});
