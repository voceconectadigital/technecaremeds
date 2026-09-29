/**
 * Aurora — entrar, sair, e descobrir COMO se entra (SPEC v0.2 §36).
 *
 * As três rotas são PÚBLICAS, e cada uma por um motivo diferente:
 *
 *  · `auth.config` porque a tela de login precisa saber qual formulário
 *    desenhar ANTES de existir qualquer credencial;
 *  · `auth.login` porque é onde a credencial nasce;
 *  · `auth.logout` porque encerrar precisa funcionar para quem tem token e
 *    nenhum vínculo ativo — a pessoa suspensa no meio da sessão também tem de
 *    conseguir sair. Saber o token É a autorização para encerrá-lo.
 */
import { defineOperation } from '../registry';
import { z, Uuid, NonEmpty, Email } from '../primitives';

/* -------------------------------------------------------------------------- */

export const AuthConfig = z.object({
  /**
   * Qual provedor está em uso NESTE processo.
   *
   * A tela usa isto para escolher entre pedir senha e mostrar o atalho de
   * desenvolvimento. Não é segredo e não é autorização: é a diferença entre uma
   * tela que funciona e uma tela que pede senha a um servidor que não confere
   * nenhuma.
   */
  provider: z.enum(['local', 'password', 'supabase']),
  /** `desenvolvimento | teste | homologacao | producao` — para o aviso na tela. */
  ambiente: NonEmpty,
  /** O piso de caracteres, para a tela dizer a regra antes de a pessoa errar. */
  senha_minima: z.number().int().positive(),
});
export type AuthConfig = z.infer<typeof AuthConfig>;

export const authConfig = defineOperation({
  operationId: 'auth.config',
  method: 'GET',
  path: '/auth/config',
  summary: 'Como se entra neste servidor',
  description:
    'Rota pública e sem credencial. Diz qual provedor de identidade está em uso para que a tela de ' +
    'login desenhe o formulário certo — uma tela que pede senha a um servidor com provedor local ' +
    'pareceria de produção sem ser.',
  public: true,
  response: AuthConfig,
});

/* -------------------------------------------------------------------------- */

export const LoginInput = z.object({
  email: Email,
  /**
   * Sem `min()` aqui, de propósito.
   *
   * A regra de força vale para DEFINIR senha, não para tentar entrar. Recusar
   * uma tentativa curta com 422 em vez de 401 contaria a quem tenta que aquela
   * senha não poderia existir — e a validação de entrada viraria um oráculo do
   * formato das senhas cadastradas. O teto existe porque `scrypt` custa CPU.
   */
  senha: z.string().max(200),
});

export const LoginResult = z.object({
  /**
   * O token de sessão. Vale como `Authorization: Bearer <token>`.
   *
   * Aparece UMA vez, nesta resposta: o que o banco guarda é `sha256(token)`.
   * Perdê-lo significa entrar de novo, e não há como recuperá-lo do servidor.
   */
  token: NonEmpty,
  expires_at: z.string(),
  user: z.object({ id: Uuid, email: NonEmpty, name: NonEmpty }),
});
export type LoginResult = z.infer<typeof LoginResult>;

export const authLogin = defineOperation({
  operationId: 'auth.login',
  method: 'POST',
  path: '/auth/login',
  summary: 'Entrar com e-mail e senha',
  description:
    'Devolve um token de sessão opaco. A recusa é a MESMA para e-mail inexistente, conta sem senha ' +
    'e senha errada — distinguir transformaria esta rota num oráculo de cadastro. Conta bloqueada por ' +
    'tentativas é o único caso que fala diferente, porque a pessoa certa precisa saber por que a ' +
    'senha certa não entra.',
  public: true,
  status: 200,
  body: LoginInput,
  response: LoginResult,
  errors: ['unauthenticated', 'rate_limited'],
});

/* -------------------------------------------------------------------------- */

export const LogoutResult = z.object({
  /** Quantas sessões foram encerradas: 1, ou 0 se o token já não valia. */
  encerradas: z.number().int().nonnegative(),
});

export const authLogout = defineOperation({
  operationId: 'auth.logout',
  method: 'POST',
  path: '/auth/logout',
  summary: 'Encerrar a sessão deste token',
  description:
    'Idempotente: encerrar duas vezes devolve 0 na segunda, e não erro. Pública porque precisa ' +
    'funcionar para quem tem token e perdeu o vínculo — quem foi suspenso no meio da sessão também ' +
    'precisa conseguir sair.',
  public: true,
  status: 200,
  response: LogoutResult,
});
