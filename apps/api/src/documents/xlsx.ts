/**
 * Aurora — um escritor de planilha .xlsx, pequeno e previsível (REL-10, WhatsApp 19/10/2026:
 * "Os relatórios também precisam ter a opção de exportação em Excel").
 *
 * POR QUE NÃO UMA BIBLIOTECA
 *
 * Pelo mesmo motivo do escritor de PDF (`pdf.ts`): o que o relatório precisa é uma tabela por
 * aba, com cabeçalho em negrito, número que o Excel soma, data que o Excel ordena e texto. Uma
 * biblioteca de planilha traria fórmula, estilo condicional, leitura de arquivo e algumas
 * centenas de kB — e superfície de ataque (leitura de XML de fora). Aqui só se ESCREVE, e o
 * arquivo inteiro cabe na cabeça de quem lê este código:
 *
 *   · o .xlsx é um ZIP com meia dúzia de XML (Office Open XML, SpreadsheetML);
 *   · as entradas vão GUARDADAS (método 0, sem compressão): o arquivo fica maior, mas não há
 *     compressor a escrever nem a confiar. O CRC32 é calculado por tabela, porque `zlib.crc32`
 *     só existe a partir do Node 22.2 e o projeto aceita Node ≥ 20.11;
 *   · a data de cada entrada é fixa (01/01/1980): mesma entrada → mesmos bytes, como o PDF.
 *
 * TIPOS DE CÉLULA
 *
 *   · número → `t="n"`: o Excel soma, ordena e formata;
 *   · data → número de série (dias desde 30/12/1899) com estilo de data; a data já chega como
 *     dia LOCAL ("AAAA-MM-DD") ou como instante + fuso, para não imprimir o dia seguinte de
 *     quem gerou às 22h em Brasília (PF-51);
 *   · texto → `inlineStr`. Texto NUNCA vira fórmula: uma célula "=HYPERLINK(...)" vinda de um
 *     nome de equipamento continua sendo texto, porque não há `<f>` em lugar nenhum.
 *
 * Caractere proibido em XML (controle, exceto tab e quebra de linha) é removido.
 */

/** Célula: texto, número, nulo (vazia), ou número/data com formato. */
export type CelulaXlsx =
  | string
  | number
  | null
  | undefined
  | { numero: number; formato: 'inteiro' | 'decimal' | 'moeda' | 'percentual' }
  | { dia: string }
  | { instante: Date; fuso: string };

export interface ColunaXlsx {
  titulo: string;
  /** Largura em caracteres. Padrão 14. */
  largura?: number;
}

export interface AbaXlsx {
  /** Até 31 caracteres; `[]:*?/\` viram espaço. */
  nome: string;
  colunas: ColunaXlsx[];
  linhas: CelulaXlsx[][];
}

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// --- ZIP --------------------------------------------------------------------------------------

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3), o do ZIP. */
export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 01/01/1980 00:00 no formato do MS-DOS: data fixa, para o arquivo ser determinístico. */
const DOS_HORA = 0;
const DOS_DATA = (0 << 9) | (1 << 5) | 1;

