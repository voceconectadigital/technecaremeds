/**
 * Aurora — o recebimento retomável dos bytes de um anexo (SPEC §20 · EPIC-014).
 *
 * O QUE ESTE ARQUIVO GARANTE
 *
 *  1. QUEM CONTA É O SERVIDOR. O aparelho propõe um deslocamento; se ele não
 *     bate com o que está guardado, a fatia NÃO é aceita e a resposta devolve o
 *     número de verdade. O aparelho se alinha e continua dali. Confiar na conta
 *     do cliente faria a fatia reentregue — o caso comum em rede ruim — somar
 *     duas vezes.
 *  2. A REENTREGA É INOFENSIVA. A escrita é posicional e a linha fica travada
 *     durante a transação, então duas fatias da mesma foto nunca se cruzam.
 *  3. NADA É DADO POR CONCLUÍDO SEM CONFERIR. No último pedaço, o arquivo
 *     inteiro é relido e o resumo criptográfico é comparado com o que foi
 *     declarado no registro. Se não bater, a contagem VOLTA A ZERO e o envio
 *     recomeça — porque metade de uma foto com metade de outra é pior do que
 *     foto nenhuma, e ninguém descobriria olhando.
 *
 * O ARQUIVO É ESCRITO DENTRO DA TRANSAÇÃO, e de propósito.
 *
 * A alternativa — gravar em disco fora dela — abriria a janela em que o byte
 * está no disco e a conta não subiu: a próxima tentativa reescreveria o mesmo
 * trecho, o que é inofensivo, mas a janela inversa (conta subiu, byte não
 * chegou) daria um arquivo com buraco e resumo que nunca fecha. Mantendo a
 * gravação sob a mesma trava, a ordem é sempre: bytes, depois conta.
 */
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  SNIFFABLE_CONTENT_TYPES,
  contentMatchesDeclaredType,
} from '@aurora/domain';
import { assertCanExecuteWorkOrder } from './execution';
import type { TenantSession } from './client';

export interface FatiaRecebida {
  /** Quantos bytes o servidor tem AGORA. É este o número que vale. */
  received: number;
  /** O arquivo chegou inteiro e o resumo conferiu. */
  completed: boolean;
  /**
   * A fatia entrou. `false` quando o deslocamento não batia — o que não é erro
   * de ninguém: é o aparelho perguntando de onde continuar.
   */
  accepted: boolean;
}

interface LinhaDoAnexo {
  storage_key: string;
  byte_size: string;
  sha256: string | null;
  content_type: string;
  received_bytes: string;
  upload_completed_at: string | null;
}

/**
 * Quem está mandando os bytes pode escrever NESTE anexo? (pente-fino PF-84)
 *
 * A rota chega pelo id do anexo, e conferia só a organização (pela RLS): um
 * técnico com o id do anexo de outra OS escreveria nele. Agora o anexo leva à
 * OS dele — direto, pela resposta de checklist ou pela sessão de medição — e a
 * OS passa pela mesma regra de toda ação de execução
 * (`assertCanExecuteWorkOrder`), com o escopo conferido aqui, porque o
 * `ScopeGuard` não conhece este caminho.
 *
 * Anexo sem OS (certificado de instrumento, arquivo de importação) só recebe
 * bytes de quem o registrou: é a mesma pessoa, no mesmo fluxo, e ninguém mais
 * tem motivo para escrever nele.
 */
export async function assertCanUploadAttachment(session: TenantSession, attachmentId: string): Promise<void> {
  const [a] = await session.query<{ uploaded_by: string | null; work_order_id: string | null }>(
    `SELECT a.uploaded_by,
            COALESCE(a.work_order_id, r.work_order_id, ms.work_order_id) AS work_order_id
       FROM aurora.attachments a
       LEFT JOIN aurora.checklist_answers ca     ON ca.id = a.checklist_answer_id
       LEFT JOIN aurora.checklist_responses r    ON r.id = ca.response_id
       LEFT JOIN aurora.measurement_sessions ms  ON ms.id = a.measurement_session_id
      WHERE a.id = $1`,
    [attachmentId]
  );
  if (!a) throw new NotFoundError('Anexo', attachmentId);
  if (a.work_order_id) {
    try {
      await assertCanExecuteWorkOrder(session, a.work_order_id, { checkScope: true });
    } catch (e) {
      // OS fora do escopo: o ANEXO é que "não existe" para quem chamou.
      if (e instanceof NotFoundError) throw new NotFoundError('Anexo', attachmentId);
      throw e;
    }
    return;
  }
  if (a.uploaded_by !== session.context.actorId) {
    const recusa = new ForbiddenError('work_order.execute');
    recusa.message = 'só quem registrou este anexo envia os bytes dele';
    throw recusa;
  }
}

/**
 * Recebe uma fatia.
 *
 * `gravar` é quem põe os bytes onde eles moram — o controller injeta o
 * armazenamento. Esta função não sabe se é disco, memória ou nuvem, e não
 * precisa saber; o que ela garante é a ORDEM e a CONTA.
 */
