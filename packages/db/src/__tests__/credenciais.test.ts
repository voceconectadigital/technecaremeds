/**
 * Aurora — provas da autenticação por senha (migration 0045).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA SUÍTE EXISTE PARA PEGAR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Todo defeito de autenticação é silencioso. Não existe tela quebrada, não
 * existe 500 no log: existe alguém entrando que não devia, ou alguém que devia
 * continuando de fora depois de "sair". Por isso as provas aqui são sobre
 * PROPRIEDADES, e várias delas são adversariais — elas tentam o que um atacante
 * tentaria.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, resumirSenha, gerarTokenDeSessao, resumoDoToken } from '@aurora/domain';
import {
  abrirSessaoPorSenha,
  identidadePorToken,
  encerrarSessao,
  definirSenha,
  JANELA_DE_SESSAO_HORAS,
} from '../credenciais';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId();
const USER = newId();
const MEM = newId();
const EMAIL = 'tecnica@hospital.test';
const SENHA = 'girassol tranquilo na varanda';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'hosp', name: 'Hospital de Teste', email: EMAIL, userName: 'Técnica de Teste' }
  );
  await definirSenha(t.admin, { userId: USER, senha: SENHA });
});

afterAll(async () => {
  await t.close();
});

describe('entrar', () => {
  it('a senha certa abre sessão e devolve quem é', async () => {
    const r = await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: SENHA });
    expect('token' in r).toBe(true);
    if (!('token' in r)) return;
    expect(r.user.email).toBe(EMAIL);
    expect(r.token.startsWith('aus_')).toBe(true);
    // A janela é a declarada, e não um número solto em algum lugar.
    const horas = (r.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(JANELA_DE_SESSAO_HORAS - 1);
    expect(horas).toBeLessThanOrEqual(JANELA_DE_SESSAO_HORAS);
  });

  it('o e-mail não distingue maiúsculas nem espaços em volta', async () => {
    const r = await abrirSessaoPorSenha(t.db, { email: `  ${EMAIL.toUpperCase()} `, senha: SENHA });
    expect('token' in r).toBe(true);
  });

  it('a senha errada é recusada', async () => {
    const r = await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: `${SENHA}x` });
    expect(r).toEqual({ motivo: 'credencial_invalida' });
  });

  /**
   * A PROPRIEDADE QUE MAIS IMPORTA DESTA SUÍTE.
   *
   * Recusa idêntica para conta inexistente e senha errada. Se as duas fossem
   * distinguíveis — por mensagem OU por tempo —, o formulário de login viraria
   * um oráculo de cadastro: dá para descobrir quem tem conta aqui sem acertar
   * uma senha sequer.
   */
  it('conta inexistente e senha errada são indistinguíveis', async () => {
    const inexistente = await abrirSessaoPorSenha(t.db, {
      email: 'ninguem@hospital.test',
      senha: SENHA,
    });
    const errada = await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: 'outra coisa qualquer' });
    expect(inexistente).toEqual(errada);
  });

  it('a conta inexistente também paga o custo do scrypt', async () => {
    /*
     * Sem o resumo de engodo, a resposta para um e-mail sem conta voltaria em
     * ~1 ms e a de senha errada em ~100 ms — e a diferença enumera o cadastro.
     *
     * O limite é frouxo de propósito (20 ms): a prova é que EXISTE trabalho de
     * derivação, não uma medida de desempenho, que oscila em máquina carregada.
     */
    const inicio = Date.now();
    await abrirSessaoPorSenha(t.db, { email: 'fantasma@hospital.test', senha: SENHA });
    expect(Date.now() - inicio).toBeGreaterThan(20);
  });

  it('e-mail ou senha vazios não chegam ao banco', async () => {
    expect(await abrirSessaoPorSenha(t.db, { email: '', senha: SENHA })).toEqual({
      motivo: 'credencial_invalida',
    });
    expect(await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: '' })).toEqual({
      motivo: 'credencial_invalida',
    });
  });

  it('conta desativada responde como credencial inválida, sem contar que existe', async () => {
    const outroId = newId();
    await t.raw(`INSERT INTO aurora.users (id, email, name, status) VALUES ($1, $2, $3, 'disabled')`, [
      outroId,
      'desativada@hospital.test',
      'Pessoa Desativada',
    ]);
    await definirSenha(t.admin, { userId: outroId, senha: SENHA });

    const r = await abrirSessaoPorSenha(t.db, { email: 'desativada@hospital.test', senha: SENHA });
    expect(r).toEqual({ motivo: 'credencial_invalida' });
  });
});

