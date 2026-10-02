/**
 * Aurora — regras de anexo (SPEC v0.2 §11, §33, §37).
 *
 * A INVERSÃO QUE ESTE ARQUIVO EXISTE PARA FAZER
 *
 * A primeira versão do registro de anexo aceitava a `storage_key` VINDA DO
 * CLIENTE, sem validar nada. Quem chamasse a rota podia escrever qualquer
 * caminho ali: `../outra-organizacao/contrato.pdf`, a chave de um objeto de
 * outro tenant, ou uma chave que sobrescrevesse um anexo existente. O registro
 * é o que a interface usa depois para pedir a URL de leitura — então apontar
 * para o objeto errado é vazar o objeto errado.
 *
 * Aqui a chave passa a ser GERADA PELO SERVIDOR, e o cliente nunca a escolhe.
 * O nome que a pessoa deu ao arquivo continua sendo guardado — é o que ela
 * reconhece na tela —, mas como METADADO, nunca como caminho.
 *
 * O QUE MAIS ESTE MÓDULO DECIDE, E POR QUÊ
 *
 *   · TIPO PERMITIDO POR FINALIDADE. Uma foto de antes/depois é imagem; um
 *     documento anexado pode ser PDF. Nenhuma finalidade aceita executável,
 *     HTML ou SVG — HTML e SVG carregam script e, servidos do nosso domínio,
 *     viram XSS armazenado.
 *   · TAMANHO MÁXIMO POR FINALIDADE. Foto de celular em rede de hospital já é
 *     difícil; aceitar 200 MB é prometer um envio que não termina.
 *   · QUANTIDADE MÁXIMA POR ENTIDADE. Sem teto, uma fila offline com defeito
 *     enche o armazenamento de uma organização e ninguém percebe até a conta.
 *
 * O QUE ESTE MÓDULO NÃO FAZ
 *
 * Não varre malware. Fingir que varre seria pior do que não varrer: a equipe
 * passaria a confiar. A porta está em `MalwareScanner` (ver `ports.ts` do
 * pacote de armazenamento quando existir); enquanto não houver serviço
 * configurado, o anexo entra marcado como não varrido e isso é visível.
 */
import { ValidationError } from './errors';

export const ATTACHMENT_PURPOSES = [
  'before',
  'after',
  'evidence',
  'document',
  'signature',
  'other',
  /** Dado bruto de uma sessão de medição (0053 · PLAT §6.2 passo 5). */
  'raw_data',
  /** O arquivo do certificado EXTERNO de um instrumento (0051). */
  'certificate',
  /** O arquivo original de um lote de importação (0058 · PLAT §12). */
  'import_source',
] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

/**
 * Tipos aceitos, por finalidade.
 *
 * Lista fechada, e não "tudo menos o perigoso": lista de bloqueio esquece o
 * próximo formato perigoso, lista de permissão só esquece um formato útil — e
 * a segunda falha é reclamação, a primeira é incidente.
 */
const IMAGENS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;

export const ALLOWED_CONTENT_TYPES: Record<AttachmentPurpose, readonly string[]> = Object.freeze({
  before: IMAGENS,
  after: IMAGENS,
  evidence: [...IMAGENS, 'application/pdf'],
  document: [...IMAGENS, 'application/pdf'],
  // A assinatura é a imagem do traço, capturada na tela.
  signature: ['image/png', 'image/jpeg'],
  other: [...IMAGENS, 'application/pdf'],
  /*
   * Dado bruto é o que o instrumento ou a pessoa produziu, do jeito que saiu:
   * planilha, texto, JSON, XML, PDF do relatório do aparelho, ou um binário
   * proprietário. O binário entra como `application/octet-stream` — guardado,
   * nunca servido como página. Nenhum tipo aqui é interpretado pelo sistema.
   */
  raw_data: [
    'text/csv',
    'text/plain',
    'application/json',
    'application/xml',
    'text/xml',
    'application/pdf',
    'application/octet-stream',
  ],
  certificate: [...IMAGENS, 'application/pdf'],
  import_source: [
    'text/csv',
    'application/json',
    'application/xml',
    'text/xml',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/zip',
  ],
});

