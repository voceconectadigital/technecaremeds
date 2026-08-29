/**
 * Aurora — diretório contra o banco (SPEC v0.2 §32, EPIC-003).
 *
 * Os critérios de aceite do épico estão aqui, um a um:
 *  - mover uma subárvore de 500 locais atualiza todos os caminhos e
 *    profundidades em uma transação
 *  - tipo inválido para o pai é recusado com mensagem que nomeia os permitidos
 *  - arquivar local com estrutura ativa abaixo é recusado com a lista
 * E os casos de borda: ciclo, profundidade acima do limite, cliente com um
 * único local raiz, local móvel sem endereço.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, locationDepth, parentIdFromPath } from '@aurora/domain';
import { withTenant } from '../client';
import {
  createCustomer,
  createLocation,
  createLocationType,
  provisionStarterLocationTypes,
  moveLocation,
  subtree,
  ancestors,
  archiveLocation,
  accessibleLocationIds,
  createSupplier,
  createTeam,
  addTeamMember,
  blockAvailability,
  isUnavailableAt,
} from '../directory';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG_A = newId(),
  USER_A = newId(),
  MEM_A = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();
const ctxA = buildContext({ organizationId: ORG_A, actorId: USER_A, requestId: 'dir-a' });
const ctxB = buildContext({ organizationId: ORG_B, actorId: USER_B, requestId: 'dir-b' });

let t: TestDatabase;
let types: Map<string, string>;
let customerA: string;
let customerB: string;
/** unidade → prédio → setor, montado uma vez e reaproveitado. */
let unidade1: string, unidade2: string, predio1: string, setor1: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: USER_A, membershipId: MEM_A },
    {
      slug: 'dir-a',
      name: 'Rede A',
      email: 'a@dir.test',
      userName: 'A',
    }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    {
      slug: 'dir-b',
      name: 'Rede B',
      email: 'b@dir.test',
      userName: 'B',
    }
  );

  await withTenant(t.db, ctxA, async (s) => {
    types = await provisionStarterLocationTypes(s);
    customerA = await createCustomer(s, { name: 'Hospital Central', isInternal: true });
    unidade1 = await createLocation(s, {
      customerId: customerA,
      locationTypeId: types.get('unidade')!,
      name: 'Unidade Norte',
    });
    unidade2 = await createLocation(s, {
      customerId: customerA,
      locationTypeId: types.get('unidade')!,
      name: 'Unidade Sul',
    });
    predio1 = await createLocation(s, {
      customerId: customerA,
      parentId: unidade1,
      locationTypeId: types.get('predio')!,
      name: 'Bloco A',
    });
    setor1 = await createLocation(s, {
      customerId: customerA,
      parentId: predio1,
      locationTypeId: types.get('setor')!,
      name: 'Ambulatório',
    });
  });

  await withTenant(t.db, ctxB, async (s) => {
    await provisionStarterLocationTypes(s);
    customerB = await createCustomer(s, { name: 'Clínica B' });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('caminho e profundidade são derivados pelo banco', () => {
  it('a aplicação escreve só o pai; path e depth saem do gatilho', async () => {
    const rows = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string; path: string; depth: number }>(
        'SELECT id, path, depth FROM aurora.locations ORDER BY path'
      )
    );
    for (const r of rows) {
      expect(r.path, `caminho de ${r.id}`).toMatch(new RegExp(`/${r.id}/$`));
      expect(locationDepth(r.path)).toBe(r.depth);
    }
    const setor = rows.find((r) => r.id === setor1)!;
    expect(setor.path).toBe(`/${unidade1}/${predio1}/${setor1}/`);
    expect(setor.depth).toBe(3);
    expect(parentIdFromPath(setor.path)).toBe(predio1);
  });

  it('renomear não mexe no caminho', async () => {
    const antes = await withTenant(t.db, ctxA, (s) =>
      s.query<{ path: string }>('SELECT path FROM aurora.locations WHERE id = $1', [setor1])
    );
    await withTenant(t.db, ctxA, (s) =>
      s.query('UPDATE aurora.locations SET name = $2 WHERE id = $1', [setor1, 'Ambulatório Geral'])
    );
    const depois = await withTenant(t.db, ctxA, (s) =>
      s.query<{ path: string; name: string }>('SELECT path, name FROM aurora.locations WHERE id = $1', [
        setor1,
      ])
    );
    expect(depois[0]!.path).toBe(antes[0]!.path);
    expect(depois[0]!.name).toBe('Ambulatório Geral');
  });

  it('ancestrais vêm da raiz até o pai', async () => {
    const linha = await withTenant(t.db, ctxA, (s) => ancestors(s, setor1));
    expect(linha.map((l) => l.id)).toEqual([unidade1, predio1]);
  });
});

