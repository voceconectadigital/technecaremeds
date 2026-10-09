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
    /*
     * `NODE_ENV` é o MODO DE EXECUÇÃO, e continua com os três valores da
     * convenção do Node — meia dúzia de ferramentas ramifica nele, e inventar um
     * quarto valor faria o Vite, o React e o próprio Node tratarem homologação
     * como desenvolvimento.
     */
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    /*
     * `AURORA_AMBIENTE` é QUAL IMPLANTAÇÃO ESTA É, e é outra pergunta.
     *
     * Uma homologação roda com build de produção — `NODE_ENV=production` — e
     * mesmo assim não é produção: os dados são de teste, o domínio é interno, e
     * as travas precisam ser diferentes. Sem esta variável, "é produção?" e "foi
     * compilado como produção?" viram a mesma pergunta, e a resposta errada
     * libera numa das duas o que só podia valer na outra.
     */
    AURORA_AMBIENTE: z
      .enum(['desenvolvimento', 'teste', 'homologacao', 'producao'])
      .default('desenvolvimento'),
    AURORA_PORT: z.coerce.number().int().positive().max(65535).default(3000),
    AURORA_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().url().or(z.string().startsWith('postgresql://')),
    AURORA_DB_APP_ROLE: z
      .string()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'nome de papel inválido')
      .default('aurora_app'),
    AURORA_DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

    /**
     * Qual adaptador da porta `AuthProvider` este processo usa.
     *
     *   local     — `local:<sujeito>:<e-mail>`, SEM SENHA. Suíte e máquina de
     *               quem desenvolve. Recusado em homologação e em produção,
     *               abaixo, e recusado de novo pelo próprio construtor.
     *   password  — identidade da própria plataforma: senha em `scrypt`, sessão
     *               como token opaco revogável (migration 0045). É o provedor
     *               real disponível hoje.
     *   supabase  — previsto, SEM ADAPTADOR. O boot falha ao escolhê-lo, em vez
     *               de cair no provedor local em silêncio. Ver
     *               `apps/api/src/auth/escolher-provedor.ts`.
     */
    AURORA_AUTH_PROVIDER: z.enum(['local', 'password', 'supabase']).default('local'),
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
    /**
     * Onde ficam os bytes dos anexos.
     *
     * Um diretório, e nada mais: a homologação do cliente não pode depender de
     * serviço pago, e um caminho em disco atende sem conta, sem chave e sem
     * fatura. Trocar por armazenamento de objetos é trocar o adaptador — a
     * porta `ArmazenamentoDeObjetos` existe para isso.
     */
    AURORA_ARQUIVOS_DIR: z.string().default('.aurora/arquivos'),

    AURORA_ALLOW_UNSAFE_DEV: booleanish.default(false),

    /**
     * Quem pode dizer à API qual é o IP do cliente (`req.ip`, chave do limite de
     * tentativas de entrada).
     *
     * `nenhum` (padrão): vale o endereço do soquete — `x-forwarded-for` é
     * ignorado, porque qualquer um o escreve.
     *
     * `rede-privada`: atrás do HostPanel (Traefik → portão web → API, todos em
     * rede de containers). O Express percorre `x-forwarded-for` da DIREITA para
     * a esquerda e só pula saltos em loopback/link-local/rede privada; o
     * primeiro endereço público é o cliente. Um cabeçalho forjado na internet
     * fica à esquerda do salto verdadeiro e nunca é escolhido — e o Traefik
     * nem repassa `x-forwarded-for` de origem não confiável.
     *
     * Lista fechada de propósito: não há modo "confie em todos".
     */
    AURORA_PROXY_CONFIAVEL: z.enum(['nenhum', 'rede-privada']).default('nenhum'),
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
    /*
     * AS TRAVAS VALEM PARA HOMOLOGAÇÃO TAMBÉM, e essa é a decisão que importa.
     *
     * Uma homologação é acessada pelo CLIENTE, por uma rede que não é a nossa.
     * Tratá-la como "quase desenvolvimento" é o que produz o desastre clássico:
     * um ambiente que aceita entrar com qualquer e-mail, sem senha, exposto na
     * internet, com dado que alguém achou que era de mentira.
     *
     * Por isso as duas travas abaixo consideram `homologacao` e `producao`
     * juntas, e só desenvolvimento e teste ficam de fora.
     */
    const exposto = env.AURORA_AMBIENTE === 'producao' || env.AURORA_AMBIENTE === 'homologacao';

    /*
     * `NODE_ENV=production` CONTINUA VALENDO SOZINHO como sinal de "não é a
     * máquina de quem desenvolve".
     *
     * A primeira versão desta mudança trocou a condição por `exposto`, e com
     * isso enfraqueceu uma trava que já existia: um processo compilado como
     * produção, sem `AURORA_AMBIENTE` definido, voltava a aceitar o atalho de
     * desenvolvimento. A prova antiga acusou — e ela estava certa.
     *
     * As duas condições somam, não se substituem.
     */
    const naoEhMaquinaDeDesenvolvimento = env.NODE_ENV === 'production' || exposto;

    if (naoEhMaquinaDeDesenvolvimento) {
      if (!env.AURORA_DB_APP_ROLE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AURORA_DB_APP_ROLE'],
          message:
            'o papel de aplicação é obrigatório fora de desenvolvimento — sem ele a API rodaria como owner, e a RLS deixaria de valer',
        });
      }
    }

    if (naoEhMaquinaDeDesenvolvimento && env.AURORA_ALLOW_UNSAFE_DEV) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AURORA_ALLOW_UNSAFE_DEV'],
        message:
          'AURORA_ALLOW_UNSAFE_DEV não pode estar ativo em produção nem em ambiente exposto (homologação): ele aceita entrar com qualquer e-mail, sem senha',
      });
    }

    /*
     * E O PROVEDOR DE IDENTIDADE PRECISA SER REAL nos dois.
     *
     * O provedor local existe para a suíte e para a máquina de quem desenvolve.
     * Deixá-lo valendo numa homologação seria a mesma porta aberta por outro
     * caminho — a trava acima recusa o atalho, e esta recusa o provedor.
     */
    if (exposto && env.AURORA_AUTH_PROVIDER === 'local') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AURORA_AUTH_PROVIDER'],
        message:
          'em homologação e em produção a identidade precisa vir de um provedor real; o provedor local entra sem senha',
      });
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
