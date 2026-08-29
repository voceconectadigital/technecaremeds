/**
 * Aurora — convite e vínculo (SPEC v0.2 §05 · §21 · EPIC-002).
 *
 * Esta suíte fecha a lacuna nº 1 do PROGRESS: até aqui, vínculo sem escopo era
 * possível, e só os auxiliares de teste garantiam a linha. O que se prova aqui
 * é que agora é o BANCO que garante — e que a função de convite faz tudo numa
 * transação só.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { provisionFactoryRoles } from '../rbac';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import {
  inviteMember,
  setMembershipScope,
  suspendMembership,
  listMembers,
  membershipsWithoutScope,
} from '../memberships';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'conv',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, unidade: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'conv', name: 'Prestadora', email: 'dona@conv.test', userName: 'Dona' }
  );

  await withTenant(t.db, ctx, async (s) => {
    await provisionFactoryRoles(s);
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede',
    });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

/* -------------------------------------------------------------------------- */

describe('o banco recusa vínculo sem escopo', () => {
  /** Pessoa criada pelo caminho de plataforma, ainda sem vínculo nenhum. */
  async function pessoaSolta(): Promise<string> {
    const id = newId();
    await t.raw(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [
      id,
      `solta-${id}@conv.test`,
      'Pessoa Solta',
    ]);
    return id;
  }

  it('inserir vínculo sozinho falha no COMMIT, e a mensagem diz o que fazer', async () => {
    const u = await pessoaSolta();
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(
          `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
           VALUES ($1, $2, $3, 'active', 'staff', false)`,
          [newId(), ORG, u]
        )
      )
    ).rejects.toThrow(/sem escopo/);
  });

  it('o vínculo recusado não sobra no banco', async () => {
    // A verificação é diferida: a linha CHEGOU a existir dentro da transação.
    // O que importa é que nada dela sobreviva ao COMMIT recusado.
    expect(await withTenant(t.db, ctx, (s) => membershipsWithoutScope(s))).toEqual([]);
  });

  it('vínculo e escopo na mesma transação passam', async () => {
    const u = await pessoaSolta();
    const novoMem = newId();

    await withTenant(t.db, ctx, async (s) => {
      await s.query(
        `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
         VALUES ($1, $2, $3, 'active', 'staff', false)`,
        [novoMem, ORG, u]
      );
      await s.query(`INSERT INTO aurora.membership_scopes (membership_id, organization_id) VALUES ($1, $2)`, [
        novoMem,
        ORG,
      ]);
    });

    expect(await withTenant(t.db, ctx, (s) => membershipsWithoutScope(s))).toEqual([]);
  });

  it('apagar o escopo de um vínculo vivo é recusado', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`DELETE FROM aurora.membership_scopes WHERE membership_id = $1`, [MEM])
      )
    ).rejects.toThrow(/não se apaga/);
  });
});

describe('convite', () => {
  let convidado: string;

  it('cria usuário, vínculo, escopo e papel de uma vez', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      inviteMember(s, {
        email: 'Joao.Silva@Conv.Test',
        name: 'João Silva',
        roleKeys: ['technician'],
        dailyHours: 8,
      })
    );
    convidado = r.membershipId;
    expect(r.reusedUser).toBe(false);

    const membros = await withTenant(t.db, ctx, (s) => listMembers(s));
    const joao = membros.find((m) => m.membership_id === convidado)!;
    // O e-mail é normalizado: buscar por endereço não pode depender da caixa.
    expect(joao.email).toBe('joao.silva@conv.test');
    expect(joao.roles).toEqual(['technician']);
    expect(joao.customer_scope).toBe('all');
  });

  it('nunca deixa vínculo sem escopo, nem em lote', async () => {
    for (let i = 0; i < 5; i++) {
      await withTenant(t.db, ctx, (s) =>
        inviteMember(s, { email: `lote${i}@conv.test`, name: `Pessoa ${i}` })
      );
    }
    expect(await withTenant(t.db, ctx, (s) => membershipsWithoutScope(s))).toEqual([]);
  });

  it('a falha no meio não deixa usuário órfão — a transação inteira volta atrás', async () => {
    const antes = await withTenant(t.db, ctx, (s) =>
      s.query<{ total: string }>(`SELECT count(*)::text AS total FROM aurora.users`)
    );

    await expect(
      withTenant(t.db, ctx, (s) =>
        inviteMember(s, {
          email: 'orfao@conv.test',
          name: 'Órfão',
          // Papel inexistente: falha DEPOIS de criar usuário, vínculo e escopo.
          roleKeys: ['papel_que_nao_existe'],
        })
      )
    ).rejects.toThrow(/não existe/);

    const depois = await withTenant(t.db, ctx, (s) =>
      s.query<{ total: string }>(`SELECT count(*)::text AS total FROM aurora.users`)
    );
    expect(depois[0]!.total).toBe(antes[0]!.total);

    const achou = await withTenant(t.db, ctx, (s) =>
      s.query(`SELECT id FROM aurora.users WHERE email = 'orfao@conv.test'`)
    );
    expect(achou).toEqual([]);
  });

  it('o mesmo e-mail em outra organização reaproveita a pessoa', async () => {
    const ORG2 = newId(),
      U2 = newId(),
      M2 = newId();
    await seedOrganization(
      t,
      { organizationId: ORG2, userId: U2, membershipId: M2 },
      { slug: 'conv2', name: 'Outra', email: 'dono2@conv.test', userName: 'Dono2' }
    );
    const ctx2 = buildContext({
      organizationId: ORG2,
      actorId: U2,
      membershipId: M2,
      requestId: 'conv2',
      permissions: PERMISSION_KEYS,
    });

    const r = await withTenant(t.db, ctx2, (s) =>
      inviteMember(s, { email: 'joao.silva@conv.test', name: 'João Silva' })
    );
    // Uma pessoa, dois vínculos: é o que faz o seletor de organização mostrar
    // as duas em vez de metade.
    expect(r.reusedUser).toBe(true);
    expect(r.membershipId).not.toBe(convidado);
  });

  it('convidar duas vezes na mesma organização é recusado, com a razão certa', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => inviteMember(s, { email: 'joao.silva@conv.test', name: 'João Silva' }))
    ).rejects.toThrow(/já faz parte desta organização/);
  });

  it('e-mail inválido e nome vazio são recusados antes de tocar o banco', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => inviteMember(s, { email: 'nao-e-email', name: 'Alguém' }))
    ).rejects.toThrow(/e-mail válido/);

    await expect(
      withTenant(t.db, ctx, (s) => inviteMember(s, { email: 'x@conv.test', name: ' ' }))
    ).rejects.toThrow(/nome de quem está sendo convidado/);
  });

  it('escopo "listed" com lista vazia é recusado — seria um vínculo cego por engano', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        inviteMember(s, {
          email: 'cego@conv.test',
          name: 'Cego',
          scope: { locationScope: 'listed', locationIds: [] },
        })
      )
    ).rejects.toThrow(/exige ao menos um local/);
  });

  it('convite com escopo restrito grava o escopo pedido', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      inviteMember(s, {
        email: 'restrito@conv.test',
        name: 'Restrito',
        scope: { locationScope: 'listed', locationIds: [unidade] },
      })
    );

    const [linha] = await withTenant(t.db, ctx, (s) =>
      s.query<{ location_scope: string; location_ids: string[] }>(
        `SELECT location_scope::text, location_ids FROM aurora.membership_scopes WHERE membership_id = $1`,
        [r.membershipId]
      )
    );
    expect(linha!.location_scope).toBe('listed');
    expect(linha!.location_ids).toEqual([unidade]);
  });
});

