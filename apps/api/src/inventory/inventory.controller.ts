/**
 * Aurora — estoque pela HTTP (SPEC v0.2 §15 · EPIC-015).
 *
 * O MODELO INTEIRO JÁ EXISTIA em `packages/db/src/inventory.ts` — saldo por
 * almoxarifado, reserva, consumo, devolução, transferência de duas pernas,
 * razão com sequência, estorno que não apaga. O que não existia era rota
 * nenhuma: o estoque era um subsistema completo e inalcançável.
 *
 * O QUE ESTE CONTROLLER DELIBERADAMENTE NÃO FAZ
 *
 * Não expõe `recordMovement` cru. Movimento de estoque tem SIGNIFICADO —
 * recebimento, ajuste, consumo, devolução, transferência — e cada um tem
 * regras diferentes sobre o que exige justificativa e o que atualiza custo
 * médio. Uma rota genérica "grave este movimento" transferiria essa decisão
 * para quem chama, e a primeira integração escreveria `adjustment` para tudo,
 * porque é a que não pede nada.
 *
 * O AJUSTE EXIGE MOTIVO, e é a única operação que altera saldo sem um fato
 * físico correspondente. Sem motivo, um inventário que não fecha vira um
 * ajuste anônimo, e a diferença entre furto, quebra e erro de lançamento —
 * que é a informação que interessa — desaparece.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  balances,
  ledger,
  adjust,
  transfer,
  reverseMovement,
  setMinimum,
  workOrderParts,
  consumeForWorkOrder,
  assertWarehouseVisible,
  assertCanExecuteWorkOrder,
  type Database,
} from '@aurora/db';
import { ValidationError } from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { optionalUuid, text, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import { runFieldOperation } from '../common/client-operation';
import type { AuroraRequest } from '../common/context.middleware';

/**
 * Quantidade positiva, lida de texto.
 *
 * Vem como texto e é validada como texto porque a coluna é `numeric`: aceitar
 * um `number` do JSON já teria passado o valor por ponto flutuante antes de
 * qualquer validação, e 0.1 + 0.2 em peça fracionada é uma diferença de
 * inventário que ninguém consegue explicar.
 */
function quantidade(valor: unknown, campo: string): string {
  const s = typeof valor === 'number' ? String(valor) : String(valor ?? '');
  if (!/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0) {
    throw new ValidationError(`${campo} deve ser uma quantidade positiva`, { field: campo });
  }
  return s;
}

