/**
 * Aurora — o escritor de .xlsx (REL-10).
 *
 * O que se prova: o arquivo é um ZIP que se lê pelo diretório central, tem as partes que o Excel
 * exige, número sai tipado (`t="n"`), data sai como número de série com estilo de data (no fuso
 * pedido), texto sai como texto (inclusive o que parece fórmula), e a saída é determinística.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  crc32,
  gerarXlsx,
  nomeDaColuna,
  serialDoDia,
  serialDoInstante,
  type AbaXlsx,
} from '../documents/xlsx';
import { abaPorNome, celulas, lerZip } from './apoio/ler-xlsx';

const abas: AbaXlsx[] = [
  {
    nome: 'Indicadores',
    colunas: [{ titulo: 'Indicador', largura: 40 }, { titulo: 'Valor' }, { titulo: 'Data' }],
    linhas: [
      ['Chamados abertos (OS)', 3, { dia: '2026-09-30' }],
      ['MTTR', { numero: 829.5, formato: 'decimal' }, null],
      ['Treinamentos realizados/solicitados', 'Pendente de definição', undefined],
      ['=HYPERLINK("http://x")', { numero: 1234.5, formato: 'moeda' }, { dia: 'sem data' }],
    ],
  },
  {
    nome: 'Filtros',
    colunas: [{ titulo: 'Filtro' }, { titulo: 'Valor' }],
    linhas: [['Gerado em', { instante: new Date('2026-10-01T01:30:00Z'), fuso: 'America/Sao_Paulo' }]],
  },
];

describe('ZIP', () => {
  it('CRC-32 confere com o valor de referência', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('xlsx', () => {
  const arquivo = gerarXlsx(abas);
  const partes = lerZip(arquivo);

  it('é um ZIP com as partes do SpreadsheetML, lido pelo diretório central', () => {
    expect(arquivo.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    expect([...partes.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    const tipos = partes.get('[Content_Types].xml')!.toString('utf8');
    expect(tipos).toContain('/xl/worksheets/sheet2.xml');
    expect(partes.get('xl/styles.xml')!.toString('utf8')).toContain('formatCode="dd/mm/yyyy"');
  });

  it('cabeçalho em negrito; número tipado; texto como inlineStr', () => {
    const c = celulas(abaPorNome(partes, 'Indicadores'));
    expect(c.get('A1')).toEqual({ tipo: 'inlineStr', valor: 'Indicador', estilo: 1 });
    expect(c.get('B2')).toEqual({ tipo: 'n', valor: '3', estilo: 0 });
    expect(c.get('B3')).toMatchObject({ tipo: 'n', valor: '829.5' });
    // Pendente sai como TEXTO, e não como número.
    expect(c.get('B4')).toMatchObject({ tipo: 'inlineStr', valor: 'Pendente de definição' });
    expect(c.has('C3')).toBe(false); // nulo: célula vazia
  });

  it('data é número de série com estilo de data; data inválida vira texto', () => {
    const c = celulas(abaPorNome(partes, 'Indicadores'));
    expect(c.get('C2')).toEqual({ tipo: 'n', valor: String(serialDoDia('2026-09-30')), estilo: 2 });
    expect(serialDoDia('1900-03-01')).toBe(61);
    expect(serialDoDia('2026-09-30')).toBe(46295);
    expect(c.get('C5')).toMatchObject({ tipo: 'inlineStr', valor: 'sem data' });
  });

  it('data e hora no fuso pedido: 01:30 UTC de 01/10 é 30/09 22:30 em Brasília', () => {
    const c = celulas(abaPorNome(partes, 'Filtros'));
    const serial = Number(c.get('B2')!.valor);
    expect(c.get('B2')!.estilo).toBe(3);
    expect(Math.floor(serial)).toBe(serialDoDia('2026-09-30'));
    expect(serial).toBeCloseTo(serialDoInstante(new Date('2026-10-01T01:30:00Z'), 'America/Sao_Paulo'));
    expect(Math.round((serial % 1) * 24 * 60)).toBe(22 * 60 + 30);
  });

  it('texto que parece fórmula continua texto, escapado', () => {
    const xml = abaPorNome(partes, 'Indicadores');
    expect(xml).not.toContain('<f>');
    expect(celulas(xml).get('A5')).toMatchObject({
      tipo: 'inlineStr',
      valor: '=HYPERLINK(&quot;http://x&quot;)',
    });
  });

  it('é determinístico; nomes de aba são saneados e únicos', () => {
    expect(gerarXlsx(abas).equals(arquivo)).toBe(true);
    const dup = lerZip(
      gerarXlsx([
        { nome: 'A/B', colunas: [{ titulo: 'x' }], linhas: [] },
        { nome: 'A B', colunas: [{ titulo: 'x' }], linhas: [] },
      ])
    );
    const wb = dup.get('xl/workbook.xml')!.toString('utf8');
    expect(wb).toContain('<sheet name="A B" sheetId="1"');
    expect(wb).toContain('<sheet name="A B 2" sheetId="2"');
    expect(nomeDaColuna(0)).toBe('A');
    expect(nomeDaColuna(25)).toBe('Z');
    expect(nomeDaColuna(26)).toBe('AA');
    if (process.env.XLSX_OUT) {
      mkdirSync(process.env.XLSX_OUT, { recursive: true });
      writeFileSync(join(process.env.XLSX_OUT, 'exemplo.xlsx'), arquivo);
    }
  });
});
