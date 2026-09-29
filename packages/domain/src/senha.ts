/**
 * Aurora — senha: força, resumo e conferência (SPEC v0.2 §36, §37).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRÊS DECISÕES, E O MOTIVO DE CADA UMA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. `scrypt`, DA BIBLIOTECA PADRÃO DO NODE.
 *
 *    Argon2id seria a primeira escolha numa folha em branco, e exige dependência
 *    nativa — que precisa compilar em toda máquina, em todo contêiner e na
 *    integração contínua. `scrypt` está em `node:crypto`, é resistente a
 *    hardware dedicado por exigir memória, e é recomendado por norma. Zero
 *    dependência nova num projeto cujo `npm audit` está em zero.
 *
 * 2. OS PARÂMETROS VIAJAM COM O RESUMO.
 *
 *    `scrypt$N$r$p$sal$derivado`. Sem isso, endurecer o custo amanhã
 *    invalidaria toda senha já cadastrada, e a descoberta viria pelo suporte,
 *    uma pessoa por vez. Com isso, o resumo antigo continua conferindo com os
 *    parâmetros dele, e a próxima troca de senha grava com os novos.
 *
 * 3. COMPRIMENTO ANTES DE COMPLEXIDADE.
 *
 *    Exigir maiúscula, número e símbolo produz `Senha@123` — que qualquer lista
 *    de dicionário tem. Doze caracteres é o piso, e o que se recusa é o que
 *    aparece em lista: sequência de teclado, repetição, o próprio e-mail, o nome
 *    do produto. A regra é dita por extenso na mensagem, porque regra de senha
 *    que a pessoa descobre por tentativa é regra que ela burla com `!` no fim.
 *
 * NENHUMA FUNÇÃO DESTE ARQUIVO CONHECE BANCO. Ele é puro sobre `node:crypto`, e
 * por isso a suíte o exercita inteiro sem subir nada.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

/* -------------------------------------------------------------------------- */
/* força                                                                      */
/* -------------------------------------------------------------------------- */

/** O piso. Doze, e não oito: oito caiu há muito tempo. */
export const SENHA_MINIMA = 12;
/**
 * O teto existe por causa do custo do `scrypt`, e não por gosto.
 *
 * Sem ele, um corpo de 1 MB no campo de senha vira trabalho de CPU
 * proporcional — negação de serviço por formulário, de graça.
 */
export const SENHA_MAXIMA = 200;

/**
 * O que se recusa, e é uma lista curta de propósito.
 *
 * Uma lista de dez mil senhas comuns dentro do repositório seria melhor defesa
 * e um arquivo que ninguém revisa; estas são as formas que aparecem quando
 * alguém precisa "só passar da validação".
 */
const PADROES_RECUSADOS: readonly { regex: RegExp; motivo: string }[] = Object.freeze([
  { regex: /^(.)\1+$/, motivo: 'é o mesmo caractere repetido' },
  { regex: /12345678|87654321/, motivo: 'contém uma sequência de números óbvia' },
  { regex: /qwerty|asdfgh|zxcvbn/i, motivo: 'contém uma sequência de teclado' },
  {
    regex: /senha|password|aurora|becare|technecare/i,
    motivo: 'contém uma palavra previsível neste contexto',
  },
]);

export interface ProblemaDeSenha {
  readonly message: string;
}

/**
 * A senha serve? Devolve TODOS os problemas, nunca o primeiro.
 *
 * Quem descobre um problema por vez volta ao formulário três vezes — e na
 * terceira escolhe a senha mais curta que passar.
 *
 * `email` entra porque senha igual ao próprio endereço é o caso mais comum de
 * "senha que a pessoa acha que é secreta".
 */
export function conferirForcaDaSenha(senha: string, contexto: { email?: string } = {}): ProblemaDeSenha[] {
  const problemas: ProblemaDeSenha[] = [];

  if (senha.length < SENHA_MINIMA) {
    problemas.push({ message: `precisa de pelo menos ${SENHA_MINIMA} caracteres (tem ${senha.length})` });
  }
  if (senha.length > SENHA_MAXIMA) {
    problemas.push({ message: `passa de ${SENHA_MAXIMA} caracteres` });
  }
  if (senha !== senha.trim()) {
    // Espaço no início ou no fim é o que some ao copiar e colar, e o sintoma é
    // "a senha que funcionou ontem não funciona hoje".
    problemas.push({ message: 'começa ou termina com espaço' });
  }
  for (const { regex, motivo } of PADROES_RECUSADOS) {
    if (regex.test(senha)) problemas.push({ message: motivo });
  }
  const email = contexto.email?.trim().toLowerCase();
  if (email) {
    const local = email.split('@')[0] ?? '';
    const baixa = senha.toLowerCase();
    if (baixa === email || (local.length >= 4 && baixa.includes(local))) {
      problemas.push({ message: 'contém o seu próprio endereço de e-mail' });
    }
  }
  return problemas;
}

