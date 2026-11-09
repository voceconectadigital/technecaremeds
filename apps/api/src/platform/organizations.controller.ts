/**
 * Aurora — organização corrente (EPIC-001).
 *
 * Controller fino, como manda a SPEC (§36): resolve contexto, delega, devolve.
 * Nenhuma regra de negócio aqui.
 *
 * Repare que não existe rota `GET /organizations/:id`. Não é esquecimento: a
 * organização corrente é determinada pelo membership, não escolhida por
 * parâmetro. Uma rota por id convidaria a tratar o id como autorização — o
 * antipadrão que §37 existe para impedir.
 */
import { Body, Controller, Delete, Get, Inject, Param, Patch, Put, Req } from '@nestjs/common';
import { RequirePermissions } from '../common/permissions.guard';
import {
  withTenant,
  loadOrganizationConfiguration,
  updateOrganizationConfiguration,
  listOrganizationLogos,
  setOrganizationLogo,
  removeOrganizationLogo,
  type Database,
  type OrganizationConfiguration,
  type OrganizationLogoMeta,
} from '@aurora/db';
import { NotFoundError, ValidationError } from '@aurora/domain';
import {
  ORGANIZATION_LOGO_MAX_BYTES,
  organizationsLogoRemove,
  organizationsLogoSet,
  organizationsUpdateConfiguration,
  type OrganizationLogo,
} from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { ARQUIVOS, DATABASE } from '../common/tokens';
import { sha256De } from '../common/arquivos/disco';
import type { ArmazenamentoDeObjetos } from '../common/arquivos/porta';
import type { AuroraRequest } from '../common/context.middleware';

interface OrganizationView extends OrganizationConfiguration {
  id: string;
  slug: string;
  name: string;
  locale: string;
  timezone: string;
  asset_label: string;
  plan: string;
  seat_limit: number;
  seats_used: number;
  status: string;
}

