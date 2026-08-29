/**
 * Aurora — auxiliares do diretório (EPIC-003).
 * Aqui só o que é puro; o comportamento da árvore é testado contra o banco em
 * packages/db/src/__tests__/directory.test.ts, que é onde ele mora.
 */
import { describe, it, expect } from 'vitest';
import {
  buildLocationPath,
  locationPathIds,
  locationDepth,
  parentIdFromPath,
  isWithinSubtree,
  subtreePrefix,
  rewriteSubtreePath,
  windowsOverlap,
  isValidWindow,
  timeToMinutes,
  normalizeForSearch,
  normalizeIdentifier,
  LOCATION_MAX_DEPTH,
} from '../directory';

const A = '018f0000-0000-7000-8000-000000000001';
const B = '018f0000-0000-7000-8000-000000000002';
const C = '018f0000-0000-7000-8000-000000000003';

describe('caminho materializado', () => {
  it('raiz é o próprio id entre barras', () => {
    expect(buildLocationPath(null, A)).toBe(`/${A}/`);
    expect(locationDepth(buildLocationPath(null, A))).toBe(1);
  });

  it('filho concatena ao caminho do pai', () => {
    const root = buildLocationPath(null, A);
    const child = buildLocationPath(root, B);
    expect(child).toBe(`/${A}/${B}/`);
    expect(locationPathIds(child)).toEqual([A, B]);
    expect(parentIdFromPath(child)).toBe(A);
    expect(parentIdFromPath(root)).toBeNull();
  });

  it('recusa caminho de pai malformado em vez de gerar caminho torto', () => {
    expect(() => buildLocationPath(`${A}/`, B)).toThrow(/malformado/);
    expect(() => buildLocationPath(`/${A}`, B)).toThrow(/malformado/);
  });

  it('não contém curinga de LIKE — é o que torna o prefixo indexável', () => {
    const path = buildLocationPath(buildLocationPath(null, A), B);
    expect(path).not.toMatch(/[%_]/);
    expect(subtreePrefix(path)).toBe(`${path}%`);
  });

  it('um local pertence à própria subárvore', () => {
    const root = buildLocationPath(null, A);
    expect(isWithinSubtree(root, root)).toBe(true);
    expect(isWithinSubtree(buildLocationPath(root, B), root)).toBe(true);
    expect(isWithinSubtree(root, buildLocationPath(root, B))).toBe(false);
  });

  it('reescrita de subárvore preserva a parte de baixo do caminho', () => {
    const oldRoot = `/${A}/${B}/`;
    const newRoot = `/${C}/${B}/`;
    expect(rewriteSubtreePath(`/${A}/${B}/x/y/`, oldRoot, newRoot)).toBe(`/${C}/${B}/x/y/`);
    expect(() => rewriteSubtreePath(`/${C}/`, oldRoot, newRoot)).toThrow(/não pertence/);
  });

  it('o limite de profundidade é o mesmo declarado na migration', () => {
    expect(LOCATION_MAX_DEPTH).toBe(8);
  });
});

describe('janelas de calendário', () => {
  it('turnos encostados convivem; sobrepostos não', () => {
    const manha = { startsAt: '08:00', endsAt: '12:00' };
    const tarde = { startsAt: '12:00', endsAt: '18:00' };
    expect(windowsOverlap(manha, tarde)).toBe(false);
    expect(windowsOverlap(manha, { startsAt: '11:59', endsAt: '18:00' })).toBe(true);
  });

  it('janela contida em outra é sobreposição', () => {
    expect(
      windowsOverlap({ startsAt: '08:00', endsAt: '18:00' }, { startsAt: '10:00', endsAt: '11:00' })
    ).toBe(true);
  });

  it('fim antes do início é janela inválida', () => {
    expect(isValidWindow({ startsAt: '22:00', endsAt: '06:00' })).toBe(false);
    expect(isValidWindow({ startsAt: '22:00', endsAt: '23:59' })).toBe(true);
  });

  it('aceita segundos e recusa horário impossível', () => {
    expect(timeToMinutes('08:30:00')).toBe(510);
    expect(() => timeToMinutes('25:00')).toThrow(/fora de faixa/);
    expect(() => timeToMinutes('8:00')).toThrow(/inválido/);
  });
});

describe('normalização para busca', () => {
  it('remove acento, pontuação e caixa', () => {
    expect(normalizeForSearch('Ambulatório — Sala 05')).toBe('ambulatorio sala 05');
  });

  it('as três grafias do mesmo número de série colidem na forma compacta', () => {
    const formas = ['SN-4471/A', 'sn 4471 a', 'SN4471A'];
    const compactas = new Set(formas.map(normalizeIdentifier));
    expect(compactas.size).toBe(1);
    expect([...compactas][0]).toBe('sn4471a');
  });

  it('texto só de pontuação vira string vazia, não espaço solto', () => {
    expect(normalizeForSearch('  ---  ')).toBe('');
  });
});
