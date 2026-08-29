/**
 * Aurora — ativos contra o banco (SPEC v0.2 §07, ADR-006 · EPIC-005).
 *
 * Critérios de aceite do épico verificados aqui:
 *  · duplicidade em campo configurado é bloqueada na importação e no formulário
 *  · transferir ativo é operação registrada, nunca edição de campo
 *  · importação em massa com relatório de erro por linha
 *
 * Casos de borda da SPEC: ativo sem modelo cadastrado; ativo emprestado para
 * outro cliente; descomissionado com componente ativo; fabricante grafado de
 * várias formas na planilha de origem.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, isQrToken, effectiveSpecs, countsForAvailability } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import {
  createAssetCategory,
  createCriticality,
  createAsset,
  findOrCreateManufacturer,
  findOrCreateAssetModel,
  transferAsset,
  decommissionAsset,
  assetsUnderLocation,
  importAssets,
  curationQueue,
  mergeManufacturers,
} from '../assets';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG_A = newId(),
  USER_A = newId(),
  MEM_A = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();
const ctxA = buildContext({ organizationId: ORG_A, actorId: USER_A, requestId: 'ast-a' });
const ctxB = buildContext({ organizationId: ORG_B, actorId: USER_B, requestId: 'ast-b' });

let t: TestDatabase;
let cliente: string, clienteDois: string;
let unidade: string, setorUti: string, setorCc: string, setorDois: string;
let catVentilador: string, catMonitor: string;
let criticidadeAlta: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: USER_A, membershipId: MEM_A },
    { slug: 'ast-a', name: 'Rede A', email: 'a@ast.test', userName: 'A' }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    { slug: 'ast-b', name: 'Rede B', email: 'b@ast.test', userName: 'B' }
  );

  await withTenant(t.db, ctxA, async (s) => {
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital Central', isInternal: true });
    clienteDois = await createCustomer(s, { name: 'Clínica Parceira' });

    unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade Norte',
    });
    setorUti = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
      code: 'UTI-01',
    });
    setorCc = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'Centro Cirúrgico',
      code: 'CC-01',
    });
    const unidadeDois = await createLocation(s, {
      customerId: clienteDois,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede Parceira',
    });
    setorDois = await createLocation(s, {
      customerId: clienteDois,
      parentId: unidadeDois,
      locationTypeId: tipos.get('setor')!,
      name: 'Ambulatório',
    });

    catVentilador = await createAssetCategory(s, { name: 'Ventilador Pulmonar', requiresCalibration: true });
    catMonitor = await createAssetCategory(s, { name: 'Monitor Multiparâmetros' });
    criticidadeAlta = await createCriticality(s, { name: 'Alta', score: 90, slaMultiplier: 0.5 });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('cadastro de ativo', () => {
  it('cria com token de QR opaco e caminho de local derivado', async () => {
    const id = await withTenant(t.db, ctxA, (s) =>
      createAsset(s, {
        name: 'Ventilador UTI 01',
        customerId: cliente,
        assetCategoryId: catVentilador,
        locationId: setorUti,
        criticalityId: criticidadeAlta,
        serialNumber: 'FK0C025472',
      })
    );
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ qr_token: string; location_path: string; status: string }>(
        'SELECT qr_token, location_path, status::text FROM aurora.assets WHERE id = $1',
        [id]
      )
    );
    expect(isQrToken(row!.qr_token)).toBe(true);
    expect(row!.qr_token).not.toMatch(/[01ILOU]/);
    expect(row!.location_path).toMatch(new RegExp(`^/${unidade}/${setorUti}/$`));
    expect(row!.status).toBe('active');
  });

  it('aceita ativo sem modelo cadastrado — o caso comum na migração', async () => {
    const id = await withTenant(t.db, ctxA, (s) =>
      createAsset(s, {
        name: 'Bomba antiga sem catálogo',
        customerId: cliente,
        assetCategoryId: catMonitor,
        locationId: setorUti,
      })
    );
    expect(id).toBeTruthy();
  });

  it('recusa local de outro cliente', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createAsset(s, {
          name: 'Ativo confuso',
          customerId: cliente,
          assetCategoryId: catMonitor,
          locationId: setorDois,
        })
      )
    ).rejects.toThrow(/outro cliente/);
  });

  it('recusa data de instalação anterior à fabricação', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(
          `INSERT INTO aurora.assets (id, organization_id, name, customer_id, asset_category_id, qr_token,
                                      manufactured_at, acquired_at)
           VALUES ($1, $2, 'Impossível', $3, $4, $5, DATE '2026-01-01', DATE '2020-01-01')`,
          [newId(), ORG_A, cliente, catMonitor, 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ']
        )
      )
    ).rejects.toThrow(/lifecycle_order|regra/i);
  });
});

describe('unicidade configurável (SPEC §07)', () => {
  it('por padrão, número de série não repete na organização', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createAsset(s, {
          name: 'Ventilador clone',
          customerId: cliente,
          assetCategoryId: catVentilador,
          serialNumber: 'FK0C025472',
        })
      )
    ).rejects.toThrow(/asset_identifiers_uq|já existe/i);
  });

  it('a mesma série escrita de outro jeito também colide', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createAsset(s, {
          name: 'Ventilador clone 2',
          customerId: cliente,
          assetCategoryId: catVentilador,
          serialNumber: 'fk0c-025472',
        })
      )
    ).rejects.toThrow(/asset_identifiers_uq|já existe/i);
  });

  it('campo NÃO configurado como único pode repetir', async () => {
    await withTenant(t.db, ctxA, async (s) => {
      await createAsset(s, {
        name: 'Monitor A',
        customerId: cliente,
        assetCategoryId: catMonitor,
        assetNumber: '7737',
      });
      await createAsset(s, {
        name: 'Monitor B',
        customerId: cliente,
        assetCategoryId: catMonitor,
        assetNumber: '7737',
      });
    });
    const [c] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ c: number }>(`SELECT count(*)::int c FROM aurora.assets WHERE asset_number = '7737'`)
    );
    expect(c!.c).toBe(2);
  });

  /**
   * O defeito que a migration 0016 corrige.
   *
   * A projeção é construída no momento da gravação, conforme a configuração
   * vigente naquele momento. Sem a 0016, ligar "patrimônio é único" valeria só
   * para o que viesse depois: os ativos já cadastrados com patrimônio repetido
   * continuariam lá, invisíveis, e a interface diria que a regra está ativa.
   */
  it('exigir unicidade com duplicata existente é recusado, e a recusa lista o conflito', async () => {
    const conflitos = await withTenant(t.db, ctxA, (s) =>
      s.query<{ field: string; value_normalized: string; asset_count: string }>(
        `SELECT field, value_normalized, asset_count
           FROM aurora.asset_identifier_conflicts($1, ARRAY['asset_number'], 'organization')`,
        [ORG_A]
      )
    );
    expect(conflitos.some((c) => c.value_normalized === '7737')).toBe(true);

    await expect(
      t.raw(
        `UPDATE aurora.organizations SET asset_unique_fields = ARRAY['serial_number','asset_number'] WHERE id = $1`,
        [ORG_A]
      )
    ).rejects.toThrow(/já existem valores repetidos.*7737/s);
  });

  it('resolvida a duplicata, a configuração passa a valer para o acervo inteiro', async () => {
    await withTenant(t.db, ctxA, (s) =>
      s.query(`UPDATE aurora.assets SET asset_number = '7738' WHERE name = 'Monitor B'`)
    );
    await t.raw(
      `UPDATE aurora.organizations SET asset_unique_fields = ARRAY['serial_number','asset_number'] WHERE id = $1`,
      [ORG_A]
    );

    // agora vale para o cadastro novo...
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createAsset(s, {
          name: 'Monitor C',
          customerId: cliente,
          assetCategoryId: catMonitor,
          assetNumber: '7737',
        })
      )
    ).rejects.toThrow(/asset_identifiers_uq|já existe/i);

    // ...e o acervo antigo foi reprojetado, não só o que veio depois
    const [projetados] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ c: number }>(
        `SELECT count(*)::int c FROM aurora.asset_identifiers WHERE field = 'asset_number'`
      )
    );
    expect(projetados!.c).toBeGreaterThanOrEqual(2);

    // volta ao padrão para não contaminar os testes seguintes
    await t.raw(
      `UPDATE aurora.organizations SET asset_unique_fields = ARRAY['serial_number'] WHERE id = $1`,
      [ORG_A]
    );
  });

  it('série vazia não participa da unicidade', async () => {
    await withTenant(t.db, ctxA, async (s) => {
      await createAsset(s, {
        name: 'Sem série 1',
        customerId: cliente,
        assetCategoryId: catMonitor,
        serialNumber: '',
      });
      await createAsset(s, {
        name: 'Sem série 2',
        customerId: cliente,
        assetCategoryId: catMonitor,
        serialNumber: null,
      });
    });
    const [c] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ c: number }>(`SELECT count(*)::int c FROM aurora.assets WHERE name LIKE 'Sem série%'`)
    );
    expect(c!.c).toBe(2);
  });

  it('a mesma série em outra organização é permitida', async () => {
    const outro = await withTenant(t.db, ctxB, async (s) => {
      const c = await createCustomer(s, { name: 'Cliente B' });
      const cat = await createAssetCategory(s, { name: 'Ventilador Pulmonar' });
      return createAsset(s, {
        name: 'Ventilador B',
        customerId: c,
        assetCategoryId: cat,
        serialNumber: 'FK0C025472',
      });
    });
    expect(outro).toBeTruthy();
  });
});

