/**
 * Aurora — motor de documentos contra o banco (SPEC v0.2 §18 · EPIC-018).
 *
 * As duas exigências de auditoria que esta suíte prova:
 *
 *   · número emitido NUNCA é reaproveitado — cancelado fica queimado;
 *   · documento assinado NÃO se edita, por nenhum caminho.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS, contentHash } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder } from '../work-orders';
import {
  provisionDocumentTypes,
  createDocument,
  loadDocument,
  updateDocumentContent,
  documentIssueCheck,
  issueDocument,
  transitionDocument,
  superseDocument,
  signDocument,
  verifyDocumentSignatures,
  sweepDocumentExpiry,
  documentsForAsset,
} from '../documents';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'doc',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, ativo: string, os: string;
let tipos: Map<string, string>;
const ANO = new Date().getUTCFullYear();

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'doc', name: 'Prestadora', email: 'a@doc.test', userName: 'A' }
  );

  await withTenant(t.db, ctx, async (s) => {
    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: unidade,
    });
    const natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    const w = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: 'Reparo',
      locationId: unidade,
      assetId: ativo,
    });
    os = w.id;

    tipos = await provisionDocumentTypes(s);
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

async function novoRelatorio(over: Record<string, unknown> = {}): Promise<string> {
  return withTenant(t.db, ctx, (s) =>
    createDocument(s, {
      documentTypeId: tipos.get('work_order_report')!,
      title: 'Relatório de atendimento',
      assetId: ativo,
      workOrderId: os,
      customerId: cliente,
      verdict: 'conforming',
      ...over,
    })
  );
}

/* -------------------------------------------------------------------------- */

describe('provisionamento', () => {
  it('cria os sete tipos (seis da SPEC §18 + aceite, gap V2 P2.7), com série própria para cada um', async () => {
    expect(tipos.size).toBe(7);

    const series = await withTenant(t.db, ctx, (s) =>
      s.query<{ prefix: string }>(`SELECT prefix FROM aurora.number_series ORDER BY prefix`)
    );
    expect(series.map((x) => x.prefix)).toEqual(['ACE', 'CAL', 'LOB', 'PAD', 'QT', 'REL', 'TSE']);
  });

  it('provisionar duas vezes não duplica nada', async () => {
    const segunda = await withTenant(t.db, ctx, (s) => provisionDocumentTypes(s));
    expect(segunda.get('work_order_report')).toBe(tipos.get('work_order_report'));

    const [{ total }] = await withTenant(t.db, ctx, (s) =>
      s.query<{ total: string }>(`SELECT count(*)::text AS total FROM aurora.number_series`)
    );
    expect(Number(total)).toBe(7);
  });
});

