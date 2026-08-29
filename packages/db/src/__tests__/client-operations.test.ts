/**
 * Aurora — a espinha da sincronização offline (EPIC-014 · SPEC §20).
 *
 * O que estas provas perseguem é uma frase da SPEC: "reenviar a mesma operação
 * nunca duplica registro". E a que vem depois, mais difícil de garantir: "nunca
 * descartar trabalho em silêncio".
 *
 * A duplicata é fácil de testar e fácil de acreditar que está resolvida. O que
 * é traiçoeiro são os quase-acertos: a retentativa que devolve sucesso sem ter
 * feito nada, a resposta de outra pessoa entregue por engano, o conflito que
 * some junto com a transação que o causou. Cada um deles tem prova própria
 * aqui, porque cada um deles é uma forma diferente de perder trabalho.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { createTestDatabase, seedOrganization, seedMember, type TestDatabase } from '../testing/harness';
import { withTenant } from '../client';
import {
  withClientOperation,
  recordClientConflict,
  pendingConflicts,
  resolveClientConflict,
  digestOfBody,
  ClientOperationMismatchError,
  ClientOperationOwnershipError,
} from '../client-operations';

let h: TestDatabase;

const ORG = newId();
const USER_A = newId();
const MEM_A = newId();
const USER_B = newId();
const MEM_B = newId();

const ctxA = buildContext({
  organizationId: ORG,
  actorId: USER_A,
  membershipId: MEM_A,
  requestId: 'op-a',
  permissions: PERMISSION_KEYS,
});
const ctxB = buildContext({
  organizationId: ORG,
  actorId: USER_B,
  membershipId: MEM_B,
  requestId: 'op-b',
  permissions: PERMISSION_KEYS,
});

beforeAll(async () => {
  h = await createTestDatabase();

  await seedOrganization(
    h,
    { organizationId: ORG, userId: USER_A, membershipId: MEM_A },
    { slug: 'ops', name: 'Ops', email: 'a@ops.test', userName: 'Técnico A' }
  );
  await seedMember(
    h,
    { organizationId: ORG, userId: USER_B, membershipId: MEM_B },
    { email: 'b@ops.test', userName: 'Técnico B' }
  );
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('impressão digital do corpo', () => {
  it('não depende da ordem das chaves', () => {
    /*
     * Sem isto, um cliente que passasse a montar o objeto noutra ordem — o que
     * acontece numa refatoração qualquer — veria toda retentativa ser acusada de
     * ser outra operação. A pessoa em campo receberia recusa por um comando que
     * ela mandou uma vez só.
     */
    expect(digestOfBody({ a: 1, b: { c: 2, d: 3 } })).toBe(digestOfBody({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('muda quando o conteúdo muda, inclusive em campo aninhado', () => {
    expect(digestOfBody({ a: 1, b: { c: 2 } })).not.toBe(digestOfBody({ a: 1, b: { c: 3 } }));
  });

  it('distingue ausência de nulo em campo de topo', () => {
    // "não mandei o campo" e "mandei o campo vazio" são decisões diferentes do
    // técnico, e a segunda apaga o que estava lá.
    expect(digestOfBody({ a: 1 })).not.toBe(digestOfBody({ a: 1, obs: null }));
  });
});

describe('a operação executa no máximo uma vez', () => {
  it('a segunda tentativa devolve o desfecho da primeira sem executar de novo', async () => {
    const op = { id: newId(), route: 'POST /work-orders', body: { titulo: 'Bomba parada' } };
    let execucoes = 0;

    const primeira = await withClientOperation(h.db, ctxA, op, async () => {
      execucoes++;
      return { id: 'os-1', numero: 'OS-0001' };
    });

    const segunda = await withClientOperation(h.db, ctxA, op, async () => {
      execucoes++;
      return { id: 'os-2', numero: 'OS-0002' };
    });

    expect(execucoes).toBe(1);
    expect(primeira).toEqual({ replayed: false, value: { id: 'os-1', numero: 'OS-0001' } });
    expect(segunda.replayed).toBe(true);
    // O desfecho da PRIMEIRA, e não o da segunda: o técnico recebe o número que
    // já existe, e não um segundo número para a mesma OS.
    expect(segunda).toMatchObject({ body: { id: 'os-1', numero: 'OS-0001' } });
  });

  it('a falha da operação NÃO deixa reserva: a retentativa executa de verdade', async () => {
    /*
     * A ARMADILHA QUE ESTA PROVA GUARDA.
     *
     * Se a reserva fosse gravada fora da transação do trabalho, uma falha
     * deixaria "já fiz isso" registrado para algo que nunca aconteceu — e a
     * retentativa receberia sucesso por trabalho nenhum. É a forma mais cruel de
     * perder trabalho: o aparelho apaga da fila, satisfeito.
     */
    const op = { id: newId(), route: 'POST /work-orders', body: { titulo: 'Falha' } };
    let tentativas = 0;

    await expect(
      withClientOperation(h.db, ctxA, op, async () => {
        tentativas++;
        throw new Error('o banco caiu no meio');
      })
    ).rejects.toThrow('o banco caiu no meio');

    const depois = await withClientOperation(h.db, ctxA, op, async () => {
      tentativas++;
      return { ok: true };
    });

    expect(tentativas).toBe(2);
    expect(depois).toEqual({ replayed: false, value: { ok: true } });
  });

  it('o mesmo identificador com outro conteúdo é RECUSADO, e não confundido', async () => {
    const id = newId();
    await withClientOperation(
      h.db,
      ctxA,
      { id, route: 'POST /work-orders', body: { titulo: 'Primeiro' } },
      async () => ({ id: 'os-1' })
    );

    /*
     * Devolver a resposta guardada aqui seria o pior desfecho possível: o
     * cliente concluiria que "Segundo" foi aplicado, apagaria da fila, e o
     * trabalho sumiria sem ninguém ver. Recusar alto é o que preserva.
     */
    await expect(
      withClientOperation(
        h.db,
        ctxA,
        { id, route: 'POST /work-orders', body: { titulo: 'Segundo' } },
        async () => ({ id: 'os-2' })
      )
    ).rejects.toBeInstanceOf(ClientOperationMismatchError);
  });

  it('o mesmo identificador vindo de outra pessoa é recusado', async () => {
    const op = { id: newId(), route: 'POST /work-orders', body: { titulo: 'Meu' } };
    await withClientOperation(h.db, ctxA, op, async () => ({ id: 'os-1' }));

    // Entregar a resposta de A para B seria vazar o resultado do trabalho de
    // outra pessoa — e, do lado de B, confirmar algo que ele não fez.
    await expect(withClientOperation(h.db, ctxB, op, async () => ({ id: 'os-2' }))).rejects.toBeInstanceOf(
      ClientOperationOwnershipError
    );
  });

  it('o efeito no banco e a marca da operação aparecem juntos', async () => {
    /*
     * A prova de atomicidade: a operação grava um cliente de verdade. Se a
     * reserva e o trabalho estivessem em transações diferentes, existiria um
     * instante com um sem o outro — e a retentativa nesse instante duplicaria.
     */
    const op = { id: newId(), route: 'POST /customers', body: { nome: 'Hospital Atômico' } };
    const clienteId = newId();

    await withClientOperation(h.db, ctxA, op, async (s) => {
      await s.query(
        `INSERT INTO aurora.customers (id, organization_id, name, is_internal)
         VALUES ($1, aurora.current_organization_id(), $2, true)`,
        [clienteId, 'Hospital Atômico']
      );
      return { id: clienteId };
    });

    const linhas = await h.raw(
      `SELECT c.id
         FROM aurora.customers c
         JOIN aurora.client_operations o ON o.client_operation_id = $1
        WHERE c.id = $2 AND o.state = 'succeeded'`,
      [op.id, clienteId]
    );
    expect(linhas).toHaveLength(1);
  });
});

describe('o conflito preserva o trabalho, e aparece', () => {
  it('o corpo recusado é guardado, e a transação que falhou não o leva junto', async () => {
    /*
     * O CENÁRIO DA SPEC, LITERAL: "OS cancelada no servidor durante execução
     * offline gera conflito visível, com o trabalho do técnico preservado e
     * recuperável".
     *
     * A transação do trabalho foi revertida — é o que "conflito" significa. Se
     * a preservação vivesse dentro dela, ela teria sumido junto, e a SPEC
     * estaria cumprida no papel e violada na prática.
     */
    const op = {
      id: newId(),
      route: 'POST /work-orders/:id/complete',
      body: {
        diagnostico: 'Válvula de exalação com fissura',
        resolucao: 'Substituída; teste de estanqueidade aprovado',
        horas: 2.5,
      },
    };

    await recordClientConflict(h.db, ctxA, op, {
      code: 'invalid_transition',
      message: 'A OS foi cancelada às 14h12 por Ana Coordenadora.',
      status: 409,
    });

    const pendentes = await withTenant(h.db, ctxA, (s) => pendingConflicts(s, MEM_A));
    const meu = pendentes.find((p) => p.clientOperationId === op.id);

    expect(meu).toBeDefined();
    expect(meu!.conflictCode).toBe('invalid_transition');
    // O TRABALHO INTEIRO, e não um resumo: é dele que o técnico vai recuperar o
    // que escreveu.
    expect(meu!.requestBody).toEqual(op.body);
    expect(meu!.conflictMessage).toContain('cancelada');
  });

  it('a retentativa de uma operação que conflitou devolve o conflito, e não executa', async () => {
    const op = { id: newId(), route: 'POST /work-orders/:id/complete', body: { horas: 1 } };
    await recordClientConflict(h.db, ctxA, op, {
      code: 'invalid_transition',
      message: 'A OS já foi fechada.',
      status: 409,
    });

    let executou = false;
    const r = await withClientOperation(h.db, ctxA, op, async () => {
      executou = true;
      return { ok: true };
    });

    expect(executou).toBe(false);
    expect(r).toMatchObject({ replayed: true, status: 409 });
  });

  it('tratar o conflito o tira da tela, e deixa o rastro da operação que o substituiu', async () => {
    const op = { id: newId(), route: 'POST /work-orders/:id/complete', body: { horas: 3 } };
    const nova = newId();

    await recordClientConflict(h.db, ctxA, op, {
      code: 'conflict',
      message: 'Saldo insuficiente no almoxarifado.',
      status: 409,
    });

    const tratou = await withTenant(h.db, ctxA, (s) =>
      resolveClientConflict(s, {
        clientOperationId: op.id,
        membershipId: MEM_A,
        supersededBy: nova,
      })
    );
    expect(tratou).toBe(true);

    const pendentes = await withTenant(h.db, ctxA, (s) => pendingConflicts(s, MEM_A));
    expect(pendentes.map((p) => p.clientOperationId)).not.toContain(op.id);

    // O rastro FICA. Sem ele, "o que aconteceu com aquele trabalho?" não tem
    // resposta seis meses depois — e a tela de atenção viraria um lixo que se
    // esvazia sem deixar história.
    const [linha] = await h.raw(
      `SELECT superseded_by::text AS nova, resolved_at IS NOT NULL AS tratado
         FROM aurora.client_operations WHERE client_operation_id = $1`,
      [op.id]
    );
    expect(linha).toMatchObject({ nova, tratado: true });
  });

  it('tratar duas vezes não conta duas: a segunda diz que não havia o que tratar', async () => {
    const op = { id: newId(), route: 'POST /x', body: {} };
    await recordClientConflict(h.db, ctxA, op, { code: 'conflict', message: 'x', status: 409 });

    const um = await withTenant(h.db, ctxA, (s) =>
      resolveClientConflict(s, { clientOperationId: op.id, membershipId: MEM_A })
    );
    const dois = await withTenant(h.db, ctxA, (s) =>
      resolveClientConflict(s, { clientOperationId: op.id, membershipId: MEM_A })
    );
    expect([um, dois]).toEqual([true, false]);
  });

  it('a tela de atenção é de quem trabalhou: o conflito de A não aparece para B', async () => {
    const op = { id: newId(), route: 'POST /y', body: { segredo: 'de A' } };
    await recordClientConflict(h.db, ctxA, op, { code: 'conflict', message: 'y', status: 409 });

    const deB = await withTenant(h.db, ctxB, (s) => pendingConflicts(s, MEM_B));
    expect(deB.map((p) => p.clientOperationId)).not.toContain(op.id);
  });
});

describe('o banco recusa linhas que não sabem dizer o que aconteceram', () => {
  it('sucesso não pode carregar código de conflito', async () => {
    await expect(
      h.raw(
        `INSERT INTO aurora.client_operations
           (organization_id, client_operation_id, membership_id, route, request_digest,
            state, response_status, conflict_code)
         VALUES ($1, $2, $3, 'POST /z', 'd', 'succeeded', 200, 'invalid_transition')`,
        [ORG, newId(), MEM_A]
      )
    ).rejects.toThrow();
  });

  it('conflito sem o corpo da requisição é impossível de gravar', async () => {
    // É a restrição que transforma "preservar o trabalho" de intenção em
    // garantia: uma versão futura deste código que esquecesse o corpo não
    // conseguiria gravar a linha.
    await expect(
      h.raw(
        `INSERT INTO aurora.client_operations
           (organization_id, client_operation_id, membership_id, route, request_digest,
            state, response_status, conflict_code, conflict_message)
         VALUES ($1, $2, $3, 'POST /z', 'd', 'conflicted', 409, 'conflict', 'x')`,
        [ORG, newId(), MEM_A]
      )
    ).rejects.toThrow();
  });
});
