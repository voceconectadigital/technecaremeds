/**
 * Aurora — o contrato descreve o que o domínio e o banco aceitam.
 *
 * `@aurora/contracts` não depende de `@aurora/domain` por desenho, e por isso
 * repete as listas fechadas. Repetição sem prova diverge: foi assim que o
 * contrato passou a dizer `merged` onde a API dizia `duplicate`, `customer`
 * onde o banco dizia `portal`, e a aceitar origens de chamado que o banco
 * recusava com 500. Cada lista repetida tem a sua comparação aqui.
 */
import { describe, it, expect } from 'vitest';
import {
  REQUEST_STATUSES as STATUS_DOMINIO,
  SERVICE_REQUEST_SOURCES as ORIGENS_DOMINIO,
  REQUEST_PRIORITIES as PRIORIDADES_DOMINIO,
} from '@aurora/domain';
import { SEAT_TYPES as ASSENTOS_DB } from '@aurora/db';
import { REQUEST_STATUSES, SERVICE_REQUEST_SOURCES, REQUEST_PRIORITIES, SEAT_TYPES } from '@aurora/contracts';

describe('paridade contrato × domínio × banco', () => {
  it('situações da solicitação', () => {
    expect([...REQUEST_STATUSES].sort()).toEqual([...STATUS_DOMINIO].sort());
  });
  it('origens da solicitação', () => {
    expect([...SERVICE_REQUEST_SOURCES].sort()).toEqual([...ORIGENS_DOMINIO].sort());
  });
  it('prioridades', () => {
    expect([...REQUEST_PRIORITIES]).toEqual([...PRIORIDADES_DOMINIO]);
  });
  it('tipos de assento (o banco tem staff e portal)', () => {
    expect([...SEAT_TYPES]).toEqual(['staff', 'portal']);
    expect([...ASSENTOS_DB]).toEqual(['staff', 'portal']);
  });
});

describe('paridade do contrato comercial (0090)', () => {
  it('naturezas, base de precificação, modalidade, pagamento e equipes fixas', async () => {
    const dominio = await import('@aurora/domain');
    const zod = await import('@aurora/contracts');
    expect([...zod.CONTRACT_KINDS]).toEqual([...dominio.CONTRACT_KINDS]);
    expect([...zod.BILLING_MODELS]).toEqual([...dominio.BILLING_MODELS]);
    expect([...zod.SERVICE_FREQUENCIES]).toEqual([...dominio.SERVICE_FREQUENCIES]);
    expect([...zod.PAYMENT_TERMS]).toEqual([...dominio.PAYMENT_TERMS]);
    expect([...zod.FIXED_TEAM_PACKAGES]).toEqual([...dominio.FIXED_TEAM_PACKAGES]);
  });
});