describe('transferência é operação, não edição', () => {
  let ventilador: string;
  let circuito: string;

  beforeAll(async () => {
    await withTenant(t.db, ctxA, async (s) => {
      ventilador = await createAsset(s, {
        name: 'Ventilador conjunto',
        customerId: cliente,
        assetCategoryId: catVentilador,
        locationId: setorUti,
      });
      circuito = await createAsset(s, {
        name: 'Circuito respiratório',
        customerId: cliente,
        assetCategoryId: catVentilador,
        locationId: setorUti,
        parentAssetId: ventilador,
      });
    });
  });

  it('editar location_id direto é recusado pelo banco', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query('UPDATE aurora.assets SET location_id = $2 WHERE id = $1', [ventilador, setorCc])
      )
    ).rejects.toThrow(/exige transferência registrada/);
  });

  it('transferir move o ativo, leva os componentes e deixa registro', async () => {
    const transferencia = await withTenant(t.db, ctxA, (s) =>
      transferAsset(s, ventilador, setorCc, 'realocação para o centro cirúrgico')
    );
    expect(transferencia).toBeTruthy();

    const rows = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string; location_id: string; location_path: string }>(
        'SELECT id, location_id, location_path FROM aurora.assets WHERE id = ANY($1::uuid[])',
        [[ventilador, circuito]]
      )
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.location_id, `ativo ${r.id}`).toBe(setorCc);
      expect(r.location_path).toContain(setorCc);
    }

    const [reg] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ from_location_id: string; to_location_id: string; reason: string; kind: string }>(
        `SELECT from_location_id, to_location_id, reason, kind::text
           FROM aurora.asset_transfers WHERE asset_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
        [ventilador]
      )
    );
    expect(reg!.from_location_id).toBe(setorUti);
    expect(reg!.to_location_id).toBe(setorCc);
    expect(reg!.kind).toBe('transfer');
  });

  it('transferir para o mesmo local é recusado', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) => transferAsset(s, ventilador, setorCc, 'sem movimento nenhum'))
    ).rejects.toThrow(/já está neste local/);
  });

  it('empréstimo para outro cliente muda a situação e exige data de devolução', async () => {
    const emprestado = await withTenant(t.db, ctxA, (s) =>
      createAsset(s, {
        name: 'Ventilador emprestável',
        customerId: cliente,
        assetCategoryId: catVentilador,
        locationId: setorUti,
      })
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        transferAsset(s, emprestado, setorDois, 'empréstimo à parceira', { kind: 'loan' })
      )
    ).rejects.toThrow(/loan_needs_due|regra/i);

    await withTenant(t.db, ctxA, (s) =>
      transferAsset(s, emprestado, setorDois, 'empréstimo à parceira', {
        kind: 'loan',
        dueBackAt: new Date('2026-12-31T00:00:00Z'),
      })
    );
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ status: string; customer_id: string }>(
        'SELECT status::text, customer_id FROM aurora.assets WHERE id = $1',
        [emprestado]
      )
    );
    expect(row!.status).toBe('loaned');
    expect(row!.customer_id).toBe(clienteDois);
  });

  it('a transferência exige motivo com conteúdo', async () => {
    await expect(withTenant(t.db, ctxA, (s) => transferAsset(s, ventilador, setorUti, 'x'))).rejects.toThrow(
      /reason_present|regra/i
    );
  });
});

describe('conjunto pai/filho', () => {
  it('aceita dois níveis e recusa o terceiro', async () => {
    const { componente } = await withTenant(t.db, ctxA, async (s) => {
      const conjunto = await createAsset(s, {
        name: 'Torre de vídeo',
        customerId: cliente,
        assetCategoryId: catMonitor,
      });
      const componente = await createAsset(s, {
        name: 'Câmera',
        customerId: cliente,
        assetCategoryId: catMonitor,
        parentAssetId: conjunto,
      });
      return { conjunto, componente };
    });
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createAsset(s, {
          name: 'Lente',
          customerId: cliente,
          assetCategoryId: catMonitor,
          parentAssetId: componente,
        })
      )
    ).rejects.toThrow(/no máximo dois níveis/);
  });
});

describe('descomissionamento', () => {
  it('exige justificativa', async () => {
    const id = await withTenant(t.db, ctxA, (s) =>
      createAsset(s, { name: 'Ativo a aposentar', customerId: cliente, assetCategoryId: catMonitor })
    );
    await expect(withTenant(t.db, ctxA, (s) => decommissionAsset(s, id, 'velho'))).rejects.toThrow(
      /ao menos 10 caracteres/
    );
    await withTenant(t.db, ctxA, (s) => decommissionAsset(s, id, 'obsolescência declarada em laudo técnico'));
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ status: string; decommissioned_at: string }>(
        'SELECT status::text, decommissioned_at FROM aurora.assets WHERE id = $1',
        [id]
      )
    );
    expect(row!.status).toBe('decommissioned');
    expect(row!.decommissioned_at).not.toBeNull();
  });

  it('recusa descomissionar conjunto com componente em operação, nomeando-o', async () => {
    const { conjunto } = await withTenant(t.db, ctxA, async (s) => {
      const conjunto = await createAsset(s, {
        name: 'Autoclave',
        customerId: cliente,
        assetCategoryId: catMonitor,
      });
      await createAsset(s, {
        name: 'Bomba de vácuo',
        customerId: cliente,
        assetCategoryId: catMonitor,
        parentAssetId: conjunto,
      });
      return { conjunto };
    });
    const erro = await withTenant(t.db, ctxA, async (s) => {
      try {
        await decommissionAsset(s, conjunto, 'substituição por equipamento novo');
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(erro).toMatch(/Bomba de vácuo/);
  });

  it('ativo descomissionado não é transferido', async () => {
    const [aposentado] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.assets WHERE name = 'Ativo a aposentar'`)
    );
    await expect(
      withTenant(t.db, ctxA, (s) => transferAsset(s, aposentado!.id, setorCc, 'tentativa indevida'))
    ).rejects.toThrow(/descomissionado não é transferido/);
  });
});

