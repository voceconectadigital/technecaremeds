/**
 * Aurora — pedidos da Store (conversa com o cliente, 21/10/2026).
 *
 * JSON para o pedido e o acompanhamento; CORPO CRU para a nota fiscal (`PUT/GET .../invoice`), pelo
 * mesmo motivo e com as mesmas defesas dos certificados de qualidade: tipo restrito (PDF e imagem),
 * teto de 10 MB, nome do arquivo que nunca vira caminho, `nosniff` no download, e o registro conferido
 * (existe E é visível a quem pede) ANTES de qualquer byte ser gravado.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  withTenant,
  createStoreOrder,
  listStoreOrders,
  getStoreOrder,
  changeStoreOrderStatus,
  setStoreOrderInvoice,
  getStoreOrderInvoice,
  STORE_ORDER_STATUSES,
  type Database,
  type StoreOrderStatus,
} from '@aurora/db';
import { ForbiddenError, NotFoundError, ValidationError } from '@aurora/domain';
import { storeOrderCancel, storeOrderStatus, storeOrdersCreate } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { RequirePermissions } from '../common/permissions.guard';
import { uuidParam } from '../common/params';
import { ARQUIVOS, DATABASE } from '../common/tokens';
import { sha256De } from '../common/arquivos/disco';
import type { ArmazenamentoDeObjetos } from '../common/arquivos/porta';
import type { AuroraRequest } from '../common/context.middleware';
import { MAX_CERTIFICADO, TIPOS_DE_CERTIFICADO } from '../quality/quality.controller';

function meuVinculo(req: AuroraRequest): string {
  const id = req.auroraContext?.membershipId;
  if (!id) throw new ForbiddenError('esta rota exige um vínculo com a organização');
  return id;
}

function nomeSeguro(bruto: string | undefined, extensao: string): string {
  let nome = '';
  try {
    nome = decodeURIComponent(bruto ?? '');
  } catch {
    nome = '';
  }
  nome = [...nome]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/"'.includes(c) ? '_' : c))
    .join('')
    .trim()
    .slice(0, 120);
  return nome.length > 0 ? nome : `nota-fiscal${extensao}`;
}

@Controller('store-orders')
export class StoreOrdersController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ARQUIVOS) private readonly arquivos: ArmazenamentoDeObjetos
  ) {}

  @Get()
  @RequirePermissions('store.read')
  async list(
    @Req() req: AuroraRequest,
    @Query('status') status?: string,
    @Query('customer') customer?: string
  ): Promise<{ items: unknown[] }> {
    const eu = meuVinculo(req);
    if (status !== undefined && !(STORE_ORDER_STATUSES as readonly string[]).includes(status)) {
      throw new ValidationError('situação desconhecida', { field: 'status' });
    }
    const items = await withTenant(this.db, req.auroraContext!, (s) =>
      listStoreOrders(s, eu, {
        status: (status as StoreOrderStatus | undefined) ?? null,
        customerId: customer === undefined ? null : uuidParam(customer, 'customer'),
      })
    );
    return { items };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('store.request_quote')
  async create(@Req() req: AuroraRequest, @Body() body: unknown): Promise<{ id: string; number: string }> {
    const eu = meuVinculo(req);
    const b = parseWith(storeOrdersCreate.body, body);
    return withTenant(this.db, req.auroraContext!, async (s) => {
      // O cliente vem do VÍNCULO. Quem alcança mais de um escolhe — mas só entre os do próprio escopo.
      const [meu] = await s.query<{ customer_id: string }>(
        `SELECT customer_id FROM aurora.accessible_customer_ids($1)
          ORDER BY (customer_id = $2) DESC NULLS LAST, customer_id LIMIT 1`,
        [eu, b.customer_id ?? null]
      );
      if (!meu || (b.customer_id && meu.customer_id !== b.customer_id)) {
        throw new ForbiddenError('store.customer');
      }
      return createStoreOrder(s, {
        customerId: meu.customer_id,
        requestedByMembershipId: eu,
        items: b.items.map((i) => ({ itemId: i.item_id, quantity: i.quantity })),
        note: b.note ?? null,
      });
    });
  }

  @Get(':id')
  @RequirePermissions('store.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const eu = meuVinculo(req);
    return withTenant(this.db, req.auroraContext!, (s) => getStoreOrder(s, eu, uuidParam(id, 'id')));
  }

  /** O cliente cancela o PRÓPRIO pedido, enquanto está "requested". */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('store.request_quote')
  async cancel(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ status: string }> {
    const eu = meuVinculo(req);
    const b = parseWith(storeOrderCancel.body, body);
    return withTenant(this.db, req.auroraContext!, (s) =>
      changeStoreOrderStatus(
        s,
        uuidParam(id, 'id'),
        { status: 'cancelled', note: b.reason },
        { membershipId: eu, canManage: false }
      )
    );
  }

  /** A prestadora leva o pedido adiante. */
  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('quote.update')
  async status(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ status: string }> {
    const eu = meuVinculo(req);
    const b = parseWith(storeOrderStatus.body, body);
    return withTenant(this.db, req.auroraContext!, (s) =>
      changeStoreOrderStatus(
        s,
        uuidParam(id, 'id'),
        { status: b.status, expectedDelivery: b.expected_delivery ?? null, note: b.note ?? null },
        { membershipId: eu, canManage: true }
      )
    );
  }

  /** Anexa a nota fiscal (corpo cru: PDF ou imagem, até 10 MB). Substitui a anterior. */
  @Put(':id/invoice')
  @RequirePermissions('quote.update')
  async uploadInvoice(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Headers('content-type') tipoCru: string | undefined,
    @Headers('x-aurora-file-name') nomeCru: string | undefined,
    @Headers('x-aurora-invoice-number') numeroCru: string | undefined
  ): Promise<{ invoice_number: string; file_name: string }> {
    const eu = meuVinculo(req);
    const orderId = uuidParam(id, 'id');
    const tipo = (tipoCru ?? '').split(';')[0]!.trim().toLowerCase();
    const extensao = TIPOS_DE_CERTIFICADO[tipo];
    if (!extensao)
      throw new ValidationError('a nota fiscal precisa ser PDF, PNG, JPEG ou WebP', {
        field: 'content-type',
      });
    let numero = '';
    try {
      numero = decodeURIComponent(numeroCru ?? '');
    } catch {
      numero = '';
    }
    if (numero.trim().length === 0) {
      throw new ValidationError('informe o número da nota fiscal (x-aurora-invoice-number)', {
        field: 'invoice_number',
      });
    }
    const corpo = (req as unknown as { body?: unknown }).body;
    if (!Buffer.isBuffer(corpo) || corpo.byteLength === 0) {
      throw new ValidationError('o corpo precisa ser o arquivo, em bytes', { field: 'body' });
    }
    if (corpo.byteLength > MAX_CERTIFICADO) {
      throw new ValidationError('arquivo grande demais (até 10 MB)', {
        field: 'body',
        maximo: MAX_CERTIFICADO,
      });
    }
    const bytes = new Uint8Array(corpo);
    const sha256 = sha256De(bytes);
    const nome = nomeSeguro(nomeCru, extensao);
    const ctx = req.auroraContext!;
    const chave = `orgs/${ctx.organizationId}/store/${orderId}/nf-${sha256.slice(0, 16)}${extensao}`;

    // 1) o pedido existe, é visível e aceita NF (confere o estado); 2) os bytes; 3) os metadados.
    await withTenant(this.db, ctx, (s) => getStoreOrder(s, eu, orderId));
    await this.arquivos.escrever(chave, 0, bytes);
    const { previousKey } = await withTenant(this.db, ctx, (s) =>
      setStoreOrderInvoice(s, eu, orderId, numero, {
        file_key: chave,
        file_name: nome,
        file_content_type: tipo,
        file_size: bytes.byteLength,
        sha256,
      })
    );
    if (previousKey && previousKey !== chave) await this.arquivos.apagar(previousKey).catch(() => undefined);
    return { invoice_number: numero.trim(), file_name: nome };
  }

  @Get(':id/invoice')
  @RequirePermissions('store.read')
  async downloadInvoice(
    @Req() req: AuroraRequest,
    @Res() res: Response,
    @Param('id') id: string
  ): Promise<void> {
    const eu = meuVinculo(req);
    const orderId = uuidParam(id, 'id');
    const meta = await withTenant(this.db, req.auroraContext!, (s) => getStoreOrderInvoice(s, eu, orderId));
    if (!meta) throw new NotFoundError('Nota fiscal', orderId);
    const bytes = await this.arquivos.ler(meta.file_key);
    if (!bytes) throw new NotFoundError('Nota fiscal', orderId);
    res.setHeader('content-type', meta.file_content_type ?? 'application/octet-stream');
    res.setHeader('content-length', String(bytes.byteLength));
    res.setHeader(
      'content-disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(meta.file_name)}`
    );
    res.setHeader('x-content-type-options', 'nosniff');
    res.status(200).end(Buffer.from(bytes));
  }
}
