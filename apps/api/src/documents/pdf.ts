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
  /** Bloco gráfico (vetorial) no lugar do texto. */
  grafico?: GraficoPdf;
  /** Tabela com cabeçalho, no lugar do texto. */
  tabela?: TabelaPdf;
  /** Linhas de assinatura lado a lado, no lugar do texto. */
  assinaturas?: AssinaturaPdf[];
  /** Começa uma página nova antes desta linha. */
  quebraDePagina?: boolean;
}

/**
 * Gráfico de linha de uma série (ex.: 12 meses) com a linha de meta tracejada.
 * Vetorial: só operadores de caminho do PDF, sem imagem e sem biblioteca.
 */
export interface GraficoPdf {
  rotulos: string[];
  valores: (number | null)[];
  /** Meta de cada ponto (a meta pode mudar de vigência); nulo = sem meta no ponto. */
  metas: (number | null)[];
  /** Casas decimais dos rótulos de valor e do eixo. */
  casas: number;
  /** Sufixo dos rótulos de valor (ex.: "%"). */
  sufixo?: string;
  /** Altura do bloco em pontos. Padrão 150. */
  altura?: number;
  /** Texto no lugar do gráfico quando a série não existe (ex.: situação de agora). */
  semSerie?: string;
}

export interface ColunaPdf {
  titulo: string;
  /** Peso da coluna na largura útil. */
  peso: number;
  alinhar?: 'e' | 'c';
}

export interface TabelaPdf {
  colunas: ColunaPdf[];
  linhas: string[][];
  /** Tamanho da fonte. Padrão 8. */
  tamanho?: number;
}

export interface AssinaturaPdf {
  nome: string;
  cargo: string;
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
  // ≥ e ≤ não existem em WinAnsi (e as metas dos relatórios os usam): viram >= e <=.
  const ajustado = texto.normalize('NFC').replace(/≥/g, '>=').replace(/≤/g, '<=');
  for (const ch of ajustado) {
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
function quebrar(texto: string, tamanho: number, larguraUtil: number, largura = 0.56): string[] {
  const max = Math.max(10, Math.floor(larguraUtil / (tamanho * largura)));
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

const escrever = (fonte: 'F1' | 'F2', tamanho: number, x: number, y: number, s: string) =>
  `BT /${fonte} ${tamanho} Tf ${num(x)} ${num(y)} Td ${literal(s)} Tj ET`;

/** Largura aproximada de um texto em Helvetica, para alinhar sem medir fonte. */
const larguraDe = (s: string, tamanho: number) => s.length * tamanho * 0.5;

const fmt = (v: number, casas: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

const AZUL = '0.16 0.38 0.65';
const VERMELHO = '0.80 0.18 0.18';

/** Operadores de um gráfico de linha que ocupa [x0, x0+larg] × [yTopo-alt, yTopo]. */
export function desenharGrafico(
  g: GraficoPdf,
  x0: number,
  yTopo: number,
  larg: number,
  alt: number
): string[] {
  const ops: string[] = [];
  const esq = 40;
  const dir = 10;
  const topo = 14;
  const base = 16;
  const px = x0 + esq;
  const pw = larg - esq - dir;
  const py = yTopo - alt + base;
  const ph = alt - base - topo;
  const n = Math.max(1, g.rotulos.length);

  ops.push(`q 0.75 G 0.5 w ${num(px)} ${num(py)} ${num(pw)} ${num(ph)} re S Q`);
  g.rotulos.forEach((r, i) => {
    const cx = px + ((i + 0.5) * pw) / n;
    ops.push(escrever('F1', 6.5, cx - larguraDe(r, 6.5) / 2, py - 9, r));
  });

  const pontos = [...g.valores, ...g.metas].filter((v): v is number => v !== null && Number.isFinite(v));
  if (g.semSerie || pontos.length === 0) {
    ops.push(escrever('F1', 8, px + 8, py + ph / 2, g.semSerie ?? 'Sem dados no período'));
    return ops;
  }
  let lo = Math.min(...pontos);
  let hi = Math.max(...pontos);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  } else {
    const folga = (hi - lo) * 0.15;
    lo -= folga;
    hi += folga;
    // Contagem e percentual não vão abaixo de zero: o eixo não pode mostrar "-3 chamados".
    if (Math.min(...pontos) >= 0 && lo < 0) lo = 0;
  }
  const yDe = (v: number) => py + ((v - lo) / (hi - lo)) * ph;
  const xDe = (i: number) => px + ((i + 0.5) * pw) / n;

  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    const y = yDe(v);
    if (k > 0 && k < 4) ops.push(`q 0.9 G 0.3 w ${num(px)} ${num(y)} m ${num(px + pw)} ${num(y)} l S Q`);
    const rotulo = fmt(v, g.casas);
    ops.push(escrever('F1', 6, px - 3 - larguraDe(rotulo, 6), y - 2, rotulo));
  }

  // Segmentos contínuos: um mês sem valor interrompe a linha em vez de ligar por cima dele.
  const trecho = (serie: (number | null)[]): string => {
    let d = '';
    let aberto = false;
    serie.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        aberto = false;
        return;
      }
      d += `${num(xDe(i))} ${num(yDe(v))} ${aberto ? 'l' : 'm'} `;
      aberto = true;
    });
    return d;
  };
  const metaTrecho = trecho(g.metas);
  if (metaTrecho) ops.push(`q ${VERMELHO} RG 1 w [4 3] 0 d ${metaTrecho}S Q`);
  const valorTrecho = trecho(g.valores);
  if (valorTrecho) ops.push(`q ${AZUL} RG 1.5 w ${valorTrecho}S Q`);
  g.valores.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return;
    ops.push(`q ${AZUL} rg ${num(xDe(i) - 1.8)} ${num(yDe(v) - 1.8)} 3.6 3.6 re f Q`);
    const rotulo = `${fmt(v, g.casas)}${g.sufixo ?? ''}`;
    ops.push(escrever('F1', 6.5, xDe(i) - larguraDe(rotulo, 6.5) / 2, yDe(v) + 4, rotulo));
  });

  // Legenda no canto superior direito.
  const lx = px + pw - 120;
  const ly = yTopo - 7;
  ops.push(`q ${AZUL} RG 1.5 w ${num(lx)} ${num(ly + 2)} m ${num(lx + 14)} ${num(ly + 2)} l S Q`);
  ops.push(escrever('F1', 6.5, lx + 18, ly, 'Valor'));
  if (metaTrecho) {
    ops.push(
      `q ${VERMELHO} RG 1 w [4 3] 0 d ${num(lx + 52)} ${num(ly + 2)} m ${num(lx + 66)} ${num(ly + 2)} l S Q`
    );
    ops.push(escrever('F1', 6.5, lx + 70, ly, 'Meta'));
  }
  return ops;
}

