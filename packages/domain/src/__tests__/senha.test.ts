/**
 * Aurora — provas da senha (SPEC v0.2 §36).
 *
 * O que estes testes existem para pegar: uma regra de força que passa a aceitar
 * o que recusava, e um resumo que passa a conferir o que não deveria. Os dois
 * falham em silêncio — a senha fraca entra e ninguém nota; o resumo frouxo
 * aceita e ninguém nota até o dia em que importa.
 */
import { describe, it, expect } from 'vitest';
import {
  conferirForcaDaSenha,
  resumirSenha,
  senhaCorresponde,
  gerarTokenDeSessao,
  resumoDoToken,
  pareceTokenDeSessao,
  SENHA_MINIMA,
  PREFIXO_DO_TOKEN,
} from '../senha';

describe('força da senha', () => {
  it('aceita uma frase longa e sem padrão óbvio', () => {
    expect(conferirForcaDaSenha('girassol tranquilo na varanda')).toEqual([]);
  });

  it(`recusa abaixo de ${SENHA_MINIMA} caracteres, dizendo quantos tem`, () => {
    const [problema] = conferirForcaDaSenha('curta123');
    expect(problema?.message).toContain(String(SENHA_MINIMA));
    expect(problema?.message).toContain('tem 8');
  });

  it('devolve TODOS os problemas, e não o primeiro', () => {
    // Curta, sequência de teclado e palavra previsível, tudo junto.
    const problemas = conferirForcaDaSenha('qwertyaurora');
    expect(problemas.length).toBeGreaterThan(1);
  });

  it('recusa a senha que contém o próprio e-mail', () => {
    const problemas = conferirForcaDaSenha('joaosilva-muito-secreto', { email: 'joaosilva@hospital.com' });
    expect(problemas.map((p) => p.message).join(' ')).toContain('e-mail');
  });

  it('não confunde um trecho curto do e-mail com o e-mail inteiro', () => {
    // A parte local tem 3 caracteres: exigir que ela não apareça recusaria
    // qualquer senha que contivesse "ana", inclusive "semana".
    expect(conferirForcaDaSenha('semana tranquila no sul', { email: 'ana@hospital.com' })).toEqual([]);
  });

  it('recusa espaço no começo ou no fim — é o que some ao copiar e colar', () => {
    const problemas = conferirForcaDaSenha(' frase boa de verdade ');
    expect(problemas.map((p) => p.message).join(' ')).toContain('espaço');
  });

  it('recusa o nome do produto, em qualquer caixa', () => {
    for (const s of ['AURORA no comando 42', 'BeCare#Demo2026!', 'technecare para todos']) {
      expect(conferirForcaDaSenha(s).length).toBeGreaterThan(0);
    }
  });
});

describe('resumo e conferência', () => {
  it('confere a senha certa e recusa a errada', () => {
    const resumo = resumirSenha('girassol tranquilo na varanda');
    expect(senhaCorresponde('girassol tranquilo na varanda', resumo)).toBe(true);
    expect(senhaCorresponde('girassol tranquilo na varandA', resumo)).toBe(false);
  });

  it('a mesma senha gera resumos DIFERENTES — o sal é por senha', () => {
    /*
     * Se dois resumos iguais saíssem da mesma senha, uma varredura no banco
     * diria quem usa a mesma senha de quem, sem quebrar nenhuma delas.
     */
    const a = resumirSenha('girassol tranquilo na varanda');
    const b = resumirSenha('girassol tranquilo na varanda');
    expect(a).not.toEqual(b);
    expect(senhaCorresponde('girassol tranquilo na varanda', a)).toBe(true);
    expect(senhaCorresponde('girassol tranquilo na varanda', b)).toBe(true);
  });

  it('os parâmetros viajam no resumo, para poder endurecer o custo depois', () => {
    expect(resumirSenha('girassol tranquilo na varanda')).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/);
  });

  it('resumo corrompido devolve false, e não lança', () => {
    for (const ruim of ['', 'scrypt$', 'scrypt$a$b$c$d$e', 'bcrypt$1$1$1$AA$AA', 'lixo']) {
      expect(() => senhaCorresponde('qualquer coisa aqui', ruim)).not.toThrow();
      expect(senhaCorresponde('qualquer coisa aqui', ruim)).toBe(false);
    }
  });

  it('recusa um resumo com custo absurdo em vez de tentar calculá-lo', () => {
    // Sem o teto, um resumo plantado com N gigante viraria trabalho de CPU sem
    // fim numa rota pública.
    const bomba = `scrypt$999999999$8$1$${Buffer.from('sal').toString('base64')}$${Buffer.from('x').toString('base64')}`;
    expect(senhaCorresponde('qualquer coisa aqui', bomba)).toBe(false);
  });

  it('normaliza Unicode: o mesmo "ç" digitado de duas formas confere', () => {
    const composto = 'maçã verde no inverno'; // ç e ã em um código
    const decomposto = 'maçã verde no inverno'; // c + cedilha, a + til
    expect(composto).not.toEqual(decomposto);
    expect(senhaCorresponde(decomposto, resumirSenha(composto))).toBe(true);
  });
});

describe('token de sessão', () => {
  it('nasce com o prefixo que o torna reconhecível num log', () => {
    expect(gerarTokenDeSessao().startsWith(PREFIXO_DO_TOKEN)).toBe(true);
  });

  it('não repete', () => {
    const vistos = new Set(Array.from({ length: 500 }, () => gerarTokenDeSessao()));
    expect(vistos.size).toBe(500);
  });

  it('o resumo é estável e não é o token', () => {
    const t = gerarTokenDeSessao();
    expect(resumoDoToken(t)).toEqual(resumoDoToken(t));
    expect(resumoDoToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(resumoDoToken(t)).not.toContain(t);
  });

  it('reconhece a forma antes de ir ao banco', () => {
    expect(pareceTokenDeSessao(gerarTokenDeSessao())).toBe(true);
    for (const ruim of ['', 'aus_', 'local:a@b:a@b', 'Bearer x', `${PREFIXO_DO_TOKEN}curto`]) {
      expect(pareceTokenDeSessao(ruim)).toBe(false);
    }
  });
});