describe('bloqueio por tentativas', () => {
  it('cinco erros fecham a conta por um tempo, e o acerto depois disso não entra', async () => {
    const id = newId();
    await t.raw(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [
      id,
      'alvo@hospital.test',
      'Alvo de Força Bruta',
    ]);
    await definirSenha(t.admin, { userId: id, senha: SENHA });

    for (let i = 0; i < 5; i++) {
      await abrirSessaoPorSenha(t.db, { email: 'alvo@hospital.test', senha: 'errada demais 1' });
    }

    const r = await abrirSessaoPorSenha(t.db, { email: 'alvo@hospital.test', senha: SENHA });
    expect('motivo' in r && r.motivo).toBe('conta_bloqueada');
    expect('liberaEm' in r && r.liberaEm).toBeInstanceOf(Date);
  });

  it('o bloqueio TEM PRAZO — não vira negação de serviço contra a pessoa certa', async () => {
    const id = newId();
    await t.raw(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [
      id,
      'prazo@hospital.test',
      'Pessoa com Prazo',
    ]);
    await definirSenha(t.admin, { userId: id, senha: SENHA });
    for (let i = 0; i < 5; i++) {
      await abrirSessaoPorSenha(t.db, { email: 'prazo@hospital.test', senha: 'errada demais 1' });
    }
    /*
     * Empurra o relógio do bloqueio para trás: é o equivalente a esperar. Sem
     * prazo, quem soubesse o e-mail de alguém poderia trancá-lo para sempre de
     * fora — o ataque vira negação de serviço em vez de invasão.
     */
    await t.raw(`UPDATE aurora.user_credentials SET locked_until = now() - interval '1 minute' WHERE user_id = $1`, [id]);

    const r = await abrirSessaoPorSenha(t.db, { email: 'prazo@hospital.test', senha: SENHA });
    expect('token' in r).toBe(true);
  });

  it('o acerto zera o contador', async () => {
    const id = newId();
    await t.raw(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [
      id,
      'zera@hospital.test',
      'Pessoa que Acerta',
    ]);
    await definirSenha(t.admin, { userId: id, senha: SENHA });

    for (let i = 0; i < 3; i++) {
      await abrirSessaoPorSenha(t.db, { email: 'zera@hospital.test', senha: 'errada demais 1' });
    }
    await abrirSessaoPorSenha(t.db, { email: 'zera@hospital.test', senha: SENHA });

    const [linha] = await t.raw<{ failed_attempts: number }>(
      `SELECT failed_attempts FROM aurora.user_credentials WHERE user_id = $1`,
      [id]
    );
    // Sem isto, cinco erros espalhados por três meses fechariam a conta de quem
    // sempre entrou.
    expect(Number(linha!.failed_attempts)).toBe(0);
  });
});

describe('a sessão', () => {
  it('o token identifica o portador', async () => {
    const r = await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: SENHA });
    if (!('token' in r)) throw new Error('não abriu sessão');

    const quem = await identidadePorToken(t.db, r.token);
    expect(quem?.userId).toBe(USER);
    expect(quem?.email).toBe(EMAIL);
  });

  it('O TOKEM EM CLARO NÃO ESTÁ NO BANCO — só o resumo', async () => {
    const r = await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: SENHA });
    if (!('token' in r)) throw new Error('não abriu sessão');

    const linhas = await t.raw<{ token_sha256: string }>(`SELECT token_sha256 FROM aurora.user_sessions`);
    const todos = linhas.map((l) => l.token_sha256);
    expect(todos).not.toContain(r.token);
    expect(todos).toContain(resumoDoToken(r.token));
  });

  it('token inventado, malformado ou de outra forma não identifica ninguém', async () => {
    for (const ruim of ['', 'lixo', 'local:a@b.c:a@b.c', gerarTokenDeSessao()]) {
      expect(await identidadePorToken(t.db, ruim)).toBeNull();
    }
  });

  it('sessão expirada não identifica — e a expiração é do servidor', async () => {
    const r = await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: SENHA });
    if (!('token' in r)) throw new Error('não abriu sessão');

    await t.raw(
      `UPDATE aurora.user_sessions
          SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 second'
        WHERE token_sha256 = $1`,
      [resumoDoToken(r.token)]
    );
    expect(await identidadePorToken(t.db, r.token)).toBeNull();
  });

  it('cada uso empurra o vencimento, mas há teto absoluto', async () => {
    const r = await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: SENHA });
    if (!('token' in r)) throw new Error('não abriu sessão');

    /*
     * Envelhece a sessão em 29 dias: o teto é `created_at + 30 dias`, então o
     * uso de hoje não pode empurrar o vencimento além disso. Sem teto, uma aba
     * aberta para sempre seria uma sessão eterna.
     */
    await t.raw(
      `UPDATE aurora.user_sessions SET created_at = now() - interval '29 days' WHERE token_sha256 = $1`,
      [resumoDoToken(r.token)]
    );
    const quem = await identidadePorToken(t.db, r.token);
    expect(quem).not.toBeNull();
    const diasAtePinicoDoTeto = (quem!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(diasAtePinicoDoTeto).toBeLessThan(1.1);
  });

  it('sair invalida o token NO SERVIDOR, e é idempotente', async () => {
    const r = await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: SENHA });
    if (!('token' in r)) throw new Error('não abriu sessão');

    expect(await encerrarSessao(t.db, r.token)).toBe(1);
    expect(await identidadePorToken(t.db, r.token)).toBeNull();
    // Encerrar de novo devolve 0, e não erro: é o estado desejado.
    expect(await encerrarSessao(t.db, r.token)).toBe(0);
  });

  it('trocar a senha derruba as sessões abertas', async () => {
    const primeira = await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: SENHA });
    const segunda = await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: SENHA });
    if (!('token' in primeira) || !('token' in segunda)) throw new Error('não abriu sessão');

    await definirSenha(t.admin, { userId: USER, senha: 'outra frase inteira nova' });

    /*
     * A parte que se esquece. Trocar a senha porque se suspeita de vazamento e
     * deixar a sessão do invasor viva é fazer metade do trabalho e acreditar
     * que fez o todo.
     */
    expect(await identidadePorToken(t.db, primeira.token)).toBeNull();
    expect(await identidadePorToken(t.db, segunda.token)).toBeNull();

    // e a senha nova vale
    const nova = await abrirSessaoPorSenha(t.db, { email: EMAIL, senha: 'outra frase inteira nova' });
    expect('token' in nova).toBe(true);
    await definirSenha(t.admin, { userId: USER, senha: SENHA });
  });
});