describe('regras de aninhamento (ADR-005)', () => {
  it('tipo que não pode ser raiz é recusado na raiz', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createLocation(s, { customerId: customerA, locationTypeId: types.get('setor')!, name: 'Setor solto' })
      )
    ).rejects.toThrow(/não pode ficar na raiz/);
  });

  it('tipo inválido para o pai é recusado nomeando os permitidos', async () => {
    // "unidade" só pode ser raiz: não há tipo nenhum na sua lista de pais.
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createLocation(s, {
          customerId: customerA,
          parentId: predio1,
          locationTypeId: types.get('unidade')!,
          name: 'Unidade aninhada',
        })
      )
    ).rejects.toThrow(/só pode ficar sob/);
  });

  it('a mensagem lista os tipos aceitos pelo pai', async () => {
    const erro = await withTenant(t.db, ctxA, async (s) => {
      try {
        await createLocation(s, {
          customerId: customerA,
          parentId: setor1,
          locationTypeId: types.get('predio')!,
          name: 'Bloco no setor',
        });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(erro).toMatch(/Unidade/);
  });

  it('tipo que não pode ser raiz e não aceita nenhum pai é recusado na criação do tipo', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) => createLocationType(s, { key: 'orfao', name: 'Órfão' }))
    ).rejects.toThrow(/location_types_placeable|check constraint/i);
  });
});

describe('mover subárvore', () => {
  it('move 500 locais e atualiza todos os caminhos numa transação', async () => {
    const filhos = Array.from({ length: 499 }, () => newId());

    await withTenant(t.db, ctxA, (s) =>
      s.query(
        `INSERT INTO aurora.locations (id, organization_id, customer_id, parent_id, location_type_id, name)
         SELECT u.id, $2, $3, $4, $5, 'Sala ' || u.ord
           FROM unnest($1::uuid[]) WITH ORDINALITY AS u(id, ord)`,
        [filhos, ORG_A, customerA, setor1, types.get('sala')!]
      )
    );

    const antes = await withTenant(t.db, ctxA, (s) => subtree(s, setor1));
    expect(antes).toHaveLength(500);
    expect(antes.every((l) => l.path.startsWith(`/${unidade1}/${predio1}/${setor1}/`))).toBe(true);

    // move o setor inteiro para debaixo da outra unidade
    const movidos = await withTenant(t.db, ctxA, (s) => moveLocation(s, setor1, unidade2));
    expect(movidos).toBe(500);

    const depois = await withTenant(t.db, ctxA, (s) => subtree(s, setor1));
    expect(depois).toHaveLength(500);
    for (const l of depois) {
      expect(l.path.startsWith(`/${unidade2}/${setor1}/`), `caminho de ${l.name}`).toBe(true);
      expect(locationDepth(l.path)).toBe(l.depth);
    }
    // o setor subiu um nível, e as salas junto
    expect(depois.find((l) => l.id === setor1)!.depth).toBe(2);
    expect(depois.filter((l) => l.depth === 3)).toHaveLength(499);
  }, 180_000);

  it('nenhum caminho órfão sobrou na organização', async () => {
    const orfaos = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(
        `SELECT l.id FROM aurora.locations l
          WHERE l.parent_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM aurora.locations p
               WHERE p.id = l.parent_id AND l.path = p.path || l.id::text || '/'
            )`
      )
    );
    expect(orfaos).toEqual([]);
  });

  it('mover para dentro da própria subárvore é recusado como ciclo', async () => {
    const [umaSala] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.locations WHERE parent_id = $1 LIMIT 1`, [setor1])
    );
    await expect(withTenant(t.db, ctxA, (s) => moveLocation(s, setor1, umaSala!.id))).rejects.toThrow(
      /ciclo/
    );
  });

  it('mover falha inteiro: um erro não deixa metade da árvore reescrita', async () => {
    const antes = await withTenant(t.db, ctxA, (s) => subtree(s, setor1));
    const [umaSala] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.locations WHERE parent_id = $1 LIMIT 1`, [setor1])
    );
    await expect(withTenant(t.db, ctxA, (s) => moveLocation(s, setor1, umaSala!.id))).rejects.toThrow();
    const depois = await withTenant(t.db, ctxA, (s) => subtree(s, setor1));
    expect(depois.map((l) => l.path).sort()).toEqual(antes.map((l) => l.path).sort());
  });
});

