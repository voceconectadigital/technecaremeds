/**
 * Aurora — validação de configuração (EPIC-001).
 *
 * Regra: a aplicação falha ALTO no boot se faltar variável obrigatória. Nunca
 * "sobe e quebra na primeira requisição", e nunca usa default silencioso para
 * coisa que muda comportamento de segurança.
 *
 * Nenhum valor de segredo é logado. `describe()` existe para diagnóstico e
 * mostra apenas quais chaves estão presentes.
 */
import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    AURORA_PORT: z.coerce.number().int().positive().max(65535).default(3000),
    AURORA_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().url().or(z.string().startsWith('postgresql://')),
    AURORA_DB_APP_ROLE: z
      .string()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'nome de papel inválido')
      .default('aurora_app'),
    AURORA_DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

    AURORA_AUTH_PROVIDER: z.enum(['local', 'supabase']).default('local'),
    AURORA_SUPABASE_URL: z.string().url().optional(),
    AURORA_SUPABASE_ANON_KEY: z.string().min(10).optional(),
    AURORA_SUPABASE_SERVICE_ROLE_KEY: z.string().min(10).optional(),

    AURORA_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    AURORA_S3_ENDPOINT: z.string().url().optional(),
    AURORA_S3_BUCKET: z.string().min(1).optional(),
    AURORA_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    AURORA_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

    /**
     * Origens autorizadas a chamar a API pelo navegador, separadas por vírgula.
     *
     * VAZIO É O PADRÃO, e é o padrão certo: sem nenhum cabeçalho de CORS, só
     * uma página servida da MESMA origem consegue chamar a API. Um `*` aqui
     * deixaria qualquer site do mundo fazer requisição autenticada em nome de
     * quem estivesse logado.
     *
     * Em desenvolvimento a interface roda numa porta e a API noutra, então a
     * lista precisa ser explícita — nunca deduzida.
     */
    AURORA_CORS_ORIGINS: z.string().default(''),

    AURORA_ALLOW_UNSAFE_DEV: booleanish.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.AURORA_AUTH_PROVIDER === 'supabase') {
      for (const key of ['AURORA_SUPABASE_URL', 'AURORA_SUPABASE_ANON_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `obrigatório quando AURORA_AUTH_PROVIDER=supabase`,
          });
        }
      }
    }
    if (env.AURORA_STORAGE_DRIVER === 's3') {
      for (const key of [
        'AURORA_S3_ENDPOINT',
        'AURORA_S3_BUCKET',
        'AURORA_S3_ACCESS_KEY_ID',
        'AURORA_S3_SECRET_ACCESS_KEY',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `obrigatório quando AURORA_STORAGE_DRIVER=s3`,
          });
        }
      }
    }
    // trava de segurança: em produção o papel de aplicação é obrigatório
    if (env.NODE_ENV === 'production') {
      if (!env.AURORA_DB_APP_ROLE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AURORA_DB_APP_ROLE'],
          message: 'em produção o papel de aplicação é obrigatório — sem ele a API rodaria como owner',
        });
      }
      if (env.AURORA_ALLOW_UNSAFE_DEV) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AURORA_ALLOW_UNSAFE_DEV'],
          message: 'AURORA_ALLOW_UNSAFE_DEV não pode estar ativo em produção',
        });
      }
    }
  });

export type AuroraEnv = z.infer<typeof envSchema>;

export class ConfigurationError extends Error {
  constructor(public readonly issues: readonly { path: string; message: string }[]) {
    super(
      'Configuração inválida:\n' +
        issues.map((i) => `  · ${i.path}: ${i.message}`).join('\n') +
        '\n\nConsulte .env.example. A aplicação não sobe com configuração incompleta.'
    );
    this.name = 'ConfigurationError';
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AuroraEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(raiz)', message: i.message }))
    );
  }
  return parsed.data;
}

const SECRET_KEYS = /(KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL)$/i;

/** Diagnóstico seguro: nunca imprime valor de segredo. */
export function describe(env: AuroraEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = SECRET_KEYS.test(k) ? (v ? '<definido>' : '<ausente>') : String(v);
  }
  return out;
}
