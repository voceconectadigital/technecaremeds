/**
 * Aurora — trilha de auditoria pela HTTP (SPEC v0.2 §22 · EPIC-022).
 *
 * A linha do tempo de um registro NÃO exige `audit.read`, e a trilha global
 * exige. A diferença é a que o §22 descreve: a história do próprio ativo ou da
 * própria OS é parte da tela dele — "o usuário não deve precisar sair da tela
 * para ver o histórico dela". Já vasculhar a trilha inteira da organização,
 * atrás de quem fez o quê, é perícia, e perícia tem permissão própria.
 */
import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import {
  withTenant,
  auditTrail,
  recordTimeline,
  auditByRequest,
  AUDIT_ACTIONS,
  type AuditAction,
  type Database,
} from '@aurora/db';
import { ForbiddenError, ValidationError, isUuid } from '@aurora/domain';
import { RequirePermissions, PermissionsCheckedInHandler } from '../common/permissions.guard';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

/**
 * As entidades cuja história pode ser aberta pela linha do tempo.
 *
 * Lista fechada, e não o nome da tabela vindo da URL: aceitar qualquer nome
 * transformaria a rota num leitor genérico de trilha de qualquer tabela — e a
 * permissão de ler a OS passaria a servir para ler a trilha de `users`.
 */
const ENTIDADES_COM_LINHA_DO_TEMPO: Record<string, string> = {
  work_orders: 'work_order.read',
  assets: 'asset.read',
  service_requests: 'service_request.read',
  customers: 'customer.read',
  contracts: 'contract.read',
  quotes: 'quote.read',
  documents: 'document.read',
};

/**
 * Campos cuja leitura é permissão de CAMPO (`fieldLevel`): a tela do registro
 * os esconde, e a linha do tempo não pode ser o caminho lateral para lê-los —
 * o diff de `monthly_value` é o valor do contrato (pente-fino 17/10).
 */
const CAMPOS_PROTEGIDOS: Record<string, Record<string, string>> = {
  contracts: {
    monthly_value: 'contract.read_financials',
    currency: 'contract.read_financials',
    overage_call_rate: 'contract.read_financials',
    overage_hour_rate: 'contract.read_financials',
    penalty_percent_per_breach: 'contract.read_financials',
    penalty_cap_percent: 'contract.read_financials',
  },
  assets: {
    purchase_value: 'asset.read_financials',
    residual_value: 'asset.read_financials',
    replacement_value: 'asset.read_financials',
    internal_notes: 'asset.read_internal_notes',
  },
};

function instant(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${field} não é uma data válida`, { field });
  }
  return d;
}

@Controller('audit')
export class AuditController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** A trilha global, filtrável — perícia e conformidade. */
  @Get()
  @RequirePermissions('audit.read')
  async trail(
    @Req() req: AuroraRequest,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;

    if (action && !AUDIT_ACTIONS.includes(action as AuditAction)) {
      throw new ValidationError(`action deve ser um de: ${AUDIT_ACTIONS.join(', ')}`, {
        field: 'action',
      });
    }
    if (actorUserId && !isUuid(actorUserId)) {
      throw new ValidationError('actorUserId deve ser um identificador válido', {
        field: 'actorUserId',
      });
    }

    const items = await withTenant(this.db, ctx, (s) =>
      auditTrail(
        s,
        {
          entityType: entityType ?? null,
          entityId: entityId ?? null,
          actorUserId: actorUserId ?? null,
          action: (action as AuditAction) ?? null,
          from: instant(from, 'from'),
          to: instant(to, 'to'),
        },
        limit ? Number(limit) : undefined
      )
    );
    return { items };
  }

  /**
   * Tudo o que uma requisição mudou.
   *
   * É a rota que transforma "salvei e sumiram três campos" numa lista concreta,
   * em vez de uma investigação.
   */
  @Get('by-request/:requestId')
  @RequirePermissions('audit.read')
  async byRequest(
    @Req() req: AuroraRequest,
    @Param('requestId') requestId: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    if (requestId.length > 100) {
      throw new ValidationError('identificador de requisição inválido', { field: 'requestId' });
    }
    return { items: await withTenant(this.db, ctx, (s) => auditByRequest(s, requestId)) };
  }

  /**
   * A história de um registro — mudanças e fatos, em ordem.
   *
   * A permissão é a de LER AQUELE registro, resolvida pela lista fechada acima.
   * É o que permite embutir a linha do tempo na própria tela do ativo sem que a
   * pessoa precise da permissão de perícia para ver o que aconteceu com o
   * equipamento que ela opera.
   */
  @Get('timeline/:entityType/:entityId')
  @PermissionsCheckedInHandler(
    'a permissão é a de ler AQUELA entidade, resolvida pela lista fechada de tipos com linha do tempo'
  )
  async timeline(
    @Req() req: AuroraRequest,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query('limit') limit?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;

    const permissao = ENTIDADES_COM_LINHA_DO_TEMPO[entityType];
    if (!permissao) {
      throw new ValidationError(
        `não há linha do tempo para "${entityType}"; disponíveis: ${Object.keys(ENTIDADES_COM_LINHA_DO_TEMPO).join(', ')}`,
        { field: 'entityType' }
      );
    }
    // Falta de permissão é 403, não 422: o pedido está bem formado, quem pede é
    // que não pode. Devolver "dado inválido" mandaria a pessoa corrigir o que
    // está certo.
    if (!ctx.permissions.has(permissao)) {
      throw new ForbiddenError(permissao);
    }

    // O escopo do registro (cliente/local) é conferido antes, pelo ScopeGuard:
    // a rota está na lista fechada dele.
    const items = await withTenant(this.db, ctx, (s) =>
      recordTimeline(s, entityType, uuidParam(entityId, 'entityId'), limit ? Number(limit) : undefined)
    );
    const protegidos = Object.entries(CAMPOS_PROTEGIDOS[entityType] ?? {}).filter(
      ([, p]) => !ctx.permissions.has(p)
    );
    if (protegidos.length === 0) return { items };
    const ocultos = new Set(protegidos.map(([campo]) => campo));
    return {
      items: items.map((i) =>
        i.changes
          ? { ...i, changes: Object.fromEntries(Object.entries(i.changes).filter(([k]) => !ocultos.has(k))) }
          : i
      ),
    };
  }
}