@Controller('organizations')
export class OrganizationsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ARQUIVOS) private readonly arquivos: ArmazenamentoDeObjetos
  ) {}

  /** Organização do contexto — nunca recebe id por parâmetro. */
  @Get('current')
  @RequirePermissions('organization.read')
  async current(@Req() req: AuroraRequest): Promise<OrganizationView> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => {
      const rows = await s.query<
        Omit<OrganizationView, 'seats_used' | keyof OrganizationConfiguration> & {
          settings: { branding?: Record<string, unknown>; domain?: { host: string; status: string } } | null;
        }
      >(
        `SELECT id, slug, name, locale, timezone, asset_label, plan, seat_limit, status::text, settings
           FROM aurora.organizations
          WHERE deleted_at IS NULL`
      );
      const linha = rows[0];
      if (!linha) throw new NotFoundError('Organização');
      const { settings, ...base } = linha;
      const org = {
        ...base,
        branding: { display_name: base.name, ...(settings?.branding ?? {}) },
        domain: settings?.domain ?? null,
      };

      const [seats] = await s.query<{ used: number }>(
        `SELECT count(*)::int AS used FROM aurora.memberships
          WHERE seat_type = 'staff' AND status = 'active' AND deleted_at IS NULL`
      );
      return { ...org, seats_used: seats?.used ?? 0, ...(await loadOrganizationConfiguration(s)) };
    });
  }

  /**
   * Modo de uso e recursos habilitados (gap V2 P0.4).
   *
   * Recurso habilitado não é permissão: diz o que a organização USA, e quem
   * pode o quê continua no RBAC. Por isso a rota pede `organization.update`, e
   * não uma permissão por módulo.
   */
  @Patch('current/configuration')
  @RequirePermissions('organization.update')
  async configure(@Req() req: AuroraRequest, @Body() body: unknown): Promise<OrganizationConfiguration> {
    const ctx = req.auroraContext!;
    const entrada = parseWith(organizationsUpdateConfiguration.body, body);
    return withTenant(this.db, ctx, (s) =>
      updateOrganizationConfiguration(s, {
        usageMode: entrada.usage_mode,
        enabledFeatures: entrada.enabled_features,
        requireOperationalResult: entrada.require_operational_result,
      })
    );
  }

  /**
   * Logomarcas da organização (Anderson, 06/11/2026): até duas, para o cabeçalho da folha da OS.
   *
   * A leitura não pede permissão além do vínculo: quem imprime a OS precisa delas, e a RLS já
   * restringe à própria organização. Pôr, trocar e tirar pedem `organization.update`.
   */
  @Get('current/logos')
  async logos(@Req() req: AuroraRequest): Promise<{ items: OrganizationLogo[] }> {
    const metas = await withTenant(this.db, req.auroraContext!, (s) => listOrganizationLogos(s));
    const items: OrganizationLogo[] = [];
    for (const m of metas) {
      const bytes = await this.arquivos.ler(m.file_key).catch(() => undefined);
      // Arquivo sumido do armazenamento: a vaga sai vazia, em vez de uma imagem quebrada no papel.
      if (bytes) items.push(paraResposta(m, bytes));
    }
    return { items };
  }

  @Put('current/logos/:slot')
  @RequirePermissions('organization.update')
  async setLogo(
    @Req() req: AuroraRequest,
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<OrganizationLogo> {
    const ctx = req.auroraContext!;
    const slot = Number(parseWith(organizationsLogoSet.params, params).slot) as 1 | 2;
    const entrada = parseWith(organizationsLogoSet.body, body);
    const bytes = new Uint8Array(Buffer.from(entrada.data_base64, 'base64'));
    if (bytes.byteLength === 0) {
      throw new ValidationError('a imagem chegou vazia', { field: 'data_base64' });
    }
    if (bytes.byteLength > ORGANIZATION_LOGO_MAX_BYTES) {
      throw new ValidationError('logomarca grande demais (até 512 kB)', {
        field: 'data_base64',
        maximo: ORGANIZATION_LOGO_MAX_BYTES,
      });
    }
    // O tipo declarado precisa bater com o conteúdo: um "PNG" que não é PNG não entra.
    if (!assinaturaConfere(entrada.content_type, bytes)) {
      throw new ValidationError('o arquivo não é uma imagem PNG, JPEG ou WebP válida', {
        field: 'content_type',
      });
    }
    const sha256 = sha256De(bytes);
    const extensao = EXTENSAO[entrada.content_type];
    const chave = `orgs/${ctx.organizationId}/marca/logo-${slot}-${sha256.slice(0, 16)}${extensao}`;

    // Os bytes primeiro, os metadados depois, e só então o arquivo antigo sai.
    await this.arquivos.escrever(chave, 0, bytes);
    const { logo, previousKey } = await withTenant(this.db, ctx, (s) =>
      setOrganizationLogo(s, {
        slot,
        label: entrada.label ?? null,
        file_key: chave,
        file_name: nomeDoArquivo(entrada.file_name, extensao),
        content_type: entrada.content_type,
        size: bytes.byteLength,
        sha256,
      })
    );
    if (previousKey && previousKey !== chave) await this.arquivos.apagar(previousKey).catch(() => undefined);
    return paraResposta(logo, bytes);
  }

  @Delete('current/logos/:slot')
  @RequirePermissions('organization.update')
  async removeLogo(@Req() req: AuroraRequest, @Param() params: unknown): Promise<{ ok: true }> {
    const slot = Number(parseWith(organizationsLogoRemove.params, params).slot) as 1 | 2;
    const { previousKey } = await withTenant(this.db, req.auroraContext!, (s) =>
      removeOrganizationLogo(s, slot)
    );
    await this.arquivos.apagar(previousKey).catch(() => undefined);
    return { ok: true };
  }
}

const EXTENSAO: Readonly<Record<OrganizationLogo['content_type'], string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/** Confere os primeiros bytes contra o tipo declarado (PNG, JPEG, WebP). */
export function assinaturaConfere(tipo: string, b: Uint8Array): boolean {
  const comeca = (sig: number[], desde = 0) => sig.every((v, i) => b[desde + i] === v);
  if (tipo === 'image/png') return comeca([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (tipo === 'image/jpeg') return comeca([0xff, 0xd8, 0xff]);
  if (tipo === 'image/webp') return comeca([0x52, 0x49, 0x46, 0x46]) && comeca([0x57, 0x45, 0x42, 0x50], 8);
  return false;
}

/** O nome do arquivo é rótulo, nunca caminho. */
function nomeDoArquivo(bruto: string, extensao: string): string {
  const nome = [...bruto]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/"'.includes(c) ? '_' : c))
    .join('')
    .trim()
    .slice(0, 120);
  return nome.length > 0 ? nome : `logo${extensao}`;
}

function paraResposta(m: OrganizationLogoMeta, bytes: Uint8Array): OrganizationLogo {
  const tipo = (
    m.content_type in EXTENSAO ? m.content_type : 'image/png'
  ) as OrganizationLogo['content_type'];
  return {
    slot: m.slot,
    label: m.label,
    file_name: m.file_name,
    content_type: tipo,
    size: m.size,
    updated_at: m.updated_at,
    data_url: `data:${tipo};base64,${Buffer.from(bytes).toString('base64')}`,
  };
}