describe('o papel da aplicação não alcança as tabelas', () => {
  /**
   * A metade estrutural da decisão da 0045. Sem esta prova, alguém amplia o
   * privilégio "só para consultar" e a garantia some sem ninguém decidir nada.
   */
  it('aurora_app não tem privilégio em user_credentials nem em user_sessions', async () => {
    const linhas = await t.raw<{ tabela: string; pode: boolean }>(
      `SELECT t.tabela, has_table_privilege('aurora_app', 'aurora.' || t.tabela, 'SELECT') AS pode
         FROM (VALUES ('user_credentials'), ('user_sessions')) AS t(tabela)`
    );
    for (const l of linhas) expect(l.pode).toBe(false);
  });

  it('aurora_app NÃO pode executar definir_senha', async () => {
    const [l] = await t.raw<{ pode: boolean }>(
      `SELECT has_function_privilege('aurora_app', 'aurora.definir_senha(uuid,text)', 'EXECUTE') AS pode`
    );
    // Capacidade concedida "para quando precisar" é a que aparece num incidente
    // sem ninguém ter decidido nada.
    expect(l!.pode).toBe(false);
  });

  it('as funções de autenticação pertencem a aurora_auth, e não a aurora_identity', async () => {
    const linhas = await t.raw<{ proname: string; dono: string }>(
      `SELECT p.proname, pg_get_userbyid(p.proowner) AS dono
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='aurora'
          AND p.proname IN ('credencial_por_email','abrir_sessao','sessao_por_token',
                            'encerrar_sessao','definir_senha','registrar_tentativa_de_senha')`
    );
    expect(linhas.length).toBe(6);
    for (const l of linhas) expect(l.dono).toBe('aurora_auth');
  });

  it('as duas tabelas têm RLS ligada e FORÇADA', async () => {
    const linhas = await t.raw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='aurora' AND c.relname IN ('user_credentials','user_sessions')`
    );
    expect(linhas.length).toBe(2);
    for (const l of linhas) {
      expect(l.relrowsecurity).toBe(true);
      expect(l.relforcerowsecurity).toBe(true);
    }
  });
});

describe('restrições de tabela', () => {
  it('um resumo que não é scrypt é recusado pelo banco', async () => {
    const id = newId();
    await t.raw(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [
      id,
      'formato@hospital.test',
      'Formato',
    ]);
    await expect(
      t.raw(`INSERT INTO aurora.user_credentials (user_id, password_hash) VALUES ($1, $2)`, [
        id,
        'senha-em-claro',
      ])
    ).rejects.toThrow();
  });

  it('uma sessão revogada sem motivo é recusada pelo banco', async () => {
    const id = newId();
    await expect(
      t.raw(
        `INSERT INTO aurora.user_sessions (id, user_id, token_sha256, expires_at, revoked_at)
         VALUES ($1, $2, $3, now() + interval '1 hour', now())`,
        [id, USER, resumoDoToken(gerarTokenDeSessao())]
      )
    ).rejects.toThrow();
  });

  it('o mesmo resumo de token não pode existir duas vezes', async () => {
    const resumo = resumoDoToken(gerarTokenDeSessao());
    await t.raw(
      `INSERT INTO aurora.user_sessions (id, user_id, token_sha256, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [newId(), USER, resumo]
    );
    await expect(
      t.raw(
        `INSERT INTO aurora.user_sessions (id, user_id, token_sha256, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [newId(), USER, resumo]
      )
    ).rejects.toThrow();
  });

  it('o resumo da senha guardado é o que a conferência aceita', async () => {
    // Fecha o circuito: o formato que o domínio gera é o que a restrição do
    // banco admite. As duas regras estão em arquivos diferentes e poderiam
    // divergir sem que nada acusasse.
    const id = newId();
    await t.raw(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [
      id,
      'circuito@hospital.test',
      'Circuito',
    ]);
    await expect(
      t.raw(`INSERT INTO aurora.user_credentials (user_id, password_hash) VALUES ($1, $2)`, [
        id,
        resumirSenha('frase boa para o circuito'),
      ])
    ).resolves.toBeDefined();
  });
});
