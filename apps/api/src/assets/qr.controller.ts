/**
 * Aurora — QR Code: rota pública e geração de etiquetas (SPEC v0.2 §07 · EPIC-006).
 *
 * `/q/{token}` é a única rota do sistema que responde sem sessão. Três decisões
 * a moldam:
 *
 * 1. **Fora do prefixo `/v1`.** O endereço vai impresso numa etiqueta que vai
 *    ficar colada num equipamento por dez anos. Versão de API numa etiqueta
 *    física é uma promessa que não temos como cumprir.
 *
 * 2. **Resposta idêntica para token inexistente e para organização que não
 *    permite acesso anônimo.** Distinguir os dois transformaria a rota num
 *    oráculo: quem tivesse uma lista de tokens saberia quais existem.
 *
 * 3. **Limite de tentativas por origem.** O token tem 130 bits e não é
 *    adivinhável por força bruta, mas a rota é pública e sem custo para quem
 *    chama; o limite existe para o serviço, não para o segredo.
 */
import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { withTenant, withPlatformSession, type Database, type SqlClient } from '@aurora/db';
import { isQrToken, generateQrToken, isUuid, ValidationError, RateLimitedError, NotFoundError } from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';
import { AttemptLimiter } from '../common/attempt-limiter';

interface QrResolution {
  organization: string;
  asset_label: string;
  asset: { name: string; category: string; location: string | null; retired: boolean };
  can_open_request: boolean;
}

@Controller()
export class QrController {
  private readonly limiter = new AttemptLimiter();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Resolução pública.
   *
   * Sem contexto de tenant — a consulta vai pela função SECURITY DEFINER da
   * migration 0017, exatamente como a resolução de identidade no login.
   */
  @Get('q/:token')
  async resolve(@Req() req: AuroraRequest, @Param('token') token: string): Promise<QrResolution> {
    // A chave é o endereço do soquete, NÃO `x-forwarded-for`.
    //
    // `x-forwarded-for` é escrito pelo cliente. Chavear o limite nele daria um
    // limitador que qualquer laço de shell contorna trocando o cabeçalho a cada
    // requisição — pior que não ter, porque pareceria proteger. Atrás de um
    // proxy confiável, a tradução correta é configurar `trust proxy` no Express,
    // que é o que faz `req.ip` passar a valer; até lá, o soquete é o que existe
    // de verdade.
    const origem = req.ip ?? 'desconhecida';
    if (!this.limiter.allow(origem)) {
      throw new RateLimitedError('Muitas tentativas; aguarde um minuto.', this.limiter.retryAfterSeconds(origem));
    }

    // Token malformado nem chega ao banco, e responde igual a token inexistente.
    if (!isQrToken(token)) throw new NotFoundError('Etiqueta');

    const rows = await withPlatformSession(this.db, (c: SqlClient) =>
      c.query<{
        organization_name: string;
        asset_label: string;
        asset_name: string;
        category_name: string;
        location_name: string | null;
        is_retired: boolean;
        allows_anonymous: boolean;
      }>('SELECT * FROM aurora.resolve_qr_token($1)', [token])
    );

    const found = rows[0];
    // Mesma resposta nos dois casos: não existir e não permitir.
    if (!found || !found.allows_anonymous) throw new NotFoundError('Etiqueta');

    return {
      organization: found.organization_name,
      asset_label: found.asset_label,
      asset: {
        name: found.asset_name,
        category: found.category_name,
        location: found.location_name,
        retired: found.is_retired,
      },
      can_open_request: !found.is_retired,
    };
  }

  /**
   * Dados de etiqueta em lote.
   *
   * Devolve o conteúdo, não o desenho: quem compõe a folha é a interface, que
   * sabe o tamanho do papel e a impressora. Gerar PDF aqui amarraria o formato
   * do adesivo a um deploy do servidor.
   *
   * É POST para uma leitura, e isso é deliberado. A folha de etiquetas nasce de
   * uma seleção que pode ter centenas de itens; quinhentos uuid numa query
   * string dão dezoito mil caracteres, e o Node recusa a requisição com 431
   * antes de qualquer código nosso rodar — foi assim que este teste descobriu.
   * A alternativa seria limitar o lote ao que cabe numa URL, o que resolveria o
   * erro estreitando o produto.
   *
   * Caminho próprio, e não `assets/labels`: aquele colidiria com
   * `GET /assets/:id`, e qual dos dois ganha dependeria da ordem em que os
   * controllers foram registrados no módulo. Rota cuja resolução depende de
   * ordem de declaração é rota que quebra na próxima refatoração.
   */
  @Post('labels')
  @RequirePermissions('asset.print_label')
  async labels(@Req() req: AuroraRequest, @Body() body: { ids?: unknown }): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((x) => typeof x === 'string') : [];
    if (ids.length === 0) {
      throw new ValidationError('informe a lista de ids em "ids"', { field: 'ids' });
    }
    if (ids.length > 500) {
      throw new ValidationError('no máximo 500 etiquetas por folha', { field: 'ids', max: 500 });
    }
    for (const id of ids as string[]) {
      if (!isUuid(id)) throw new ValidationError(`identificador inválido: ${id}`, { field: 'ids' });
    }

    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT a.id, a.name, a.tag, a.asset_number, a.qr_token,
                c.name AS category_name, l.name AS location_name
           FROM aurora.assets a
           JOIN aurora.asset_categories c ON c.id = a.asset_category_id
           LEFT JOIN aurora.locations l   ON l.id = a.location_id
          WHERE a.id = ANY($1::uuid[]) AND a.deleted_at IS NULL
          ORDER BY l.name NULLS LAST, a.name`,
        [ids]
      )
    );
    return { items };
  }

  /**
   * Troca o token de um ativo.
   *
   * Invalida a etiqueta antiga imediatamente — é o que se faz quando uma
   * etiqueta é fotografada e o registro foi divulgado. Devolve o token
   * anterior para que quem operou consiga identificar a etiqueta a recolher.
   */
  @Post('assets/:id/rotate-qr')
  @RequirePermissions('asset.print_label')
  async rotate(
    @Req() req: AuroraRequest,
    @Param('id') id: string
  ): Promise<{ previous_token: string; qr_token: string }> {
    const ctx = req.auroraContext!;
    if (!isUuid(id)) throw new ValidationError('id deve ser um identificador válido', { field: 'id' });
    const novo = generateQrToken((n) => new Uint8Array(randomBytes(n)));
    const [row] = await withTenant(this.db, ctx, (s) =>
      s.query<{ previous: string }>(`SELECT aurora.rotate_qr_token($1, $2) AS previous`, [id, novo])
    );
    return { previous_token: row!.previous, qr_token: novo };
  }
}