describe('busca por subárvore de local', () => {
  it('devolve os ativos de toda a subárvore, por prefixo indexado', async () => {
    const naUnidade = await withTenant(t.db, ctxA, (s) => assetsUnderLocation(s, unidade));
    const naUti = await withTenant(t.db, ctxA, (s) => assetsUnderLocation(s, setorUti));
    expect(naUnidade.length).toBeGreaterThan(naUti.length);
    expect(naUti.every((a) => a.location_path.includes(setorUti))).toBe(true);
  });
});

describe('medidores', () => {
  it('leitura acumulada que regride exige justificativa', async () => {
    const { medidor } = await withTenant(t.db, ctxA, async (s) => {
      const ativo = await createAsset(s, {
        name: 'Ativo com horímetro',
        customerId: cliente,
        assetCategoryId: catVentilador,
      });
      const medidor = newId();
      await s.query(
        `INSERT INTO aurora.meters (id, organization_id, asset_id, kind, unit)
         VALUES ($1, $2, $3, 'hours', 'h')`,
        [medidor, ORG_A, ativo]
      );
      await s.query(
        `INSERT INTO aurora.meter_readings (id, organization_id, meter_id, value, read_at)
         VALUES ($1, $2, $3, 1200, now() - interval '1 day')`,
        [newId(), ORG_A, medidor]
      );
      return { medidor };
    });

    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(
          `INSERT INTO aurora.meter_readings (id, organization_id, meter_id, value) VALUES ($1, $2, $3, 900)`,
          [newId(), ORG_A, medidor]
        )
      )
    ).rejects.toThrow(/menor que a anterior/);

    await withTenant(t.db, ctxA, (s) =>
      s.query(
        `INSERT INTO aurora.meter_readings (id, organization_id, meter_id, value, regression_note)
         VALUES ($1, $2, $3, 900, 'placa trocada em 12/03, horímetro zerado')`,
        [newId(), ORG_A, medidor]
      )
    );
    const [c] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ c: number }>('SELECT count(*)::int c FROM aurora.meter_readings WHERE meter_id = $1', [
        medidor,
      ])
    );
    expect(c!.c).toBe(2);
  });
});

