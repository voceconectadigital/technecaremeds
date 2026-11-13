/**
 * Aurora — contratos pela HTTP (SPEC v0.2 §17 · EPIC-017).
 *
 * Duas rotas merecem explicação, porque a alternativa óbvia é pior:
 *
 * `GET /contracts/:id/periods/:period` **mede sem gravar**. É a rota que a tela
 * usa para mostrar o mês em curso, e um GET que grava seria um GET que muda o
 * estado do sistema toda vez que alguém abre a tela.
 *
 * `POST /contracts/:id/periods/:period/close` é irreversível de propósito e por
 * isso é rota própria, com permissão própria (`contract.close_period`). Fechar
 * não é "salvar de novo": é dizer que aqueles números são a fatura.
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  createContract,
  updateContract,
  effectiveSlaForAsset,
  addCoverage,
  addService,
  setSlaOverride,
  activateContract,
  terminateContract,
  contractForAsset,
  coveredAssets,
  measurePeriod,
  saveMeasurement,
  closePeriod,
  sweepContractAlerts,
  type Database,
  type TenantSession,
} from '@aurora/db';
import {
  ValidationError,
  CONTRACT_KINDS,
  COVERAGE_KINDS,
  BILLING_MODELS,
  SERVICE_FREQUENCIES,
  PAYMENT_TERMS,
  NotFoundError,
  type ContractKind,
  type CoverageKind,
  type BillingModel,
  type ServiceFrequency,
  type PaymentTerms,
} from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import { escopoRestrito } from '../common/scope-sql';
import type { AuroraRequest } from '../common/context.middleware';

/**
 * O período de medição, no formato `AAAA-MM`.
 *
 * Esta conferência existia como regex na própria rota
 * (`:period(\\d{4}-\\d{2})`) e sumiu quando o Express 5 passou a recusar
 * regex embutida em parâmetro. Sem ela, "2026-13" ou "banana" chegariam à
 * camada de dados como se fossem período — e a medição de um contrato é
 * exatamente onde um valor sem sentido vira número de fatura.
 */
function periodoParam(value: unknown, field = 'period'): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new ValidationError(`${field} deve estar no formato AAAA-MM`, { field });
  }
  return value;
}

function isoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} deve ser uma data no formato AAAA-MM-DD`, { field });
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} deve ser um de: ${allowed.join(', ')}`, { field });
  }
  return value as T;
}

/** Opcional que aceita nulo: ausente = undefined (não muda), null/'' = null (apaga). */
function opcionalOuNulo<T>(value: unknown, ler: (v: unknown) => T): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return ler(value);
}

function equipesFixas(value: unknown): number[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new ValidationError('fixedTeamPackages deve ser uma lista de 1 a 10', {
      field: 'fixedTeamPackages',
    });
  }
  return value.map((v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new ValidationError('equipe fixa deve ser um número de 1 a 10', { field: 'fixedTeamPackages' });
    }
    return n;
  });
}

/** A política de SLA precisa existir na organização (a RLS esconde a das outras). */
async function conferirPolitica(s: TenantSession, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const [ok] = await s.query(
    `SELECT 1 AS ok FROM aurora.sla_policies WHERE id = $1 AND archived_at IS NULL`,
    [id]
  );
  if (!ok) throw new ValidationError('política de SLA não encontrada', { field: 'slaPolicyId' });
}

/** Hoje, no formato de data — um só lugar, para o teste poder raciocinar sobre ele. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface CreateBody {
  customerId?: unknown;
  kind?: unknown;
  title?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
  autoRenew?: unknown;
  renewalNoticeDays?: unknown;
  slaPolicyId?: unknown;
  billingModel?: unknown;
  monthlyValue?: unknown;
  includedCalls?: unknown;
  includedHours?: unknown;
  overageCallRate?: unknown;
  overageHourRate?: unknown;
  penaltyPercentPerBreach?: unknown;
  penaltyCapPercent?: unknown;
  slaTargetPercent?: unknown;
  planTargetPercent?: unknown;
  notes?: unknown;
  serviceFrequency?: unknown;
  fixedTeamPackages?: unknown;
  paymentTerms?: unknown;
  /** Cobre todos os equipamentos do cliente (cobertura `customer`), como no cadastro do cliente. */
  coverAllAssets?: unknown;
  /** Ativa na mesma transação (exige cobertura). */
  activate?: unknown;
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(`${field} deve ser um número não negativo`, { field });
  }
  return n;
}

