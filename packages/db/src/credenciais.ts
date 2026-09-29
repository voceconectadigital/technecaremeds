/**
 * Aurora — autenticação por senha, camada de dados (migration 0045).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TODO ACESSO PASSA POR FUNÇÃO NOMEADA. NÃO HÁ `SELECT` DIRETO AQUI.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `aurora.user_credentials` e `aurora.user_sessions` não concedem privilégio
 * nenhum a `aurora_app`: um `SELECT` direto a partir deste arquivo falharia com
 * "permission denied". É deliberado, e está explicado na 0045 — a superfície de
 * autenticação do sistema são seis funções `SECURITY DEFINER` de consulta fixa,
 * e não uma tabela que qualquer consulta futura possa alcançar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A RESPOSTA É A MESMA PARA TODOS OS MOTIVOS DE RECUSA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * E-mail que não existe, e-mail sem senha cadastrada, senha errada, conta
 * suspensa: `null`. Distinguir faria da rota de login um oráculo de cadastro —
 * quem tivesse uma lista de endereços saberia quais têm conta aqui, que é
 * exatamente o insumo do próximo ataque.
 *
 * A única recusa que fala diferente é o bloqueio por tentativas, porque ela
 * precisa dizer à pessoa certa por que a senha certa não está entrando.
 */
import {
  senhaCorresponde,
  resumirSenha,
  gerarTokenDeSessao,
  resumoDoToken,
  pareceTokenDeSessao,
  newId,
} from '@aurora/domain';
import { withPlatformSession, type Database, type SqlClient } from './client';

/** Quanto tempo uma sessão vive sem uso. Cada requisição empurra este prazo. */
export const JANELA_DE_SESSAO_HORAS = 12;