/** Monta um ZIP com as entradas GUARDADAS (sem compressão), na ordem dada. */
export function zipGuardado(entradas: readonly { nome: string; dados: Buffer }[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;
  for (const e of entradas) {
    const nome = Buffer.from(e.nome, 'utf8');
    const crc = crc32(e.dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão para extrair: 2.0
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(0, 8); // método 0: guardado
    local.writeUInt16LE(DOS_HORA, 10);
    local.writeUInt16LE(DOS_DATA, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.dados.length, 18);
    local.writeUInt32LE(e.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nome, e.dados);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // feito por: 2.0
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(DOS_HORA, 12);
    dir.writeUInt16LE(DOS_DATA, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(e.dados.length, 20);
    dir.writeUInt32LE(e.dados.length, 24);
    dir.writeUInt16LE(nome.length, 28);
    // extra, comentário, disco, atributos internos e externos: zero
    dir.writeUInt32LE(deslocamento, 42);
    central.push(dir, nome);
    deslocamento += local.length + nome.length + e.dados.length;
  }
  const diretorio = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, diretorio, fim]);
}

// --- SpreadsheetML ----------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const PROIBIDO_EM_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

function xml(texto: string): string {
  return texto
    .replace(PROIBIDO_EM_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A, B, …, Z, AA, AB… */
export function nomeDaColuna(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Dia "AAAA-MM-DD" → número de série do Excel (1900, com o 29/02/1900 fictício já embutido). */
export function serialDoDia(dia: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms / 86_400_000 + 25_569;
}

/** Instante → número de série da hora LOCAL no fuso dado. */
export function serialDoInstante(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  const ms = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return ms / 86_400_000 + 25_569;
}

/**
 * Estilos (`cellXfs`), na ordem:
 *   0 padrão · 1 cabeçalho (negrito, fundo cinza) · 2 data · 3 data e hora · 4 inteiro
 *   · 5 decimal · 6 moeda · 7 percentual (o valor já vem em 0–100, então o formato é `0.0"%"`).
 */
const ESTILO = { cabecalho: 1, dia: 2, instante: 3, inteiro: 4, decimal: 5, moeda: 6, percentual: 7 };

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="4">' +
  '<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>' +
  '<numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/>' +
  '<numFmt numFmtId="166" formatCode="&quot;R$&quot; #,##0.00"/>' +
  '<numFmt numFmtId="167" formatCode="0.0&quot;%&quot;"/>' +
  '</numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE7EBF0"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="8">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function celula(ref: string, c: CelulaXlsx, estiloTexto = 0): string {
  if (c === null || c === undefined || c === '') return '';
  const s = (n: number) => (n ? ` s="${n}"` : '');
  const numeroXml = (n: number, estilo: number) =>
    Number.isFinite(n) ? `<c r="${ref}" t="n"${s(estilo)}><v>${n}</v></c>` : '';
  if (typeof c === 'number') return numeroXml(c, 0);
  if (typeof c === 'string') {
    return `<c r="${ref}" t="inlineStr"${s(estiloTexto)}><is><t xml:space="preserve">${xml(c)}</t></is></c>`;
  }
  if ('numero' in c) return numeroXml(c.numero, ESTILO[c.formato]);
  if ('dia' in c) {
    const serial = serialDoDia(c.dia);
    return serial === null ? celula(ref, c.dia) : numeroXml(serial, ESTILO.dia);
  }
  return numeroXml(serialDoInstante(c.instante, c.fuso), ESTILO.instante);
}

function nomeDaAba(nome: string, usados: Set<string>): string {
  let base = nome.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Planilha';
  base = base.slice(0, 31);
  let final = base;
  for (let i = 2; usados.has(final.toLowerCase()); i++) final = `${base.slice(0, 28)} ${i}`;
  usados.add(final.toLowerCase());
  return final;
}

function planilhaXml(aba: AbaXlsx): string {
  const linhas: string[] = [];
  const cab = aba.colunas.map((col, i) => celula(`${nomeDaColuna(i)}1`, col.titulo, ESTILO.cabecalho));
  linhas.push(`<row r="1">${cab.join('')}</row>`);
  aba.linhas.forEach((l, k) => {
    const r = k + 2;
    linhas.push(`<row r="${r}">${l.map((c, i) => celula(`${nomeDaColuna(i)}${r}`, c)).join('')}</row>`);
  });
  const cols = aba.colunas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura ?? 14}" customWidth="1"/>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    // O cabeçalho fica congelado: rolar 300 equipamentos sem perder o nome das colunas.
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${linhas.join('')}</sheetData>` +
    '</worksheet>'
  );
}

/** Monta o .xlsx. Mesma entrada → mesmos bytes. */
export function gerarXlsx(abas: readonly AbaXlsx[]): Buffer {
  if (abas.length === 0) throw new Error('planilha sem aba');
  const usados = new Set<string>();
  const nomes = abas.map((a) => nomeDaAba(a.nome, usados));
  const u = (s: string) => Buffer.from(s, 'utf8');
  const cabecalhoXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const contentTypes =
    cabecalhoXml +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    abas
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join('') +
    '</Types>';

  const rels =
    cabecalhoXml +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook =
    cabecalhoXml +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    nomes.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';

  const workbookRels =
    cabecalhoXml +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    abas
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join('') +
    `<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  return zipGuardado([
    { nome: '[Content_Types].xml', dados: u(contentTypes) },
    { nome: '_rels/.rels', dados: u(rels) },
    { nome: 'xl/workbook.xml', dados: u(workbook) },
    { nome: 'xl/_rels/workbook.xml.rels', dados: u(workbookRels) },
    { nome: 'xl/styles.xml', dados: u(STYLES_XML) },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: u(planilhaXml(a)) })),
  ]);
}
