/**
 * Aurora — um escritor de PDF de texto, pequeno e previsível (gap V2 P2.8).
 *
 * POR QUE NÃO UMA BIBLIOTECA
 *
 * O documento técnico precisa de texto, títulos, quebra de linha e quebra de
 * página. Uma biblioteca de PDF traria fontes embutidas, compressão, um motor de
 * layout e várias centenas de kB para a API — e um comportamento que muda de
 * versão em versão. Para o que é pedido aqui, 200 linhas que qualquer pessoa lê
 * de ponta a ponta são mais seguras: a saída é DETERMINÍSTICA (mesmo conteúdo,
 * mesmos bytes), nenhum dado externo entra no arquivo, e não há como injetar
 * operador PDF por um campo de texto, porque todo texto passa por `literal()`.
 *
 * O QUE ELE NÃO FAZ
 *
 * Não embute fonte (usa Helvetica, uma das 14 fontes-padrão que todo leitor
 * tem), não desenha imagem, não assina digitalmente. Caractere fora do
 * WinAnsi (o latim do português cabe inteiro) vira "?": um PDF que troca um
 * símbolo raro por "?" é feio; um que quebra é inútil.
 */

export interface LinhaPdf {
  texto: string;
  /** Título de seção: negrito e maior. */
  titulo?: boolean;
  negrito?: boolean;
  /** Tamanho da fonte em pontos. Padrão 10. */
  tamanho?: number;
  /** Recuo em pontos. */
  recuo?: number;
  /** Espaço extra antes da linha. */
  espacoAntes?: number;
}

export interface OpcoesPdf {
  titulo: string;
  autor: string;
  /** Linha repetida no rodapé de toda página. */
  rodape: string;
  /** Faixa repetida no topo de toda página (ex.: "NÃO EMITIDO"). Opcional. */
  faixa?: string | null;
}

const LARGURA = 595.28; // A4
const ALTURA = 841.89;
const MARGEM = 50;

/** cp1252 para os caracteres acima de 0x7F que o português usa e os que o Windows mapeia. */
const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/** Converte texto para bytes WinAnsi; o que não cabe vira "?". */
export function winAnsi(texto: string): number[] {
  const out: number[] = [];
  for (const ch of texto.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09) out.push(0x20);
    else if (cp >= 0x20 && cp <= 0x7e) out.push(cp);
    else if (cp >= 0xa0 && cp <= 0xff) out.push(cp);
    else if (WIN_ANSI_EXTRA[ch] !== undefined) out.push(WIN_ANSI_EXTRA[ch]!);
    else if (cp === 0x2212)
      out.push(0x2d); // sinal de menos tipográfico → hífen
    else out.push(0x3f); // ?
  }
  return out;
}

/**
 * Literal de string PDF, com escape.
 *
 * É a única porta de texto para dentro do arquivo: parênteses e barra
 * invertida escapados, e nada de controle. Um título "x) Tj (y" não vira
 * operador — continua sendo texto.
 */
function literal(texto: string): string {
  let s = '(';
  for (const b of winAnsi(texto)) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return s + ')';
}

/** Quebra pela largura aproximada da Helvetica (média ~0,52 em). Conservador: nunca vaza a margem. */
function quebrar(texto: string, tamanho: number, larguraUtil: number): string[] {
  const max = Math.max(10, Math.floor(larguraUtil / (tamanho * 0.56)));
  const linhas: string[] = [];
  for (const paragrafo of texto.split(/\r?\n/)) {
    let atual = '';
    for (const palavra of paragrafo.split(/\s+/)) {
      if (palavra === '') continue;
      let p = palavra;
      while (p.length > max) {
        if (atual) {
          linhas.push(atual);
          atual = '';
        }
        linhas.push(p.slice(0, max));
        p = p.slice(max);
      }
      if (!atual) atual = p;
      else if (atual.length + 1 + p.length <= max) atual += ' ' + p;
      else {
        linhas.push(atual);
        atual = p;
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();

/** Monta o PDF. Mesma entrada → mesmos bytes. */
export function gerarPdf(linhas: readonly LinhaPdf[], opcoes: OpcoesPdf): Buffer {
  const paginas: string[][] = [];
  let atual: string[] = [];
  let y = ALTURA - MARGEM - (opcoes.faixa ? 24 : 0);
  const fundo = MARGEM + 30;

  const novaPagina = () => {
    paginas.push(atual);
    atual = [];
    y = ALTURA - MARGEM - (opcoes.faixa ? 24 : 0);
  };

  for (const l of linhas) {
    const tamanho = l.tamanho ?? (l.titulo ? 12 : 10);
    const fonte = l.titulo || l.negrito ? 'F2' : 'F1';
    const recuo = l.recuo ?? 0;
    const entre = tamanho * 1.35;
    y -= l.espacoAntes ?? (l.titulo ? 8 : 0);
    for (const pedaco of quebrar(l.texto, tamanho, LARGURA - 2 * MARGEM - recuo)) {
      if (y - entre < fundo) novaPagina();
      y -= entre;
      atual.push(`BT /${fonte} ${tamanho} Tf ${num(MARGEM + recuo)} ${num(y)} Td ${literal(pedaco)} Tj ET`);
    }
  }
  paginas.push(atual);

  const total = paginas.length;
  const objetos: string[] = [];
  // 1 catálogo, 2 páginas, 3 Helvetica, 4 Helvetica-Bold, 5 info; páginas a partir de 6.
  const idsDePagina = paginas.map((_, i) => 6 + i * 2);
  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[2] = `<< /Type /Pages /Kids [${idsDePagina.map((id) => `${id} 0 R`).join(' ')}] /Count ${total} >>`;
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objetos[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objetos[5] = `<< /Title ${literal(opcoes.titulo)} /Author ${literal(opcoes.autor)} >>`;

  paginas.forEach((conteudo, i) => {
    const idPagina = idsDePagina[i]!;
    const idConteudo = idPagina + 1;
    const extras: string[] = [];
    if (opcoes.faixa) {
      extras.push(
        `BT /F2 11 Tf ${num(MARGEM)} ${num(ALTURA - MARGEM + 4)} Td ${literal(opcoes.faixa)} Tj ET`
      );
    }
    extras.push(`BT /F1 8 Tf ${num(MARGEM)} ${num(MARGEM)} Td ${literal(opcoes.rodape)} Tj ET`);
    extras.push(
      `BT /F1 8 Tf ${num(LARGURA - MARGEM - 70)} ${num(MARGEM)} Td ${literal(`página ${i + 1} de ${total}`)} Tj ET`
    );
    const fluxo = [...conteudo, ...extras].join('\n');
    objetos[idPagina] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(LARGURA)} ${num(ALTURA)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idConteudo} 0 R >>`;
    objetos[idConteudo] = `<< /Length ${Buffer.byteLength(fluxo, 'latin1')} >>\nstream\n${fluxo}\nendstream`;
  });

  // Tudo o que entra no arquivo já é ASCII (texto passou por `literal`), então
  // latin1 é byte a byte e os deslocamentos do xref batem.
  let corpo = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const deslocamentos: number[] = [];
  for (let id = 1; id < objetos.length; id++) {
    deslocamentos[id] = Buffer.byteLength(corpo, 'latin1');
    corpo += `${id} 0 obj\n${objetos[id]}\nendobj\n`;
  }
  const inicioXref = Buffer.byteLength(corpo, 'latin1');
  corpo += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objetos.length; id++) {
    corpo += `${String(deslocamentos[id]).padStart(10, '0')} 00000 n \n`;
  }
  corpo += `trailer\n<< /Size ${objetos.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(corpo, 'latin1');
}