/**
 * Teto de tamanho, por finalidade.
 *
 * Foto de celular moderno em qualidade alta fica entre 3 e 8 MB; 15 MB dá
 * folga sem virar convite. Documento aceita mais porque um laudo digitalizado
 * de trinta páginas passa fácil dos 15.
 */
export const MAX_BYTES: Record<AttachmentPurpose, number> = Object.freeze({
  before: 15 * 1024 * 1024,
  after: 15 * 1024 * 1024,
  evidence: 15 * 1024 * 1024,
  document: 40 * 1024 * 1024,
  // O traço é um PNG pequeno. Um "assinatura" de 5 MB é outra coisa.
  signature: 2 * 1024 * 1024,
  other: 15 * 1024 * 1024,
  raw_data: 50 * 1024 * 1024,
  certificate: 40 * 1024 * 1024,
  // Uma exportação inteira de sistema legado passa fácil de dezenas de MB.
  import_source: 200 * 1024 * 1024,
});

/**
 * Finalidades cujo arquivo é EVIDÊNCIA de integridade: o resumo SHA-256 é
 * obrigatório no registro. O banco exige o mesmo (`att_evidence_has_sha`).
 */
export const PURPOSES_REQUIRING_SHA256: readonly AttachmentPurpose[] = Object.freeze([
  'raw_data',
  'certificate',
  'import_source',
]);

/** Quantos anexos uma mesma entidade aceita. */
export const MAX_ATTACHMENTS_PER_ENTITY = 50;

/** Extensão canônica de cada tipo — a do servidor, não a do nome enviado. */
const EXTENSAO: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/octet-stream': 'bin',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/zip': 'zip',
};

/**
 * Limpa o nome do arquivo para EXIBIÇÃO.
 *
 * Ele nunca vira caminho — a chave de armazenamento é gerada à parte —, mas
 * ainda assim é limpo: um nome com `\r\n` estraga cabeçalho HTTP de download,
 * um nome com caractere de controle estraga log, e um nome de 4 mil caracteres
 * estraga a tela.
 */
export function sanitizeFileName(nome: unknown): string {
  if (typeof nome !== 'string' || nome.trim().length === 0) {
    throw new ValidationError('informe o nome do arquivo', { field: 'file_name' });
  }

  const limpo = nome
    // Só o último trecho: "C:\fotos\x.jpg" e "../../x.jpg" viram "x.jpg".
    .split(/[/\\]/)
    .pop()!
    // Controle, aspas e o que quebra cabeçalho de download.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Nome que começa com ponto some em listagem e confunde.
    .replace(/^\.+/, '');

  if (limpo.length === 0) {
    throw new ValidationError('o nome do arquivo não tem nenhum caractere utilizável', {
      field: 'file_name',
    });
  }

  return limpo.slice(0, 200);
}

export interface AttachmentInput {
  purpose: AttachmentPurpose;
  fileName: string;
  contentType: string;
  byteSize: number;
}

export interface ValidatedAttachment {
  purpose: AttachmentPurpose;
  /** O nome limpo, para mostrar. */
  fileName: string;
  contentType: string;
  byteSize: number;
  extension: string;
}

/**
 * Confere o que o cliente declarou sobre o arquivo.
 *
 * É conferência do DECLARADO. O tipo real só se sabe lendo os primeiros bytes
 * do objeto, e isso acontece no armazenamento, depois do envio — ver
 * `assertContentMatches`.
 */