@Controller('contracts')
export class ContractsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post()
  @RequirePermissions('contract.create')
  async create(@Req() req: AuroraRequest, @Body() body: CreateBody): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const slaPolicyId = body.slaPolicyId ? uuidParam(body.slaPolicyId, 'slaPolicyId') : null;
    const id = await withTenant(this.db, ctx, async (s) => {
      await conferirPolitica(s, slaPolicyId);
      const novo = await createContract(s, {
        customerId: uuidParam(body.customerId, 'customerId'),
        kind: oneOf<ContractKind>(body.kind, CONTRACT_KINDS, 'kind'),
        title: typeof body.title === 'string' ? body.title : undefined,
        startsOn: isoDate(body.startsOn, 'startsOn'),
        endsOn: body.endsOn === undefined || body.endsOn === null ? null : isoDate(body.endsOn, 'endsOn'),
        autoRenew: body.autoRenew === true,
        renewalNoticeDays: optionalNumber(body.renewalNoticeDays, 'renewalNoticeDays') ?? 30,
        slaPolicyId,
        // Ausente = não informada: o banco grava o padrão antigo e marca `billing_model_informed` falso.
        billingModel: body.billingModel
          ? oneOf<BillingModel>(body.billingModel, BILLING_MODELS, 'billingModel')
          : undefined,
        monthlyValue: optionalNumber(body.monthlyValue, 'monthlyValue'),
        includedCalls: optionalNumber(body.includedCalls, 'includedCalls'),
        includedHours: optionalNumber(body.includedHours, 'includedHours'),
        overageCallRate: optionalNumber(body.overageCallRate, 'overageCallRate'),
        overageHourRate: optionalNumber(body.overageHourRate, 'overageHourRate'),
        penaltyPercentPerBreach: optionalNumber(body.penaltyPercentPerBreach, 'penaltyPercentPerBreach'),
        penaltyCapPercent: optionalNumber(body.penaltyCapPercent, 'penaltyCapPercent'),
        slaTargetPercent: optionalNumber(body.slaTargetPercent, 'slaTargetPercent'),
        planTargetPercent: optionalNumber(body.planTargetPercent, 'planTargetPercent'),
        notes: typeof body.notes === 'string' ? body.notes : null,
        serviceFrequency:
          opcionalOuNulo(body.serviceFrequency, (v) =>
            oneOf<ServiceFrequency>(v, SERVICE_FREQUENCIES, 'serviceFrequency')
          ) ?? null,
        fixedTeamPackages: equipesFixas(body.fixedTeamPackages),
        paymentTerms:
          opcionalOuNulo(body.paymentTerms, (v) => oneOf<PaymentTerms>(v, PAYMENT_TERMS, 'paymentTerms')) ??
          null,
      });
      if (body.coverAllAssets === true) {
        await addCoverage(s, { contractId: novo, kind: 'customer' });
      }
      if (body.activate === true) await activateContract(s, novo);
      return novo;
    });
    return { id };
  }

  /** Opções do formulário de contrato: as políticas de SLA da organização. */
  @Get('options')
  @RequirePermissions('contract.read')
  async options(@Req() req: AuroraRequest): Promise<{ sla_policies: unknown[] }> {
    const ctx = req.auroraContext!;
    const politicas = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT id, name, is_default FROM aurora.sla_policies
          WHERE archived_at IS NULL ORDER BY is_default DESC, name`
      )
    );
    return { sla_policies: politicas };
  }

  /**
   * Edita o contrato pelo cadastro do cliente (0090): título, vigência, SLA geral, modalidade,
   * equipes fixas, base de precificação, condição de pagamento e observações. Valores, franquias
   * e glosa não passam por aqui.
   */
  @Patch(':id')
  @RequirePermissions('contract.update')
  async update(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: CreateBody
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const contractId = uuidParam(id, 'id');
    const slaPolicyId = opcionalOuNulo(body.slaPolicyId, (v) => uuidParam(v, 'slaPolicyId'));
    await withTenant(this.db, ctx, async (s) => {
      await conferirPolitica(s, slaPolicyId);
      await updateContract(s, contractId, {
        title: opcionalOuNulo(body.title, (v) => String(v)),
        startsOn: body.startsOn === undefined ? undefined : isoDate(body.startsOn, 'startsOn'),
        endsOn: opcionalOuNulo(body.endsOn, (v) => isoDate(v, 'endsOn')),
        autoRenew: body.autoRenew === undefined ? undefined : body.autoRenew === true,
        slaPolicyId,
        billingModel:
          body.billingModel === undefined
            ? undefined
            : oneOf<BillingModel>(body.billingModel, BILLING_MODELS, 'billingModel'),
        serviceFrequency: opcionalOuNulo(body.serviceFrequency, (v) =>
          oneOf<ServiceFrequency>(v, SERVICE_FREQUENCIES, 'serviceFrequency')
        ),
        fixedTeamPackages:
          body.fixedTeamPackages === undefined ? undefined : equipesFixas(body.fixedTeamPackages),
        paymentTerms: opcionalOuNulo(body.paymentTerms, (v) =>
          oneOf<PaymentTerms>(v, PAYMENT_TERMS, 'paymentTerms')
        ),
        notes: opcionalOuNulo(body.notes, (v) => String(v)),
      });
    });
    return { id: contractId };
  }

  @Get()
  @RequirePermissions('contract.read')
  async list(
    @Req() req: AuroraRequest,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT ct.id, ct.number, ct.title, ct.customer_id, ct.kind, ct.status,
                ct.starts_on::text AS starts_on, ct.ends_on::text AS ends_on, ct.auto_renew,
                ct.billing_model, ct.billing_model_informed, ct.sla_policy_id, sp.name AS sla_policy_name, ct.service_frequency,
                ct.fixed_team_packages::int[] AS fixed_team_packages, ct.payment_terms,
                EXISTS (SELECT 1 FROM aurora.contract_coverages cv
                         WHERE cv.contract_id = ct.id AND cv.kind = 'customer') AS covers_all_assets
           FROM aurora.contracts ct
           LEFT JOIN aurora.sla_policies sp ON sp.id = ct.sla_policy_id
          WHERE ct.archived_at IS NULL
            AND ($1::uuid IS NULL OR ct.customer_id = $1)
            AND ($2::text  IS NULL OR ct.status::text = $2)
            -- Quem é restrito vê só os contratos dos clientes do seu escopo
            -- (pente-fino 17/10); as rotas por id ficam com o ScopeGuard.
            AND ($3::uuid IS NULL
                 OR ct.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($3)))
          ORDER BY ct.starts_on DESC, ct.number`,
        [customerId ?? null, status ?? null, escopoRestrito(ctx) ? ctx.membershipId : null]
      )
    );
    return { items };
  }

  @Get(':id')
  @RequirePermissions('contract.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    const contractId = uuidParam(id, 'id');
    return withTenant(this.db, ctx, async (s) => {
      // COLUNAS NOMEADAS, e os valores comerciais saem por permissão.
      //
      // Era `SELECT *`. A tabela guarda valor mensal, taxa de excedente por
      // chamado e por hora, percentual de glosa e teto de glosa — e existe
      // `contract.read_financials` justamente porque nem todo mundo deve
      // vê-los. O coordenador precisa saber O QUE o contrato cobre; o que ele
      // custa é conversa comercial.
      //
      // O filtro é na CONSULTA. Escondido na tela, o valor do contrato já
      // teria trafegado até o navegador de quem não pode vê-lo.
      const podeVerValores = ctx.permissions.has('contract.read_financials');
      const [contrato] = await s.query(
        `SELECT id, number, title, customer_id, kind::text AS kind, status::text AS status,
                starts_on::text AS starts_on, ends_on::text AS ends_on,
                auto_renew, renewal_notice_days, adjustment_index,
                sla_policy_id, price_list_id,
                (SELECT sp.name FROM aurora.sla_policies sp WHERE sp.id = sla_policy_id) AS sla_policy_name,
                service_frequency, fixed_team_packages::int[] AS fixed_team_packages, payment_terms,
                billing_model::text AS billing_model, billing_model_informed,
                included_calls, included_hours::text AS included_hours,
                sla_target_percent::text AS sla_target_percent,
                plan_target_percent::text AS plan_target_percent,
                notes, archived_at, created_at, updated_at,
                CASE WHEN $2::boolean THEN monthly_value::text END AS monthly_value,
                CASE WHEN $2::boolean THEN currency END AS currency,
                CASE WHEN $2::boolean THEN overage_call_rate::text END AS overage_call_rate,
                CASE WHEN $2::boolean THEN overage_hour_rate::text END AS overage_hour_rate,
                CASE WHEN $2::boolean THEN penalty_percent_per_breach::text END
                  AS penalty_percent_per_breach,
                CASE WHEN $2::boolean THEN penalty_cap_percent::text END AS penalty_cap_percent
           FROM aurora.contracts WHERE id = $1`,
        [contractId, podeVerValores]
      );
      if (!contrato) throw new ValidationError('contrato não encontrado', { field: 'id' });
      const coberturas = await s.query(
        `SELECT id, kind, asset_id, location_id, asset_category_id, specificity
           FROM aurora.contract_coverages WHERE contract_id = $1 ORDER BY specificity DESC`,
        [contractId]
      );
      const servicos = await s.query(
        `SELECT work_order_type_id, billed_separately
           FROM aurora.contract_services WHERE contract_id = $1`,
        [contractId]
      );
      return { contract: contrato, coverages: coberturas, services: servicos };
    });
  }

  /** Os ativos que a expressão alcança HOJE — a pergunta que o operador faz antes de ativar. */
  @Get(':id/assets')
  @RequirePermissions('contract.read')
  async assets(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const contractId = uuidParam(id, 'id');
    const items = await withTenant(this.db, ctx, async (s) => {
      const ids = await coveredAssets(s, contractId);
      if (ids.length === 0) return [];
      // O contrato é do cliente; o equipamento coberto pode estar num setor
      // fora do escopo de quem pergunta — esse fica de fora da lista.
      return s.query(
        `SELECT id, name, location_path, sla_enabled, sla_policy_id IS NOT NULL AS has_own_sla
           FROM aurora.assets
          WHERE id = ANY($1::uuid[])
            AND ($2::uuid IS NULL
                 OR location_id IS NULL
                 OR location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2)))
          ORDER BY name`,
        [ids, escopoRestrito(ctx) ? ctx.membershipId : null]
      );
    });
    return { items };
  }

  @Post(':id/coverages')
  @RequirePermissions('contract.update')
  async coverage(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { kind?: unknown; assetId?: unknown; locationId?: unknown; assetCategoryId?: unknown }
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const contractId = uuidParam(id, 'id');
    const coverageId = await withTenant(this.db, ctx, (s) =>
      addCoverage(s, {
        contractId,
        kind: oneOf<CoverageKind>(body.kind, COVERAGE_KINDS, 'kind'),
        assetId: body.assetId ? uuidParam(body.assetId, 'assetId') : null,
        locationId: body.locationId ? uuidParam(body.locationId, 'locationId') : null,
        assetCategoryId: body.assetCategoryId ? uuidParam(body.assetCategoryId, 'assetCategoryId') : null,
      })
    );
    return { id: coverageId };
  }

  @Post(':id/services')
  @RequirePermissions('contract.update')
  async service(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { workOrderTypeId?: unknown; billedSeparately?: unknown }
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const serviceId = await withTenant(this.db, ctx, (s) =>
      addService(s, {
        contractId: uuidParam(id, 'id'),
        workOrderTypeId: uuidParam(body.workOrderTypeId, 'workOrderTypeId'),
        billedSeparately: body.billedSeparately === true,
      })
    );
    return { id: serviceId };
  }

  @Post(':id/sla-overrides')
  @RequirePermissions('contract.update')
  async slaOverride(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { criticalityLevelId?: unknown; slaPolicyId?: unknown }
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const overrideId = await withTenant(this.db, ctx, (s) =>
      setSlaOverride(s, {
        contractId: uuidParam(id, 'id'),
        criticalityLevelId: uuidParam(body.criticalityLevelId, 'criticalityLevelId'),
        slaPolicyId: uuidParam(body.slaPolicyId, 'slaPolicyId'),
      })
    );
    return { id: overrideId };
  }

  @Post(':id/activate')
  @RequirePermissions('contract.update')
  async activate(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ status: string }> {
    const ctx = req.auroraContext!;
    await withTenant(this.db, ctx, (s) => activateContract(s, uuidParam(id, 'id')));
    return { status: 'active' };
  }

  @Post(':id/terminate')
  @RequirePermissions('contract.update')
  async terminate(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { reason?: unknown }
  ): Promise<{ status: string }> {
    const ctx = req.auroraContext!;
    if (typeof body.reason !== 'string') {
      throw new ValidationError('encerrar contrato exige justificativa', { field: 'reason' });
    }
    await withTenant(this.db, ctx, (s) => terminateContract(s, uuidParam(id, 'id'), body.reason as string));
    return { status: 'terminated' };
  }

  /** Mede sem gravar — é a tela do mês em curso. */
  @Get(':id/periods/:period')
  @RequirePermissions('contract.read_financials')
  async period(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Param('period') period: string
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => measurePeriod(s, uuidParam(id, 'id'), periodoParam(period)));
  }

  /*
   * GRAVA a medição — e por isso exige as duas: ver os valores e poder alterar
   * o contrato. Só `contract.read_financials` deixaria o papel Financeiro,
   * cuja descrição é de leitura de valores, escrever a medição do mês.
   */
  @Post(':id/periods/:period')
  @RequirePermissions('contract.read_financials', 'contract.update')
  async saveperiod(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Param('period') period: string
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => saveMeasurement(s, uuidParam(id, 'id'), periodoParam(period)));
  }

  @Post(':id/periods/:period/close')
  @RequirePermissions('contract.close_period')
  async close(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Param('period') period: string
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) =>
      closePeriod(s, uuidParam(id, 'id'), periodoParam(period), today())
    );
  }

  /**
   * A varredura de alertas.
   *
   * É POST porque muda estado: expira contrato vencido e emite evento. Um GET
   * que faz isso é uma armadilha para qualquer coisa que faça pré-carregamento
   * de links — inclusive o navegador do próprio usuário.
   */
  @Post('alerts/sweep')
  @RequirePermissions('contract.update')
  async sweep(@Req() req: AuroraRequest, @Body() body: { period?: unknown }): Promise<{ alerts: unknown[] }> {
    const ctx = req.auroraContext!;
    const period = typeof body.period === 'string' ? body.period : today().slice(0, 7);
    const alerts = await withTenant(this.db, ctx, (s) => sweepContractAlerts(s, today(), period));
    return { alerts };
  }
}

