import { describe, it, expect, beforeEach } from 'vitest';
import { newId, isUuid, isUuidV7, timestampOf, __resetIdFactory } from '../id';

describe('fábrica de UUID v7 (ADR-024)', () => {
  beforeEach(() => __resetIdFactory());

  it('produz formato de UUID válido', () => {
    for (let i = 0; i < 200; i++) expect(isUuid(newId())).toBe(true);
  });

  it('produz versão 7 e variante RFC 9562 em todos os ids', () => {
    for (let i = 0; i < 500; i++) {
      const id = newId();
      expect(id[14], `versão errada em ${id}`).toBe('7');
      const variant = parseInt(id[19]!, 16);
      expect(variant, `variante errada em ${id}`).toBeGreaterThanOrEqual(0x8);
      expect(variant).toBeLessThanOrEqual(0xb);
      expect(isUuidV7(id)).toBe(true);
    }
  });

  it('é monotônico dentro do mesmo milissegundo', () => {
    const fixed = 1_800_000_000_000;
    const ids = Array.from({ length: 1000 }, () => newId(fixed));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('é monotônico ao longo do tempo', () => {
    const ids = [newId(1_800_000_000_000), newId(1_800_000_000_001), newId(1_800_000_001_000)];
    expect([...ids].sort()).toEqual(ids);
  });

  it('não regride quando o relógio anda para trás', () => {
    const a = newId(1_800_000_000_000);
    const b = newId(1_799_999_999_000); // NTP puxou o relógio para trás
    expect(b > a).toBe(true);
  });

  it('mantém monotonicidade ao estourar o contador de 12 bits', () => {
    const fixed = 1_800_000_000_000;
    const ids = Array.from({ length: 5000 }, () => newId(fixed));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(5000);
  });

  it('não colide em volume', () => {
    const ids = new Set(Array.from({ length: 50_000 }, () => newId()));
    expect(ids.size).toBe(50_000);
  });

  it('embute o timestamp de criação', () => {
    const when = 1_800_000_000_000;
    expect(timestampOf(newId(when)).getTime()).toBe(when);
  });

  it('rejeita valores que não são UUID v7', () => {
    expect(isUuidV7('00000000-0000-4000-8000-000000000000')).toBe(false); // v4
    expect(isUuidV7('não é uuid')).toBe(false);
    expect(isUuidV7(null)).toBe(false);
    expect(() => timestampOf('00000000-0000-4000-8000-000000000000')).toThrow(TypeError);
  });
});