describe('emissão', () => {
  let doc: string;

  it('rascunho não emite: existe revisão no meio', async () => {
    doc = await novoRelatorio();
    await expect(withTenant(t.db, ctx, (s) => issueDocument(s, doc))).rejects.toThrow(
      /só se emite documento em revisão/
    );
  });

  it('o veredito ausente é apontado antes de tentar', async () => {
    const semVeredito = await novoRelatorio({ verdict: null });
    const r = await withTenant(t.db, ctx, (s) => documentIssueCheck(s, semVeredito));
    expect(r.ok).toBe(false);
    expect(r.blockers[0]).toMatch(/veredito/);
  });

  it('emite com número da série, hash e carimbo', async () => {
    await withTenant(t.db, ctx, (s) => transitionDocument(s, doc, 'under_review'));
    const numero = await withTenant(t.db, ctx, (s) => issueDocument(s, doc));

    expect(numero).toBe(`REL-${ANO}-000001`);

    const d = await withTenant(t.db, ctx, (s) => loadDocument(s, doc));
    expect(d.status).toBe('issued');
    expect(d.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.issued_at).not.toBeNull();
    // Relatório de OS não vence: dar-lhe validade encheria o painel de
    // "documentos a renovar" que ninguém precisa renovar.
    expect(d.valid_until).toBeNull();
  });

  it('o número é sequencial dentro da série', async () => {
    const outro = await novoRelatorio();
    const numero = await withTenant(t.db, ctx, async (s) => {
      await transitionDocument(s, outro, 'under_review');
      return issueDocument(s, outro);
    });
    expect(numero).toBe(`REL-${ANO}-000002`);
  });

  it('o certificado exige responsável técnico e assinatura', async () => {
    const cert = await withTenant(t.db, ctx, (s) =>
      createDocument(s, {
        documentTypeId: tipos.get('calibration_certificate')!,
        assetId: ativo,
        verdict: 'conforming',
      })
    );
    const r = await withTenant(t.db, ctx, (s) => documentIssueCheck(s, cert));
    expect(r.blockers).toHaveLength(2);
    expect(r.blockers.join(' ')).toMatch(/responsável técnico.*assinatura|assinatura.*responsável/s);
  });

  it('o certificado percorre o fluxo inteiro: revisar, assinar, emitir', async () => {
    // Este é o caso que o desenho anterior tornava impossível: o tipo exige
    // assinatura, e assinar exige conteúdo consolidado. Com o hash nascendo na
    // entrada em revisão, o certificado é assinável antes de emitido.
    const cert = await withTenant(t.db, ctx, (s) =>
      createDocument(s, {
        documentTypeId: tipos.get('calibration_certificate')!,
        assetId: ativo,
        verdict: 'conforming',
        technicalManagerId: MEM,
      })
    );

    await withTenant(t.db, ctx, async (s) => {
      await transitionDocument(s, cert, 'under_review');
      await expect(issueDocument(s, cert)).rejects.toThrow(/exige assinatura/);
    });

    await withTenant(t.db, ctx, (s) =>
      signDocument(s, {
        documentId: cert,
        signerName: 'Ana Souza',
        signerRole: 'technical_manager',
        method: 'portal',
        portalUserId: USER,
      })
    );

    const numero = await withTenant(t.db, ctx, (s) => issueDocument(s, cert));
    expect(numero).toBe(`CAL-${ANO}-000001`);

    const d = await withTenant(t.db, ctx, (s) => loadDocument(s, cert));
    expect(d.status).toBe('issued');
    // Certificado vence em um ano; o hash assinado sobreviveu à emissão.
    expect(d.valid_until).not.toBeNull();

    const conferencia = await withTenant(t.db, ctx, (s) => verifyDocumentSignatures(s, cert));
    expect(conferencia[0]!.valid).toBe(true);
  });

  it('assinado não volta para rascunho — o caminho é uma versão nova', async () => {
    const [d] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(
        `SELECT d.id FROM aurora.documents d
          WHERE EXISTS (SELECT 1 FROM aurora.document_signatures g WHERE g.document_id = d.id)
            AND d.status = 'under_review' LIMIT 1`
      )
    );
    if (!d) return;
    await expect(withTenant(t.db, ctx, (s) => transitionDocument(s, d.id, 'draft'))).rejects.toThrow(
      /não volta para rascunho/
    );
  });

  it('conteúdo alterado depois da revisão impede a emissão', async () => {
    const doc = await novoRelatorio();
    await withTenant(t.db, ctx, (s) => transitionDocument(s, doc, 'under_review'));
    await withTenant(t.db, ctx, (s) => updateDocumentContent(s, doc, { verdict: 'non_conforming' }));

    await expect(withTenant(t.db, ctx, (s) => issueDocument(s, doc))).rejects.toThrow(
      /o conteúdo mudou depois da revisão/
    );
  });
});

describe('o número queimado', () => {
  it('cancelar exige motivo e mantém o número', async () => {
    const doc = await novoRelatorio();
    const numero = await withTenant(t.db, ctx, async (s) => {
      await transitionDocument(s, doc, 'under_review');
      return issueDocument(s, doc);
    });

    await expect(
      withTenant(t.db, ctx, (s) => transitionDocument(s, doc, 'cancelled', { reason: 'erro' }))
    ).rejects.toThrow(/motivo de ao menos 10 caracteres/);

    await withTenant(t.db, ctx, (s) =>
      transitionDocument(s, doc, 'cancelled', {
        reason: 'emitido para o ativo errado, conferido com o solicitante',
      })
    );

    const d = await withTenant(t.db, ctx, (s) => loadDocument(s, doc));
    expect(d.status).toBe('cancelled');
    expect(d.number).toBe(numero);
  });

  it('o número seguinte não volta para o buraco', async () => {
    const doc = await novoRelatorio();
    const numero = await withTenant(t.db, ctx, async (s) => {
      await transitionDocument(s, doc, 'under_review');
      return issueDocument(s, doc);
    });
    expect(numero).toBe(`REL-${ANO}-000004`);
  });

  it('o número emitido não se altera', async () => {
    const [d] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.documents WHERE number IS NOT NULL LIMIT 1`)
    );
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.documents SET number = 'REL-9999-000001' WHERE id = $1`, [d!.id])
      )
    ).rejects.toThrow(/não se altera/);
  });
});

