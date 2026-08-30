/**
 * Aurora — execução pela HTTP: checklist, horas, anexos e assinatura (EPIC-011).
 *
 * A rota de conclusão NÃO existe aqui. Concluir é uma transição, e transição
 * tem uma rota só (`POST /work-orders/:id/transitions`) — é lá que o bloco de
 * conclusão roda. Uma rota `/complete` separada seria um segundo caminho para o
 * mesmo ato, e o segundo caminho é sempre o que esquece uma verificação.
 *
 * O que existe aqui é a rota que **pergunta** o que falta sem tentar concluir:
 * o aplicativo de campo precisa mostrar a lista de pendências enquanto a pessoa
 * trabalha, não só quando ela tenta fechar.
 */
import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import {
  withTenant,
  attachChecklist,
  answerChecklistItem,
  checklistStatus,
  loadChecklistItems,
  startTimer,
  stopTimer,
  logTime,
  attachFile,
  signWorkOrder,
  verifySignatures,
  completionCheck,
  completionRequirementsFor,
  type Database,
} from '@aurora/db';
import { NotFoundError, ValidationError, type AttachmentPurpose } from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { optionalUuid, uuidParam } from '../common/params';
import { runFieldOperation } from '../common/client-operation';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

@Controller('work-orders')
export class ExecutionController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * O que falta para concluir, sem tentar concluir.
   *
   * Existe para o aplicativo de campo mostrar a lista enquanto a pessoa
   * trabalha. Descobrir só na hora de fechar significa descobrir quando já
   * saiu do hospital.
   */
  @Get(':id/completion')
  @RequirePermissions('work_order.read')
  async completion(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    const woId = uuidParam(id, 'id');
    return withTenant(this.db, ctx, async (s) => {
      const requisitos = await completionRequirementsFor(s, woId);
      if (requisitos.length === 0) return { required: [], ok: true, missing: [] };
      const r = await completionCheck(s, woId, requisitos);
      return { required: requisitos, ...r };
    });
  }

  @Get(':id/checklists')
  @RequirePermissions('work_order.read')
  async checklists(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const woId = uuidParam(id, 'id');
    const items = await withTenant(this.db, ctx, async (s) => {
      const respostas = await s.query<{
        id: string;
        template_id: string;
        template_key: string;
        template_version: number;
      }>(
        `SELECT id, template_id, template_key, template_version
           FROM aurora.checklist_responses WHERE work_order_id = $1 ORDER BY started_at`,
        [woId]
      );
      return Promise.all(
        respostas.map(async (r) => ({
          ...r,
          items: await loadChecklistItems(s, r.template_id),
          status: await checklistStatus(s, r.id),
        }))
      );
    });
    return { items };
  }

  @Post(':id/checklists')
  @RequirePermissions('work_order.execute')
  async attach(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { template_id?: unknown; response_id?: unknown }
  ): Promise<{ response_id: string }> {
    const responseId = await runFieldOperation(this.db, req, 'POST /work-orders/:id/checklists', body, (s) =>
      attachChecklist(
        s,
        uuidParam(id, 'id'),
        uuidParam(body.template_id, 'template_id'),
        /*
         * O APARELHO PODE TRAZER O IDENTIFICADOR DA RESPOSTA.
         *
         * Sem isso, responder um item exigiria estar online para anexar
         * primeiro — e anexar é a primeira coisa que o técnico faz ao chegar
         * no equipamento, que é onde não há rede. Com o identificador vindo
         * de lá, o anexo e as respostas entram na fila juntos, na ordem certa.
         */
        optionalUuid(body.response_id, 'response_id') ?? undefined
      )
    );
    return { response_id: responseId };
  }

  @Post(':id/timer/start')
  @RequirePermissions('time_entry.create')
  async start(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ entry_id: string }> {
    /*
     * O CRONÔMETRO É O CASO MAIS CARO DE DUPLICAR.
     *
     * Dois cronômetros abertos na mesma OS produzem duas contagens que correm
     * juntas, e a folha do dia passa a somar dezesseis horas para oito. Como a
     * rota não tem corpo, a operação é identificada só pelo cabeçalho — que é
     * exatamente o que o aparelho gera antes da primeira tentativa.
     */
    const entryId = await runFieldOperation(
      this.db,
      req,
      'POST /work-orders/:id/timer/start',
      { work_order_id: id },
      (s) => startTimer(s, uuidParam(id, 'id'))
    );
    return { entry_id: entryId };
  }

  /**
   * Apontamento manual.
   *
   * Apontar para outra pessoa exige permissão própria — sem isso, qualquer um
   * poderia lançar horas em nome de qualquer um, e a folha de campo deixaria de
   * significar alguma coisa.
   */
  @Post(':id/time-entries')
  @RequirePermissions('time_entry.create')
  async log(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ entry_id: string }> {
    const ctx = req.auroraContext!;
    if (typeof body.started_at !== 'string' || typeof body.ended_at !== 'string') {
      throw new ValidationError('started_at e ended_at são obrigatórios', {
        fields: ['started_at', 'ended_at'],
      });
    }
    const paraOutro = typeof body.membership_id === 'string' && body.membership_id !== ctx.membershipId;
    if (paraOutro && !ctx.permissions.has('time_entry.create_for_others')) {
      throw new ValidationError('apontar hora para outra pessoa exige time_entry.create_for_others', {
        permission: 'time_entry.create_for_others',
      });
    }

    const inicio = new Date(body.started_at);
    const fim = new Date(body.ended_at);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      throw new ValidationError('datas inválidas', { fields: ['started_at', 'ended_at'] });
    }
    if (fim > new Date() && !ctx.permissions.has('time_entry.create_future')) {
      throw new ValidationError('apontar hora no futuro exige time_entry.create_future', {
        permission: 'time_entry.create_future',
      });
    }

    const entryId = await runFieldOperation(this.db, req, 'POST /work-orders/:id/time-entries', body, (s) =>
      logTime(s, {
        workOrderId: uuidParam(id, 'id'),
        membershipId: typeof body.membership_id === 'string' ? body.membership_id : undefined,
        startedAt: inicio,
        endedAt: fim,
        note: typeof body.note === 'string' ? body.note : undefined,
        hourlyCost: typeof body.hourly_cost === 'number' ? body.hourly_cost : null,
      })
    );
    return { entry_id: entryId };
  }

  /**
   * Registra um anexo que JÁ FOI ENVIADO ao armazenamento.
   *
   * O arquivo não passa por esta rota. O cliente pede uma URL assinada, envia
   * direto, e só então registra a referência aqui. Passar o arquivo pela API
   * transformaria cada foto de campo — em rede de hospital, pelo celular —
   * numa requisição que pode morrer no meio e não deixar rastro nem do envio.
   *
   * O CLIENTE NÃO ESCOLHE ONDE O ARQUIVO MORA. A chave de armazenamento é
   * gerada pelo servidor, com a organização abrindo o caminho e o identificador
   * do anexo como nome. Ela vem na resposta justamente para o cliente saber
   * para onde enviar.
   */
  @Post(':id/attachments')
  @RequirePermissions('work_order.execute')
  async attachment(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ attachment_id: string; storage_key: string }> {
    const r = await runFieldOperation(this.db, req, 'POST /work-orders/:id/attachments', body, (s) =>
      attachFile(s, {
        workOrderId: uuidParam(id, 'id'),
        // Tipo, tamanho, nome e finalidade são conferidos pelo domínio
        // (`validateAttachment`): lista fechada de tipos por finalidade, teto
        // de tamanho, e o nome limpo de tudo que quebraria cabeçalho ou log.
        purpose: body.purpose as AttachmentPurpose,
        fileName: body.file_name as string,
        contentType: body.content_type as string,
        byteSize: body.byte_size as number,
        sha256: typeof body.sha256 === 'string' ? body.sha256 : null,
      })
    );

    return { attachment_id: r.id, storage_key: r.storageKey };
  }

  @Post(':id/signatures')
  @RequirePermissions('work_order.execute')
  async sign(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ id: string; digest: string }> {
    const roles = ['technician', 'customer', 'supervisor'] as const;
    const methods = ['drawn', 'email_code'] as const;
    if (!roles.includes(body.signer_role as never)) {
      throw new ValidationError('signer_role inválido', { field: 'signer_role', allowed: roles });
    }
    if (!methods.includes(body.method as never)) {
      throw new ValidationError('method inválido', { field: 'method', allowed: methods });
    }
    if (typeof body.signer_name !== 'string' || body.signer_name.trim().length < 2) {
      throw new ValidationError('signer_name é obrigatório', { field: 'signer_name' });
    }

    return runFieldOperation(this.db, req, 'POST /work-orders/:id/signatures', body, (s) =>
      signWorkOrder(s, uuidParam(id, 'id'), {
        signerRole: body.signer_role as (typeof roles)[number],
        signerName: (body.signer_name as string).trim(),
        method: body.method as (typeof methods)[number],
        signerEmail: typeof body.signer_email === 'string' ? body.signer_email : null,
        signerDocument: typeof body.signer_document === 'string' ? body.signer_document : null,
        attachmentId: typeof body.attachment_id === 'string' ? body.attachment_id : null,
      })
    );
  }

  /**
   * As assinatura desta OS ainda cobrem o texto atual?
   *
   * O produto não impede alterar uma OS assinada — há motivos legítimos. O que
   * ele faz é saber, e mostrar, que a assinatura já não cobre o texto novo.
   */
  @Get(':id/signatures')
  @RequirePermissions('work_order.read')
  async signatures(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) => verifySignatures(s, uuidParam(id, 'id')));
    if (items.length === 0) {
      // Distinguir "OS sem assinatura" de "OS inexistente" importa: o primeiro
      // é um estado normal, o segundo é um erro de quem chamou.
      await withTenant(this.db, ctx, async (s) => {
        const [existe] = await s.query('SELECT 1 FROM aurora.work_orders WHERE id = $1', [id]);
        if (!existe) throw new NotFoundError('Ordem de serviço', id);
      });
    }
    return { items };
  }
}

