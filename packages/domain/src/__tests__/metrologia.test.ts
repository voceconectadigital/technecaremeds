/**
 * Aurora — a fronteira da metrologia (SPEC §EPIC-019 · US-DOC-002).
 *
 * Duas coisas são provadas aqui, e a segunda é tão importante quanto a
 * primeira:
 *
 *  1. a regra de data faz o que a SPEC diz, inclusive nos dias exatos em que
 *     ela costuma ser implementada errada;
 *  2. NADA ALÉM DISSO FOI IMPLEMENTADO. A prova do fim exige que a lista de
 *     decisões bloqueadas continue bloqueada — porque o modo de este arquivo
 *     apodrecer é alguém acrescentar "só uma fórmula simples" num dia de
 *     pressa, e ninguém notar até a auditoria.
 */
import { describe, it, expect } from 'vitest';
import {
  padraoValidoEm,
  padroesQueImpedemEmissao,
  furosNaRastreabilidade,
  DECISOES_METROLOGICAS_BLOQUEADAS,
  type PadraoDeMedicao,
} from '../metrologia';

const padrao = (venceEm: string, nome = 'Multímetro de referência MM-04'): PadraoDeMedicao => ({
  nome,
  numeroDoCertificado: 'RBC-2025-1174',
  laboratorio: 'Laboratório Acreditado Ltda',
  venceEm,
});

describe('METRO-001 · a validade é avaliada NA DATA DA MEDIÇÃO', () => {
  it('AC1 · padrão vencido antes da medição impede a emissão', () => {
    const impedimentos = padroesQueImpedemEmissao([padrao('2026-03-01')], '2026-03-02');
    expect(impedimentos).toHaveLength(1);
    // A recusa NOMEIA — é a AC1. "Padrão vencido" sem dizer qual manda a pessoa
    // conferir a papelada de todos.
    expect(impedimentos[0]!.motivo).toContain('MM-04');
    expect(impedimentos[0]!.motivo).toContain('RBC-2025-1174');
    expect(impedimentos[0]!.motivo).toContain('2026-03-01');
  });

  it('AC2 · padrão que vence ENTRE a medição e a emissão não impede nada', () => {
    /*
     * É o caso de borda que a SPEC nomeia, e a razão é física: o certificado
     * afirma o que o instrumento fazia NAQUELE DIA, comparado com um padrão que
     * naquele dia era rastreável. Recusar aqui invalidaria trabalho correto.
     */
    expect(padroesQueImpedemEmissao([padrao('2026-03-20')], '2026-03-15')).toEqual([]);
  });

  it('o DIA do vencimento ainda vale', () => {
    /*
     * O erro clássico é usar `<` e encurtar toda validade do sistema em um dia
     * — sem que ninguém entenda por quê, porque o certificado do padrão diz
     * "válido até 15" e o sistema recusa no 15.
     */
    expect(padraoValidoEm(padrao('2026-03-15'), '2026-03-15')).toBe(true);
    expect(padraoValidoEm(padrao('2026-03-15'), '2026-03-16')).toBe(false);
  });

  it('a virada do ano e do mês não confundem a comparação', () => {
    expect(padraoValidoEm(padrao('2026-12-31'), '2027-01-01')).toBe(false);
    expect(padraoValidoEm(padrao('2027-01-01'), '2026-12-31')).toBe(true);
    expect(padraoValidoEm(padrao('2026-02-28'), '2026-03-01')).toBe(false);
  });

  it('a comparação é de TEXTO, e por isso não depende de fuso', () => {
    /*
     * `new Date('2026-03-15')` é meia-noite UTC — no Brasil, o dia 14. Se a
     * comparação passasse por `Date`, o mesmo padrão seria válido em Manaus e
     * vencido em Brasília na mesma medição, e a diferença apareceria como
     * "bug intermitente" que só acontece de madrugada.
     *
     * Este caso não prova o fuso diretamente — prova o efeito: a resposta é a
     * mesma independentemente de como a máquina que roda interpreta datas.
     */
    expect(padraoValidoEm(padrao('2026-03-15'), '2026-03-14')).toBe(true);
    expect(padraoValidoEm(padrao('2026-03-15'), '2026-03-15')).toBe(true);
  });

  it('uma data mal formada é recusada em vez de comparar em silêncio', () => {
    // `'15/03/2026' <= '2026-03-15'` é uma comparação de texto perfeitamente
    // válida, e perfeitamente errada. Sem esta recusa, ela responderia.
    expect(() => padraoValidoEm(padrao('15/03/2026'), '2026-03-15')).toThrow(/data civil/);
    expect(() => padraoValidoEm(padrao('2026-03-15'), 'ontem')).toThrow(/data civil/);
  });

  it('vários padrões vencidos são listados TODOS, e não um por vez', () => {
    const impedimentos = padroesQueImpedemEmissao(
      [padrao('2026-01-01', 'Padrão A'), padrao('2027-01-01', 'Padrão B'), padrao('2026-02-01', 'Padrão C')],
      '2026-06-01'
    );
    // Quem vai resolver precisa saber quantos padrões recalibrar antes de
    // tentar de novo: uma recusa por vez vira três idas ao laboratório.
    expect(impedimentos.map((i) => i.padrao.nome)).toEqual(['Padrão A', 'Padrão C']);
  });
});