/* -------------------------------------------------------------------------- */
/* resumo                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Custo do `scrypt`.
 *
 * `N = 2^15` com `r = 8` consome cerca de 32 MB e uns 100 ms nesta classe de
 * máquina. É o ponto em que um ataque de dicionário fica caro sem que entrar no
 * sistema fique lento para gente.
 *
 * `maxmem` precisa ser dito: o padrão do Node é 32 MB e `N = 2^15` fica no
 * limite, então a chamada falharia de forma intermitente conforme a versão.
 */
const PARAMETROS = Object.freeze({ N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 });
const TAMANHO_DO_SAL = 16;

/** `scrypt$N$r$p$sal$derivado`, tudo em base64 nas duas últimas partes. */
export function resumirSenha(senha: string): string {
  const sal = randomBytes(TAMANHO_DO_SAL);
  const derivado = scryptSync(senha.normalize('NFKC'), sal, PARAMETROS.keylen, PARAMETROS);
  return [
    'scrypt',
    PARAMETROS.N,
    PARAMETROS.r,
    PARAMETROS.p,
    sal.toString('base64'),
    derivado.toString('base64'),
  ].join('$');
}

/**
 * A senha corresponde ao resumo?
 *
 * `timingSafeEqual`, e não `===`: comparação que sai no primeiro byte diferente
 * revela, pelo tempo, quantos bytes iniciais estavam certos. É um ataque
 * publicado, não hipótese.
 *
 * Resumo mal formado devolve `false` em vez de lançar. Uma linha corrompida no
 * banco tem de virar "senha não confere", e não um 500 que conta ao mundo que
 * aquela conta existe e tem dado estragado.
 *
 * A NORMALIZAÇÃO É NFKC nas duas pontas. "ç" tem duas representações Unicode, e
 * o teclado do Android manda uma e o do macOS manda outra — sem normalizar, a
 * mesma senha digitada em dois aparelhos produz dois resumos.
 */
export function senhaCorresponde(senha: string, resumo: string): boolean {
  const partes = resumo.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;

  const N = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Um resumo que pedisse N absurdo viraria trabalho de CPU sem fim. O teto é
  // generoso e existe.
  if (N < 1024 || N > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let sal: Buffer;
  let esperado: Buffer;
  try {
    sal = Buffer.from(partes[4]!, 'base64');
    esperado = Buffer.from(partes[5]!, 'base64');
  } catch {
    return false;
  }
  if (sal.length === 0 || esperado.length === 0) return false;

  let obtido: Buffer;
  try {
    obtido = scryptSync(senha.normalize('NFKC'), sal, esperado.length, {
      N,
      r,
      p,
      maxmem: PARAMETROS.maxmem,
    });
  } catch {
    return false;
  }
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}

/* -------------------------------------------------------------------------- */
/* token de sessão                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Prefixo do token, para que ele seja reconhecível quando aparecer onde não
 * devia — um log, um relatório de erro, uma captura de tela.
 *
 * Reconhecível é o que permite a uma varredura de segredos encontrá-lo.
 */
export const PREFIXO_DO_TOKEN = 'aus_';

/** 256 bits de aleatoriedade. Nada de contador, nada de uuid. */
export function gerarTokenDeSessao(): string {
  return PREFIXO_DO_TOKEN + randomBytes(32).toString('base64url');
}

/** O que vai para o banco. O token NUNCA vai. */
export function resumoDoToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Parece um token nosso? Recusa antes de tocar o banco. */
export function pareceTokenDeSessao(valor: string): boolean {
  return (
    valor.startsWith(PREFIXO_DO_TOKEN) && /^[A-Za-z0-9_-]{43}$/.test(valor.slice(PREFIXO_DO_TOKEN.length))
  );
}
