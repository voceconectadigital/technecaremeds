/**
 * Téchne Care — o cliente da demonstração.
 *
 * O que estes testes protegem: que toda resposta gravada continua cabendo no
 * contrato (uma mudança de contrato sem nova captura quebraria a demonstração
 * em silêncio), que nenhuma escrita é aceita, e que a busca e os filtros
 * funcionam sobre as respostas locais.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as C from '@aurora/contracts';
import { ApiError, findOperation, type OperationDefinition } from '@aurora/contracts';
import { criarClienteDemo, MENSAGEM_SEM_ESCRITA } from '../cliente';
import dados from '../capturas.json';

const cliente = criarClienteDemo(0);
const chamar = (op: OperationDefinition, args?: Record<string, unknown>) =>
  cliente.call(op as never, args as never) as Promise<Record<string, unknown>>;

afterEach(() => {
  vi.useRealTimers();
});

describe('respostas gravadas', () => {
  it('toda captura cabe no contrato da operação', () => {
    const fora: string[] = [];
    for (const c of dados.capturas as unknown as Array<{ op: string; body: unknown }>) {
      const op = findOperation(c.op);
      expect(op, `operação ${c.op} existe`).toBeTruthy();
      // Sem lista de exceções: os quatro desvios API × contrato que a captura
      // registrava foram corrigidos no CONTRATO (a API estava certa).
      const r = op!.response.safeParse(c.body);
      if (!r.success) fora.push(`${c.op}: ${r.error.issues[0]?.message}`);
    }
    expect(fora).toEqual([]);
  });

  it('o quadro e a lista de OS respondem', async () => {
    const quadro = await chamar(C.workOrdersBoard);
    expect((quadro.columns as unknown[]).length).toBeGreaterThan(5);
    const lista = await chamar(C.workOrdersList, { query: { limit: 500 } });
    expect((lista.items as unknown[]).length).toBeGreaterThan(20);
  });

  it('filtra pelo campo de mesmo nome quando o filtro não foi capturado', async () => {
    const r = await chamar(C.workOrdersList, { query: { limit: 200, category: 'waiting' } });
    const itens = r.items as Array<{ category: string }>;
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.every((i) => i.category === 'waiting')).toBe(true);
  });

  it('respeita o limite pedido', async () => {
    const r = await chamar(C.requestsQueue, { query: { limit: 2 } });
    expect((r.items as unknown[]).length).toBe(2);
  });

  it('ficha inexistente é 404, como na API', async () => {
    await expect(
      chamar(C.workOrderDetail, { params: { id: '00000000-0000-7000-8000-000000000000' } })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('escrita', () => {
  it('todo comando é recusado com a mensagem da demonstração', async () => {
    const erro = await chamar(C.requestCreate, { body: { summary: 'x' } }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).problem.message).toBe(MENSAGEM_SEM_ESCRITA);
  });

  it('sair sempre dá certo', async () => {
    await expect(chamar(C.authLogout)).resolves.toEqual({ ok: true });
  });
});

describe('busca global', () => {
  it.each([
    ['WO-2026', 'work_order'],
    ['ventilador', 'asset'],
    ['PAT-0501', 'asset'],
    ['SR-2026', 'service_request'],
  ])('"%s" encontra %s', async (termo, escopo) => {
    const r = await chamar(C.searchGlobal, { query: { q: termo } });
    expect((r.hits as Array<{ scope: string }>).some((h) => h.scope === escopo)).toBe(true);
  });

  it('">" busca comandos de navegação', async () => {
    const r = await chamar(C.searchGlobal, { query: { q: '>agenda' } });
    expect(r.commandMode).toBe(true);
    expect((r.commands as Array<{ action: string }>).map((c) => c.action)).toContain('/agenda');
  });
});

describe('datas', () => {
  it('o que era passado na captura continua passado, em qualquer hora do dia', async () => {
    // Uma manhã cedo, dias depois da captura.
    const depois = new Date(dados.capturedAt);
    depois.setDate(depois.getDate() + 5);
    depois.setHours(6, 0, 0, 0);
    vi.useFakeTimers({ now: depois, toFake: ['Date'] });

    const c = criarClienteDemo(0);
    const r = (await c.call(C.requestsQueue as never, { query: { limit: 200 } } as never)) as {
      items: Array<{ created_at: string }>;
    };
    for (const i of r.items) expect(Date.parse(i.created_at)).toBeLessThanOrEqual(depois.getTime());
  });
});
