/**
 * Aurora — dias até o fim da vigência (homologação 23/11/2026).
 *
 * CT-2026-00001 terminava em 23/11/2026 e aparecia "Vencido" ao lado de
 * "Vigente" no próprio dia final: a lista lia `ends_on` como meia-noite UTC.
 * O último dia conta, como em `contractTermStatus` no servidor.
 */
import { describe, it, expect } from 'vitest';
import { contractTermStatus } from '@aurora/domain';
import { diasAteOFimDaVigencia } from '../features/comercial/rotulos-contrato';

describe('diasAteOFimDaVigencia', () => {
  it('no último dia da vigência é 0, não vencido', () => {
    expect(diasAteOFimDaVigencia('2026-11-23', '2026-11-23')).toBe(0);
  });

  it('no dia seguinte ao fim é -1', () => {
    expect(diasAteOFimDaVigencia('2026-11-23', '2026-11-24')).toBe(-1);
  });

  it('conta dias de calendário através de mês e ano', () => {
    expect(diasAteOFimDaVigencia('2027-01-02', '2026-12-31')).toBe(2);
    expect(diasAteOFimDaVigencia('2026-11-02', '2026-10-31')).toBe(2);
  });

  it('aceita data com hora e ignora a hora', () => {
    expect(diasAteOFimDaVigencia('2026-11-23T00:00:00Z', '2026-11-23')).toBe(0);
  });

  it('concorda com a situação calculada pelo servidor', () => {
    for (const hoje of ['2026-11-22', '2026-11-23', '2026-11-24']) {
      const vencidoNaTela = diasAteOFimDaVigencia('2026-11-23', hoje) < 0;
      const vencidoNoServidor = contractTermStatus('2025-11-23', '2026-11-23', hoje) === 'expired';
      expect(vencidoNaTela).toBe(vencidoNoServidor);
    }
  });
});
