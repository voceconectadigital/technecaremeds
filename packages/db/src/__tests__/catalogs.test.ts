/**
 * Aurora — catálogos governados e campos personalizados contra o banco
 * (SPEC v0.2 §29, §41 · EPIC-004).
 *
 * O caso de referência que estes testes reproduzem é literal: a auditoria
 * encontrou "fechada" convivendo com "Fechada" em 312 OS, e "Emprestimo" ao
 * lado de "Empréstimo de equipamento". O primeiro par não pode nascer; o
 * segundo exige julgamento humano e por isso ganha mesclagem assistida.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  newId,
  buildContext,
  CATALOGS,
  CATALOG_KEYS,
  normalizeLabel,
  suggestMergeGroups,
} from '@aurora/domain';
import { withTenant } from '../client';
import {
  syncCatalogDefinitions,
  createCatalogItem,
  listCatalog,
  archiveCatalogItem,
  mergeCatalogItems,
  resolveCatalogItem,
  createCustomFieldDefinition,
  loadCustomFieldDefinitions,
  saveCustomValues,
} from '../catalogs';
import { createCustomer } from '../directory';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG_A = newId(),
  USER_A = newId(),
  MEM_A = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();
const ctxA = buildContext({ organizationId: ORG_A, actorId: USER_A, requestId: 'cat-a' });
const ctxB = buildContext({ organizationId: ORG_B, actorId: USER_B, requestId: 'cat-b' });

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: USER_A, membershipId: MEM_A },
    { slug: 'cat-a', name: 'A', email: 'a@cat.test', userName: 'A' }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    { slug: 'cat-b', name: 'B', email: 'b@cat.test', userName: 'B' }
  );
}, 90_000);

afterAll(async () => {
  await t?.close();
});

describe('normalização de rótulo', () => {
  /**
   * Duas implementações da mesma regra — uma em SQL (que impede o duplicado) e
   * outra em TypeScript (que avisa antes de enviar) — divergem sozinhas se
   * ninguém comparar. Este é o teste que compara.
   */
  it('o PostgreSQL e o TypeScript concordam sobre toda a lista', async () => {
    const entradas = [
      'Fechada',
      'fechada',
      '  FECHADA  ',
      'Empréstimo',
      'Emprestimo',
      'Empréstimo de equipamento',
      'Reposição de Oxigênio',
      'REPOSIÇÃO DE OXIGÊNIO',
      'Ar-condicionado',
      'Ar condicionado',
      'SN-4471/A',
      'Ventilação Mecânica — UTI',
      'Não conformidade (grau III)',
      'Ação corretiva',
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    ];
    const rows = await withTenant(t.db, ctxA, (s) =>
      s.query<{ entrada: string; sql: string }>(
        `SELECT u.entrada, aurora.normalize_label(u.entrada) AS sql
           FROM unnest($1::text[]) AS u(entrada)`,
        [entradas]
      )
    );
    expect(rows).toHaveLength(entradas.length);
    for (const r of rows) {
      expect(r.sql, `divergência em ${JSON.stringify(r.entrada)}`).toBe(normalizeLabel(r.entrada));
    }
  });

  it('as três grafias que a auditoria encontrou colidem em uma só', async () => {
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ a: string; b: string; c: string }>(
        `SELECT aurora.normalize_label('Fechada') a,
                aurora.normalize_label('fechada') b,
                aurora.normalize_label('  FECHADA ') c`
      )
    );
    expect(new Set([row!.a, row!.b, row!.c]).size).toBe(1);
  });
});

describe('definições de catálogo', () => {
  it('o banco espelha exatamente o catálogo do código', async () => {
    const r = await syncCatalogDefinitions(t.admin);
    expect(r.orphaned).toEqual([]);
    const rows = await t.raw('SELECT key FROM aurora.catalog_definitions ORDER BY key');
    expect(rows.map((x) => x.key)).toEqual([...CATALOG_KEYS].sort());
  });

  it('sincronizar de novo não insere nada', async () => {
    const r = await syncCatalogDefinitions(t.admin);
    expect(r.inserted).toBe(0);
    expect(r.updated).toBe(CATALOGS.length);
  });

  it('recusa rodar sob o papel de aplicação', async () => {
    await expect(syncCatalogDefinitions(t.db)).rejects.toThrow(/administrativo/);
  });
});

