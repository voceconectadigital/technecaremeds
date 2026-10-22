import { describe, expect, it } from 'vitest';
import { frasePorVencimento } from '../features/qualidade/pagina';

describe('a frase do vencimento do certificado', () => {
  const hoje = new Date(2026, 9, 21); // 21/10/2026

  it('vence daqui a alguns dias, hoje, ou venceu há alguns dias', () => {
    expect(frasePorVencimento('2026-11-02', hoje)).toBe('Vence em 12 dias (02/11/2026)');
    expect(frasePorVencimento('2026-10-22', hoje)).toBe('Vence em 1 dia (22/10/2026)');
    expect(frasePorVencimento('2026-10-21', hoje)).toBe('Vence hoje (21/10/2026)');
    expect(frasePorVencimento('2026-10-20', hoje)).toBe('Venceu há 1 dia (20/10/2026)');
    expect(frasePorVencimento('2026-10-01', hoje)).toBe('Venceu há 20 dias (01/10/2026)');
  });

  it('sem validade informada, diz isso — e não inventa uma data', () => {
    expect(frasePorVencimento(null, hoje)).toBe('Sem validade informada');
  });
});
