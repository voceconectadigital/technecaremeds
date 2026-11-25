/**
 * As consultas de impacto da 0092 rodam no banco ANTES dela, e dizem a verdade.
 *
 * O arquivo é executado na produção por uma pessoa: consulta que quebra no meio, ou que discorda da
 * regra que a API vai aplicar, é pior do que não ter consulta. Aqui ele roda inteiro com as estruturas
 * da 0092 removidas, e a lista de equipamentos bloqueados é comparada com `service_block`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext, newId, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createAsset, createAssetCategory } from '../assets';
import { addCoverage, activateContract, createContract } from '../contracts';
import { organizationToday, serviceBlockFor } from '../contract-service';
import { createCustomer } from '../directory';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'pre-0092',
  permissions: PERMISSION_KEYS,
});
let t: TestDatabase;

const SQL = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'docs', 'auditoria', 'consultas-pre-deploy-0092.sql'),
  'utf8'
);
/** Cada consulta com o título do `\echo` que a antecede. */
const consultas = SQL.split(/^\\echo /m)
  .slice(1)
  .map((b) => {
    const fim = b.indexOf('\n');
    return {
      titulo: b.slice(0, fim).trim(),
      sql: b
        .slice(fim + 1)
        .replace(/ROLLBACK;\s*$/, '')
        .trim()
        .replace(/;$/, ''),
    };
  });

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'pre-0092', name: 'Prestadora', email: 'a@pre-0092.test', userName: 'Ana' }
  );
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('consultas de impacto da 0092', () => {
  it('só leem: transação READ ONLY, encerrada em ROLLBACK, e nenhum comando de escrita', () => {
    expect(SQL).toMatch(/^BEGIN TRANSACTION READ ONLY;/m);
    expect(SQL.trim()).toMatch(/ROLLBACK;$/);
    expect(consultas.length).toBeGreaterThanOrEqual(13);
    for (const c of consultas)
      expect(c.sql, c.titulo).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/);
  });

  it('rodam no estado da 0091 e o resultado concorda com a regra que a API aplica', async () => {
    const esperados: string[] = [];
    await withTenant(t.db, ctx, async (s) => {
      const hoje = await organizationToday(s);
      const dia = (n: number) =>
        new Date(Date.parse(`${hoje}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
      const cat = await createAssetCategory(s, { name: 'Monitor' });
      const cliente = async (nome: string, fins: string[]) => {
        const id = await createCustomer(s, { name: nome });
        const ativo = await createAsset(s, { name: `Equip ${nome}`, customerId: id, assetCategoryId: cat });
        for (const [i, fim] of fins.entries()) {
          const k = await createContract(s, {
            customerId: id,
            kind: 'full_service',
            startsOn: i === 0 ? dia(-400) : dia(-1),
            endsOn: fim,
            autoRenew: nome === 'Renova',
          });
          await addCoverage(s, { contractId: k, kind: 'customer' });
          await activateContract(s, k);
        }
        if (await serviceBlockFor(s, { customerId: id, assetId: ativo }, hoje))
          esperados.push(`Equip ${nome}`);
      };
      await cliente('Vencido', [dia(-10)]);
      await cliente('Vigente', [dia(100)]);
      await cliente('SemContrato', []);
      await cliente('Substituido', [dia(-10), dia(300)]);
      await cliente('Renova', [hoje]);
    });
    expect(esperados).toEqual(['Equip Vencido']);

    // O banco como está em produção: sem nada da 0092.
    for (const c of [
      'DROP FUNCTION aurora.service_block(uuid, uuid, date)',
      'DROP TABLE aurora.contract_renewals',
      'ALTER TABLE aurora.plan_tasks DROP COLUMN first_due_on',
      'ALTER TABLE aurora.work_orders DROP COLUMN service_started_at, DROP COLUMN service_ended_at',
      'ALTER TABLE aurora.contracts DROP COLUMN service_hold, DROP COLUMN service_hold_reason, DROP COLUMN service_hold_at, DROP COLUMN service_hold_by',
    ]) {
      await t.raw(c);
    }
    const linhas = new Map<string, Array<Record<string, unknown>>>();
    for (const c of consultas) {
      linhas.set(c.titulo, await t.raw(c.sql));
    }
    const de = (n: string) => [...linhas].find(([k]) => k.startsWith(`'== ${n}`))![1];
    expect(de('2.').map((l) => l.equipamento)).toEqual(esperados);
    expect(de('5. ').map((l) => l.cliente)).toEqual(['Renova']);
    expect(de('1.').map((l) => [l.cliente, l.cliente_tem_outro_valido])).toEqual([
      ['Substituido', true],
      ['Vencido', false],
    ]);
  });
});
