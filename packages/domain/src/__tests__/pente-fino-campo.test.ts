/**
 * Aurora — regras puras do pente-fino de campo (PF-14, PF-65, PF-84).
 */
import { describe, it, expect } from 'vitest';
import {
  deviceInstant,
  executionRestrictedToAssignment,
  contentMatchesDeclaredType,
  SNIFFABLE_CONTENT_TYPES,
  ValidationError,
} from '../index';

const AGORA = new Date('2026-10-17T12:00:00.000Z');

describe('PF-14 · quem a regra de atribuição alcança', () => {
  it('execute sem execute_any: restrito', () => {
    expect(executionRestrictedToAssignment(new Set(['work_order.execute']))).toBe(true);
  });
  it('execute_any (com ou sem execute): livre', () => {
    expect(executionRestrictedToAssignment(new Set(['work_order.execute_any']))).toBe(false);
    expect(executionRestrictedToAssignment(new Set(['work_order.execute', 'work_order.execute_any']))).toBe(
      false
    );
  });
  it('nenhuma das duas (o gestor que só conclui): a permissão da rota decide', () => {
    expect(executionRestrictedToAssignment(new Set(['work_order.complete']))).toBe(false);
  });
});

describe('PF-65 · a hora do aparelho', () => {
  it('ausente → null (vale a hora do servidor)', () => {
    expect(deviceInstant(undefined, 'started_at', AGORA)).toBeNull();
    expect(deviceInstant(null, 'started_at', AGORA)).toBeNull();
  });
  it('dentro da janela é aceita como veio', () => {
    expect(deviceInstant('2026-10-17T09:00:00.000Z', 'started_at', AGORA)?.toISOString()).toBe(
      '2026-10-17T09:00:00.000Z'
    );
    // Limites: exatamente 5 min adiante e exatamente 48 h atrás ainda passam.
    expect(deviceInstant('2026-10-17T12:05:00.000Z', 'x', AGORA)).not.toBeNull();
    expect(deviceInstant('2026-10-15T12:00:00.000Z', 'x', AGORA)).not.toBeNull();
  });
  it('fora da janela ou malformada → 422 nomeando o campo', () => {
    for (const bruto of ['2026-10-17T12:05:00.001Z', '2026-10-15T11:59:59.999Z', 'amanhã', 42]) {
      let erro: unknown;
      try {
        deviceInstant(bruto, 'ended_at', AGORA);
      } catch (e) {
        erro = e;
      }
      expect(erro, String(bruto)).toBeInstanceOf(ValidationError);
      expect((erro as ValidationError).details.field).toBe('ended_at');
    }
  });
});

describe('PF-84 · o conteúdo confere com o tipo declarado', () => {
  it('JPEG de verdade passa; HTML declarado como JPEG não', () => {
    expect(contentMatchesDeclaredType('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(contentMatchesDeclaredType('image/jpeg', new TextEncoder().encode('<html>'))).toBe(false);
  });
  it('texto (CSV, JSON) não tem assinatura e fica fora da conferência', () => {
    expect(SNIFFABLE_CONTENT_TYPES).not.toContain('text/csv');
    expect(SNIFFABLE_CONTENT_TYPES).toContain('application/pdf');
  });
});