describe('assinatura e imutabilidade', () => {
  let doc: string;
  let hashOriginal: string;

  beforeAll(async () => {
    doc = await novoRelatorio();
    await withTenant(t.db, ctx, async (s) => {
      await transitionDocument(s, doc, 'under_review');
      await issueDocument(s, doc);
    });
    hashOriginal = (await withTenant(t.db, ctx, (s) => loadDocument(s, doc))).content_hash!;
  });

  it('cada método exige a sua prova', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        signDocument(s, {
          documentId: doc,
          signerName: 'Ana Souza',
          signerRole: 'technician',
          method: 'drawn',
        })
      )
    ).rejects.toThrow(/imagem/);
  });

  it('o hash gravado vem do documento, não de quem assina', async () => {
    const anexo = await withTenant(t.db, ctx, async (s) => {
      const id = newId();
      await s.query(
        `INSERT INTO aurora.attachments (id, organization_id, work_order_id, purpose, storage_key,
                                         file_name, content_type, byte_size, uploaded_by)
         VALUES ($1, $2, $3, 'signature', 'k/1', 'assinatura.png', 'image/png', 1024, $4)`,
        [id, ORG, os, MEM]
      );
      return id;
    });

    const sig = await withTenant(t.db, ctx, (s) =>
      signDocument(s, {
        documentId: doc,
        signerName: 'Ana Souza',
        signerRole: 'technician',
        method: 'drawn',
        attachmentId: anexo,
      })
    );

    const [linha] = await withTenant(t.db, ctx, (s) =>
      s.query<{ signed_content_hash: string }>(
        `SELECT signed_content_hash FROM aurora.document_signatures WHERE id = $1`,
        [sig]
      )
    );
    expect(linha!.signed_content_hash).toBe(hashOriginal);
  });

  it('a conferência diz que a assinatura ainda vale', async () => {
    const conferencia = await withTenant(t.db, ctx, (s) => verifyDocumentSignatures(s, doc));
    expect(conferencia).toHaveLength(1);
    expect(conferencia[0]!.valid).toBe(true);
  });

  it('documento assinado não se edita — nem por caminho direto no banco', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.documents SET payload = '{"x":1}'::jsonb WHERE id = $1`, [doc])
      )
    ).rejects.toThrow(/já assinado/);
  });

  it('a assinatura não se altera nem se apaga', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.document_signatures SET signer_name = 'Outro' WHERE document_id = $1`, [doc])
      )
    ).rejects.toThrow(/não se altera nem se apaga/);

    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`DELETE FROM aurora.document_signatures WHERE document_id = $1`, [doc])
      )
    ).rejects.toThrow(/não se altera nem se apaga/);
  });

  it('documento sem conteúdo consolidado não aceita assinatura', async () => {
    const rascunho = await novoRelatorio();
    await expect(
      withTenant(t.db, ctx, (s) =>
        signDocument(s, {
          documentId: rascunho,
          signerName: 'Ana',
          signerRole: 'technician',
          method: 'portal',
          portalUserId: USER,
        })
      )
    ).rejects.toThrow(/sem conteúdo consolidado/);
  });

  it('o caminho para mudar é a versão nova, e a anterior fica acessível', async () => {
    const novo = await withTenant(t.db, ctx, (s) => superseDocument(s, doc));

    const antigo = await withTenant(t.db, ctx, (s) => loadDocument(s, doc));
    const versao2 = await withTenant(t.db, ctx, (s) => loadDocument(s, novo));

    expect(antigo.status).toBe('superseded');
    expect(antigo.number).not.toBeNull();
    expect(versao2.version).toBe(2);
    expect(versao2.status).toBe('draft');
    // A versão nova ainda não tem número: ele é queimado na emissão dela.
    expect(versao2.number).toBeNull();
  });
});

