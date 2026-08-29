/**
 * Aurora — papéis e permissões pela HTTP (SPEC v0.2 §04, §05 · EPIC-002).
 *
 * A ROTA QUE IMPORTA É A DA EXPLICAÇÃO.
 *
 * `GET /memberships/:id/permissions` não devolve uma lista de permissões:
 * devolve, para cada uma, de onde ela veio. É a diferença entre "o Rafael tem
 * work_order.close" e "o Rafael tem work_order.close porque é Coordenador, e
 * também porque alguém abriu uma exceção em março que ninguém removeu".
 *
 * Sem procedência, quem administra permissões corrige no lugar errado: tira o
 * papel, o acesso continua, e a saída habitual é empilhar uma exceção de
 * negação por cima — que é como uma organização chega a um modelo de acesso
 * que ninguém consegue mais explicar.
 */
import { Body, Controller, Delete, Get, Inject, Param, Put, Req } from '@nestjs/common';
import {
  withTenant,
  listRoles,
  rolePermissions,
  explainPermissions,
  setPermissionOverride,
  clearPermissionOverride,
  setMemberRoles,
  type Database,
} from '@aurora/db';
import { PERMISSIONS, PERMISSION_KEYS, ValidationError } from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { oneOf, text, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

@Controller()
export class RolesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * O catálogo de permissões que EXISTEM.
   *
   * Vem do domínio, e não do banco: a lista é a mesma para toda organização, e
   * é o que a tela de papéis usa para desenhar as caixas de seleção. Ler do
   * banco devolveria a mesma coisa mais devagar, e num momento em que a
   * sincronização do catálogo poderia ainda não ter rodado.
   */
  @Get('permissions')
  @RequirePermissions('organization.manage_roles')
  permissions(): { items: unknown[] } {
    return {
      items: PERMISSIONS.map((p) => ({
        key: p.key,
        resource: p.resource,
        action: p.action,
        description: p.description,
        // `fieldLevel` marca as permissões aplicadas na SERIALIZAÇÃO, e não na
        // rota: custo, nota interna, valor do ativo. A tela de papéis precisa
        // distingui-las, porque conceder uma delas não abre uma tela nova —
        // muda o que aparece dentro das telas que a pessoa já vê.
        field_level: p.fieldLevel ?? false,
      })),
    };
  }

  /** Os papéis desta organização, com quantas pessoas cada um tem. */
  @Get('roles')
  @RequirePermissions('organization.manage_roles')
  async roles(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) => listRoles(s));
    return { items };
  }

  /** O que um papel concede. */
  @Get('roles/:id/permissions')
  @RequirePermissions('organization.manage_roles')
  async ofRole(
    @Req() req: AuroraRequest,
    @Param('id') id: string
  ): Promise<{ items: string[] }> {
    const ctx = req.auroraContext!;
    const roleId = uuidParam(id, 'id');
    const items = await withTenant(this.db, ctx, (s) => rolePermissions(s, roleId));
    return { items };
  }

  /**
   * Por que esta pessoa pode o que pode.
   *
   * A permissão exigida é `manage_members` e não `manage_roles`: quem
   * administra pessoas precisa conseguir responder à pergunta sem também poder
   * redesenhar o modelo de acesso da organização. São dois trabalhos, e
   * exigir o segundo para fazer o primeiro é o que leva alguém a receber
   * `manage_roles` "só para conferir uma coisa".
   */
  @Get('memberships/:id/permissions')
  @RequirePermissions('organization.manage_members')
  async explain(
    @Req() req: AuroraRequest,
    @Param('id') id: string
  ): Promise<{ items: unknown[]; effective: string[] }> {
    const ctx = req.auroraContext!;
    const membershipId = uuidParam(id, 'id');
    const items = await withTenant(this.db, ctx, (s) => explainPermissions(s, membershipId));

    /*
     * O EFETIVO É CALCULADO AQUI a partir das mesmas linhas, e não numa
     * segunda consulta.
     *
     * Duas consultas dariam duas respostas quando a exceção vencesse no
     * intervalo entre elas — e a tela mostraria uma explicação que não bate
     * com a lista, que é o pior resultado possível para uma tela cujo trabalho
     * é explicar.
     *
     * A regra é a de `aurora.effective_permissions`: `deny` vence.
     */
    const negadas = new Set(
      items.filter((i) => i.effect === 'deny').map((i) => i.permission_key)
    );
    const efetivas = [
      ...new Set(
        items.filter((i) => i.effect === 'grant' && !negadas.has(i.permission_key)).map((i) => i.permission_key)
      ),
    ].sort();

    return { effective: efetivas, items };
  }

  /**
   * Abre ou remove uma exceção pontual.
   *
   * `PUT` e não `POST`: a exceção é única por (pessoa, permissão) — é a chave
   * primária da tabela — e escrever duas vezes tem de dar o mesmo resultado.
   */
  @Put('memberships/:id/permissions/:key')
  @RequirePermissions('organization.manage_roles')
  async override(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const membershipId = uuidParam(id, 'id');

    if (!PERMISSION_KEYS.includes(key)) {
      throw new ValidationError(`permissão desconhecida: ${key}`, { field: 'key' });
    }

    const efeito = oneOf(body.effect, ['grant', 'deny'] as const, 'effect');
    const motivo = text(body.reason);
    if (motivo === null || motivo.length < 5) {
      // O banco também recusa (CHECK desde a 0005). A recusa aqui existe para
      // a mensagem ser útil em vez de um erro de restrição.
      throw new ValidationError(
        'a exceção exige um motivo — sem ele, ninguém consegue decidir depois se pode removê-la',
        { field: 'reason' }
      );
    }

    const vence = body.expires_at === undefined || body.expires_at === null
      ? null
      : new Date(String(body.expires_at));
    if (vence !== null && Number.isNaN(vence.getTime())) {
      throw new ValidationError('expires_at não é uma data válida', { field: 'expires_at' });
    }

    await withTenant(this.db, ctx, (s) =>
      setPermissionOverride(s, {
        membershipId,
        permissionKey: key,
        effect: efeito,
        reason: motivo,
        expiresAt: vence,
      })
    );
    return { ok: true };
  }

  @Delete('memberships/:id/permissions/:key')
  @RequirePermissions('organization.manage_roles')
  async clearOverride(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Param('key') key: string
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const membershipId = uuidParam(id, 'id');
    await withTenant(this.db, ctx, (s) => clearPermissionOverride(s, membershipId, key));
    return { ok: true };
  }

  /**
   * Troca o conjunto de papéis de uma pessoa.
   *
   * O corpo traz o conjunto INTEIRO, e não "adicione este". Enviar o conjunto
   * completo torna a operação idempotente e elimina a corrida de duas telas
   * abertas: a última a salvar ganha, inteira, em vez de as duas somarem
   * papéis que ninguém pediu junto.
   */
  @Put('memberships/:id/roles')
  @RequirePermissions('organization.manage_members')
  async roleSet(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const membershipId = uuidParam(id, 'id');
    const ids = body.role_ids;
    if (!Array.isArray(ids)) {
      throw new ValidationError('role_ids deve ser uma lista', { field: 'role_ids' });
    }
    const roleIds = ids.map((x, i) => uuidParam(String(x), `role_ids[${i}]`));

    await withTenant(this.db, ctx, (s) => setMemberRoles(s, membershipId, roleIds));
    return { ok: true };
  }
}
