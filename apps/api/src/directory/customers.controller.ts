/**
 * Aurora — clientes e tipos de local (SPEC v0.2 §05, §32 · EPIC-003).
 *
 * O modo single-customer (clínica que atende só a si mesma) não tem rota
 * própria e não muda o modelo: é a organização com um único cliente
 * `is_internal`. Quem decide esconder o seletor é a interface, lendo
 * `single_customer` da listagem. Um "modo" no banco viraria dois caminhos de
 * código para a mesma pergunta e divergiria no primeiro cliente que crescer.
 */
import { Controller, Get, Inject, Req } from '@nestjs/common';
import { withTenant, type Database } from '@aurora/db';
import { ForbiddenError } from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

interface CustomerListView {
  items: unknown[];
  /** Verdadeiro quando há exatamente um cliente e ele é o interno. */
  single_customer: boolean;
}

@Controller()
export class CustomersController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('customers')
  @RequirePermissions('customer.read')
  async customers(@Req() req: AuroraRequest): Promise<CustomerListView> {
    const ctx = req.auroraContext!;
    if (!ctx.membershipId) {
      throw new ForbiddenError('esta rota exige um vínculo de usuário com a organização');
    }
    const membershipId = ctx.membershipId;
    return withTenant(this.db, ctx, async (s) => {
      const items = await s.query<{ id: string; is_internal: boolean }>(
        `SELECT c.id, c.name, c.trade_name, c.code, c.is_internal, c.segment, c.status::text,
                (SELECT count(*) FROM aurora.locations l
                  WHERE l.customer_id = c.id AND l.deleted_at IS NULL)::int AS location_count
           FROM aurora.customers c
          WHERE c.deleted_at IS NULL
            AND c.id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))
          ORDER BY c.name`,
        [membershipId]
      );
      return {
        items,
        single_customer: items.length === 1 && items[0]!.is_internal === true,
      };
    });
  }

  /**
   * Tipos de local com as regras de aninhamento já resolvidas em nomes.
   *
   * A interface precisa saber, antes de abrir o formulário, quais tipos cabem
   * sob o pai escolhido. Sem isso a única forma de descobrir é tentar salvar e
   * ler o erro — que é exatamente o que a auditoria registrou como reclamação
   * na referência.
   */
  @Get('location-types')
  @RequirePermissions('location.read')
  async locationTypes(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT t.id, t.key, t.name, t.icon, t.can_be_root, t.allows_assets, t.position,
                t.allowed_parent_type_ids,
                COALESCE(
                  (SELECT array_agg(p.name ORDER BY p.name)
                     FROM aurora.location_types p
                    WHERE p.id = ANY (t.allowed_parent_type_ids) AND p.deleted_at IS NULL),
                  ARRAY[]::text[]
                ) AS allowed_parent_names
           FROM aurora.location_types t
          WHERE t.deleted_at IS NULL
          ORDER BY t.position, t.name`
      )
    );
    return { items };
  }
}