@Controller('inventory')
export class InventoryController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Saldos por item e almoxarifado.
   *
   * `available` vem do banco como `on_hand - reserved`, e não é calculado na
   * tela: a peça reservada para a OS de amanhã está fisicamente na prateleira
   * e não está disponível, e uma tela que subtraísse por conta própria erraria
   * no dia em que a reserva mudasse de forma.
   */
  @Get('balances')
  @RequirePermissions('inventory.read')
  async balances(
    @Req() req: AuroraRequest,
    @Query('warehouse') warehouse?: string,
    @Query('below_minimum') belowMinimum?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) =>
      balances(s, {
        warehouseId: optionalUuid(warehouse, 'warehouse'),
        belowMinimum: belowMinimum === 'true',
        membershipId: ctx.membershipId,
        // `inventory.read_costs` passa a valer de fato (16/10/2026).
        withCosts: ctx.permissions.has('inventory.read_costs'),
      })
    );
    return { items: items.map(comEnderecoDaImagem) };
  }

  /**
   * Extrato de um item num almoxarifado.
   *
   * Do mais recente para o mais antigo, com `sequence`: é a ordem do razão, e
   * é ela — e não `occurred_at` — que responde "o que aconteceu depois do
   * quê" quando dois movimentos caem no mesmo instante.
   */
  @Get('ledger')
  @RequirePermissions('inventory.read')
  async ledger(
    @Req() req: AuroraRequest,
    @Query('item') item: string,
    @Query('warehouse') warehouse: string,
    @Query('limit') limit?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const itemId = uuidParam(item, 'item');
    const warehouseId = uuidParam(warehouse, 'warehouse');
    const max = Math.min(Number.parseInt(limit ?? '100', 10) || 100, 500);
    const items = await withTenant(this.db, ctx, async (s) => {
      // Almoxarifado de cliente fora do escopo → 404, como nas demais rotas.
      await assertWarehouseVisible(s, warehouseId, ctx.membershipId);
      // Custo unitário só com `inventory.read_costs`, como em `balances`.
      return ledger(s, itemId, warehouseId, max, ctx.permissions.has('inventory.read_costs'));
    });
    return { items };
  }

  /** As peças reservadas e consumidas numa OS, com o que ainda falta confirmar. */
  @Get('work-orders/:id/parts')
  @RequirePermissions('inventory.read')
  async parts(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const woId = uuidParam(id, 'id');
    const items = await withTenant(this.db, ctx, (s) => workOrderParts(s, woId));
    return { items };
  }

  /**
   * O TÉCNICO PEGOU A PEÇA. Reserva e baixa, numa transação só.
   *
   * O caminho de escritório é reservar antes e consumir depois — a reserva
   * segura o saldo entre "vou precisar" e "usei". Em campo isso não existe: a
   * pessoa está com a peça na mão e o fato já aconteceu. Obrigá-la a duas
   * chamadas produziria reservas órfãs toda vez que o segundo passo falhasse, e
   * o saldo ficaria preso sem ninguém saber por quê.
   *
   * A ATOMICIDADE É O PONTO. As duas operações rodam na mesma transação: ou o
   * consumo existe inteiro, ou o saldo fica como estava. Uma reserva sem
   * consumo é estoque bloqueado que ninguém liberou.
   *
   * E É AQUI QUE A SPEC PEDE CONFLITO VISÍVEL: "peça consumida offline que já
   * não existe no estoque — a operação entra em conflito visível, o saldo não
   * fica negativo, e o técnico escolhe outro almoxarifado ou registra
   * requisição". Quem garante que o saldo não fica negativo é a restrição do
   * banco; o que este método faz é deixar a recusa chegar como recusa, para a
   * fila do aparelho transformá-la em pendência de atenção com o trabalho
   * preservado.
   *
   * QUEM LANÇA PEÇA NA OS DE QUEM (PF-14). A rota é guardada por
   * `inventory.move`, que dois tipos de pessoa têm por motivos diferentes:
   *
   *   · o TÉCNICO/OPERADOR, que tem também `work_order.execute`: para ele,
   *     lançar a peça que usou é um ato de EXECUÇÃO da OS, e vale a mesma regra
   *     do check-in, do checklist e da conclusão — só na OS atribuída a ele ou à
   *     equipe dele, salvo `work_order.execute_any`. Sem isso, um técnico
   *     baixaria peça na OS de outro e o custo iria para a OS errada;
   *   · o ALMOXARIFE e o GESTOR, que não executam OS (não têm
   *     `work_order.execute`): para eles, é um movimento de estoque feito no
   *     balcão em nome da OS, e `assertCanExecuteWorkOrder` não os restringe
   *     (`executionRestrictedToAssignment` só alcança quem tem `execute` sem
   *     `execute_any`).
   *
   * Quem acumula os dois papéis num vínculo só fica com a regra mais estreita:
   * as permissões se somam e a pessoa é tratada como executora. Para lançar no
   * balcão em qualquer OS, ela recebe `work_order.execute_any` — a mesma
   * resposta que o coordenador já tem.
   */
  @Post('work-orders/:id/parts')
  @RequirePermissions('inventory.move')
  async consumirPeca(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ movement_id: string; reservation_id: string }> {
    const woId = uuidParam(id, 'id');
    const itemId = uuidParam(body.item_id, 'item_id');
    const warehouseId = uuidParam(body.warehouse_id, 'warehouse_id');

    const qty = Number(body.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ValidationError('a quantidade consumida deve ser um número positivo', {
        field: 'qty',
      });
    }

    const ctx = req.auroraContext!;
    return runFieldOperation(this.db, req, 'POST /work-orders/:id/parts', body, async (s) => {
      await assertCanExecuteWorkOrder(s, woId);
      await assertWarehouseVisible(s, warehouseId, ctx.membershipId);
      // Consome primeiro a reserva já aberta da OS (a da aprovação do
      // orçamento) e só reserva o que passar dela — senão a peça sai duas vezes
      // (aqui e no faturamento). Almoxarifado de outro cliente é recusado.
      const r = await consumeForWorkOrder(s, woId, itemId, warehouseId, qty);
      return { movement_id: r.movementId, reservation_id: r.reservationId };
    });
  }

  /**
   * Ajuste de saldo, com motivo obrigatório.
   *
   * É a única operação que muda o saldo sem um fato físico do outro lado.
   * Sem motivo, o inventário que não fecha vira um ajuste anônimo — e a
   * diferença entre furto, quebra e erro de lançamento, que é a informação que
   * interessa, desaparece junto.
   */
  @Post('adjustments')
  @RequirePermissions('inventory.adjust')
  async adjust(@Req() req: AuroraRequest, @Body() body: Record<string, unknown>): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const itemId = uuidParam(String(body.item_id ?? ''), 'item_id');
    const warehouseId = uuidParam(String(body.warehouse_id ?? ''), 'warehouse_id');

    // O ajuste pode ser negativo — é metade do seu propósito. Por isso a
    // validação aqui é diferente da de `quantidade`.
    const qtyBruta = body.qty;
    const qty = Number(qtyBruta);
    if (!Number.isFinite(qty) || qty === 0) {
      throw new ValidationError('qty deve ser um número diferente de zero', { field: 'qty' });
    }

    const motivo = text(body.reason);
    if (motivo === null || motivo.length < 5) {
      throw new ValidationError(
        'o ajuste exige motivo — sem ele, furto, quebra e erro de lançamento viram a mesma linha',
        { field: 'reason' }
      );
    }

    const id = await withTenant(this.db, ctx, async (s) => {
      await assertWarehouseVisible(s, warehouseId, ctx.membershipId);
      return adjust(s, itemId, warehouseId, qty, motivo);
    });
    return { id };
  }

  /**
   * Transferência entre almoxarifados.
   *
   * Duas pernas, uma operação: sai de um e entra no outro na MESMA transação.
   * Duas chamadas separadas deixariam a peça em lugar nenhum se a segunda
   * falhasse — e o estoque só descobriria isso no inventário seguinte.
   */
  @Post('transfers')
  @RequirePermissions('inventory.move')
  async transfer(
    @Req() req: AuroraRequest,
    @Body() body: Record<string, unknown>
  ): Promise<{ out_id: string; in_id: string }> {
    const ctx = req.auroraContext!;
    const itemId = uuidParam(String(body.item_id ?? ''), 'item_id');
    const de = uuidParam(String(body.from_warehouse_id ?? ''), 'from_warehouse_id');
    const para = uuidParam(String(body.to_warehouse_id ?? ''), 'to_warehouse_id');
    if (de === para) {
      throw new ValidationError('origem e destino são o mesmo almoxarifado', {
        field: 'to_warehouse_id',
      });
    }
    const qty = Number(quantidade(body.qty, 'qty'));

    const r = await withTenant(this.db, ctx, async (s) => {
      await assertWarehouseVisible(s, de, ctx.membershipId);
      await assertWarehouseVisible(s, para, ctx.membershipId);
      return transfer(s, itemId, de, para, qty, text(body.reason) ?? undefined);
    });
    return { out_id: r.out, in_id: r.in };
  }

  /**
   * Estorno de um movimento.
   *
   * Grava um movimento CONTRÁRIO apontando para o original, e não apaga nada.
   * Apagar deixaria o razão com um buraco: o saldo bateria e ninguém
   * conseguiria explicar por que a peça apareceu e sumiu.
   */
  @Post('movements/:id/reversal')
  @RequirePermissions('inventory.adjust')
  async reverse(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const movimentoId = uuidParam(id, 'id');
    const motivo = text(body.reason);
    if (motivo === null || motivo.length < 5) {
      throw new ValidationError('o estorno exige motivo', { field: 'reason' });
    }
    const novo = await withTenant(this.db, ctx, async (s) => {
      const [mov] = await s.query<{ warehouse_id: string }>(
        `SELECT warehouse_id FROM aurora.stock_movements WHERE id = $1`,
        [movimentoId]
      );
      if (mov) await assertWarehouseVisible(s, mov.warehouse_id, ctx.membershipId);
      return reverseMovement(s, movimentoId, motivo);
    });
    return { id: novo };
  }

  /**
   * Define o mínimo de um item num almoxarifado.
   *
   * O mínimo é por (item, almoxarifado) e não por item: a mesma peça pode ser
   * crítica na base que atende a UTI e dispensável no depósito central, e um
   * mínimo global geraria aviso onde não importa e silêncio onde importa.
   */
  @Post('minimums')
  @RequirePermissions('inventory.update')
  async minimum(@Req() req: AuroraRequest, @Body() body: Record<string, unknown>): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const itemId = uuidParam(String(body.item_id ?? ''), 'item_id');
    const warehouseId = uuidParam(String(body.warehouse_id ?? ''), 'warehouse_id');
    const min = Number(body.min_qty);
    if (!Number.isFinite(min) || min < 0) {
      throw new ValidationError('min_qty deve ser zero ou positivo', { field: 'min_qty' });
    }
    await withTenant(this.db, ctx, async (s) => {
      await assertWarehouseVisible(s, warehouseId, ctx.membershipId);
      await setMinimum(s, itemId, warehouseId, min);
    });
    return { ok: true };
  }
}

/* -------------------------------------------------------------------------- */

/**
 * A chave relativa do banco vira endereço aqui, e em nenhum outro lugar.
 *
 * É a mesma regra dos anexos (§28): a tela não sabe onde os bytes moram. Hoje
 * as imagens de catálogo são arquivos estáticos servidos junto da aplicação;
 * amanhã podem vir de um armazenamento de objetos com URL assinada. Quem muda
 * é esta função — nenhuma tela, nenhum contrato.
 *
 * A chave já é validada como RELATIVA por restrição de tabela (migration 0046),
 * então não há como uma URL externa chegar até aqui e virar um `src` que
 * entrega o endereço IP de quem abriu a tela a um terceiro. A barra é
 * acrescentada aqui porque a chave gravada não a tem: guardar "/x" e "x" nas
 * mesmas linhas seria a origem de uma barra dupla em metade dos endereços.
 */
function comEnderecoDaImagem<T extends { image_key: string | null }>(
  linha: T
): Omit<T, 'image_key'> & { image_url: string | null } {
  const { image_key, ...resto } = linha;
  return { ...resto, image_url: image_key ? `/${image_key.replace(/^\/+/, '')}` : null };
}
