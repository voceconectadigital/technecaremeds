/**
 * Aurora — o escritor de PDF (gap V2 P2.8).
 *
 * O que um leitor de PDF exige e o que um atacante tentaria: o arquivo é
 * estruturalmente válido (xref aponta para os objetos), é determinístico, o
 * texto do português sobrevive, e texto de usuário NUNCA vira operador.
 */
import { describe, it, expect } from 'vitest';
import { gerarPdf, winAnsi } from '../documents/pdf';
import { pdfDoDocumento, nomeDoArquivo, type DocumentoParaPdf } from '../documents/documento-pdf';

const opcoes = { titulo: 'Teste', autor: 'Organização', rodape: 'rodapé' };

function conferirXref(pdf: Buffer): void {
  const s = pdf.toString('latin1');
  expect(s.startsWith('%PDF-1.4\n')).toBe(true);
  expect(s.endsWith('%%EOF\n')).toBe(true);
  const inicio = Number(/startxref\n(\d+)\n/.exec(s)![1]);
  expect(s.slice(inicio, inicio + 4)).toBe('xref');
  const [, total] = /xref\n0 (\d+)\n/.exec(s.slice(inicio))!;
  const entradas = s
    .slice(inicio)
    .split('\n')
    .slice(3, 2 + Number(total));
  entradas.forEach((linha, i) => {
    const deslocamento = Number(linha.slice(0, 10));
    expect(s.slice(deslocamento, deslocamento + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`);
  });
}

describe('estrutura', () => {
  it('xref aponta exatamente para cada objeto', () => {
    conferirXref(gerarPdf([{ texto: 'Olá, mundo', titulo: true }, { texto: 'linha' }], opcoes));
  });

  it('muitas linhas viram várias páginas, e o xref continua certo', () => {
    const linhas = Array.from({ length: 300 }, (_, i) => ({ texto: `linha ${i}` }));
    const pdf = gerarPdf(linhas, opcoes);
    conferirXref(pdf);
    expect(Number(/\/Count (\d+)/.exec(pdf.toString('latin1'))![1])).toBeGreaterThan(3);
    expect(pdf.toString('latin1')).toContain('(p\\341gina 1 de ');
  });

  it('é determinístico: mesmo conteúdo, mesmos bytes', () => {
    const a = gerarPdf([{ texto: 'Certificado' }], opcoes);
    const b = gerarPdf([{ texto: 'Certificado' }], opcoes);
    expect(a.equals(b)).toBe(true);
  });
});

describe('texto', () => {
  it('o português sobrevive em WinAnsi', () => {
    expect(winAnsi('ção')).toEqual([0xe7, 0xe3, 0x6f]);
    expect(winAnsi('—')).toEqual([0x97]);
    expect(winAnsi('µA')).toEqual([0xb5, 0x41]);
  });

  it('o que não cabe em WinAnsi vira "?", não quebra o arquivo', () => {
    expect(winAnsi('Ω✓')).toEqual([0x3f, 0x3f]);
  });

  it('texto de usuário nunca vira operador PDF', () => {
    const pdf = gerarPdf([{ texto: 'x) Tj ET BT /F2 99 Tf (pwned' }], opcoes).toString('latin1');
    expect(pdf).toContain('(x\\) Tj ET BT /F2 99 Tf \\(pwned) Tj');
    conferirXref(Buffer.from(pdf, 'latin1'));
  });

  it('palavra maior que a linha é cortada em vez de vazar a margem', () => {
    const pdf = gerarPdf([{ texto: 'a'.repeat(500) }], opcoes).toString('latin1');
    const linhas = pdf.match(/\(a+\) Tj/g)!;
    expect(linhas.length).toBeGreaterThan(1);
  });
});

describe('o documento técnico', () => {
  const base: DocumentoParaPdf = {
    id: '0193dd00-0000-7000-8000-000000000001',
    organization_name: 'Prestadora Exemplo',
    type_label: 'Certificado de calibração',
    number: null,
    version: 1,
    status: 'draft',
    title: 'Calibração de incubadora',
    verdict: null,
    issued_at: null,
    valid_until: null,
    asset_name: 'Incubadora',
    work_order_number: 'WO-2026-0001',
    technical_manager_name: 'RT',
    content_hash: null,
    payload: {},
    signatures: [],
  };

  it('rascunho sai com faixa de NÃO EMITIDO e sem número', () => {
    const s = pdfDoDocumento(base).toString('latin1');
    expect(s).toContain('DOCUMENTO N\\303O EMITIDO');
    expect(s).toContain('Sem n\\372mero');
  });

  it('emitido sai sem faixa, com número e hash no rodapé do conteúdo', () => {
    const s = pdfDoDocumento({
      ...base,
      status: 'issued',
      number: 'CAL-2026-000001',
      issued_at: '2026-10-01T12:00:00.000Z',
      content_hash: 'a'.repeat(64),
    }).toString('latin1');
    expect(s).not.toContain('N\\303O EMITIDO');
    expect(s).toContain('CAL-2026-000001');
    expect(s).toContain('a'.repeat(64));
  });

  it('a marca técnica interna não aparece no documento do cliente', () => {
    const s = pdfDoDocumento(base).toString('latin1');
    expect(s.toLowerCase()).not.toContain('aurora');
  });

  it('nome do arquivo é seguro para cabeçalho', () => {
    expect(nomeDoArquivo({ number: 'CAL-2026/0001"x', id: base.id, version: 2 })).toBe(
      'CAL-2026-0001-x-v2.pdf'
    );
    expect(nomeDoArquivo({ number: null, id: base.id, version: 1 })).toBe('rascunho-0193dd00-v1.pdf');
  });
});
