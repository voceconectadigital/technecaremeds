/**
 * Aurora — clientes e tipos de local (SPEC v0.2 §05, §32 · EPIC-003).
 *
 * O modo single-customer (clínica que atende só a si mesma) não tem rota
 * própria e não muda o modelo: é a organização com um único cliente
 * `is_internal`. Quem decide esconder o seletor é a interface, lendo
 * `single_customer` da listagem. Um "modo" no banco viraria dois caminhos de
 * código para a mesma pergunta e divergiria no primeiro cliente que crescer.
 */
import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { withTenant, createCustomer, type Database, type TenantSession } from '@aurora/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@aurora/domain';
import { customersCreate, type Customer } from '@aurora/contracts';
import { RequirePermissions } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

interface CustomerListView {
  items: Customer[];
  /** Verdadeiro quando há exatamente um cliente e ele é o interno. */
  single_customer: boolean;
}

/**
 * As colunas de um cliente, com as contagens.
 *
 * Uma consulta só para a lista, a ficha e a resposta da criação: se cada uma
 * escrevesse a sua, a criação devolveria um cliente com um campo a menos e a
 * tela que acabou de cadastrar mostraria "—" onde a lista mostra "0".
 */
const SELECT_CUSTOMER = `
  SELECT c.id, c.name, c.trade_name, c.code, c.tax_id, c.is_internal, c.segment, c.status::text AS status,
         (SELECT count(*) FROM aurora.locations l
           WHERE l.customer_id = c.id AND l.deleted_at IS NULL)::int AS location_count,
         (SELECT count(*) FROM aurora.assets a
           WHERE a.customer_id = c.id AND a.deleted_at IS NULL)::int AS asset_count
    FROM aurora.customers c`;

/**
 * O escopo por cliente é resolvido a partir do vínculo. Um chamador sem
 * vínculo (contexto de sistema) não tem escopo definido, e "sem escopo" não
 * pode significar "tudo" numa rota que lista dados de tenant.
 */
function requireMembership(membershipId: string | null): string {
  if (!membershipId) {
    throw new ForbiddenError('esta rota exige um vínculo de usuário com a organização');
  }
  return membershipId;
}

/** Vazio e só-espaços viram `null`: "não informado" tem uma forma só no banco. */
function ouNulo(v: string | undefined): string | null {
  return v && v.length > 0 ? v : null;
}

/**
 * A recusa do índice único, dita na língua de quem preencheu o formulário.
 *
 * O tradutor genérico responde "já existe um registro com estes dados
 * (customers_org_name_uq)" — correto, e inútil para quem só quer saber qual
 * campo mudar. Aqui o nome da regra vira o campo, e o formulário acende o
 * campo certo.
 */
function conflitoLegivel(err: unknown): unknown {
  if (!(err instanceof ConflictError)) return err;
  const regra = (err.details as { constraint?: unknown }).constraint;
  if (regra === 'customers_org_name_uq') {
    return new ConflictError('já existe um cliente com este nome', { ...err.details, field: 'name' });
  }
  if (regra === 'customers_org_code_uq') {
    return new ConflictError('já existe um cliente com este código', { ...err.details, field: 'code' });
  }
  return err;
}

async function lerCliente(s: TenantSession, id: string): Promise<Customer | undefined> {
  const [row] = await s.query<Customer>(`${SELECT_CUSTOMER} WHERE c.id = $1 AND c.deleted_at IS NULL`, [id]);
  return row;
}

@Controller()
export class CustomersController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('customers')
  @RequirePermissions('customer.read')
  async customers(@Req() req: AuroraRequest): Promise<CustomerListView> {
    const ctx = req.auroraContext!;
    const membershipId = requireMembership(ctx.membershipId);
    return withTenant(this.db, ctx, async (s) => {
      const items = await s.query<Customer>(
        `${SELECT_CUSTOMER}
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
   * Cadastra um cliente.
   *
   * `is_internal` não é aceito aqui: o cliente interno é um por organização e
   * nasce no provisionamento. Deixá-lo no formulário seria oferecer uma opção
   * que o banco recusa em toda organização que já existe.
   *
   * O escopo de quem cadastra não é ampliado. Um vínculo restrito a certos
   * clientes cria o novo e deixa de vê-lo na lista — o que é o comportamento
   * honesto: conceder acesso é ato de quem administra pessoas, não efeito
   * colateral de um cadastro.
   */
  @Post('customers')
  @RequirePermissions('customer.create')
  async create(@Req() req: AuroraRequest, @Body() body: unknown): Promise<Customer> {
    const b = parseWith(customersCreate.body, body);
    try {
      return await withTenant(this.db, req.auroraContext!, async (s) => {
        const id = await createCustomer(s, {
          name: b.name,
          tradeName: ouNulo(b.trade_name),
          code: ouNulo(b.code),
          taxId: ouNulo(b.tax_id),
          segment: ouNulo(b.segment),
        });
        return (await lerCliente(s, id))!;
      });
    } catch (err) {
      throw conflitoLegivel(err);
    }
  }

  @Get('customers/:id')
  @RequirePermissions('customer.read')
  async detail(
    @Req() req: AuroraRequest,
    @Param('id') id: string
  ): Promise<{ customer: Customer; locations: unknown[] }> {
    const ctx = req.auroraContext!;
    const membershipId = requireMembership(ctx.membershipId);
    const customerId = uuidParam(id, 'id');
    return withTenant(this.db, ctx, async (s) => {
      const [visivel] = await s.query<{ ok: boolean }>(
        `SELECT true AS ok FROM aurora.accessible_customer_ids($1) WHERE customer_id = $2`,
        [membershipId, customerId]
      );
      const customer = visivel ? await lerCliente(s, customerId) : undefined;
      if (!customer) throw new NotFoundError('cliente', customerId);

      const locations = await s.query(
        `SELECT l.id, l.parent_id, l.name, l.code, l.path, l.depth, l.location_type_id,
                t.key AS location_type_key, t.name AS location_type_name
           FROM aurora.locations l
           LEFT JOIN aurora.location_types t ON t.id = l.location_type_id
          WHERE l.customer_id = $2
            AND l.deleted_at IS NULL
            AND l.id IN (SELECT location_id FROM aurora.accessible_location_ids($1))
          ORDER BY l.path`,
        [membershipId, customerId]
      );
      return { customer, locations };
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
