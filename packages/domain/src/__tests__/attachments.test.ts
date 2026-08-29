/**
 * Aurora — regras de anexo (SPEC v0.2 §11, §33, §37).
 *
 * O que estes testes protegem é uma inversão: a chave de armazenamento passou
 * a ser GERADA pelo servidor. Antes ela vinha do cliente, sem validação, e o
 * registro é justamente o que a interface usa depois para pedir a URL de
 * leitura — apontar para o objeto errado é vazar o objeto errado.
 */
import { describe, it, expect } from 'vitest';
import {
  validateAttachment,
  sanitizeFileName,
  buildStorageKey,
  isSafeStorageKey,
  contentMatchesDeclaredType,
  ALLOWED_CONTENT_TYPES,
  MAX_BYTES,
  ATTACHMENT_PURPOSES,
} from '../attachments';

const ORG = '0193c8a0-0000-7000-8000-000000000001';
const OS = '0193c8a0-0001-7000-8000-000000000002';
const ANEXO = '0193c8a0-0002-7000-8000-000000000003';

describe('nome do arquivo', () => {
  it('fica só com o último trecho — caminho não sobrevive', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\fotos\\antes.jpg')).toBe('antes.jpg');
    expect(sanitizeFileName('/var/www/html/x.png')).toBe('x.png');
  });

  it('perde o que quebraria cabeçalho de download ou log', () => {
    // `\r\n` num cabeçalho `Content-Disposition` é injeção de resposta.
    expect(sanitizeFileName('foto\r\nX-Injetado: sim.jpg')).toBe('fotoX-Injetado sim.jpg');
    expect(sanitizeFileName('a"b<c>d|e.jpg')).toBe('abcde.jpg');
  });

  it('não começa com ponto — arquivo oculto some da listagem', () => {
    expect(sanitizeFileName('...oculto.jpg')).toBe('oculto.jpg');
  });

  it('recusa nome que não sobra nada depois de limpo', () => {
    expect(() => sanitizeFileName('...')).toThrow(/nenhum caractere utilizável/);
    expect(() => sanitizeFileName('   ')).toThrow(/informe o nome/);
    expect(() => sanitizeFileName(null)).toThrow(/informe o nome/);
  });

  it('corta nome absurdamente longo', () => {
    expect(sanitizeFileName('a'.repeat(500) + '.jpg')).toHaveLength(200);
  });
});

describe('tipo permitido', () => {
  it('foto de antes/depois é imagem, e só', () => {
    expect(() =>
      validateAttachment({
        purpose: 'before',
        fileName: 'x.pdf',
        contentType: 'application/pdf',
        byteSize: 100,
      })
    ).toThrow(/não é aceito/);
  });

  it('nenhuma finalidade aceita HTML ou SVG', () => {
    // Os dois carregam script; servidos do nosso domínio, viram XSS
    // armazenado. É a razão de a lista ser de permissão, e não de bloqueio.
    for (const purpose of ATTACHMENT_PURPOSES) {
      for (const tipo of ['text/html', 'image/svg+xml', 'application/x-msdownload']) {
        expect(ALLOWED_CONTENT_TYPES[purpose], `${purpose} × ${tipo}`).not.toContain(tipo);
      }
    }
  });

  it('ignora o parâmetro do cabeçalho e a caixa', () => {
    const r = validateAttachment({
      purpose: 'before',
      fileName: 'a.jpg',
      contentType: 'IMAGE/JPEG; charset=binary',
      byteSize: 100,
    });
    expect(r.contentType).toBe('image/jpeg');
  });

  it('a extensão vem do TIPO, não do nome enviado', () => {
    // "relatorio.exe" declarado como PDF vira `.pdf` na chave — o nome
    // original fica só como metadado de exibição.
    const r = validateAttachment({
      purpose: 'document',
      fileName: 'relatorio.exe',
      contentType: 'application/pdf',
      byteSize: 100,
    });
    expect(r.extension).toBe('pdf');
    expect(r.fileName).toBe('relatorio.exe');
  });
});