export function validateAttachment(input: AttachmentInput): ValidatedAttachment {
  if (!ATTACHMENT_PURPOSES.includes(input.purpose)) {
    throw new ValidationError('finalidade de anexo inválida', {
      field: 'purpose',
      allowed: ATTACHMENT_PURPOSES,
    });
  }

  const permitidos = ALLOWED_CONTENT_TYPES[input.purpose];
  const tipo = String(input.contentType || '')
    .split(';')[0]!
    .trim()
    .toLowerCase();

  if (!permitidos.includes(tipo)) {
    throw new ValidationError(`este tipo de arquivo não é aceito para "${input.purpose}"`, {
      field: 'content_type',
      allowed: permitidos,
    });
  }

  const max = MAX_BYTES[input.purpose];
  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
    throw new ValidationError('o tamanho do arquivo deve ser um número positivo', {
      field: 'byte_size',
    });
  }
  if (input.byteSize > max) {
    throw new ValidationError(
      `o arquivo tem ${mb(input.byteSize)} e o limite para "${input.purpose}" é ${mb(max)}`,
      { field: 'byte_size', max }
    );
  }

  return {
    purpose: input.purpose,
    fileName: sanitizeFileName(input.fileName),
    contentType: tipo,
    byteSize: input.byteSize,
    extension: EXTENSAO[tipo] ?? 'bin',
  };
}

/**
 * A chave do objeto no armazenamento — gerada aqui, nunca recebida.
 *
 * Formato: `org/<organização>/<entidade>/<id da entidade>/<id do anexo>.<ext>`
 *
 *   · a ORGANIZAÇÃO abre o caminho, então um objeto nunca pode ser confundido
 *     com o de outro tenant, e uma política de bucket por prefixo é possível;
 *   · o ID DO ANEXO é o nome do arquivo, e ele é um UUID v7 recém-gerado —
 *     duas gravações nunca colidem, e por isso não existe sobrescrita;
 *   · nada aqui vem do cliente. Sem entrada do cliente no caminho, não há
 *     travessia de diretório para impedir: ela não tem por onde entrar.
 */
export function buildStorageKey(input: {
  organizationId: string;
  entity:
    | 'work-orders'
    | 'checklist-answers'
    | 'documents'
    | 'assets'
    | 'measurement-sessions'
    | 'instrument-certificates'
    | 'import-batches';
  entityId: string;
  attachmentId: string;
  extension: string;
}): string {
  for (const [campo, valor] of [
    ['organizationId', input.organizationId],
    ['entityId', input.entityId],
    ['attachmentId', input.attachmentId],
  ] as const) {
    if (!/^[0-9a-fA-F-]{36}$/.test(valor)) {
      throw new ValidationError(`${campo} deve ser um identificador válido`, { field: campo });
    }
  }

  const ext = /^[a-z0-9]{1,8}$/.test(input.extension) ? input.extension : 'bin';
  return `org/${input.organizationId}/${input.entity}/${input.entityId}/${input.attachmentId}.${ext}`;
}

/**
 * Confere que uma chave é uma das nossas.
 *
 * Defesa em profundidade: linhas antigas, migração de dados, ou uma futura
 * rota que esqueça de gerar a chave. Se não casar com o formato, não vira URL.
 */
export function isSafeStorageKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length <= 300 &&
    !key.includes('..') &&
    /^org\/[0-9a-fA-F-]{36}\/[a-z-]+\/[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.[a-z0-9]{1,8}$/.test(key)
  );
}

/**
 * Confere que o CONTEÚDO é o que foi declarado.
 *
 * Recebe os primeiros bytes do objeto já enviado. Declarar `image/png` e
 * mandar um HTML é o caminho clássico para XSS armazenado quando o arquivo é
 * servido de volta — e nenhuma checagem do tipo declarado pega isso, porque o
 * atacante escreve o cabeçalho.
 *
 * A lista é de assinaturas de formato ("números mágicos"), curta de propósito:
 * cobre o que aceitamos e nada mais.
 */
export function contentMatchesDeclaredType(contentType: string, primeirosBytes: Uint8Array): boolean {
  const b = primeirosBytes;
  const comeca = (...bytes: number[]) => bytes.every((v, i) => b[i] === v);

  switch (contentType) {
    case 'image/jpeg':
      return comeca(0xff, 0xd8, 0xff);
    case 'image/png':
      return comeca(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'application/pdf':
      return comeca(0x25, 0x50, 0x44, 0x46); // %PDF
    case 'image/webp':
      // RIFF....WEBP
      return comeca(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42;
    case 'image/heic':
    case 'image/heif':
      // caixa `ftyp` no deslocamento 4
      return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
    default:
      return false;
  }
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
