/**
 * Aurora — leitor de ZIP/.xlsx SÓ para os testes (REL-10).
 *
 * Lê o arquivo como um leitor de planilha leria: pelo DIRETÓRIO CENTRAL (o fim do arquivo), e
 * não pelos cabeçalhos locais na ordem em que foram escritos. Assim o teste prova que o índice
 * aponta para o lugar certo. Só entende entrada guardada (método 0), que é o que o escritor faz;
 * outra coisa falha alto.
 */
import { crc32 } from '../../documents/xlsx';

export function lerZip(buf: Buffer): Map<string, Buffer> {
  // O registro de fim do diretório central fica nos últimos 22 bytes (sem comentário).
  const fim = buf.length - 22;
  if (buf.readUInt32LE(fim) !== 0x06054b50) throw new Error('fim do diretório central não encontrado');
  const quantas = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const saida = new Map<string, Buffer>();
  for (let i = 0; i < quantas; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`entrada ${i} do diretório central inválida`);
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const tamanho = buf.readUInt32LE(p + 20);
    const nomeLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comentarioLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + nomeLen).toString('utf8');
    if (metodo !== 0) throw new Error(`${nome}: método ${metodo} não suportado pelo leitor de teste`);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`${nome}: cabeçalho local inválido`);
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(inicio, inicio + tamanho);
    if (crc32(dados) !== crc) throw new Error(`${nome}: CRC não confere`);
    saida.set(nome, Buffer.from(dados));
    p += 46 + nomeLen + extraLen + comentarioLen;
  }
  return saida;
}

/** O XML de uma aba pelo NOME, seguindo workbook.xml → workbook.xml.rels, como o Excel faz. */
export function abaPorNome(arquivos: Map<string, Buffer>, nome: string): string {
  const wb = arquivos.get('xl/workbook.xml')!.toString('utf8');
  const m = new RegExp(`<sheet name="${nome}" sheetId="\\d+" r:id="(rId\\d+)"/>`).exec(wb);
  if (!m) throw new Error(`aba "${nome}" não encontrada`);
  const rels = arquivos.get('xl/_rels/workbook.xml.rels')!.toString('utf8');
  const alvo = new RegExp(`Id="${m[1]}" Type="[^"]+" Target="([^"]+)"`).exec(rels)![1]!;
  return arquivos.get(`xl/${alvo}`)!.toString('utf8');
}

/** Os textos de cada célula de uma aba (inlineStr e números), por referência (A1, B2…). */
export function celulas(sheetXml: string): Map<string, { tipo: string; valor: string; estilo: number }> {
  const out = new Map<string, { tipo: string; valor: string; estilo: number }>();
  for (const m of sheetXml.matchAll(/<c r="([A-Z]+\d+)" t="(n|inlineStr)"(?: s="(\d+)")?>(.*?)<\/c>/g)) {
    const corpo = m[4]!;
    const valor = m[2] === 'n' ? /<v>(.*?)<\/v>/.exec(corpo)![1]! : /<t[^>]*>(.*?)<\/t>/.exec(corpo)![1]!;
    out.set(m[1]!, { tipo: m[2]!, valor, estilo: Number(m[3] ?? 0) });
  }
  return out;
}
