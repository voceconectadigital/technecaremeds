/**
 * Aurora — a chegada dos bytes de um anexo (SPEC v0.2 §20 · EPIC-014).
 *
 * ESTA ROTA É A METADE QUE FALTAVA.
 *
 * `POST /work-orders/:id/attachments` registra que a foto existe e devolve
 * onde ela deve ficar. Durante um bom tempo o aplicativo de campo enviava as
 * fatias para um endereço que NÃO EXISTIA: o registro entrava no banco, a tela
 * mostrava a foto como capturada, e os bytes nunca saíam do aparelho. Do lado
 * de fora não havia sintoma nenhum — a OS fechava, o relatório saía, e a
 * evidência simplesmente não estava lá.
 *
 * Quem encontrou isso foi o teste de sobrevivência offline, olhando o estado
 * dos anexos DEPOIS de a fila esvaziar. É o tipo de defeito que nenhuma
 * verificação de "existe service worker?" acharia.
 *
 * O CORPO É CRU, E POR ISSO A ROTA É SEPARADA.
 *
 * Fatia de arquivo binário não passa por `express.json`. O interpretador de
 * corpo cru é montado só neste caminho — mandar o resto da API aceitar
 * `application/octet-stream` seria abrir uma porta que nada mais usa.
 *
 * A CONTA NÃO ESTÁ AQUI. Ela está em `receiveAttachmentSlice`, junto do banco,
 * onde a trava da linha serializa duas fatias simultâneas da mesma foto.
 */
import { Controller, Headers, Inject, Param, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { receiveAttachmentSlice, type Database } from '@aurora/db';
import { runFieldOperation } from '../common/client-operation';
import { ValidationError } from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { uuidParam } from '../common/params';
import { ARQUIVOS, DATABASE } from '../common/tokens';
import { sha256De } from '../common/arquivos/disco';
import type { ArmazenamentoDeObjetos } from '../common/arquivos/porta';
import type { AuroraRequest } from '../common/context.middleware';

/** 64 MB — teto por fatia, muito acima das 256 kB que o aparelho manda. */
const MAX_FATIA = 64 * 1024 * 1024;

@Controller('field')
export class FieldUploadController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ARQUIVOS) private readonly arquivos: ArmazenamentoDeObjetos
  ) {}

  /**
   * Recebe uma fatia do arquivo de um anexo já registrado.
   *
   * Devolve sempre `{ received }` — quantos bytes o servidor tem. É por esse
   * número que o aparelho decide de onde continuar, e é o único número que
   * vale: o do cliente, depois de uma confirmação perdida, estaria adiantado.
   *
   * 409 não é falha: quer dizer "minha conta é outra, continue daqui". O
   * aparelho se alinha e reenvia a partir de `received`, sem contar tentativa.
   */
  @Put('attachments/:id/bytes')
  @RequirePermissions('work_order.execute')
  async bytes(
    @Req() req: AuroraRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Headers('x-aurora-offset') offsetCru: string | undefined,
    @Headers('x-aurora-sha256') sha256: string | undefined,
    @Headers('x-aurora-final') finalCru: string | undefined
  ): Promise<void> {
    const offset = Number(offsetCru ?? '0');
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ValidationError('x-aurora-offset precisa ser um inteiro não negativo', {
        field: 'x-aurora-offset',
      });
    }
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new ValidationError('x-aurora-sha256 precisa ser um sha-256 em hexadecimal', {
        field: 'x-aurora-sha256',
      });
    }

    /*
     * O corpo vem do interpretador cru montado no bootstrap. Se ele não rodou,
     * `body` não é um Buffer — e receber "nada" como fatia vazia gravaria um
     * arquivo truncado com aparência de sucesso.
     */
    const corpo = (req as unknown as { body?: unknown }).body;
    if (!Buffer.isBuffer(corpo) || corpo.byteLength === 0) {
      throw new ValidationError('o corpo precisa ser a fatia do arquivo, em bytes', {
        field: 'body',
      });
    }
    if (corpo.byteLength > MAX_FATIA) {
      throw new ValidationError('fatia grande demais', { field: 'body', maximo: MAX_FATIA });
    }

    /*
     * A OPERAÇÃO PASSA PELO MESMO CAMINHO DE CAMPO que os outros comandos:
     * contexto do tenant, papel sem privilégio, e o registro de operação do
     * cliente quando o cabeçalho vem. A reentrega de uma fatia já é inofensiva
     * pela escrita posicional, mas o rastro de quem mandou o quê vale o mesmo
     * aqui que no resto.
     */
    const r = await runFieldOperation(
      this.db,
      req,
      'PUT /field/attachments/:id/bytes',
      { offset, sha256, final: finalCru === '1' },
      (s) =>
        receiveAttachmentSlice(
          s,
          {
            attachmentId: uuidParam(id, 'id'),
            offset,
            bytes: new Uint8Array(corpo),
            sha256,
            final: finalCru === '1',
          },
          {
            escrever: (chave, deslocamento, bytes) => this.arquivos.escrever(chave, deslocamento, bytes),
            ler: (chave) => this.arquivos.ler(chave),
            resumo: sha256De,
          }
        )
    );

    res.status(r.accepted ? 200 : 409).json({
      received: r.received,
      completed: r.completed,
    });
  }
}