export async function receiveAttachmentSlice(
  session: TenantSession,
  input: {
    attachmentId: string;
    offset: number;
    bytes: Uint8Array;
    /** O resumo declarado no registro. Confere que é o MESMO arquivo. */
    sha256: string;
    final: boolean;
  },
  armazenamento: {
    escrever(chave: string, deslocamento: number, bytes: Uint8Array): Promise<void>;
    ler(chave: string): Promise<Uint8Array | undefined>;
    resumo(bytes: Uint8Array): string;
  }
): Promise<FatiaRecebida> {
  /*
   * `FOR UPDATE` — a trava é o que serializa duas fatias simultâneas da mesma
   * foto. Sem ela, as duas leriam o mesmo `received_bytes`, as duas achariam
   * que estão na vez, e uma sobrescreveria a conta da outra.
   *
   * A visibilidade continua sendo a do tenant: a política de RLS vale aqui como
   * em qualquer outra consulta, e um anexo de outra organização simplesmente
   * não aparece — não é "recusado", é inexistente.
   */
  const [linha] = await session.query<LinhaDoAnexo>(
    `SELECT storage_key, byte_size::text, sha256, content_type, received_bytes::text, upload_completed_at
       FROM aurora.attachments
      WHERE id = $1
      FOR UPDATE`,
    [input.attachmentId]
  );
  if (!linha) throw new NotFoundError('Anexo', input.attachmentId);

  const tamanhoTotal = Number(linha.byte_size);
  const jaTem = Number(linha.received_bytes);

  /*
   * O RESUMO PRECISA SER O DO REGISTRO.
   *
   * É o que impede continuar um envio depois de a foto ter sido substituída no
   * aparelho: sem esta conferência, a retomada juntaria metade de uma imagem
   * com metade de outra, e o arquivo resultante não seria nem uma nem outra.
   */
  if (linha.sha256 && linha.sha256 !== input.sha256) {
    throw new ValidationError('este envio não é do mesmo arquivo que foi registrado', {
      field: 'sha256',
    });
  }

  if (linha.upload_completed_at) {
    // Já está tudo lá. Não é erro: é a confirmação que se perdeu no caminho.
    return { received: tamanhoTotal, completed: true, accepted: false };
  }

  if (input.offset !== jaTem) {
    // Não é erro — é desencontro de conta. O aparelho se alinha pelo número.
    return { received: jaTem, completed: false, accepted: false };
  }

  const fim = input.offset + input.bytes.byteLength;
  if (fim > tamanhoTotal) {
    throw new ValidationError('esta fatia passaria do tamanho declarado no registro', {
      field: 'byte_size',
      declarado: tamanhoTotal,
      chegaria_a: fim,
    });
  }
  if (input.final && fim !== tamanhoTotal) {
    throw new ValidationError('a última fatia não fecha o tamanho declarado', {
      field: 'byte_size',
      declarado: tamanhoTotal,
      chegaria_a: fim,
    });
  }

  // 1 · OS BYTES. Ver a nota do cabeçalho sobre a ordem.
  await armazenamento.escrever(linha.storage_key, input.offset, input.bytes);

  const completo = fim === tamanhoTotal;

  if (completo && linha.sha256) {
    /*
     * A CONFERÊNCIA FINAL. Relê o arquivo inteiro e compara.
     *
     * Custa uma leitura por foto, uma vez. É o que separa "o servidor tem um
     * arquivo" de "o servidor tem ESTE arquivo" — e num anexo que vira
     * evidência de manutenção, essa diferença é a razão de o anexo existir.
     */
    const guardado = await armazenamento.ler(linha.storage_key);
    if (!guardado || armazenamento.resumo(guardado) !== linha.sha256) {
      /*
       * VOLTA A ZERO, e o aparelho reenvia do começo.
       *
       * Aceitar um arquivo cujo resumo não fecha seria guardar uma evidência
       * corrompida com aparência de válida — o pior desfecho possível aqui.
       */
      await session.query(`UPDATE aurora.attachments SET received_bytes = 0 WHERE id = $1`, [
        input.attachmentId,
      ]);
      throw new ConflictError(
        'o arquivo recebido não confere com o resumo declarado; o envio recomeça do início'
      );
    }
  }

  if (completo && SNIFFABLE_CONTENT_TYPES.includes(linha.content_type)) {
    /*
     * O CONTEÚDO É O TIPO DECLARADO? (PF-84)
     *
     * O resumo prova que chegou o arquivo que o aparelho mandou — não que ele é
     * o que o registro diz. Declarar `image/jpeg` e mandar um HTML é o caminho
     * clássico de XSS armazenado no dia em que o anexo for servido de volta.
     * Os primeiros bytes ("números mágicos") decidem; fora do tipo, 422 e o
     * anexo NÃO fica concluído (a transação volta, e a conta junto).
     */
    const guardado = await armazenamento.ler(linha.storage_key);
    if (!guardado || !contentMatchesDeclaredType(linha.content_type, guardado.subarray(0, 16))) {
      throw new ValidationError(
        `o conteúdo do arquivo não é do tipo declarado (${linha.content_type}); o anexo não foi concluído`,
        { field: 'content_type', declared: linha.content_type }
      );
    }
  }

  // 2 · A CONTA, depois dos bytes.
  await session.query(
    `UPDATE aurora.attachments
        SET received_bytes = $2,
            upload_completed_at = CASE WHEN $3::boolean THEN now() ELSE upload_completed_at END
      WHERE id = $1`,
    [input.attachmentId, fim, completo]
  );

  return { received: fim, completed: completo, accepted: true };
}

/** O que a interface precisa saber sobre o arquivo de um anexo. */
export async function attachmentUploadState(
  session: TenantSession,
  attachmentId: string
): Promise<{ received: number; total: number; completed: boolean } | null> {
  const [linha] = await session.query<{
    byte_size: string;
    received_bytes: string;
    upload_completed_at: string | null;
  }>(
    `SELECT byte_size::text, received_bytes::text, upload_completed_at
       FROM aurora.attachments WHERE id = $1`,
    [attachmentId]
  );
  if (!linha) return null;
  return {
    received: Number(linha.received_bytes),
    total: Number(linha.byte_size),
    completed: linha.upload_completed_at !== null,
  };
}
