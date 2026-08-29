/**
 * Aurora — "Precisa da sua atenção" (SPEC v0.2 §20 · EPIC-014).
 *
 * A TELA QUE EXISTE PARA QUE NADA SUMA.
 *
 * A SPEC nomeia o pior defeito possível deste produto: perder trabalho em
 * silêncio. Um comando que o servidor recusa porque o mundo mudou — a OS foi
 * cancelada, a peça acabou, o estado já não permite — não pode simplesmente
 * voltar como erro e desaparecer. O que o técnico escreveu continua sendo
 * trabalho, e alguém precisa decidir o que fazer com ele.
 *
 * Estas duas rotas são essa decisão: uma lista o que ficou pendurado, com o
 * conteúdo original inteiro; a outra registra que alguém tratou, e a qual
 * operação nova a decisão levou.
 *
 * A LISTA É DE QUEM TRABALHOU, E NÃO DA ORGANIZAÇÃO. O conflito nasceu de um
 * comando que uma pessoa deu; é ela quem sabe o que quis fazer. Uma caixa
 * coletiva viraria uma caixa de ninguém.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  pendingConflicts,
  resolveClientConflict,
  fieldSyncBundle,
  type Database,
} from '@aurora/db';
import { ForbiddenError, NotFoundError, ValidationError } from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { optionalUuid, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

function meuVinculo(req: AuroraRequest): string {
  const id = req.auroraContext?.membershipId;
  if (!id) throw new ForbiddenError('field.session');
  return id;
}

@Controller('field')
export class FieldController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * O pacote do dia: tudo que o aparelho precisa antes de a rede acabar.
   *
   * UMA ROTA, E NÃO OITO. O técnico entra no elevador do subsolo quando
   * terminar de sincronizar, e oito idas de rede numa conexão de hospital têm
   * oito chances de morrer no meio — deixando o aparelho com metade do dia.
   * Um pacote só chega inteiro ou não chega, e "não chegou" é um estado que a
   * tela sabe mostrar.
   *
   * `since` faz a sincronização ser incremental. O instante é sempre o que o
   * SERVIDOR devolveu na chamada anterior: um celular com a data errada — caso
   * de borda que a SPEC lista — pediria "o que mudou desde 2027" e não baixaria
   * nada, indo a campo achando que está em dia.
   */
  @Get('sync')
  @RequirePermissions('work_order.read')
  async sync(
    @Req() req: AuroraRequest,
    @Query('since') since?: string,
    @Query('horizon') horizon?: string
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);

    let desde: Date | null = null;
    if (since !== undefined) {
      desde = new Date(since);
      if (Number.isNaN(desde.getTime())) {
        throw new ValidationError('since precisa ser o instante que o servidor devolveu em synced_at.', {
          field: 'since',
          received: since,
        });
      }
    }

    const dias = horizon === undefined ? 7 : Number.parseInt(horizon, 10);
    if (!Number.isFinite(dias) || dias < 1 || dias > 90) {
      throw new ValidationError('horizon precisa ser um número de dias entre 1 e 90.', {
        field: 'horizon',
        received: horizon,
      });
    }

    return withTenant(this.db, ctx, (s) => fieldSyncBundle(s, eu, { since: desde, horizonDays: dias }));
  }

  /**
   * O que ficou pendurado, com o conteúdo original.
   *
   * `request_body` sai inteiro de propósito. Um resumo obrigaria o técnico a
   * lembrar o que tinha escrito, e o ponto da tela é justamente ele NÃO
   * precisar lembrar: o diagnóstico de duas horas atrás está ali, do jeito que
   * ele digitou, pronto para virar uma operação nova.
   */
  @Get('attention')
  @RequirePermissions('work_order.read')
  async attention(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    const items = await withTenant(this.db, ctx, (s) => pendingConflicts(s, eu));
    return {
      items: items.map((c) => ({
        client_operation_id: c.clientOperationId,
        route: c.route,
        conflict_code: c.conflictCode,
        conflict_message: c.conflictMessage,
        request_body: c.requestBody,
        received_at: c.receivedAt,
      })),
    };
  }

  /**
   * Alguém tratou. `superseded_by` liga o conflito ao que veio depois.
   *
   * Aceitar a ligação é o que impede a tela de virar um botão de "sumir com
   * isto": seis meses depois, "o que aconteceu com aquele apontamento?" tem
   * resposta, e a resposta é uma operação com identificador próprio.
   */
  @Post('attention/:id/resolve')
  @RequirePermissions('work_order.execute')
  async resolve(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ resolved: true }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);

    const ok = await withTenant(this.db, ctx, (s) =>
      resolveClientConflict(s, {
        clientOperationId: uuidParam(id, 'id'),
        membershipId: eu,
        supersededBy: optionalUuid(body.superseded_by, 'superseded_by') ?? undefined,
      })
    );

    /*
     * NÃO EXISTE, JÁ TRATADO E DE OUTRA PESSOA DEVOLVEM A MESMA COISA.
     *
     * Distinguir contaria a quem chamou que existe um conflito alheio com
     * aquele identificador — e o identificador é gerado no aparelho de outra
     * pessoa. Aqui isso não vaza dado de negócio, mas a regra vale igual: o
     * caminho de erro não confirma a existência do que não se pode ver.
     */
    if (!ok) throw new NotFoundError('Conflito pendente', id);
    return { resolved: true };
  }
}