describe('ajuste de escopo', () => {
  it('altera sem apagar', async () => {
    const membros = await withTenant(t.db, ctx, (s) => listMembers(s));
    const alvo = membros.find((m) => m.email === 'lote0@conv.test')!;

    await withTenant(t.db, ctx, (s) =>
      setMembershipScope(s, alvo.membership_id, {
        customerScope: 'listed',
        customerIds: [cliente],
      })
    );

    const [linha] = await withTenant(t.db, ctx, (s) =>
      s.query<{ customer_scope: string; customer_ids: string[] }>(
        `SELECT customer_scope::text, customer_ids FROM aurora.membership_scopes WHERE membership_id = $1`,
        [alvo.membership_id]
      )
    );
    expect(linha!.customer_scope).toBe('listed');
    expect(linha!.customer_ids).toEqual([cliente]);
  });

  it('vínculo inexistente é recusado', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => setMembershipScope(s, newId(), { customerScope: 'all' }))
    ).rejects.toThrow(/não encontrado/);
  });
});

describe('encerramento', () => {
  it('desativa em vez de apagar — a trilha continua tendo dono', async () => {
    const membros = await withTenant(t.db, ctx, (s) => listMembers(s));
    const alvo = membros.find((m) => m.email === 'lote1@conv.test')!;

    await withTenant(t.db, ctx, (s) => suspendMembership(s, alvo.membership_id, 'saiu da empresa em agosto'));

    const depois = await withTenant(t.db, ctx, (s) => listMembers(s));
    const encerrado = depois.find((m) => m.membership_id === alvo.membership_id)!;
    expect(encerrado).toBeDefined();
    expect(encerrado.status).toBe('suspended');
  });

  it('exige motivo', async () => {
    const membros = await withTenant(t.db, ctx, (s) => listMembers(s));
    const alvo = membros.find((m) => m.email === 'lote2@conv.test')!;

    await expect(withTenant(t.db, ctx, (s) => suspendMembership(s, alvo.membership_id, 'x'))).rejects.toThrow(
      /motivo/
    );
  });

  it('o último proprietário ativo não pode ser encerrado', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => suspendMembership(s, MEM, 'tentativa de encerrar o único dono'))
    ).rejects.toThrow(/último proprietário ativo/);
  });
});

describe('isolamento', () => {
  it('a lista de membros é da organização de quem pergunta', async () => {
    const ORG3 = newId(),
      U3 = newId(),
      M3 = newId();
    await seedOrganization(
      t,
      { organizationId: ORG3, userId: U3, membershipId: M3 },
      { slug: 'conv3', name: 'Terceira', email: 'dono3@conv.test', userName: 'Dono3' }
    );
    const ctx3 = buildContext({
      organizationId: ORG3,
      actorId: U3,
      membershipId: M3,
      requestId: 'conv3',
      permissions: PERMISSION_KEYS,
    });

    const membros = await withTenant(t.db, ctx3, (s) => listMembers(s));
    expect(membros).toHaveLength(1);
    expect(membros[0]!.email).toBe('dono3@conv.test');
  });
});
