import { describe, expect, it } from 'vitest';
import { iconeDaProfissao } from '../features/configuracoes/profissao';

describe('ícone da profissão', () => {
  it.each([
    ['Médico(a)', 'doctor'],
    ['Enfermeira', 'nurse'],
    ['Técnico(a) de enfermagem', 'nurse'],
    ['Auxiliar de enfermagem', 'nurse'],
    ['ENGENHEIRO(A) CLÍNICO', 'engineer'],
    ['Técnico(a)', 'technician'],
    ['Comprador(a)', 'buyer'],
    ['Gerente de manutenção', 'manager'],
    ['Diretor(a)', 'executive'],
    ['Empresária', 'executive'],
    ['Astronauta', 'person'],
    ['', 'person'],
    [null, 'person'],
  ])('%s → %s', (titulo, esperado) => {
    expect(iconeDaProfissao(titulo)).toBe(esperado);
  });
});
