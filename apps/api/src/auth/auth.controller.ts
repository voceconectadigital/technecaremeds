/**
 * Aurora — entrar e sair (SPEC v0.2 §36 · §37 camadas 1 e 2).
 *
 * As três rotas são públicas e estão na lista de isenção do middleware de
 * contexto (`context.middleware.ts`). Isenção de contexto NÃO é isenção de
 * verificação: o login confere a senha, e o logout exige o token em mãos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE CONTROLLER NÃO FAZ, E É DE PROPÓSITO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  · NÃO define senha. `aurora.definir_senha` não é concedida a `aurora_app`
 *    (rodapé da migration 0045). Hoje quem define é o comando administrativo,
 *    sob o papel de dono. Uma rota de troca de senha exige senha atual e uma
 *    decisão sobre recuperação por e-mail — e não há transporte de e-mail.
 *  · NÃO escolhe organização. Quem escolhe é `GET /v1/me/organizations` com o
 *    token já em mãos, e o vínculo é conferido a cada requisição. Devolver a
 *    organização aqui faria o login parecer autorizar algo, e ele não autoriza:
 *    ele identifica.
 *  · NÃO emite cookie. O token viaja em `Authorization`, como em toda a API.
 *    Cookie traria CSRF para dentro de um produto que hoje não tem essa
 *    superfície, e a resposta seria uma segunda defesa para um problema que não
 *    precisamos criar.
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { LoginInput, type AuthConfig } from '@aurora/contracts';
import { abrirSessaoPorSenha, encerrarSessao, type Database } from '@aurora/db';
import { UnauthenticatedError, RateLimitedError, SENHA_MINIMA } from '@aurora/domain';
import type { AuroraEnv } from '@aurora/config';
import { DATABASE, ENV, LOGGER } from '../common/tokens';
import { parseWith } from '../common/contract-validation';
import { AttemptLimiter } from '../common/attempt-limiter';
import type { AuroraRequest } from '../common/context.middleware';
import type { StructuredLogger } from '../common/logger';

/**
 * Dez tentativas por minuto e por origem.
 *
 * Generoso para gente — ninguém erra a própria senha dez vezes em um minuto — e
 * apertado para laço de shell. O contador por CONTA, que vive no banco, é o que
 * segura a tentativa lenta e distribuída; este segura a rajada.
 */
const TENTATIVAS_POR_MINUTO = 10;

@Controller('auth')
export class AuthController {
  private readonly limiter = new AttemptLimiter(TENTATIVAS_POR_MINUTO, 60_000);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: AuroraEnv,
    @Inject(LOGGER) private readonly logger: StructuredLogger
  ) {}

  @Get('config')
  config(): AuthConfig {
    return {
      provider: this.env.AURORA_AUTH_PROVIDER,
      ambiente: this.env.AURORA_AMBIENTE,
      senha_minima: SENHA_MINIMA,
    };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Req() req: AuroraRequest, @Body() body: unknown) {
    /*
     * A chave é o endereço do SOQUETE, e não `x-forwarded-for`.
     *
     * `x-forwarded-for` é escrito por quem chama. Chavear o limite nele daria um
     * limitador que qualquer laço contorna trocando o cabeçalho a cada
     * requisição — pior do que não ter, porque pareceria proteger. Este é o
     * mesmo defeito que já foi corrigido uma vez na rota do QR.
     */
    const origem = req.ip ?? 'desconhecida';
    if (this.limiter.bloqueado(origem)) {
      throw new RateLimitedError(
        'Muitas tentativas de entrada desta origem. Aguarde um instante e tente de novo.',
        this.limiter.retryAfterSeconds(origem)
      );
    }

    const entrada = parseWith(LoginInput, body);

    // A tentativa conta ANTES da ida ao banco e é devolvida no acerto: assim
    // uma rajada paralela não passa inteira pela conferência acima.
    this.limiter.registrarFalha(origem);

    let resultado: Awaited<ReturnType<typeof abrirSessaoPorSenha>>;
    try {
      resultado = await abrirSessaoPorSenha(this.db, {
        email: entrada.email,
        senha: entrada.senha,
        clientIp: origem,
        userAgent: req.header('user-agent') ?? null,
      });
    } catch (e) {
      // Banco fora do ar não é tentativa de adivinhar senha: sem devolver a
      // cota, um hospital inteiro atrás de um NAT que insiste durante a queda
      // sairia dela bloqueado por 429 (revisão de 17/10/2026).
      this.limiter.perdoarFalha(origem);
      throw e;
    }

    if ('motivo' in resultado) {
      // SÓ A FALHA CONSOME COTA — ver `bloqueado()` em attempt-limiter.ts:
      // contar também o acerto puniria um hospital inteiro atrás de um NAT. A
      // falha já foi registrada antes da ida ao banco.

      /*
       * O LOG REGISTRA A TENTATIVA E NÃO REGISTRA A SENHA.
       *
       * Nem a senha, nem o resumo, nem o comprimento — comprimento de senha
       * numa linha de log é um filtro a menos para quem for quebrar o resumo.
       * O e-mail fica, porque sem ele a linha não serve para investigar nada.
       */
      this.logger.warn('entrada recusada', {
        email: entrada.email,
        motivo: resultado.motivo,
        origem,
      });

      /*
       * MENSAGEM ÚNICA, inclusive para a conta bloqueada (pente-fino 17/10/2026).
       *
       * A frase própria de "conta bloqueada" só aparecia para e-mail que tem
       * conta ativa com senha — cinco erros e uma sexta tentativa enumeravam o
       * cadastro. A frase única avisa do bloqueio sem dizer de quem é.
       */
      throw new UnauthenticatedError(
        'E-mail ou senha não conferem. Depois de várias tentativas, a entrada fica bloqueada por alguns minutos.'
      );
    }

    this.limiter.perdoarFalha(origem);

    this.logger.info('entrada concedida', { user_id: resultado.user.id, origem });

    return {
      token: resultado.token,
      expires_at: resultado.expiresAt.toISOString(),
      user: resultado.user,
    };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AuroraRequest): Promise<{ encerradas: number }> {
    const authorization = req.header('authorization') ?? '';
    const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';

    /*
     * SEM TOKEN, 0 — e não erro.
     *
     * Sair de uma sessão que já não existe é o estado desejado, não uma falha.
     * Devolver 401 aqui faria a tela de logout quebrar exatamente quando a
     * sessão expirou sozinha, que é quando ela mais é usada.
     */
    if (!bearer) return { encerradas: 0 };

    const encerradas = await encerrarSessao(this.db, bearer, 'encerrada pelo portador');
    return { encerradas };
  }
}