describe('governança dos itens', () => {
  it('cria itens e os lista na ordem de exibição', async () => {
    await withTenant(t.db, ctxA, async (s) => {
      await createCatalogItem(s, {
        catalogKey: 'work_order_type',
        key: 'corretiva',
        label: 'Corretiva',
        systemKey: 'corrective',
        position: 1,
      });
      await createCatalogItem(s, {
        catalogKey: 'work_order_type',
        key: 'preventiva',
        label: 'Preventiva',
        systemKey: 'preventive',
        position: 0,
      });
    });
    const itens = await withTenant(t.db, ctxA, (s) => listCatalog(s, 'work_order_type'));
    expect(itens.map((i) => i.label)).toEqual(['Preventiva', 'Corretiva']);
  });

  it('"Fechada" e "fechada" não podem coexistir — é o defeito da referência', async () => {
    await withTenant(t.db, ctxA, (s) =>
      createCatalogItem(s, { catalogKey: 'failure_symptom', key: 'nao_liga', label: 'Não liga' })
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createCatalogItem(s, { catalogKey: 'failure_symptom', key: 'nao_liga_2', label: 'NAO LIGA' })
      )
    ).rejects.toThrow(/catalog_items_label_uq|já existe/i);
  });

  it('a mesma chave técnica não se repete no mesmo catálogo', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createCatalogItem(s, { catalogKey: 'failure_symptom', key: 'nao_liga', label: 'Outro rótulo' })
      )
    ).rejects.toThrow(/catalog_items_key_uq|já existe/i);
  });

  it('a chave técnica é imutável; o rótulo não', async () => {
    const id = await withTenant(t.db, ctxA, (s) =>
      createCatalogItem(s, { catalogKey: 'failure_symptom', key: 'ruido', label: 'Ruido' })
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query('UPDATE aurora.catalog_items SET key = $2 WHERE id = $1', [id, 'ruido_anormal'])
      )
    ).rejects.toThrow(/imutável/);

    await withTenant(t.db, ctxA, (s) =>
      s.query('UPDATE aurora.catalog_items SET label = $2 WHERE id = $1', [id, 'Ruído anormal'])
    );
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ label: string; normalized_label: string; key: string }>(
        'SELECT label, normalized_label, key FROM aurora.catalog_items WHERE id = $1',
        [id]
      )
    );
    expect(row!.key).toBe('ruido');
    expect(row!.label).toBe('Ruído anormal');
    expect(row!.normalized_label).toBe('ruido anormal');
  });

  it('rótulo que normaliza para nada é recusado', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createCatalogItem(s, { catalogKey: 'failure_symptom', key: 'vazio', label: '---' })
      )
    ).rejects.toThrow(/label_meaningful|regra/i);
  });

  it('catálogo plano não aceita subitem', async () => {
    const [pai] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.catalog_items WHERE key = 'corretiva'`)
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createCatalogItem(s, {
          catalogKey: 'work_order_type',
          key: 'sub',
          label: 'Sub',
          parentId: pai!.id,
        })
      )
    ).rejects.toThrow(/não aceita subitens/);
  });

  it('catálogo hierárquico aceita dois níveis e recusa o terceiro', async () => {
    const { nivel2 } = await withTenant(t.db, ctxA, async (s) => {
      const nivel1 = await createCatalogItem(s, {
        catalogKey: 'failure_cause',
        key: 'eletrica',
        label: 'Elétrica',
      });
      const nivel2 = await createCatalogItem(s, {
        catalogKey: 'failure_cause',
        key: 'fonte',
        label: 'Fonte de alimentação',
        parentId: nivel1,
      });
      return { nivel1, nivel2 };
    });

    await expect(
      withTenant(t.db, ctxA, (s) =>
        createCatalogItem(s, {
          catalogKey: 'failure_cause',
          key: 'capacitor',
          label: 'Capacitor',
          parentId: nivel2,
        })
      )
    ).rejects.toThrow(/no máximo dois níveis/);
  });

  it('subitem não atravessa catálogos', async () => {
    const [outro] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.catalog_items WHERE key = 'nao_liga'`)
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createCatalogItem(s, {
          catalogKey: 'failure_cause',
          key: 'invasor',
          label: 'Invasor',
          parentId: outro!.id,
        })
      )
    ).rejects.toThrow(/catálogo/);
  });
});