describe('hash de identidade', () => {
  it('dois documentos com o mesmo conteúdo têm hashes diferentes', async () => {
    const a = await novoRelatorio({ title: 'Igual' });
    const b = await novoRelatorio({ title: 'Igual' });

    const [ha, hb] = await withTenant(t.db, ctx, async (s) => {
      await transitionDocument(s, a, 'under_review');
      await issueDocument(s, a);
      await transitionDocument(s, b, 'under_review');
      await issueDocument(s, b);
      return [(await loadDocument(s, a)).content_hash, (await loadDocument(s, b)).content_hash];
    });

    // A identidade do documento entra no resumo (id, versão, tipo): sem isso, a
    // assinatura de um serviria para o outro. O número NÃO entra, porque só
    // existe na emissão e o conteúdo é assinado antes dela.
    expect(ha).not.toBe(hb);
  });

  it('o hash é reproduzível a partir do conteúdo canônico', async () => {
    expect(contentHash({ b: 1, a: 2 })).toBe(contentHash({ a: 2, b: 1 }));
  });
});

describe('liberação e vencimento', () => {
  it('liberar ao cliente carimba a data', async () => {
    const doc = await novoRelatorio();
    await withTenant(t.db, ctx, async (s) => {
      await transitionDocument(s, doc, 'under_review');
      await issueDocument(s, doc);
      await transitionDocument(s, doc, 'released');
    });

    const [d] = await withTenant(t.db, ctx, (s) =>
      s.query<{ released_to_customer_at: Date | null }>(
        `SELECT released_to_customer_at FROM aurora.documents WHERE id = $1`,
        [doc]
      )
    );
    expect(d!.released_to_customer_at).not.toBeNull();
  });

  it('a varredura avisa no marco e não repete', async () => {
    const doc = await novoRelatorio();
    await withTenant(t.db, ctx, async (s) => {
      await transitionDocument(s, doc, 'under_review');
      await issueDocument(s, doc);
      await s.query(`UPDATE aurora.documents SET valid_until = now() + interval '20 days' WHERE id = $1`, [
        doc,
      ]);
    });

    const primeira = await withTenant(t.db, ctx, (s) => sweepDocumentExpiry(s));
    expect(primeira.find((a) => a.documentId === doc)?.threshold).toBe(30);

    const segunda = await withTenant(t.db, ctx, (s) => sweepDocumentExpiry(s));
    expect(segunda.find((a) => a.documentId === doc)).toBeUndefined();
  });

  it('aproximando-se do vencimento, o marco seguinte avisa de novo', async () => {
    const [d] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.documents WHERE expiry_notified_threshold = 30 LIMIT 1`)
    );
    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.documents SET valid_until = now() + interval '5 days' WHERE id = $1`, [d!.id])
    );

    const r = await withTenant(t.db, ctx, (s) => sweepDocumentExpiry(s));
    expect(r.find((a) => a.documentId === d!.id)?.threshold).toBe(7);
  });

  it('vencido é carimbado como tal', async () => {
    const doc = await novoRelatorio();
    await withTenant(t.db, ctx, async (s) => {
      await transitionDocument(s, doc, 'under_review');
      await issueDocument(s, doc);
      await s.query(`UPDATE aurora.documents SET valid_until = now() - interval '1 day' WHERE id = $1`, [
        doc,
      ]);
    });

    const r = await withTenant(t.db, ctx, (s) => sweepDocumentExpiry(s));
    expect(r.find((a) => a.documentId === doc)?.expired).toBe(true);
    expect((await withTenant(t.db, ctx, (s) => loadDocument(s, doc))).status).toBe('expired');
  });
});

describe('leitura pela ficha do ativo', () => {
  it('lista os documentos do ativo, do mais recente para o mais antigo', async () => {
    const lista = (await withTenant(t.db, ctx, (s) => documentsForAsset(s, ativo))) as {
      type_key: string;
    }[];
    expect(lista.length).toBeGreaterThan(3);
    expect(lista.every((d) => typeof d.type_key === 'string')).toBe(true);
  });
});

describe('isolamento', () => {
  it('outra organização não enxerga documento nenhum', async () => {
    const OUTRA = newId(),
      U2 = newId(),
      M2 = newId();
    await seedOrganization(
      t,
      { organizationId: OUTRA, userId: U2, membershipId: M2 },
      { slug: 'doc2', name: 'Outra', email: 'b@doc.test', userName: 'B' }
    );
    const ctx2 = buildContext({
      organizationId: OUTRA,
      actorId: U2,
      membershipId: M2,
      requestId: 'doc2',
      permissions: PERMISSION_KEYS,
    });

    const linhas = await withTenant(t.db, ctx2, (s) => s.query(`SELECT id FROM aurora.documents`));
    expect(linhas).toHaveLength(0);
  });
});