/** Desenha uma linha da tabela; devolve os operadores. */
function linhaDeTabela(
  t: TabelaPdf,
  celulas: string[],
  larguras: number[],
  yTopo: number,
  altura: number,
  cabecalho: boolean
): string[] {
  const ops: string[] = [];
  const tam = t.tamanho ?? 8;
  const total = larguras.reduce((a, b) => a + b, 0);
  if (cabecalho)
    ops.push(`q 0.90 g ${num(MARGEM)} ${num(yTopo - altura)} ${num(total)} ${num(altura)} re f Q`);
  let x = MARGEM;
  larguras.forEach((w, i) => {
    ops.push(`q 0.6 G 0.4 w ${num(x)} ${num(yTopo - altura)} ${num(w)} ${num(altura)} re S Q`);
    const col = t.colunas[i]!;
    quebrar(celulas[i] ?? '', tam, w - 6).forEach((parte, k) => {
      const ty = yTopo - 3 - tam - k * tam * 1.25;
      const tx = col.alinhar === 'c' ? x + (w - larguraDe(parte, tam)) / 2 : x + 3;
      ops.push(escrever(cabecalho ? 'F2' : 'F1', tam, Math.max(x + 1, tx), ty, parte));
    });
    x += w;
  });
  return ops;
}

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

  const larguraUtil = LARGURA - 2 * MARGEM;

  for (const l of linhas) {
    if (l.quebraDePagina && atual.length > 0) novaPagina();
    if (l.grafico) {
      const alt = l.grafico.altura ?? 150;
      if (y - alt < fundo) novaPagina();
      atual.push(...desenharGrafico(l.grafico, MARGEM, y, larguraUtil, alt));
      y -= alt + 6;
      continue;
    }
    if (l.tabela) {
      const t = l.tabela;
      const tam = t.tamanho ?? 8;
      const soma = t.colunas.reduce((a, c) => a + c.peso, 0);
      const larguras = t.colunas.map((c) => (c.peso / soma) * larguraUtil);
      const alturaDe = (celulas: string[]) =>
        Math.max(...celulas.map((c, i) => quebrar(c, tam, larguras[i]! - 6).length), 1) * tam * 1.25 + 6;
      const cab = t.colunas.map((c) => c.titulo);
      const desenhaCab = () => {
        const h = alturaDe(cab);
        atual.push(...linhaDeTabela(t, cab, larguras, y, h, true));
        y -= h;
      };
      y -= l.espacoAntes ?? 4;
      if (y - alturaDe(cab) - alturaDe(t.linhas[0] ?? []) < fundo) novaPagina();
      desenhaCab();
      for (const celulas of t.linhas) {
        const h = alturaDe(celulas);
        if (y - h < fundo) {
          novaPagina();
          desenhaCab();
        }
        atual.push(...linhaDeTabela(t, celulas, larguras, y, h, false));
        y -= h;
      }
      y -= 6;
      continue;
    }
    if (l.assinaturas) {
      const quantas = Math.max(1, l.assinaturas.length);
      const alt = 70;
      if (y - alt < fundo) novaPagina();
      y -= 36;
      const col = larguraUtil / quantas;
      l.assinaturas.forEach((a, i) => {
        const x1 = MARGEM + i * col + 12;
        const x2 = MARGEM + (i + 1) * col - 12;
        atual.push(`q 0.3 G 0.6 w ${num(x1)} ${num(y)} m ${num(x2)} ${num(y)} l S Q`);
        const centro = (x1 + x2) / 2;
        if (a.nome) atual.push(escrever('F2', 9, centro - larguraDe(a.nome, 9) / 2, y - 12, a.nome));
        atual.push(escrever('F1', 8, centro - larguraDe(a.cargo, 8) / 2, y - (a.nome ? 23 : 12), a.cargo));
      });
      y -= 34;
      continue;
    }
    const tamanho = l.tamanho ?? (l.titulo ? 12 : 10);
    const fonte = l.titulo || l.negrito ? 'F2' : 'F1';
    const recuo = l.recuo ?? 0;
    const entre = tamanho * 1.35;
    y -= l.espacoAntes ?? (l.titulo ? 8 : 0);
    // Título não fica sozinho no pé da página: leva junto o começo do que ele introduz.
    if (l.titulo && y - 90 < fundo) novaPagina();
    // Negrito e título (muitas vezes em caixa alta) são mais largos que a média da Helvetica.
    for (const pedaco of quebrar(
      l.texto,
      tamanho,
      LARGURA - 2 * MARGEM - recuo,
      fonte === 'F2' ? 0.68 : 0.56
    )) {
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