describe('arquivar', () => {
  it('recusa arquivar item com subitens ativos, nomeando-os', async () => {
    const [pai] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.catalog_items WHERE key = 'eletrica'`)
    );
    const erro = await withTenant(t.db, ctxA, async (s) => {
      try {
        await archiveCatalogItem(s, pai!.id);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(erro).toMatch(/Fonte de alimentação/);
  });

  it('item de sistema não é arquivável', async () => {
    const id = await withTenant(t.db, ctxA, (s) =>
      createCatalogItem(s, {
        catalogKey: 'rejection_reason',
        key: 'duplicada',
        label: 'Duplicada',
        isSystem: true,
      })
    );
    await expect(withTenant(t.db, ctxA, (s) => archiveCatalogItem(s, id))).rejects.toThrow(/item de sistema/);
  });

  it('arquivar libera o rótulo para um item novo', async () => {
    const id = await withTenant(t.db, ctxA, (s) =>
      createCatalogItem(s, { catalogKey: 'rejection_reason', key: 'fora_escopo', label: 'Fora de escopo' })
    );
    await withTenant(t.db, ctxA, (s) => archiveCatalogItem(s, id));
    const novo = await withTenant(t.db, ctxA, (s) =>
      createCatalogItem(s, { catalogKey: 'rejection_reason', key: 'fora_escopo_v2', label: 'Fora de escopo' })
    );
    expect(novo).toBeTruthy();
    const vivos = await withTenant(t.db, ctxA, (s) => listCatalog(s, 'rejection_reason'));
    expect(vivos.filter((i) => i.label === 'Fora de escopo')).toHaveLength(1);
  });

  it('a chave técnica arquivada NÃO é reaproveitável', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createCatalogItem(s, { catalogKey: 'rejection_reason', key: 'fora_escopo', label: 'Outra coisa' })
      )
    ).rejects.toThrow(/catalog_items_key_uq|já existe/i);
  });
});

describe('mesclagem assistida', () => {
  it('a sugestão trabalha sobre a lista que veio do banco', async () => {
    await withTenant(t.db, ctxA, async (s) => {
      await createCatalogItem(s, {
        catalogKey: 'rejection_reason',
        key: 'equip_terceiro',
        label: 'Equipamento de terceiro',
      });
      await createCatalogItem(s, {
        catalogKey: 'rejection_reason',
        key: 'equip_terceiro_locado',
        label: 'Equipamento de terceiro locado',
      });
    });
    const itens = await withTenant(t.db, ctxA, (s) => listCatalog(s, 'rejection_reason'));
    const sugestoes = suggestMergeGroups(itens.map((i) => ({ id: i.id, label: i.label })));
    expect(sugestoes).toHaveLength(1);
    expect(sugestoes[0]!.reason).toBe('um_contem_o_outro');
  });

  it('mescla reapontando os subitens e arquivando a origem', async () => {
    const { origem, destino, filho } = await withTenant(t.db, ctxA, async (s) => {
      const origem = await createCatalogItem(s, {
        catalogKey: 'failure_cause',
        key: 'mecanica_dup',
        label: 'Mecanica',
      });
      const destino = await createCatalogItem(s, {
        catalogKey: 'failure_cause',
        key: 'mecanica',
        label: 'Mecânica estrutural',
      });
      const filho = await createCatalogItem(s, {
        catalogKey: 'failure_cause',
        key: 'rodizio',
        label: 'Rodízio',
        parentId: origem,
      });
      return { origem, destino, filho };
    });

    const reapontadas = await withTenant(t.db, ctxA, (s) => mergeCatalogItems(s, origem, destino));
    expect(reapontadas).toBe(1);

    const [depois] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ parent_id: string }>('SELECT parent_id FROM aurora.catalog_items WHERE id = $1', [filho])
    );
    expect(depois!.parent_id).toBe(destino);

    const [origemRow] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ archived_at: string | null; merged_into_id: string }>(
        'SELECT archived_at, merged_into_id FROM aurora.catalog_items WHERE id = $1',
        [origem]
      )
    );
    expect(origemRow!.archived_at).not.toBeNull();
    expect(origemRow!.merged_into_id).toBe(destino);

    // a duplicata é preservada, não apagada: o histórico continua legível
    const vivos = await withTenant(t.db, ctxA, (s) => listCatalog(s, 'failure_cause'));
    expect(vivos.map((i) => i.id)).not.toContain(origem);
    const todos = await withTenant(t.db, ctxA, (s) =>
      listCatalog(s, 'failure_cause', { includeArchived: true })
    );
    expect(todos.map((i) => i.id)).toContain(origem);
  });

  it('quem apontava para a origem é resolvido para o destino final', async () => {
    const { a, c } = await withTenant(t.db, ctxA, async (s) => {
      const a = await createCatalogItem(s, {
        catalogKey: 'failure_action',
        key: 'troca_a',
        label: 'Troca A',
      });
      const b = await createCatalogItem(s, {
        catalogKey: 'failure_action',
        key: 'troca_b',
        label: 'Troca B',
      });
      const c = await createCatalogItem(s, {
        catalogKey: 'failure_action',
        key: 'troca_c',
        label: 'Troca C',
      });
      await mergeCatalogItems(s, a, b);
      await mergeCatalogItems(s, b, c);
      return { a, c };
    });
    const resolvido = await withTenant(t.db, ctxA, (s) => resolveCatalogItem(s, a));
    expect(resolvido.id).toBe(c);
  });

  it('mesclar em um item já mesclado aponta direto para o vencedor final', async () => {
    const { antigo, atual } = await withTenant(t.db, ctxA, async (s) => {
      const antigo = await createCatalogItem(s, {
        catalogKey: 'failure_action',
        key: 'limpeza_v1',
        label: 'Limpeza v1',
      });
      const [c] = await s.query<{ id: string }>(`SELECT id FROM aurora.catalog_items WHERE key = 'troca_c'`);
      const [b] = await s.query<{ id: string }>(`SELECT id FROM aurora.catalog_items WHERE key = 'troca_b'`);
      // mescla no B, que já foi mesclado no C
      await mergeCatalogItems(s, antigo, b!.id);
      return { antigo, atual: c!.id };
    });
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ merged_into_id: string }>('SELECT merged_into_id FROM aurora.catalog_items WHERE id = $1', [
        antigo,
      ])
    );
    expect(row!.merged_into_id).toBe(atual);
  });

  it('recusa mesclar entre catálogos diferentes', async () => {
    const ids = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string; catalog_key: string }>(
        `SELECT id, catalog_key FROM aurora.catalog_items WHERE key IN ('nao_liga', 'corretiva')`
      )
    );
    const [x, y] = ids;
    await expect(withTenant(t.db, ctxA, (s) => mergeCatalogItems(s, x!.id, y!.id))).rejects.toThrow(
      /catálogos diferentes/
    );
  });

  it('recusa mesclar um item nele mesmo', async () => {
    const [item] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.catalog_items WHERE key = 'nao_liga'`)
    );
    await expect(withTenant(t.db, ctxA, (s) => mergeCatalogItems(s, item!.id, item!.id))).rejects.toThrow(
      /nele mesmo/
    );
  });

  it('não mescla item de outra organização', async () => {
    const alheio = await withTenant(t.db, ctxB, (s) =>
      createCatalogItem(s, { catalogKey: 'failure_symptom', key: 'alheio', label: 'Alheio' })
    );
    const [meu] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.catalog_items WHERE key = 'nao_liga'`)
    );
    await expect(withTenant(t.db, ctxA, (s) => mergeCatalogItems(s, alheio, meu!.id))).rejects.toThrow(
      /inexistente|fora do seu acesso/
    );
  });
});

describe('isolamento dos catálogos', () => {
  it('cada organização tem a sua lista', async () => {
    const a = await withTenant(t.db, ctxA, (s) => listCatalog(s, 'failure_symptom'));
    const b = await withTenant(t.db, ctxB, (s) => listCatalog(s, 'failure_symptom'));
    expect(a.length).toBeGreaterThan(0);
    expect(b.map((i) => i.key)).toEqual(['alheio']);
  });

  it('o mesmo rótulo em outra organização é permitido', async () => {
    const id = await withTenant(t.db, ctxB, (s) =>
      createCatalogItem(s, { catalogKey: 'failure_symptom', key: 'nao_liga', label: 'Não liga' })
    );
    expect(id).toBeTruthy();
  });
});

describe('campos personalizados no banco', () => {
  it('cria uma definição e a recupera tipada', async () => {
    await withTenant(t.db, ctxA, (s) =>
      createCustomFieldDefinition(s, {
        entityType: 'customer',
        key: 'centro_custo',
        label: 'Centro de custo',
        kind: 'text',
        required: true,
        max: 20,
      })
    );
    const defs = await withTenant(t.db, ctxA, (s) => loadCustomFieldDefinitions(s, 'customer'));
    expect(defs).toHaveLength(1);
    expect(defs[0]!.kind).toBe('text');
    // `numeric` volta como string do driver; a conversão precisa acontecer
    expect(defs[0]!.max).toBe(20);
    expect(typeof defs[0]!.max).toBe('number');
  });

  it('a definição incoerente é recusada antes de chegar ao banco', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createCustomFieldDefinition(s, {
          entityType: 'customer',
          key: 'sem_opcao',
          label: 'Sem opção',
          kind: 'select',
        })
      )
    ).rejects.toThrow(/ao menos uma opção/);
  });

  it('a chave e o tipo são imutáveis', async () => {
    const [def] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.custom_field_definitions WHERE key = 'centro_custo'`)
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query('UPDATE aurora.custom_field_definitions SET key = $2 WHERE id = $1', [def!.id, 'cc'])
      )
    ).rejects.toThrow(/imutável/);
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(
          `UPDATE aurora.custom_field_definitions SET kind = 'number'::aurora.custom_field_kind WHERE id = $1`,
          [def!.id]
        )
      )
    ).rejects.toThrow(/tipo do campo .* é imutável/);
  });

  it('grava valores válidos e recusa os inválidos, com a mesma definição', async () => {
    const cliente = await withTenant(t.db, ctxA, (s) => createCustomer(s, { name: 'Cliente com campo' }));

    const gravado = await withTenant(t.db, ctxA, (s) =>
      saveCustomValues(s, 'customer', 'customers', cliente, { centro_custo: 'CC-1042' })
    );
    expect(gravado).toEqual({ centro_custo: 'CC-1042' });

    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ custom: Record<string, unknown> }>('SELECT custom FROM aurora.customers WHERE id = $1', [
        cliente,
      ])
    );
    expect(row!.custom).toEqual({ centro_custo: 'CC-1042' });

    await expect(
      withTenant(t.db, ctxA, (s) =>
        saveCustomValues(s, 'customer', 'customers', cliente, {
          centro_custo: 'um centro de custo longo demais',
        })
      )
    ).rejects.toThrow(/passa de 20 caracteres/);

    await expect(
      withTenant(t.db, ctxA, (s) => saveCustomValues(s, 'customer', 'customers', cliente, {}))
    ).rejects.toThrow(/obrigatório/);
  });

  it('o limite de 50 campos por entidade é do banco, não só do código', async () => {
    await withTenant(t.db, ctxA, async (s) => {
      for (let i = 2; i <= 50; i++) {
        await createCustomFieldDefinition(s, {
          entityType: 'customer',
          key: `campo_${i}`,
          label: `Campo ${i}`,
          kind: 'text',
        });
      }
    });
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createCustomFieldDefinition(s, {
          entityType: 'customer',
          key: 'campo_51',
          label: 'Campo 51',
          kind: 'text',
        })
      )
    ).rejects.toThrow(/limite de 50 campos/);
  });

  it('arquivar um campo abre vaga para outro', async () => {
    await withTenant(t.db, ctxA, (s) =>
      s.query(`UPDATE aurora.custom_field_definitions SET archived_at = now() WHERE key = 'campo_50'`)
    );
    const id = await withTenant(t.db, ctxA, (s) =>
      createCustomFieldDefinition(s, {
        entityType: 'customer',
        key: 'campo_51',
        label: 'Campo 51',
        kind: 'text',
      })
    );
    expect(id).toBeTruthy();
  });

  it('o limite é por entidade: outra entidade começa do zero', async () => {
    const id = await withTenant(t.db, ctxA, (s) =>
      createCustomFieldDefinition(s, {
        entityType: 'location',
        key: 'ramal',
        label: 'Ramal',
        kind: 'text',
      })
    );
    expect(id).toBeTruthy();
  });

  it('definições não vazam entre organizações', async () => {
    const defs = await withTenant(t.db, ctxB, (s) => loadCustomFieldDefinitions(s, 'customer'));
    expect(defs).toEqual([]);
  });
});
