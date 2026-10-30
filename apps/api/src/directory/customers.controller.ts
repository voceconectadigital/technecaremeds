/**
 * Aurora — clientes e tipos de local (SPEC v0.2 §05, §32 · EPIC-003).
 *
 * O modo single-customer (clínica que atende só a si mesma) não tem rota
 * própria e não muda o modelo: é a organização com um único cliente
 * `is_internal`. Quem decide esconder o seletor é a interface, lendo
 * `single_customer` da listagem. Um "modo" no banco viraria dois caminhos de
 * código para a mesma pergunta e divergiria no primeiro cliente que crescer.
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { withTenant, createCustomer, updateCustomer, type Database, type TenantSession } from '@aurora/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  isValidCustomerSubtype,
  contractTermStatus,
  localDay,
} from '@aurora/domain';
import { customersCreate, customersUpdate, customersAddContact, type Customer } from '@aurora/contracts';
import { newId } from '@aurora/domain';
import { PermissionsCheckedInHandler } from '../common/permissions.guard';
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
  SELECT c.id, c.name, c.trade_name, c.code, c.tax_id, c.is_internal, c.segment, c.kind, c.subtype,
         c.status::text AS status, c.report_tier,
         -- Dia de calendário, em texto: "date" virando instante no driver muda de dia no fuso.
         to_char(c.contract_starts_on, 'YYYY-MM-DD') AS contract_starts_on,
         to_char(c.contract_ends_on, 'YYYY-MM-DD') AS contract_ends_on,
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

async function clienteVisivel(s: TenantSession, membershipId: string, customerId: string): Promise<void> {
  const [visivel] = await s.query<{ ok: boolean }>(
    `SELECT true AS ok FROM aurora.accessible_customer_ids($1) WHERE customer_id = $2`,
    [membershipId, customerId]
  );
  if (!visivel) throw new NotFoundError('cliente', customerId);
}

function conferirSubtipo(kind: string, subtype: string | null | undefined): void {
  if (!isValidCustomerSubtype(kind, subtype)) {
    throw new ValidationError('subtipo não pertence à classificação escolhida', { field: 'subtype' });
  }
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

/**
 * A situação da vigência (CLI-06), derivada a cada leitura a partir das duas datas e do dia
 * de hoje no fuso padrão da organização — nunca gravada, porque gravada envelheceria sozinha.
 */
function comSituacaoDoContrato(c: Customer): Customer {
  return {
    ...c,
    contract_status: contractTermStatus(c.contract_starts_on, c.contract_ends_on, localDay(new Date())),
  };
}

/**
 * Vigência do contrato: início e fim JUNTOS (ou nenhum), e o fim depois do início. O banco
 * tem as mesmas regras (0085); aqui elas chegam com o campo nomeado, para o formulário.
 */
function conferirVigencia(inicio: string | null | undefined, fim: string | null | undefined): void {
  if (Boolean(inicio) !== Boolean(fim)) {
    throw new ValidationError('informe o início e o fim da vigência do contrato juntos (ou nenhum)', {
      field: inicio ? 'contract_ends_on' : 'contract_starts_on',
    });
  }
  if (inicio && fim && fim <= inicio) {
    throw new ValidationError('o fim da vigência precisa ser depois do início', {
      field: 'contract_ends_on',
    });
  }
}