describe('tamanho', () => {
  it('recusa acima do teto da finalidade, dizendo os dois números', () => {
    expect(() =>
      validateAttachment({
        purpose: 'signature',
        fileName: 'a.png',
        contentType: 'image/png',
        byteSize: MAX_BYTES.signature + 1,
      })
    ).toThrow(/2,0 MB/);
  });

  it('assinatura tem teto menor que documento — são coisas diferentes', () => {
    expect(MAX_BYTES.signature).toBeLessThan(MAX_BYTES.document);
  });

  it('recusa tamanho zero, negativo ou fracionário', () => {
    for (const byteSize of [0, -1, 1.5]) {
      expect(() =>
        validateAttachment({
          purpose: 'before',
          fileName: 'a.jpg',
          contentType: 'image/jpeg',
          byteSize,
        })
      ).toThrow(/número positivo/);
    }
  });
});

describe('chave de armazenamento', () => {
  it('a organização abre o caminho e o anexo é o nome', () => {
    expect(
      buildStorageKey({
        organizationId: ORG,
        entity: 'work-orders',
        entityId: OS,
        attachmentId: ANEXO,
        extension: 'jpg',
      })
    ).toBe(`org/${ORG}/work-orders/${OS}/${ANEXO}.jpg`);
  });

  it('nada do cliente entra no caminho — nem o nome do arquivo', () => {
    const chave = buildStorageKey({
      organizationId: ORG,
      entity: 'work-orders',
      entityId: OS,
      attachmentId: ANEXO,
      extension: 'jpg',
    });
    expect(chave).not.toContain('..');
    expect(chave.split('/')).toHaveLength(5);
  });

  it('recusa identificador que não é identificador', () => {
    expect(() =>
      buildStorageKey({
        organizationId: '../outra-org',
        entity: 'work-orders',
        entityId: OS,
        attachmentId: ANEXO,
        extension: 'jpg',
      })
    ).toThrow(/identificador válido/);
  });

  it('extensão estranha vira "bin" em vez de entrar no caminho', () => {
    expect(
      buildStorageKey({
        organizationId: ORG,
        entity: 'work-orders',
        entityId: OS,
        attachmentId: ANEXO,
        extension: '../../evil',
      })
    ).toMatch(/\.bin$/);
  });

  it('dois anexos nunca colidem — logo não há sobrescrita', () => {
    const a = buildStorageKey({
      organizationId: ORG,
      entity: 'work-orders',
      entityId: OS,
      attachmentId: ANEXO,
      extension: 'jpg',
    });
    const b = buildStorageKey({
      organizationId: ORG,
      entity: 'work-orders',
      entityId: OS,
      attachmentId: '0193c8a0-0002-7000-8000-000000000009',
      extension: 'jpg',
    });
    expect(a).not.toBe(b);
  });
});

describe('conferência de chave (defesa em profundidade)', () => {
  it('aceita o que nós geramos', () => {
    expect(
      isSafeStorageKey(
        buildStorageKey({
          organizationId: ORG,
          entity: 'work-orders',
          entityId: OS,
          attachmentId: ANEXO,
          extension: 'jpg',
        })
      )
    ).toBe(true);
  });

  it('recusa travessia, chave solta e caminho absoluto', () => {
    for (const chave of [
      `org/${ORG}/work-orders/${OS}/../../../etc/passwd`,
      'wo/qualquer/antes.jpg',
      `/org/${ORG}/work-orders/${OS}/${ANEXO}.jpg`,
      `org/${ORG}/work-orders/${OS}/${ANEXO}.jpg/../outro.jpg`,
      '',
      null,
      42,
    ]) {
      expect(isSafeStorageKey(chave), String(chave)).toBe(false);
    }
  });
});

describe('conteúdo é o que foi declarado', () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);

  it('reconhece JPEG, PNG e PDF de verdade', () => {
    expect(contentMatchesDeclaredType('image/jpeg', bytes(0xff, 0xd8, 0xff))).toBe(true);
    expect(
      contentMatchesDeclaredType('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    ).toBe(true);
    expect(contentMatchesDeclaredType('application/pdf', bytes(0x25, 0x50, 0x44, 0x46))).toBe(true);
  });

  it('pega o HTML disfarçado de imagem', () => {
    // "<html>" declarado como PNG é o caminho clássico para XSS armazenado, e
    // nenhuma checagem do tipo DECLARADO pega isso: quem declara é o atacante.
    const html = new TextEncoder().encode('<html><script>alert(1)</script>');
    expect(contentMatchesDeclaredType('image/png', html)).toBe(false);
    expect(contentMatchesDeclaredType('image/jpeg', html)).toBe(false);
  });

  it('tipo fora da lista nunca casa', () => {
    expect(contentMatchesDeclaredType('text/html', new TextEncoder().encode('<html>'))).toBe(false);
  });
});