describe('profundidade máxima', () => {
  it('o nono nível é recusado', async () => {
    const chain = await withTenant(t.db, ctxA, async (s) => {
      const alaId = await createLocationType(s, {
        key: 'ala',
        name: 'Ala',
        canBeRoot: true,
        allowedParentTypeIds: [types.get('unidade')!],
      });
      // uma ala pode ficar sob outra ala: é o que permite montar uma corrente
      await s.query('UPDATE aurora.location_types SET allowed_parent_type_ids = $2 WHERE id = $1', [
        alaId,
        [types.get('unidade')!, alaId],
      ]);
      const ids: string[] = [];
      let parent: string | null = null;
      for (let i = 1; i <= 8; i++) {
        const id: string = await createLocation(s, {
          customerId: customerA,
          parentId: parent,
          locationTypeId: alaId,
          name: `Nível ${i}`,
        });
        ids.push(id);
        parent = id;
      }
      return { alaId, ids };
    });

    const [ultimo] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ depth: number }>('SELECT depth FROM aurora.locations WHERE id = $1', [chain.ids[7]])
    );
    expect(ultimo!.depth).toBe(8);

    await expect(
      withTenant(t.db, ctxA, (s) =>
        createLocation(s, {
          customerId: customerA,
          parentId: chain.ids[7]!,
          locationTypeId: chain.alaId,
          name: 'Nível 9',
        })
      )
    ).rejects.toThrow(/excede o limite de 8/);
  });

  it('mover uma subárvore que estouraria o limite é recusado, e a mensagem diz quanto daria', async () => {
    const { raiz, folhaFunda } = await withTenant(t.db, ctxA, async (s) => {
      const [ala] = await s.query<{ id: string }>(`SELECT id FROM aurora.location_types WHERE key = 'ala'`);
      const raiz = await createLocation(s, {
        customerId: customerA,
        locationTypeId: ala!.id,
        name: 'Ala portátil',
      });
      let parent = raiz;
      for (let i = 2; i <= 4; i++) {
        parent = await createLocation(s, {
          customerId: customerA,
          parentId: parent,
          locationTypeId: ala!.id,
          name: `Portátil ${i}`,
        });
      }
      return { raiz, folhaFunda: parent };
    });
    expect(folhaFunda).toBeTruthy();

    // a corrente de 8 níveis ainda existe; pendurar uma subárvore de 4 no nível 6 daria 9
    const [nivel6] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.locations WHERE name = 'Nível 6'`)
    );
    await expect(withTenant(t.db, ctxA, (s) => moveLocation(s, raiz, nivel6!.id))).rejects.toThrow(
      /acima do limite de 8/
    );
  });
});

describe('arquivar', () => {
  it('recusa arquivar local com estrutura ativa abaixo e nomeia as pendências', async () => {
    const erro = await withTenant(t.db, ctxA, async (s) => {
      try {
        await archiveLocation(s, unidade2);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(erro).toMatch(/ativo\(s\) abaixo/);
    expect(erro).toMatch(/Ambulatório Geral/);
  });

  it('arquiva uma folha sem reclamar', async () => {
    const folha = await withTenant(t.db, ctxA, (s) =>
      createLocation(s, {
        customerId: customerA,
        parentId: unidade1,
        locationTypeId: types.get('predio')!,
        name: 'Bloco vazio',
      })
    );
    await withTenant(t.db, ctxA, (s) => archiveLocation(s, folha));
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ status: string }>('SELECT status::text FROM aurora.locations WHERE id = $1', [folha])
    );
    expect(row!.status).toBe('archived');
  });
});

describe('casos de borda do cadastro', () => {
  it('clínica pequena: um cliente com um único local raiz funciona', async () => {
    const id = await withTenant(t.db, ctxA, async (s) => {
      const c = await createCustomer(s, { name: 'Clínica de Bairro' });
      return createLocation(s, { customerId: c, locationTypeId: types.get('unidade')!, name: 'Sede' });
    });
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ depth: number; parent_id: string | null }>(
        'SELECT depth, parent_id FROM aurora.locations WHERE id = $1',
        [id]
      )
    );
    expect(row).toEqual({ depth: 1, parent_id: null });
  });

  it('local móvel sem endereço é aceito', async () => {
    const id = await withTenant(t.db, ctxA, (s) =>
      createLocation(s, {
        customerId: customerA,
        parentId: unidade1,
        locationTypeId: types.get('setor')!,
        name: 'Ambulância 07',
        isMobile: true,
      })
    );
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ is_mobile: boolean; address: unknown }>(
        'SELECT is_mobile, address FROM aurora.locations WHERE id = $1',
        [id]
      )
    );
    expect(row!.is_mobile).toBe(true);
    expect(row!.address).toEqual({});
  });

  it('no máximo um cliente interno por organização', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) => createCustomer(s, { name: 'Outro interno', isInternal: true }))
    ).rejects.toThrow(/customers_one_internal_uq|duplicate key/i);
  });

  it('coordenada exige o par completo', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query('UPDATE aurora.locations SET geo_lat = 1.5 WHERE id = $1', [unidade1])
      )
    ).rejects.toThrow(/locations_geo_pair|check constraint/i);
  });
});

describe('isolamento entre organizações', () => {
  it('A não enxerga locais de B', async () => {
    const localB = await withTenant(t.db, ctxB, async (s) => {
      const [tipo] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.location_types WHERE key = 'unidade'`
      );
      return createLocation(s, { customerId: customerB, locationTypeId: tipo!.id, name: 'Sede B' });
    });
    const visto = await withTenant(t.db, ctxA, (s) =>
      s.query('SELECT id FROM aurora.locations WHERE id = $1', [localB])
    );
    expect(visto).toEqual([]);
  });

  it('A não consegue criar local apontando para cliente de B', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createLocation(s, { customerId: customerB, locationTypeId: types.get('unidade')!, name: 'Invasão' })
      )
    ).rejects.toThrow(/_org_fk|fora do seu acesso|row-level security/i);
  });

  it('A não consegue pendurar local sob pai de B', async () => {
    const [raizB] = await withTenant(t.db, ctxB, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.locations WHERE name = 'Sede B'`)
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createLocation(s, {
          customerId: customerA,
          parentId: raizB!.id,
          locationTypeId: types.get('predio')!,
          name: 'Bloco invasor',
        })
      )
    ).rejects.toThrow(/inexistente|_org_fk|fora do seu acesso|row-level security/i);
  });
});

describe('escopo por local', () => {
  it('escopo "all" devolve todos os locais da organização', async () => {
    const [total] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ c: number }>(`SELECT count(*)::int c FROM aurora.locations WHERE deleted_at IS NULL`)
    );
    const ids = await withTenant(t.db, ctxA, (s) => accessibleLocationIds(s, MEM_A));
    expect(ids).toHaveLength(total!.c);
  });

  it('escopo "listed" devolve a raiz e tudo abaixo dela, e nada de fora', async () => {
    await withTenant(t.db, ctxA, (s) =>
      s.query(
        `UPDATE aurora.membership_scopes SET location_scope = 'listed', location_ids = $2 WHERE membership_id = $1`,
        [MEM_A, [setor1]]
      )
    );
    const ids = await withTenant(t.db, ctxA, (s) => accessibleLocationIds(s, MEM_A));
    const esperado = await withTenant(t.db, ctxA, (s) => subtree(s, setor1));
    expect(new Set(ids)).toEqual(new Set(esperado.map((l) => l.id)));
    expect(ids).not.toContain(unidade1);
    expect(ids).toContain(setor1);
  });

  it('escopo de local não vaza para outra organização', async () => {
    const ids = await withTenant(t.db, ctxB, (s) => accessibleLocationIds(s, MEM_A));
    expect(ids).toEqual([]);
  });
});

describe('calendários', () => {
  let calendario: string;

  it('aceita turnos encostados no mesmo dia', async () => {
    calendario = await withTenant(t.db, ctxA, async (s) => {
      const id = newId();
      await s.query(
        `INSERT INTO aurora.calendars (id, organization_id, name, timezone) VALUES ($1, $2, 'Comercial', 'America/Sao_Paulo')`,
        [id, ORG_A]
      );
      for (const [ini, fim] of [
        ['08:00', '12:00'],
        ['12:00', '18:00'],
      ]) {
        await s.query(
          `INSERT INTO aurora.calendar_windows (id, organization_id, calendar_id, weekday, starts_at, ends_at)
           VALUES ($1, $2, $3, 1, $4, $5)`,
          [newId(), ORG_A, id, ini, fim]
        );
      }
      return id;
    });
    const janelas = await withTenant(t.db, ctxA, (s) =>
      s.query('SELECT id FROM aurora.calendar_windows WHERE calendar_id = $1', [calendario])
    );
    expect(janelas).toHaveLength(2);
  });

  it('recusa janela sobreposta no mesmo dia', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(
          `INSERT INTO aurora.calendar_windows (id, organization_id, calendar_id, weekday, starts_at, ends_at)
           VALUES ($1, $2, $3, 1, '11:00', '13:00')`,
          [newId(), ORG_A, calendario]
        )
      )
    ).rejects.toThrow(/sobrepõe/);
  });

  it('a mesma faixa em outro dia da semana é aceita', async () => {
    await withTenant(t.db, ctxA, (s) =>
      s.query(
        `INSERT INTO aurora.calendar_windows (id, organization_id, calendar_id, weekday, starts_at, ends_at)
         VALUES ($1, $2, $3, 2, '11:00', '13:00')`,
        [newId(), ORG_A, calendario]
      )
    );
    const [c] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ c: number }>('SELECT count(*)::int c FROM aurora.calendar_windows WHERE calendar_id = $1', [
        calendario,
      ])
    );
    expect(c!.c).toBe(3);
  });

  it('feriado é exceção do calendário, não janela negativa', async () => {
    await withTenant(t.db, ctxA, (s) =>
      s.query(
        `INSERT INTO aurora.calendar_exceptions (id, organization_id, calendar_id, on_date, kind, note)
         VALUES ($1, $2, $3, DATE '2026-09-07', 'holiday', 'Independência')`,
        [newId(), ORG_A, calendario]
      )
    );
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ kind: string }>(`SELECT kind::text FROM aurora.calendar_exceptions WHERE calendar_id = $1`, [
        calendario,
      ])
    );
    expect(row!.kind).toBe('holiday');
  });

  it('exceção de horário estendido exige a janela', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(
          `INSERT INTO aurora.calendar_exceptions (id, organization_id, calendar_id, on_date, kind)
           VALUES ($1, $2, $3, DATE '2026-09-08', 'extended')`,
          [newId(), ORG_A, calendario]
        )
      )
    ).rejects.toThrow(/extended_needs_window|check constraint/i);
  });
});

describe('trilha de auditoria do diretório', () => {
  it('criar e renomear um local deixam registro com o campo alterado', async () => {
    const id = await withTenant(t.db, ctxA, async (s) => {
      const novo = await createLocation(s, {
        customerId: customerA,
        parentId: unidade1,
        locationTypeId: types.get('predio')!,
        name: 'Bloco auditado',
      });
      await s.query('UPDATE aurora.locations SET name = $2 WHERE id = $1', [novo, 'Bloco B']);
      return novo;
    });
    const trilha = await withTenant(t.db, ctxA, (s) =>
      s.query<{ action: string; changes: Record<string, unknown> | null }>(
        `SELECT action::text, changes FROM aurora.audit_logs
          WHERE entity_type = 'locations' AND entity_id = $1::text ORDER BY occurred_at, action`,
        [id]
      )
    );
    expect(trilha.map((r) => r.action).sort()).toEqual(['create', 'update']);
    const update = trilha.find((r) => r.action === 'update')!;
    expect(Object.keys(update.changes ?? {})).toContain('name');
  });
});

describe('fornecedores, equipes e disponibilidade', () => {
  it('fornecedor com nome repetido é recusado, ignorando caixa e espaço', async () => {
    await withTenant(t.db, ctxA, (s) =>
      createSupplier(s, { name: 'Medtronic Brasil', categories: ['ventilação'] })
    );
    await expect(
      withTenant(t.db, ctxA, (s) => createSupplier(s, { name: '  medtronic brasil ' }))
    ).rejects.toThrow(/suppliers_org_name_uq|já existe/i);
  });

  it('a mesma razão social em outra organização é aceita — o cadastro é por tenant', async () => {
    const id = await withTenant(t.db, ctxB, (s) => createSupplier(s, { name: 'Medtronic Brasil' }));
    expect(id).toBeTruthy();
  });

  it('nota de fornecedor fora de 1..5 é recusada', async () => {
    const id = await withTenant(t.db, ctxA, (s) => createSupplier(s, { name: 'Fornecedor com nota' }));
    await expect(
      withTenant(t.db, ctxA, (s) => s.query('UPDATE aurora.suppliers SET rating = 9 WHERE id = $1', [id]))
    ).rejects.toThrow(/suppliers_rating_range|regra/i);
  });

  it('equipe com membro: incluir duas vezes atualiza em vez de duplicar', async () => {
    const team = await withTenant(t.db, ctxA, (s) => createTeam(s, { name: 'Engenharia Clínica' }));
    await withTenant(t.db, ctxA, (s) =>
      addTeamMember(s, team, MEM_A, { roleInTeam: 'lead', skills: ['eletromédica'] })
    );
    await withTenant(t.db, ctxA, (s) =>
      addTeamMember(s, team, MEM_A, { roleInTeam: 'member', skills: ['infusão'] })
    );
    const rows = await withTenant(t.db, ctxA, (s) =>
      s.query<{ role_in_team: string; skills: string[] }>(
        'SELECT role_in_team, skills FROM aurora.team_members WHERE team_id = $1',
        [team]
      )
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role_in_team).toBe('member');
    expect(rows[0]!.skills).toEqual(['infusão']);
  });

  it('A não consegue colocar vínculo de B na própria equipe', async () => {
    const team = await withTenant(t.db, ctxA, (s) => createTeam(s, { name: 'Equipe fechada' }));
    await expect(withTenant(t.db, ctxA, (s) => addTeamMember(s, team, MEM_B))).rejects.toThrow(
      /_org_fk|fora do seu acesso|row-level security/i
    );
  });

  it('férias tornam a pessoa indisponível na janela, e só nela', async () => {
    const inicio = new Date('2026-12-20T00:00:00Z');
    const fim = new Date('2027-01-05T00:00:00Z');
    await withTenant(t.db, ctxA, (s) => blockAvailability(s, MEM_A, 'vacation', inicio, fim, 'férias'));

    await withTenant(t.db, ctxA, async (s) => {
      expect(await isUnavailableAt(s, MEM_A, new Date('2026-12-25T12:00:00Z'))).toBe(true);
      expect(await isUnavailableAt(s, MEM_A, new Date('2026-12-19T23:59:00Z'))).toBe(false);
      // o fim é exclusivo: quem volta dia 5 já está disponível às 00:00
      expect(await isUnavailableAt(s, MEM_A, fim)).toBe(false);
    });
  });

  it('bloqueio que termina antes de começar é recusado', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        blockAvailability(
          s,
          MEM_A,
          'leave',
          new Date('2027-02-10T00:00:00Z'),
          new Date('2027-02-01T00:00:00Z')
        )
      )
    ).rejects.toThrow(/availability_blocks_order|regra/i);
  });
});

describe('a árvore não atravessa clientes', () => {
  it('pendurar local de um cliente sob local de outro é recusado com mensagem clara', async () => {
    const { outroCliente, raizOutro } = await withTenant(t.db, ctxA, async (s) => {
      const outroCliente = await createCustomer(s, { name: 'Hospital Vizinho' });
      const raizOutro = await createLocation(s, {
        customerId: outroCliente,
        locationTypeId: types.get('unidade')!,
        name: 'Unidade Vizinha',
      });
      return { outroCliente, raizOutro };
    });
    expect(outroCliente).toBeTruthy();

    await expect(
      withTenant(t.db, ctxA, (s) =>
        createLocation(s, {
          customerId: customerA,
          parentId: raizOutro,
          locationTypeId: types.get('predio')!,
          name: 'Bloco de outro cliente',
        })
      )
    ).rejects.toThrow(/pertence a outro cliente/);
  });

  it('mover uma subárvore para debaixo de outro cliente é recusado, não reatribuído em silêncio', async () => {
    const [vizinha] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.locations WHERE name = 'Unidade Vizinha'`)
    );
    const antes = await withTenant(t.db, ctxA, (s) => subtree(s, setor1));

    await expect(withTenant(t.db, ctxA, (s) => moveLocation(s, setor1, vizinha!.id))).rejects.toThrow(
      /pertence a outro cliente/
    );

    const depois = await withTenant(t.db, ctxA, (s) => subtree(s, setor1));
    expect(depois.every((l) => l.customer_id === customerA)).toBe(true);
    expect(depois.map((l) => l.path).sort()).toEqual(antes.map((l) => l.path).sort());
  });
});
