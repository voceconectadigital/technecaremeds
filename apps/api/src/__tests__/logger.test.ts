/**
 * Aurora — o log da API não leva dado pessoal (OPS-07 · LGPD, rodada 29/10/2026).
 *
 * CPF, telefone, registro profissional e coordenadas do check-in são mascarados — pela chave, em
 * objetos aninhados e (o CPF) dentro de texto livre. Os segredos continuam `[redacted]`, e o que
 * serve para correlacionar (request_id, rota, código) continua no log.
 */
import { describe, it, expect } from 'vitest';
import { createLogger, maskPersonalDataInText, sanitizeLogValue } from '../common/logger';

function capturar() {
  const linhas: Record<string, unknown>[] = [];
  const logger = createLogger('debug', {}, (l) => linhas.push(JSON.parse(l) as Record<string, unknown>));
  return { logger, linhas };
}

describe('OPS-07 · minimização no log', () => {
  it('mascara CPF, telefone, registro profissional e coordenadas pela chave', () => {
    const { logger, linhas } = capturar();
    logger.info('check-in registrado', {
      request_id: 'req-1',
      cpf: '529.982.247-25',
      phone: '(31) 99999-0000',
      telefone: '3133330000',
      registrations: [{ kind: 'CREA', number: 'MG-123456' }],
      latitude: -19.92,
      longitude: -43.94,
      accuracy_m: 12,
    });
    const l = linhas[0]!;
    expect(l.request_id).toBe('req-1');
    for (const k of ['cpf', 'phone', 'telefone', 'registrations', 'latitude', 'longitude', 'accuracy_m']) {
      expect(l[k], k).toBe('[masked]');
    }
    expect(JSON.stringify(l)).not.toMatch(/529|99999|3333|MG-123456|-19\.92|-43\.94/);
  });

  it('desce nos objetos aninhados e nas listas', () => {
    const { logger, linhas } = capturar();
    logger.warn('corpo inesperado', {
      detalhe: { pessoa: { nome: 'Ana', cpf: '52998224725' }, visitas: [{ lat: 1.5, lng: 2.5 }] },
    });
    const texto = JSON.stringify(linhas[0]);
    expect(texto).not.toContain('52998224725');
    expect(texto).not.toMatch(/1\.5|2\.5/);
    expect(texto).toContain('Ana');
  });

  it('CPF escrito no meio de um texto (mensagem de erro) vira máscara; uuid e números maiores ficam', () => {
    const { logger, linhas } = capturar();
    logger.error('falha ao gravar o CPF 529.982.247-25 do cadastro', {
      error: 'duplicate key (cpf)=(52998224725) already exists',
      entity: '0a1b2c3d-1111-4222-8333-123456789012',
      total: '1234567890123',
    });
    const l = linhas[0]!;
    expect(l.msg).toBe('falha ao gravar o CPF ***.***.***-** do cadastro');
    expect(l.error).toBe('duplicate key (cpf)=(***.***.***-**) already exists');
    expect(l.entity).toBe('0a1b2c3d-1111-4222-8333-123456789012');
    expect(l.total).toBe('1234567890123');
  });

  it('segredos continuam [redacted], e o filho herda a mesma regra', () => {
    const { logger, linhas } = capturar();
    logger
      .child({ authorization: 'Bearer abc', cpf: '52998224725' })
      .info('pedido', { password: 'x', rota: '/v1/x' });
    const l = linhas[0]!;
    expect(l.authorization).toBe('[redacted]');
    expect(l.password).toBe('[redacted]');
    expect(l.cpf).toBe('[masked]');
    expect(l.rota).toBe('/v1/x');
  });

  it('nulo continua nulo (não inventa um dado mascarado); erro vira nome + mensagem mascarada', () => {
    expect(sanitizeLogValue('phone', null)).toBeNull();
    expect(sanitizeLogValue('e', new Error('CPF 52998224725 inválido'))).toEqual({
      name: 'Error',
      message: 'CPF ***.***.***-** inválido',
    });
    expect(maskPersonalDataInText('sem dado pessoal')).toBe('sem dado pessoal');
  });
});