/**
 * Rotas de recursos que NÃO pertencem ao caminho da ordem de serviço.
 *
 * Uma resposta de checklist e um apontamento de hora são identificados por si
 * mesmos: quem os tem em mãos não precisa repetir a OS na URL. Deixá-los no
 * controlador de `work-orders` os transformaria em
 * `/work-orders/checklist-responses/...`, que descreve mal o que são — e foi
 * exatamente o 404 que este arranjo produziu antes de o teste apontá-lo.
 */
@Controller()
export class ExecutionResourcesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Responde um item. O VEREDITO NÃO VEM DO CLIENTE.
   *
   * Aceitar `verdict` no corpo permitiria marcar como aprovado um valor fora da
   * faixa — exatamente o que o motor existe para impedir. O cliente manda o
   * valor medido; quem julga é o servidor.
   */
  @Post('checklist-responses/:responseId/answers')
  @RequirePermissions('work_order.execute')
  async answer(
    @Req() req: AuroraRequest,
    @Param('responseId') responseId: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ verdict: string; status: unknown }> {
    const rId = uuidParam(responseId, 'responseId');
    const itemId = uuidParam(body.item_id, 'item_id');

    return runFieldOperation(
      this.db,
      req,
      'POST /checklist-responses/:responseId/answers',
      body,
      async (s) => {
        const { verdict } = await answerChecklistItem(s, rId, itemId, {
          text: typeof body.text === 'string' ? body.text : null,
          number: typeof body.number === 'number' ? body.number : null,
          boolean: typeof body.boolean === 'boolean' ? body.boolean : null,
          options: Array.isArray(body.options) ? (body.options as string[]) : null,
          date: typeof body.date === 'string' ? body.date : null,
          photoCount: typeof body.photo_count === 'number' ? body.photo_count : 0,
        });
        return { verdict, status: await checklistStatus(s, rId) };
      }
    );
  }

  @Post('time-entries/:entryId/stop')
  @RequirePermissions('time_entry.create')
  async stop(
    @Req() req: AuroraRequest,
    @Param('entryId') entryId: string,
    @Body() body: { note?: unknown }
  ): Promise<{ minutes: number }> {
    const minutes = await runFieldOperation(
      this.db,
      req,
      'POST /time-entries/:entryId/stop',
      { entry_id: entryId, ...body },
      (s) =>
        stopTimer(s, uuidParam(entryId, 'entryId'), typeof body.note === 'string' ? body.note : undefined)
    );
    return { minutes };
  }
}