describe('importação em massa', () => {
  it('importa, relata erro por linha e não deixa uma linha ruim derrubar as boas', async () => {
    const linhas = [
      {
        line: 1,
        name: 'Monitor 001',
        category: 'Monitor Multiparâmetros',
        manufacturer: 'Mindray',
        model: 'BeneHeart R3',
        location_code: 'UTI-01',
        serial_number: 'IMP-0001',
      },
      { line: 2, name: '', category: 'Monitor Multiparâmetros' },
      { line: 3, name: 'Monitor 003', category: 'Categoria Que Não Existe' },
      {
        line: 4,
        name: 'Monitor 004',
        category: 'Monitor Multiparâmetros',
        manufacturer: 'MINDRAY',
        model: 'BeneHeart R3',
        serial_number: 'IMP-0004',
      },
      { line: 5, name: 'Monitor 005', category: 'Monitor Multiparâmetros', serial_number: 'IMP-0001' },
      { line: 6, name: 'Monitor 006', category: 'Monitor Multiparâmetros', model: 'Sem fabricante' },
      { line: 7, name: 'Monitor 007', category: 'Monitor Multiparâmetros', location_code: 'NAO-EXISTE' },
      {
        line: 8,
        name: 'Monitor 008',
        category: 'Monitor Multiparâmetros',
        manufacturer: 'Líder',
        serial_number: 'IMP-0008',
      },
      { line: 9, name: 'Monitor 009', category: 'Monitor Multiparâmetros', acquired_at: '31/12/2025' },
      { line: 10, name: 'Monitor 010', category: 'Monitor Multiparâmetros', purchase_value: '-5' },
    ];

    const r = await withTenant(t.db, ctxA, (s) => importAssets(s, linhas, { customerId: cliente }));

    expect(r.imported).toBe(3);
    expect(r.failed).toBe(7);
    const porLinha = new Map(r.issues.map((i) => [i.line, i.message]));
    expect(porLinha.get(2)).toMatch(/nome é obrigatório/);
    expect(porLinha.get(3)).toMatch(/não existe/);
    expect(porLinha.get(5)).toMatch(/asset_identifiers_uq|já existe/i);
    expect(porLinha.get(6)).toMatch(/sem fabricante/);
    expect(porLinha.get(7)).toMatch(/local de código/);
    expect(porLinha.get(9)).toMatch(/AAAA-MM-DD/);
    expect(porLinha.get(10)).toMatch(/negativo/);
  });

  it('"Mindray" e "MINDRAY" viram um fabricante só; "Líder" entra separado para curadoria', async () => {
    const fila = await withTenant(t.db, ctxA, (s) => curationQueue(s));
    const nomes = fila.manufacturers.map((m) => m.name).sort();
    expect(nomes).toEqual(['Líder', 'Mindray']);
    expect(fila.models.map((m) => m.name)).toEqual(['BeneHeart R3']);
  });

  it('a curadoria funde duplicata reapontando os modelos', async () => {
    const { lider, liderMaiusculo } = await withTenant(t.db, ctxA, async (s) => {
      const [lider] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.manufacturers WHERE name = 'Líder'`
      );
      const outro = await findOrCreateManufacturer(s, 'Lider Equipamentos', { verified: true });
      await findOrCreateAssetModel(s, {
        manufacturerId: lider!.id,
        categoryId: catMonitor,
        name: 'Modelo Antigo',
      });
      return { lider: lider!.id, liderMaiusculo: outro.id };
    });

    const movidos = await withTenant(t.db, ctxA, (s) => mergeManufacturers(s, lider, liderMaiusculo));
    expect(movidos).toBe(1);

    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ archived_at: string | null; merged_into_id: string }>(
        'SELECT archived_at, merged_into_id FROM aurora.manufacturers WHERE id = $1',
        [lider]
      )
    );
    expect(row!.archived_at).not.toBeNull();
    expect(row!.merged_into_id).toBe(liderMaiusculo);
  });

  it('recusa fundir fabricantes com modelos homônimos, nomeando o problema', async () => {
    const { a, b } = await withTenant(t.db, ctxA, async (s) => {
      const a = await findOrCreateManufacturer(s, 'Alfa Med');
      const b = await findOrCreateManufacturer(s, 'Alpha Medical');
      await findOrCreateAssetModel(s, { manufacturerId: a.id, categoryId: catMonitor, name: 'Serie 3' });
      await findOrCreateAssetModel(s, { manufacturerId: b.id, categoryId: catMonitor, name: 'Série 3' });
      return { a: a.id, b: b.id };
    });
    await expect(withTenant(t.db, ctxA, (s) => mergeManufacturers(s, a, b))).rejects.toThrow(
      /modelos de mesmo nome/
    );
  });

  it('importa um volume grande em tempo utilizável', async () => {
    const N = 3000;
    const linhas = Array.from({ length: N }, (_, i) => ({
      line: i + 1,
      name: `Ativo em massa ${i}`,
      category: 'Monitor Multiparâmetros',
      manufacturer: i % 2 === 0 ? 'Mindray' : 'Philips',
      model: `Modelo ${i % 40}`,
      serial_number: `MASSA-${i}`,
    }));

    const r = await withTenant(t.db, ctxA, (s) => importAssets(s, linhas, { customerId: cliente }));
    expect(r.imported).toBe(N);
    expect(r.issues).toEqual([]);
    // O critério do épico é 27 mil em menos de 10 minutos, ou seja ~22 ms por
    // linha. Aqui medimos 3 mil e comparamos com a mesma taxa, com folga de 2x
    // para o PGlite (WASM, uma conexão) não ser confundido com o alvo.
    const msPorLinha = r.elapsedMs / N;
    expect(msPorLinha, `${msPorLinha.toFixed(1)} ms/linha`).toBeLessThan(44);
  }, 300_000);
});

describe('regras de domínio aplicadas na leitura', () => {
  it('specs do ativo sobrescrevem as do modelo campo a campo', () => {
    const modelo = { tensao_v: 220, classe_risco: 'II', peso_kg: 8 };
    const ativo = { tensao_v: 127 };
    expect(effectiveSpecs(modelo, ativo)).toEqual({ tensao_v: 127, classe_risco: 'II', peso_kg: 8 });
  });

  it('só ativo e em manutenção contam para disponibilidade', () => {
    expect(countsForAvailability('active')).toBe(true);
    expect(countsForAvailability('under_maintenance')).toBe(true);
    expect(countsForAvailability('standby')).toBe(false);
    expect(countsForAvailability('decommissioned')).toBe(false);
  });
});

describe('isolamento entre organizações', () => {
  it('A não vê ativos de B', async () => {
    const vistos = await withTenant(t.db, ctxA, (s) =>
      s.query(`SELECT id FROM aurora.assets WHERE name = 'Ventilador B'`)
    );
    expect(vistos).toEqual([]);
  });

  it('A não transfere ativo de B', async () => {
    const [alheio] = await withTenant(t.db, ctxB, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.assets WHERE name = 'Ventilador B'`)
    );
    await expect(
      withTenant(t.db, ctxA, (s) => transferAsset(s, alheio!.id, setorCc, 'tentativa cross-tenant'))
    ).rejects.toThrow(/inexistente|fora do seu acesso/);
  });
});
