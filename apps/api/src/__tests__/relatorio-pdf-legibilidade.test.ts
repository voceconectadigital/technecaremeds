/**
 * Aurora — o que a inspeção visual dos PDFs de relatório achou (29/10/2026):
 *
 *   · a legenda "Gráfico 02: …" ficava sozinha no pé da página e o gráfico ia para a seguinte;
 *   · a série toda zero desenhava o eixo de −1 a 1 ("−1 chamado");
 *   · o cabeçalho "Depreciado" do Patrimonial estourava a coluna;
 *   · o motivo pendente do TMPA citava um identificador de código no texto do cliente;
 *   · a versão das fórmulas (REL-07) sai no rodapé de notas do PDF.
 */
import { describe, it, expect } from 'vitest';
import { REPORT_INDICATORS, formulaInfo } from '@aurora/domain';
import type { AssetReport, ReportSection } from '@aurora/db';
import { desenharGrafico, gerarPdf, type LinhaPdf } from '../documents/pdf';
import { notaDasFormulas } from '../insights/relatorio-oficial';
import { montarPatrimonial } from '../insights/relatorio-patrimonial';

const opcoes = { titulo: 'Teste', autor: 'Org', rodape: 'rodapé' };

/** O fluxo de conteúdo de cada página, na ordem. */
function paginas(pdf: Buffer): string[] {
  return [...pdf.toString('latin1').matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => m[1]!);
}

describe('legenda do gráfico vai junto com o gráfico', () => {
  it('quando o gráfico não cabe no resto da página, a quebra vem ANTES da legenda', () => {
    // 48 linhas de 10 pt deixam ~64 pt: cabe a legenda, não cabe o gráfico de 140 pt.
    const linhas: LinhaPdf[] = Array.from({ length: 48 }, (_, i) => ({ texto: `linha ${i}` }));
    linhas.push(
      { texto: 'Gráfico 01: AxF', negrito: true, tamanho: 8, espacoAntes: 4, comOProximo: true },
      {
        texto: '',
        grafico: {
          rotulos: ['jan/26', 'fev/26'],
          valores: [10, 20],
          metas: [null, null],
          casas: 0,
          altura: 140,
        },
      }
    );
    const p = paginas(gerarPdf(linhas, opcoes));
    const daLegenda = p.findIndex((x) => x.includes('(Gr\\341fico 01: AxF)'));
    const doGrafico = p.findIndex((x) => x.includes('(jan/26)'));
    expect(daLegenda).toBeGreaterThanOrEqual(0);
    expect(daLegenda).toBe(doGrafico);
    expect(daLegenda).toBe(1);
  });

  it('com espaço sobrando, nada muda: legenda e gráfico na primeira página', () => {
    const p = paginas(
      gerarPdf(
        [
          { texto: 'Gráfico 01: AxF', comOProximo: true },
          { texto: '', grafico: { rotulos: ['jan/26'], valores: [1], metas: [null], casas: 0 } },
        ],
        opcoes
      )
    );
    expect(p).toHaveLength(1);
  });
});

describe('eixo da série toda zero', () => {
  it('vai de 0 a 1, nunca abaixo de zero', () => {
    const ops = desenharGrafico(
      { rotulos: ['jan/26', 'fev/26', 'mar/26'], valores: [0, 0, 0], metas: [null, null, null], casas: 0 },
      50,
      700,
      495,
      140
    ).join('\n');
    expect(ops).not.toMatch(/\(-/);
    expect(ops).toContain('(0)');
    expect(ops).toContain('(1)');
  });

  it('série negativa constante continua com folga para baixo', () => {
    const ops = desenharGrafico(
      { rotulos: ['a'], valores: [-2], metas: [null], casas: 0 },
      50,
      700,
      495,
      140
    ).join('\n');
    expect(ops).toContain('(-3)');
  });
});

describe('cabeçalho da tabela do Patrimonial cabe na coluna', () => {
  it('a palavra mais longa de cada título (negrito 7 pt) cabe na largura da coluna', () => {
    const relatorio = {
      filters: { customer: null, situation: 'all' },
      counts: { active: 1, maintenance: 0, obsolete: 0, total: 1 },
      by_status: { active: 1 },
      financials_visible: true,
      totals: [],
      assets_without_value: 0,
      items: [
        {
          id: 'x',
          name: 'Monitor',
          tag: null,
          serial_number: null,
          status: 'active',
          obsolescence_report: null,
          customer_name: 'Hospital',
          location_name: null,
          acquired_at: null,
          useful_life_years: null,
          percent_depreciated: null,
          currency: 'BRL',
          purchase_value: null,
          book_value: null,
        },
      ],
    } as unknown as AssetReport;
    const { linhas } = montarPatrimonial({
      organizacao: 'Org',
      relatorio,
      geradoEm: new Date(),
      fuso: 'UTC',
    });
    const tabela = linhas.find((l) => l.tabela)!.tabela!;
    const util = 595.28 - 2 * 50;
    const soma = tabela.colunas.reduce((a, c) => a + c.peso, 0);
    for (const c of tabela.colunas) {
      const largura = (c.peso / soma) * util - 6;
      const maiorPalavra = Math.max(...c.titulo.split(/\s+/).map((p) => p.length));
      // 0,6 em da Helvetica-Bold por letra: estimativa folgada para minúsculas.
      expect(maiorPalavra * 7 * 0.6, c.titulo).toBeLessThanOrEqual(largura);
    }
  });
});

describe('texto ao cliente, sem identificador de código', () => {
  it('nenhuma nota de indicador cita nome de função entre crases ou em camelCase', () => {
    for (const i of REPORT_INDICATORS) {
      expect(i.note ?? '', i.key).not.toMatch(/`|\b[a-z]+[A-Z][a-zA-Z]+\b|requested_type/);
    }
  });
});

describe('versão das fórmulas no PDF (REL-07)', () => {
  it('cada seção com a versão e a data; a fonte das definições listada uma vez', () => {
    const secao = (key: string): ReportSection => {
      const i = REPORT_INDICATORS.find((x) => x.key === key)!;
      const fi = formulaInfo(i);
      return {
        key,
        label: i.label,
        formula_version: fi.version,
        formula_defined_on: fi.definedOn,
        formula_source: fi.source,
      } as unknown as ReportSection;
    };
    const texto = notaDasFormulas([secao('mttr'), secao('work_order_rating')])
      .map((l) => l.texto)
      .join('\n');
    expect(texto).toContain('Versão das fórmulas');
    expect(texto).toMatch(/MTTR: v1-provisoria \(17\/10\/2026\)/);
    expect(texto).toMatch(/v1 \(21\/10\/2026\)/);
    expect(texto).toContain('Conversa com o cliente, 21/10/2026');
    expect(notaDasFormulas([])).toEqual([]);
  });
});

describe('eixo dos gráficos do PDF', () => {
  it('passo redondo e múltiplo da casa decimal do rótulo', async () => {
    const { passoRedondo } = await import('../documents/pdf');
    expect(passoRedondo(0.25, 1)).toBe(1); // série toda zero, rótulo inteiro: 0, 1
    expect(passoRedondo(1.15, 1)).toBe(2); // série até 4: 0, 2, 4, 6
    expect(passoRedondo(1.15, 0.1)).toBe(2);
    expect(passoRedondo(0.6, 0.1)).toBe(1);
    expect(passoRedondo(2.2, 1)).toBe(5); // 2,5 não serve com rótulo inteiro
    expect(passoRedondo(2.2, 0.1)).toBe(2.5);
    expect(passoRedondo(18, 1)).toBe(20);
  });
});