async function lerCliente(s: TenantSession, id: string): Promise<Customer | undefined> {
  const [row] = await s.query<Customer>(`${SELECT_CUSTOMER} WHERE c.id = $1 AND c.deleted_at IS NULL`, [id]);
  return row ? comSituacaoDoContrato(row) : undefined;
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
        items: items.map(comSituacaoDoContrato),
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
    conferirSubtipo(b.kind ?? 'eas', b.subtype);
    conferirVigencia(b.contract_starts_on, b.contract_ends_on);
    try {
      return await withTenant(this.db, req.auroraContext!, async (s) => {
        const id = await createCustomer(s, {
          name: b.name,
          tradeName: ouNulo(b.trade_name),
          code: ouNulo(b.code),
          taxId: ouNulo(b.tax_id),
          segment: ouNulo(b.segment),
          kind: b.kind ?? 'eas',
          subtype: b.subtype ? b.subtype : null,
          reportTier: b.report_tier ?? null,
          contractStartsOn: b.contract_starts_on ?? null,
          contractEndsOn: b.contract_ends_on ?? null,
        });
        return (await lerCliente(s, id))!;
      });
    } catch (err) {
      throw conflitoLegivel(err);
    }
  }

  /**
   * Edita o cadastro (reunião 16/10/2026). Fora do escopo: 404, como na ficha.
   */
  @Patch('customers/:id')
  @RequirePermissions('customer.update')
  async update(@Req() req: AuroraRequest, @Param('id') id: string, @Body() body: unknown): Promise<Customer> {
    const ctx = req.auroraContext!;
    const membershipId = requireMembership(ctx.membershipId);
    const customerId = uuidParam(id, 'id');
    const b = parseWith(customersUpdate.body, body);
    try {
      return await withTenant(this.db, ctx, async (s) => {
        const [visivel] = await s.query<{ ok: boolean }>(
          `SELECT true AS ok FROM aurora.accessible_customer_ids($1) WHERE customer_id = $2`,
          [membershipId, customerId]
        );
        const atual = visivel ? await lerCliente(s, customerId) : undefined;
        if (!atual) throw new NotFoundError('cliente', customerId);
        if (atual.is_internal && b.kind === 'corporate') {
          throw new ValidationError('o cliente interno é a própria organização e não muda de classificação', {
            field: 'kind',
          });
        }
        const kind = b.kind ?? atual.kind ?? 'eas';
        // Trocar o tipo sem mandar subtipo invalida o subtipo antigo: ele é limpo.
        const subtype =
          b.subtype !== undefined ? b.subtype || null : b.kind && b.kind !== atual.kind ? null : undefined;
        conferirSubtipo(kind, subtype);
        // A vigência é conferida com o que FICA: mandar só o fim confere contra o início gravado.
        conferirVigencia(
          b.contract_starts_on !== undefined ? b.contract_starts_on : atual.contract_starts_on,
          b.contract_ends_on !== undefined ? b.contract_ends_on : atual.contract_ends_on
        );
        await updateCustomer(s, customerId, {
          name: b.name,
          tradeName: b.trade_name === undefined ? undefined : ouNulo(b.trade_name),
          code: b.code === undefined ? undefined : ouNulo(b.code),
          taxId: b.tax_id === undefined ? undefined : ouNulo(b.tax_id),
          kind: b.kind,
          subtype,
          reportTier: b.report_tier,
          contractStartsOn: b.contract_starts_on,
          contractEndsOn: b.contract_ends_on,
        });
        return (await lerCliente(s, customerId))!;
      });
    } catch (err) {
      throw conflitoLegivel(err);
    }
  }

  @Get('customers/:id/contacts')
  @RequirePermissions('customer.read')
  async contacts(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const membershipId = requireMembership(ctx.membershipId);
    const customerId = uuidParam(id, 'id');
    return withTenant(this.db, ctx, async (s) => {
      await clienteVisivel(s, membershipId, customerId);
      const items = await s.query(
        `SELECT id, name, role_title, email, phone, is_primary
           FROM aurora.customer_contacts
          WHERE customer_id = $1 AND deleted_at IS NULL
          ORDER BY is_primary DESC, name`,
        [customerId]
      );
      return { items };
    });
  }

  @Post('customers/:id/contacts')
  @RequirePermissions('customer.read')
  @PermissionsCheckedInHandler('aceita customer.update ou quote.create')
  async addContact(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    if (!ctx.permissions.has('customer.update') && !ctx.permissions.has('quote.create')) {
      throw new ForbiddenError('customer.update');
    }
    const membershipId = requireMembership(ctx.membershipId);
    const customerId = uuidParam(id, 'id');
    const b = parseWith(customersAddContact.body, body);
    return withTenant(this.db, ctx, async (s) => {
      await clienteVisivel(s, membershipId, customerId);
      const novo = newId();
      await s.query(
        `INSERT INTO aurora.customer_contacts
           (id, organization_id, customer_id, name, role_title, email, phone, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          novo,
          ctx.organizationId,
          customerId,
          b.name,
          b.role_title ?? null,
          b.email ?? null,
          b.phone ?? null,
          ctx.actorId,
        ]
      );
      return { id: novo };
    });
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
                t.key AS location_type_key, t.name AS location_type_name, t.allows_assets,
                (SELECT count(*) FROM aurora.assets a
                  WHERE a.location_path LIKE l.path || '%' AND a.deleted_at IS NULL)::int AS asset_count
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
