/**
 * Aurora — notificações pela HTTP (SPEC v0.2 §23 · EPIC-023).
 *
 * A caixa de entrada é sempre a de QUEM PEDE. Não existe rota para ler a caixa
 * de outra pessoa, e o vínculo vem do contexto autenticado, nunca do corpo ou
 * da query: aceitar `membershipId` do cliente transformaria a caixa de
 * notificações num leitor de mensagens alheias com um parâmetro trocado.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  inbox,
  unreadCount,
  markRead,
  markAllRead,
  setPreference,
  setQuietHours,
  pendingDeliveries,
  markDeliverySent,
  markDeliveryFailed,
  type Database,
} from '@aurora/db';
import {
  isUuid,
  ValidationError,
  UnauthenticatedError,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  DIGEST_MODES,
  type NotificationChannel,
  type DigestMode,
} from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

const UUID_ROUTE = '[0-9a-fA-F-]{36}';

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} deve ser um de: ${allowed.join(', ')}`, { field });
  }
  return value as T;
}

/**
 * O vínculo de quem está pedindo.
 *
 * Sem vínculo não há caixa: um ator de sistema não tem notificação pessoal, e
 * devolver a de outra pessoa seria a falha mais grave possível neste módulo.
 */
function meuVinculo(req: AuroraRequest): string {
  const id = req.auroraContext?.membershipId;
  if (!id) throw new UnauthenticatedError('esta operação exige um vínculo pessoal');
  return id;
}

@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** O catálogo, para a tela de preferências saber o que oferecer. */
  @Get('types')
  types(): { items: unknown[] } {
    return {
      items: NOTIFICATION_TYPES.map((t) => ({
        key: t.key,
        label: t.label,
        channels: t.channels,
        phase: t.phase,
        bypassesQuietHours: t.bypassesQuietHours,
      })),
    };
  }

  @Get()
  async list(
    @Req() req: AuroraRequest,
    @Query('unread') unread?: string,
    @Query('limit') limit?: string
  ): Promise<{ items: unknown[]; unread: number }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    return withTenant(this.db, ctx, async (s) => ({
      items: await inbox(s, eu, {
        unreadOnly: unread === 'true',
        limit: limit ? Number(limit) : undefined,
      }),
      // A contagem vem junto: o sino da interface precisa dela em toda carga, e
      // uma segunda requisição para exibir um número é a que sempre atrasa.
      unread: await unreadCount(s, eu),
    }));
  }

  @Post('read')
  async read(@Req() req: AuroraRequest, @Body() body: { ids?: unknown }): Promise<{ marked: number }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);

    if (!Array.isArray(body.ids) || body.ids.some((x) => typeof x !== 'string' || !isUuid(x))) {
      throw new ValidationError('ids deve ser uma lista de identificadores', { field: 'ids' });
    }
    if (body.ids.length > 500) {
      throw new ValidationError('marque no máximo 500 por vez', { field: 'ids' });
    }

    const marked = await withTenant(this.db, ctx, (s) => markRead(s, eu, body.ids as string[]));
    return { marked };
  }

  @Post('read-all')
  async readAll(@Req() req: AuroraRequest): Promise<{ marked: number }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);
    const marked = await withTenant(this.db, ctx, (s) => markAllRead(s, eu));
    return { marked };
  }

  @Post('preferences')
  async preference(
    @Req() req: AuroraRequest,
    @Body() body: { typeKey?: unknown; channel?: unknown; enabled?: unknown; digest?: unknown }
  ): Promise<{ saved: true }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);

    await withTenant(this.db, ctx, (s) =>
      setPreference(s, eu, {
        typeKey: typeof body.typeKey === 'string' ? body.typeKey : '',
        channel: oneOf<NotificationChannel>(body.channel, NOTIFICATION_CHANNELS, 'channel'),
        enabled: body.enabled !== false,
        digest: body.digest ? oneOf<DigestMode>(body.digest, DIGEST_MODES, 'digest') : 'immediate',
      })
    );
    return { saved: true };
  }

  @Post('quiet-hours')
  async quietHours(
    @Req() req: AuroraRequest,
    @Body() body: { startMinute?: unknown; endMinute?: unknown; fullDays?: unknown }
  ): Promise<{ saved: true }> {
    const ctx = req.auroraContext!;
    const eu = meuVinculo(req);

    const minuto = (v: unknown, campo: string): number | null => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 1439) {
        throw new ValidationError(`${campo} deve ser um minuto do dia entre 0 e 1439`, {
          field: campo,
        });
      }
      return n;
    };

    const dias = Array.isArray(body.fullDays) ? body.fullDays.map(Number) : [];
    if (dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new ValidationError('fullDays deve conter dias da semana de 0 a 6', {
        field: 'fullDays',
      });
    }

    await withTenant(this.db, ctx, (s) =>
      setQuietHours(s, eu, {
        startMinute: minuto(body.startMinute, 'startMinute'),
        endMinute: minuto(body.endMinute, 'endMinute'),
        fullDays: dias,
      })
    );
    return { saved: true };
  }

  /**
   * A fila de saída.
   *
   * Exposta para o adaptador de transporte — que ainda não existe — consumir. O
   * envio de fato não está simulado em lugar nenhum: a entrega fica `pending`
   * até que algo real a marque, porque um "enviado" falso some sem deixar
   * rastro e é a pior mentira possível num sistema de notificação.
   */
  @Get('outbox')
  @RequirePermissions('audit.read')
  async outbox(@Req() req: AuroraRequest, @Query('channel') channel?: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const canal = oneOf<NotificationChannel>(channel, NOTIFICATION_CHANNELS, 'channel');
    const items = await withTenant(this.db, ctx, (s) => pendingDeliveries(s, canal));
    return { items };
  }

  /*
   * Escrita, e por isso NÃO é `audit.read`: o papel Auditor tem essa chave e a
   * §21 diz que ele não escreve nada. Quem chama isto é o adaptador de
   * transporte, informando o que aconteceu de fato com a mensagem.
   */
  @Post(`outbox/:id(${UUID_ROUTE})/sent`)
  @RequirePermissions('notification.deliver')
  async sent(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    await withTenant(this.db, ctx, (s) => markDeliverySent(s, id));
    return { ok: true };
  }

  @Post(`outbox/:id(${UUID_ROUTE})/failed`)
  @RequirePermissions('notification.deliver')
  async failed(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { error?: unknown }
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const erro = typeof body.error === 'string' ? body.error : 'erro não informado';
    await withTenant(this.db, ctx, (s) => markDeliveryFailed(s, id, erro));
    return { ok: true };
  }
}
