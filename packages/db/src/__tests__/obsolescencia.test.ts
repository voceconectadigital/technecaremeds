/**
 * Laudo de obsolescência como OS própria (conversa com o cliente, 21/10/2026).
 *
 * Numeração própria (OBC-AAAA-NNNN), justificativa técnica, um laudo aberto por equipamento;
 * concluir exige foto; validar descomissiona o equipamento — e gerar o laudo, não.
 * Quem valida assina pela sessão (OS-24 da auditoria de 29/10/2026).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createAssetCategory, createAsset } from '../assets';
import { provisionFactoryRoles } from '../rbac';
import { provisionWorkOrderStates, transitionWorkOrder } from '../work-orders';
import { createObsolescenceReport } from '../obsolescencia';
import { verifySignatures } from '../execution';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'obsolescencia',
  permissions: PERMISSION_KEYS,
});

const JUSTIFICATIVA =
  'Equipamento com 14 anos, sem peças de reposição no fabricante e custo de reparo acima de 70% do valor de reposição.';

let t: TestDatabase;
let ativo: string, outroAtivo: string, laudo: string;

async function statusDoAtivo(id: string): Promise<string> {
  const [a] = await t.admin.query<{ status: string }>(
    `SELECT status::text AS status FROM aurora.assets WHERE id = $1`,
    [id]
  );
  return a!.status;
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'obs', name: 'Prestadora', email: 'coord@obs.test', userName: 'Coordenadora' }
  );
  await withTenant(t.db, ctx, async (s) => {
    await provisionFactoryRoles(s);
    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    const cliente = await createCustomer(s, { name: 'Hospital' });
    const local = await createLocation(s, {
      customerId: cliente,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: local,
    });
    outroAtivo = await createAsset(s, {
      name: 'Ventilador 02',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: local,
    });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('gerar o laudo', () => {
  it('a justificativa técnica curta demais é recusada', async () => {
    await expect(withTenant(t.db, ctx, (s) => createObsolescenceReport(s, ativo, 'velho'))).rejects.toThrow(
      /20 caracteres/
    );
  });

  it('vira uma OS de numeração própria OBC-AAAA-0001, com a justificativa na descrição', async () => {
    const r = await withTenant(t.db, ctx, (s) => createObsolescenceReport(s, ativo, JUSTIFICATIVA));
    laudo = r.id;
    expect(r.number).toMatch(/^OBC-\d{4}-0001$/);
    const [os] = await t.admin.query<{ title: string; description: string; type: string }>(
      `SELECT w.title, w.description, ti.system_key AS type
         FROM aurora.work_orders w JOIN aurora.catalog_items ti ON ti.id = w.work_order_type_id WHERE w.id = $1`,
      [laudo]
    );
    expect(os).toMatchObject({
      title: 'Laudo de obsolescência — Ventilador 01',
      description: JUSTIFICATIVA,
      type: 'obsolescence',
    });
  });

  it('gerar o laudo NÃO desativa o equipamento', async () => {
    expect(await statusDoAtivo(ativo)).toBe('active');
  });

  it('um laudo aberto por equipamento: o segundo é recusado, dizendo qual está em andamento', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => createObsolescenceReport(s, ativo, JUSTIFICATIVA))
    ).rejects.toThrow(/já existe um laudo.*OBC-/);
  });

  it('a série é própria: o laudo de outro equipamento é OBC-…-0002, e a OS comum segue em WO', async () => {
    const r = await withTenant(t.db, ctx, (s) => createObsolescenceReport(s, outroAtivo, JUSTIFICATIVA));
    expect(r.number).toMatch(/^OBC-\d{4}-0002$/);
  });
});

describe('concluir e validar o laudo', () => {
  it('concluir sem foto é recusado', async () => {
    // Leva a OS a "em execução" sem atravessar o fluxo de campo, que não é o assunto aqui.
    await t.admin.transaction(async (tx) => {
      await tx.query(`SET LOCAL session_replication_role = replica`);
      await tx.query(
        `UPDATE aurora.work_orders
            SET status_category = 'in_progress', started_at = now(),
                status_id = (SELECT id FROM aurora.work_order_statuses WHERE key = 'in_progress')
          WHERE id = $1`,
        [laudo]
      );
    });
    await expect(
      withTenant(t.db, ctx, (s) =>
        transitionWorkOrder(s, laudo, 'completed', { resolution: 'Laudo emitido.' })
      )
    ).rejects.toThrow(/ao menos uma foto/);
  });

  it('com a foto, conclui; ao validar, o equipamento é descomissionado com a justificativa do laudo', async () => {
    await t.admin.query(
      `INSERT INTO aurora.attachments
         (id, organization_id, work_order_id, purpose, storage_key, file_name, content_type, byte_size, uploaded_by)
       VALUES ($1, $2, $3, 'before', $4, 'foto.jpg', 'image/jpeg', 1000, $5)`,
      [newId(), ORG, laudo, `orgs/${ORG}/os/${laudo}/foto.jpg`, USER]
    );
    await withTenant(t.db, ctx, (s) =>
      transitionWorkOrder(s, laudo, 'completed', { resolution: 'Laudo emitido.' })
    );
    // Concluído ainda não baixa: quem valida é que aceita o laudo.
    expect(await statusDoAtivo(ativo)).toBe('active');

    await withTenant(t.db, ctx, (s) => transitionWorkOrder(s, laudo, 'validated'));
    expect(await statusDoAtivo(ativo)).toBe('decommissioned');
    const [a] = await t.admin.query<{ decommission_reason: string }>(
      `SELECT decommission_reason FROM aurora.assets WHERE id = $1`,
      [ativo]
    );
    expect(a!.decommission_reason).toContain('sem peças de reposição');
  });

  it('OS-24: quem valida assina pela sessão — resumo SHA-256, e-mail e hora; concluir não assinava', async () => {
    const assinaturas = await t.admin.query<{
      signer_role: string;
      method: string;
      signer_name: string;
      signer_email: string | null;
      signed_content_sha256: string;
      signed_at: Date;
    }>(
      `SELECT signer_role::text AS signer_role, method::text AS method, signer_name, signer_email,
              signed_content_sha256, signed_at
         FROM aurora.signatures WHERE work_order_id = $1`,
      [laudo]
    );
    // Uma só: a da validação. A conclusão (teste anterior) não assinou nada.
    expect(assinaturas).toHaveLength(1);
    const a = assinaturas[0]!;
    expect(a.signer_role).toBe('supervisor');
    expect(a.method).toBe('session');
    expect(a.signer_name).toBe('Coordenadora');
    expect(a.signer_email).toBe('coord@obs.test');
    expect(a.signed_content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.signed_at).toBeTruthy();
    const [v] = await withTenant(t.db, ctx, (s) => verifySignatures(s, laudo));
    expect(v!.still_valid).toBe(true);
  });

  it('equipamento que já saiu de operação não gera outro laudo', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => createObsolescenceReport(s, ativo, JUSTIFICATIVA))
    ).rejects.toThrow(/já está fora de operação/);
  });
});
