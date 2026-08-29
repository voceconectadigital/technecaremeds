/**
 * Aurora — o registro de contratos (SPEC v0.2 §36).
 */
import { describe, it, expect } from 'vitest';
import {
  allOperations,
  findOperation,
  operationForRoute,
  normalizePath,
  toJsonSchema,
  ProblemDetails,
  PROBLEM_CODES,
  createApiClient,
  ApiError,
  membersInvite,
  meOrganizations,
} from '../index';

describe('registro', () => {
  it('todo identificador de operação é único e no formato dominio.acao', () => {
    const ids = allOperations().map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-zA-Z]*\.[a-zA-Z]+$/);
  });

  it('toda operação tem resumo e resposta', () => {
    for (const op of allOperations()) {
      expect(op.summary.length, op.operationId).toBeGreaterThan(5);
      expect(op.response, op.operationId).toBeDefined();
    }
  });

  it('caminho declarado nunca traz o prefixo de versão — quem põe é o bootstrap', () => {
    for (const op of allOperations()) {
      expect(op.path.startsWith('/v1'), op.operationId).toBe(false);
      expect(op.path.startsWith('/'), op.operationId).toBe(true);
    }
  });

  it('localiza pela rota, ignorando a restrição de formato do parâmetro', () => {
    const achado = operationForRoute('PATCH', '/organizations/current/members/:id([0-9a-fA-F-]{36})/scope');
    expect(achado?.operationId).toBe('members.setScope');
  });

  it('normalizar caminho não é normalizar caminho diferente', () => {
    expect(normalizePath('/a/:id([0-9]{2})/b')).toBe('/a/:id/b');
    expect(normalizePath('/a/:id/b')).toBe('/a/:id/b');
    expect(normalizePath('/a/:outro/b')).not.toBe('/a/:id/b');
  });

  it('encontra por identificador', () => {
    expect(findOperation('members.invite')).toBe(membersInvite);
    expect(findOperation('nao.existe')).toBeUndefined();
  });
});

describe('conversão para JSON Schema', () => {
  it('o problema do RFC 9457 vira esquema com os campos obrigatórios', () => {
    const js = toJsonSchema(ProblemDetails) as {
      required: string[];
      properties: Record<string, { enum?: string[] }>;
    };
    expect(js.required).toEqual(expect.arrayContaining(['code', 'message', 'request_id']));
    expect(js.properties.code!.enum).toEqual([...PROBLEM_CODES]);
  });

  it('toda operação registrada converte sem estourar', () => {
    for (const op of allOperations()) {
      expect(() => toJsonSchema(op.response, 'output'), op.operationId).not.toThrow();
      if (op.body) expect(() => toJsonSchema(op.body!), op.operationId).not.toThrow();
      if (op.query) expect(() => toJsonSchema(op.query!), op.operationId).not.toThrow();
    }
  });
});

describe('validação de entrada do convite', () => {
  const parse = (v: unknown) => membersInvite.body.safeParse(v);

  it('normaliza o e-mail — buscar por endereço não pode depender da caixa', () => {
    const r = parse({ email: '  Joao.Silva@Conv.TEST ', name: 'João' });
    expect(r.success && r.data.email).toBe('joao.silva@conv.test');
  });

  it('recusa escopo restrito com lista vazia, apontando o campo', () => {
    const r = parse({
      email: 'a@b.test',
      name: 'Alguém',
      location_scope: 'listed',
      location_ids: [],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(['location_ids']);
  });

  it('aceita escopo restrito com lista preenchida', () => {
    const r = parse({
      email: 'a@b.test',
      name: 'Alguém',
      location_scope: 'listed',
      location_ids: ['0193c8a0-0000-7000-8000-000000000001'],
    });
    expect(r.success).toBe(true);
  });
});

describe('cliente tipado', () => {
  function clienteFalso(resposta: {
    status: number;
    body: unknown;
    onRequest?: (url: string, init: RequestInit) => void;
  }) {
    const fetchFalso: typeof globalThis.fetch = async (url, init) => {
      resposta.onRequest?.(String(url), init ?? {});
      return {
        ok: resposta.status < 400,
        status: resposta.status,
        headers: new Headers(),
        json: async () => resposta.body,
      } as Response;
    };
    return createApiClient({
      baseUrl: 'http://api.test/v1',
      token: () => 'credencial',
      organizationId: () => '0193c8a0-0000-7000-8000-000000000002',
      fetch: fetchFalso,
    });
  }

  it('monta o endereço com o parâmetro no lugar certo', () => {
    const c = clienteFalso({ status: 200, body: {} });
    expect(c.urlFor(membersInvite, { body: { email: 'a@b.test', name: 'Alguém' } })).toBe(
      'http://api.test/v1/organizations/current/members'
    );
  });

  it('manda credencial e organização escolhida nos cabeçalhos', async () => {
    let visto: RequestInit = {};
    const c = clienteFalso({
      status: 200,
      body: { items: [] },
      onRequest: (_u, init) => {
        visto = init;
      },
    });
    await c.call(meOrganizations);

    const h = visto.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer credencial');
    // A organização é ESCOLHA entre as que a pessoa tem, nunca autorização: o
    // servidor confere o vínculo de qualquer forma.
    expect(h['x-aurora-organization']).toBe('0193c8a0-0000-7000-8000-000000000002');
  });

  it('erro do servidor vira ApiError com a permissão que falta', async () => {
    const c = clienteFalso({
      status: 403,
      body: {
        code: 'forbidden',
        message: 'falta organization.manage_members',
        request_id: 'req-1',
        details: { permission: 'organization.manage_members' },
      },
    });

    await expect(c.call(meOrganizations)).rejects.toBeInstanceOf(ApiError);
    try {
      await c.call(meOrganizations);
    } catch (e) {
      const erro = e as ApiError;
      expect(erro.isPermission).toBe(true);
      expect(erro.missingPermission).toBe('organization.manage_members');
      expect(erro.problem.request_id).toBe('req-1');
    }
  });

  it('resposta sem problem details ainda chega com a mesma forma de erro', async () => {
    const c = clienteFalso({ status: 502, body: '<html>proxy</html>' });
    try {
      await c.call(meOrganizations);
      throw new Error('deveria ter falhado');
    } catch (e) {
      const erro = e as ApiError;
      expect(erro).toBeInstanceOf(ApiError);
      expect(erro.problem.code).toBe('internal_error');
    }
  });

  it('resposta fora do contrato é recusada, e não repassada meio certa', async () => {
    const c = clienteFalso({ status: 200, body: { items: [{ slug: 'só isso' }] } });
    await expect(c.call(meOrganizations)).rejects.toThrow(/não corresponde ao contrato/);
  });

  it('parâmetro de caminho ausente falha antes de chamar a rede', () => {
    const c = clienteFalso({ status: 200, body: {} });
    expect(() =>
      // @ts-expect-error é exatamente o erro que o tipo impede — aqui provamos
      // que ele também é pego em tempo de execução, para quem chama de JS.
      c.urlFor(findOperation('members.setScope')!, {})
    ).toThrow(/parâmetro de caminho ausente: id/);
  });
});