export interface IdentidadeDeSessao {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

export interface SessaoAberta {
  /** O token em claro. Existe UMA vez, nesta resposta, e nunca é gravado. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly user: { id: string; email: string; name: string };
}

/** Recusa que a rota precisa distinguir para responder direito. */
export type MotivoDeRecusa = 'credencial_invalida' | 'conta_bloqueada';

export interface RecusaDeLogin {
  readonly motivo: MotivoDeRecusa;
  /** Preenchido só em `conta_bloqueada`. */
  readonly liberaEm?: Date;
}

interface LinhaDeCredencial {
  user_id: string;
  email: string;
  name: string;
  password_hash: string;
  failed_attempts: number;
  locked_until: string | Date | null;
}

function comoData(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

/**
 * Autentica e abre sessão. Uma transação, do começo ao fim.
 *
 * POR QUE UMA TRANSAÇÃO SÓ: conferir a senha numa transação e abrir a sessão em
 * outra deixa uma janela em que o acerto foi registrado (contador zerado) e a
 * sessão não existe. O sintoma seria "entrei e não entrei", que ninguém
 * reproduz.
 */
export async function abrirSessaoPorSenha(
  db: Database,
  entrada: {
    email: string;
    senha: string;
    clientIp?: string | null;
    userAgent?: string | null;
    agora?: Date;
  }
): Promise<SessaoAberta | RecusaDeLogin> {
  const agora = entrada.agora ?? new Date();
  const email = entrada.email.trim().toLowerCase();

  /*
   * O e-mail vazio nem chega ao banco. Não é otimização: `credencial_por_email('')`
   * é uma consulta perfeitamente válida que devolve zero linhas, e deixá-la
   * passar gastaria uma ida ao banco por requisição de um laço de shell.
   */
  if (!email || !entrada.senha) return { motivo: 'credencial_invalida' };

  return withPlatformSession(db, async (c: SqlClient) => {
    const [linha] = await c.query<LinhaDeCredencial>(
      'SELECT * FROM aurora.credencial_por_email($1)',
      [email]
    );

    if (!linha) {
      /*
       * CONTA INEXISTENTE AINDA PAGA O CUSTO DO `scrypt`.
       *
       * Sem isto, a resposta para um e-mail sem conta volta em 1 ms e a resposta
       * para senha errada volta em 100 ms — e a diferença enumera o cadastro
       * inteiro sem precisar acertar nenhuma senha. O resumo abaixo é de uma
       * senha impossível, e o trabalho é o mesmo.
       */
      senhaCorresponde(entrada.senha, resumoDeEngodo());
      return { motivo: 'credencial_invalida' as const };
    }

    const bloqueadoAte = comoData(linha.locked_until);
    if (bloqueadoAte && bloqueadoAte > agora) {
      return { motivo: 'conta_bloqueada' as const, liberaEm: bloqueadoAte };
    }

    if (!senhaCorresponde(entrada.senha, linha.password_hash)) {
      await c.query('SELECT aurora.registrar_tentativa_de_senha($1, false)', [linha.user_id]);
      return { motivo: 'credencial_invalida' as const };
    }

    await c.query('SELECT aurora.registrar_tentativa_de_senha($1, true)', [linha.user_id]);

    const token = gerarTokenDeSessao();
    const expiresAt = new Date(agora.getTime() + JANELA_DE_SESSAO_HORAS * 3_600_000);
    await c.query('SELECT aurora.abrir_sessao($1, $2, $3, $4, $5, $6)', [
      newId(),
      linha.user_id,
      resumoDoToken(token),
      expiresAt.toISOString(),
      entrada.clientIp ?? null,
      entrada.userAgent ?? null,
    ]);

    return {
      token,
      expiresAt,
      user: { id: linha.user_id, email: linha.email, name: linha.name },
    };
  });
}

/**
 * Um resumo válido de uma senha que ninguém tem.
 *
 * Gerado uma vez por processo, no primeiro uso: gerar a cada tentativa custaria
 * o dobro do `scrypt` — o do engodo e o da conferência — e gerar no carregamento
 * do módulo faria toda importação deste arquivo pagar 100 ms, inclusive nos
 * testes que nunca chamam login.
 */
let resumoFantasma: string | null = null;

function resumoDeEngodo(): string {
  resumoFantasma ??= resumirSenha(`engodo-${newId()}`);
  return resumoFantasma;
}

/** Quem é o portador deste token? `null` para qualquer motivo de recusa. */
export async function identidadePorToken(
  db: Database,
  token: string
): Promise<IdentidadeDeSessao | null> {
  // Token malformado não chega ao banco — e responde igual a token inexistente.
  if (!pareceTokenDeSessao(token)) return null;

  const rows = await withPlatformSession(db, (c: SqlClient) =>
    c.query<{
      session_id: string;
      user_id: string;
      email: string;
      name: string;
      expires_at: string | Date;
    }>('SELECT * FROM aurora.sessao_por_token($1, $2::interval)', [
      resumoDoToken(token),
      `${JANELA_DE_SESSAO_HORAS} hours`,
    ])
  );

  const linha = rows[0];
  if (!linha) return null;
  return {
    userId: linha.user_id,
    email: linha.email,
    name: linha.name,
    sessionId: linha.session_id,
    expiresAt: comoData(linha.expires_at)!,
  };
}

/** Encerra a sessão deste token. Idempotente: devolve quantas foram fechadas. */
export async function encerrarSessao(db: Database, token: string, motivo?: string): Promise<number> {
  if (!pareceTokenDeSessao(token)) return 0;
  const rows = await withPlatformSession(db, (c: SqlClient) =>
    c.query<{ encerrar_sessao: number }>('SELECT aurora.encerrar_sessao($1, $2) AS encerrar_sessao', [
      resumoDoToken(token),
      motivo ?? '',
    ])
  );
  return Number(rows[0]?.encerrar_sessao ?? 0);
}

/**
 * Grava a senha de alguém e derruba as sessões abertas dela.
 *
 * NÃO é chamada pela API: `aurora.definir_senha` não é concedida a `aurora_app`
 * (ver o rodapé da 0045). Quem chama é o comando administrativo, sob o papel de
 * dono. A função vive aqui para que a regra do resumo e o nome da função do
 * banco morem num lugar só.
 */
export async function definirSenha(
  db: Database,
  entrada: { userId: string; senha: string }
): Promise<void> {
  const hash = resumirSenha(entrada.senha);
  await db.transaction(async (tx) => {
    await tx.query('SELECT aurora.definir_senha($1, $2)', [entrada.userId, hash]);
  });
}

/*
 * Exportado para a suíte: ela precisa provar que a conta inexistente paga o
 * mesmo custo, e não há como observar isso de fora sem o engodo à mão.
 */
export { resumoDeEngodo };