/**
 * A pergunta feita do lado do ativo: "quem responde por este equipamento hoje?"
 *
 * Fica em `/assets/:id/contract` e não em `/contracts/...` porque é isso que a
 * ficha do ativo precisa perguntar, e obrigar a tela a varrer contratos para
 * descobrir seria a mesma inversão que faz a referência ter tela de contrato
 * que ninguém abre.
 */
@Controller('assets')
export class AssetContractController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get(':id/contract')
  @RequirePermissions('asset.read')
  async current(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Query('on') on?: string
  ): Promise<{ contract: unknown | null }> {
    const ctx = req.auroraContext!;
    const assetId = uuidParam(id, 'id');
    const data = on ? isoDate(on, 'on') : today();

    const contrato = await withTenant(this.db, ctx, async (s) => {
      const contractId = await contractForAsset(s, assetId, data);
      if (!contractId) return null;
      const [row] = await s.query(
        `SELECT id, number, title, kind, status, starts_on::text, ends_on::text, sla_policy_id
           FROM aurora.contracts WHERE id = $1`,
        [contractId]
      );
      return row ?? null;
    });

    return { contract: contrato };
  }

  /** O SLA que vale para o equipamento hoje e DE ONDE ele vem (geral do contrato, exceção…). */
  @Get(':id/effective-sla')
  @RequirePermissions('asset.read')
  async effectiveSla(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    const assetId = uuidParam(id, 'id');
    const sla = await withTenant(this.db, ctx, (s) => effectiveSlaForAsset(s, assetId));
    if (!sla) throw new NotFoundError('Equipamento', assetId);
    return sla;
  }
}