describe('METRO-002 · a cadeia de rastreabilidade é conferida por preenchimento', () => {
  it('padrão sem número de certificado ou sem laboratório é furo', () => {
    const furos = furosNaRastreabilidade([
      { nome: 'Sem número', numeroDoCertificado: '  ', laboratorio: 'Lab', venceEm: '2027-01-01' },
      { nome: 'Sem lab', numeroDoCertificado: 'X-1', laboratorio: '', venceEm: '2027-01-01' },
    ]);
    expect(furos).toHaveLength(2);
    expect(furos[0]).toContain('Sem número');
    expect(furos[1]).toContain('Sem lab');
  });

  it('nenhum padrão declarado é o maior furo de todos', () => {
    expect(furosNaRastreabilidade([])).toEqual([
      'nenhum padrão foi declarado: sem padrão não há rastreabilidade',
    ]);
  });

  it('uma cadeia completa não acusa nada', () => {
    expect(furosNaRastreabilidade([padrao('2027-01-01')])).toEqual([]);
  });
});

describe('METRO-003 · o que está bloqueado CONTINUA bloqueado', () => {
  /*
   * ESTA PROVA É UM FREIO, e não uma verificação de comportamento.
   *
   * O modo de a fronteira da metrologia apodrecer não é alguém decidir violá-la:
   * é alguém acrescentar "só uma fórmula simples" num dia de pressa, com boa
   * intenção, e ninguém notar até uma auditoria olhar um certificado. Cada item
   * desta lista é uma decisão com consequência regulatória que exige um
   * metrologista — e a própria SPEC diz isso, em §EPIC-019: "erro de cálculo
   * metrológico tem consequência regulatória".
   *
   * Tirar um item daqui obriga a mexer neste teste, e mexer neste teste obriga
   * a explicar por quê num commit. É toda a proteção que um teste pode dar — e
   * é mais do que um comentário daria.
   */
  const ESPERADAS = [
    'incerteza_expandida',
    'erro_sistematico',
    'criterio_de_aceitacao',
    'limites_seguranca_eletrica',
    'arredondamento',
  ];

  it('as cinco decisões seguem sem implementação, e cada uma diz o que precisa', () => {
    expect(DECISOES_METROLOGICAS_BLOQUEADAS.map((d) => d.chave)).toEqual(ESPERADAS);

    for (const d of DECISOES_METROLOGICAS_BLOQUEADAS) {
      // "Bloqueado" sem dizer o que destrava vira uma lista de desculpas.
      expect(d.porque.length, `${d.chave} precisa dizer POR QUE está bloqueada`).toBeGreaterThan(30);
      expect(
        d.precisaDe.length,
        `${d.chave} precisa dizer o que um metrologista tem de fornecer`
      ).toBeGreaterThan(15);
    }
  });

  it('o módulo não exporta nenhuma função de cálculo metrológico', async () => {
    /*
     * A conferência é sobre o QUE O MÓDULO OFERECE, e não sobre o texto dele.
     *
     * Se um dia alguém acrescentar `calcularIncertezaExpandida`, este caso
     * falha — e falha com o nome da função na mensagem, que é o que faz a
     * pessoa parar e procurar quem valida a fórmula antes de seguir.
     */
    const modulo = await import('../metrologia');
    const proibidas = /incerteza|expandida|fator_?k|arredond|veredito|tolerancia|conformidade/i;
    const suspeitas = Object.keys(modulo).filter(
      (nome) => typeof (modulo as Record<string, unknown>)[nome] === 'function' && proibidas.test(nome)
    );
    expect(
      suspeitas,
      `apareceu cálculo metrológico neste módulo: ${suspeitas.join(', ')}. ` +
        'Antes de seguir, veja docs/AURORA-METROLOGIA-FRONTEIRA.md — isto precisa de um metrologista.'
    ).toEqual([]);
  });
});
