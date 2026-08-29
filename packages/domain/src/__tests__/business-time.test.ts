/**
 * Aurora — tempo útil (SPEC v0.2 §11 · EPIC-010).
 *
 * Este é o cálculo mais fácil de errar do produto inteiro, e o erro é
 * silencioso: um SLA que diz "cumprido" quando estourou não avisa ninguém. Por
 * isso a suíte é grande e cheia de casos concretos, com fusos reais e feriados
 * reais.
 */
import { describe, it, expect } from 'vitest';
import {
  businessMinutesBetween,
  addBusinessMinutes,
  isWithinBusinessHours,
  alwaysOpenCalendar,
  zonedParts,
  instantFromZoned,
  windowsForDay,
  EmptyCalendarError,
  type BusinessCalendar,
} from '../business-time';

/** Segunda a sexta, 08:00–18:00, horário de São Paulo. */
const comercial: BusinessCalendar = {
  timeZone: 'America/Sao_Paulo',
  windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startsAt: '08:00', endsAt: '18:00' })),
  exceptions: [],
};

/** Com intervalo de almoço: 08:00–12:00 e 13:00–18:00. */
const comAlmoco: BusinessCalendar = {
  timeZone: 'America/Sao_Paulo',
  windows: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startsAt: '08:00', endsAt: '12:00' },
    { weekday, startsAt: '13:00', endsAt: '18:00' },
  ]),
  exceptions: [],
};

/** 2026-08-24 é uma segunda-feira. */
const seg = (hhmm: string) => new Date(`2026-08-24T${hhmm}:00-03:00`);
const ter = (hhmm: string) => new Date(`2026-08-25T${hhmm}:00-03:00`);
const sab = (hhmm: string) => new Date(`2026-08-29T${hhmm}:00-03:00`);

describe('conversão de fuso', () => {
  it('lê as partes locais corretas em São Paulo', () => {
    const p = zonedParts(new Date('2026-08-24T14:30:00-03:00'), 'America/Sao_Paulo');
    expect(p).toEqual({ year: 2026, month: 8, day: 24, hour: 14, minute: 30, weekday: 1 });
  });

  it('o mesmo instante tem hora diferente em Manaus', () => {
    const instante = new Date('2026-08-24T14:30:00-03:00');
    expect(zonedParts(instante, 'America/Sao_Paulo').hour).toBe(14);
    expect(zonedParts(instante, 'America/Manaus').hour).toBe(13);
  });

  it('hora local volta ao mesmo instante', () => {
    const instante = instantFromZoned('America/Sao_Paulo', 2026, 8, 24, 8 * 60);
    expect(instante.toISOString()).toBe('2026-08-24T11:00:00.000Z');
    expect(zonedParts(instante, 'America/Sao_Paulo').hour).toBe(8);
  });

  it('meia-noite não vira 24 horas', () => {
    const p = zonedParts(new Date('2026-08-24T00:00:00-03:00'), 'America/Sao_Paulo');
    expect(p.hour).toBe(0);
    expect(p.day).toBe(24);
  });
});

describe('minutos úteis dentro do mesmo dia', () => {
  it('conta só o que está dentro da janela', () => {
    expect(businessMinutesBetween(seg('09:00'), seg('11:00'), comercial)).toBe(120);
  });

  it('o que começa antes da abertura só conta a partir dela', () => {
    expect(businessMinutesBetween(seg('06:00'), seg('09:00'), comercial)).toBe(60);
  });

  it('o que termina depois do fechamento para no fechamento', () => {
    expect(businessMinutesBetween(seg('17:00'), seg('23:00'), comercial)).toBe(60);
  });

  it('intervalo inteiramente fora da janela conta zero', () => {
    expect(businessMinutesBetween(seg('19:00'), seg('23:00'), comercial)).toBe(0);
  });

  it('fim antes do início conta zero, não negativo', () => {
    expect(businessMinutesBetween(seg('11:00'), seg('09:00'), comercial)).toBe(0);
  });

  it('o intervalo de almoço não conta', () => {
    expect(businessMinutesBetween(seg('11:00'), seg('14:00'), comAlmoco)).toBe(120);
  });
});

describe('minutos úteis atravessando dias', () => {
  it('de uma tarde para a manhã seguinte soma só as janelas', () => {
    // segunda 17:00 → terça 09:00 = 1 h de segunda + 1 h de terça
    expect(businessMinutesBetween(seg('17:00'), ter('09:00'), comercial)).toBe(120);
  });

  it('o fim de semana não conta', () => {
    // sexta 17:00 → segunda seguinte 09:00 = 1 h + 1 h
    const sex = new Date('2026-08-28T17:00:00-03:00');
    const segSeguinte = new Date('2026-08-31T09:00:00-03:00');
    expect(businessMinutesBetween(sex, segSeguinte, comercial)).toBe(120);
  });

  it('uma semana inteira dá cinco dias de dez horas', () => {
    const de = new Date('2026-08-24T00:00:00-03:00');
    const ate = new Date('2026-08-31T00:00:00-03:00');
    expect(businessMinutesBetween(de, ate, comercial)).toBe(5 * 10 * 60);
  });
});

describe('feriado e plantão', () => {
  const comFeriado: BusinessCalendar = {
    ...comercial,
    exceptions: [{ date: '2026-08-25', kind: 'holiday' }],
  };

  it('feriado zera o dia', () => {
    expect(businessMinutesBetween(ter('08:00'), ter('18:00'), comFeriado)).toBe(0);
  });

  it('o prazo pula o feriado', () => {
    // segunda 17:00 + 2 h úteis: 1 h na segunda, terça é feriado, 1 h na quarta
    const prazo = addBusinessMinutes(seg('17:00'), 120, comFeriado);
    expect(zonedParts(prazo, 'America/Sao_Paulo')).toMatchObject({ day: 26, hour: 9 });
  });

  it('plantão de sábado substitui a grade daquele dia', () => {
    const comPlantao: BusinessCalendar = {
      ...comercial,
      exceptions: [{ date: '2026-08-29', kind: 'extended', startsAt: '09:00', endsAt: '13:00' }],
    };
    expect(businessMinutesBetween(sab('08:00'), sab('23:00'), comPlantao)).toBe(240);
    expect(windowsForDay(comPlantao, zonedParts(sab('10:00'), 'America/Sao_Paulo'))).toEqual([
      { from: 540, to: 780 },
    ]);
  });

  it('"fechado" tem o mesmo efeito de feriado', () => {
    const fechado: BusinessCalendar = {
      ...comercial,
      exceptions: [{ date: '2026-08-24', kind: 'closed' }],
    };
    expect(businessMinutesBetween(seg('08:00'), seg('18:00'), fechado)).toBe(0);
  });
});

describe('cálculo do prazo', () => {
  it('quatro horas úteis a partir das 09:00 vencem às 13:00', () => {
    const prazo = addBusinessMinutes(seg('09:00'), 240, comercial);
    expect(prazo.toISOString()).toBe(seg('13:00').toISOString());
  });

  it('o prazo transborda para o dia seguinte quando não cabe', () => {
    // segunda 16:00 + 4 h: 2 h na segunda, 2 h na terça → terça 10:00
    const prazo = addBusinessMinutes(seg('16:00'), 240, comercial);
    expect(zonedParts(prazo, 'America/Sao_Paulo')).toMatchObject({ day: 25, hour: 10 });
  });

  it('quem abre fora do horário só começa a contar na próxima abertura', () => {
    // sábado 10:00 + 1 h → segunda 09:00
    const prazo = addBusinessMinutes(sab('10:00'), 60, comercial);
    expect(zonedParts(prazo, 'America/Sao_Paulo')).toMatchObject({ day: 31, hour: 9 });
  });

  it('o almoço empurra o prazo', () => {
    // segunda 11:00 + 2 h no calendário com almoço → 14:00
    const prazo = addBusinessMinutes(seg('11:00'), 120, comAlmoco);
    expect(zonedParts(prazo, 'America/Sao_Paulo')).toMatchObject({ hour: 14, minute: 0 });
  });

  it('prazo zero é o próprio instante', () => {
    expect(addBusinessMinutes(seg('09:00'), 0, comercial).toISOString()).toBe(seg('09:00').toISOString());
  });

  it('o prazo calculado bate com a contagem: as duas funções concordam', () => {
    for (const minutos of [30, 60, 240, 600, 1200, 3000]) {
      const prazo = addBusinessMinutes(seg('09:13'), minutos, comAlmoco);
      expect(businessMinutesBetween(seg('09:13'), prazo, comAlmoco), `${minutos} min`).toBe(minutos);
    }
  });
});

describe('fuso do local, não da organização', () => {
  /**
   * O caso da SPEC: uma prestadora de Belo Horizonte atendendo uma base em
   * Manaus. Manaus não tem horário de verão e fica uma hora atrás; usar o fuso
   * da matriz daria uma hora de erro em todo prazo da filial.
   */
  it('o mesmo horário comercial em Manaus produz prazo em instante diferente', () => {
    const manaus: BusinessCalendar = { ...comercial, timeZone: 'America/Manaus' };
    const abertura = new Date('2026-08-24T11:00:00Z'); // 08:00 em SP, 07:00 em Manaus

    const prazoSp = addBusinessMinutes(abertura, 60, comercial);
    const prazoManaus = addBusinessMinutes(abertura, 60, manaus);

    // Em SP já são 08:00 e a contagem começa; em Manaus ainda são 07:00 e a
    // contagem só começa às 08:00 locais, uma hora depois.
    expect(prazoSp.toISOString()).toBe('2026-08-24T12:00:00.000Z');
    expect(prazoManaus.toISOString()).toBe('2026-08-24T13:00:00.000Z');
  });
});

describe('dentro do horário', () => {
  it('reconhece abertura e fechamento pelas bordas certas', () => {
    expect(isWithinBusinessHours(seg('08:00'), comercial)).toBe(true);
    expect(isWithinBusinessHours(seg('17:59'), comercial)).toBe(true);
    expect(isWithinBusinessHours(seg('18:00'), comercial)).toBe(false);
    expect(isWithinBusinessHours(seg('07:59'), comercial)).toBe(false);
  });

  it('sábado está fora, e o almoço também', () => {
    expect(isWithinBusinessHours(sab('10:00'), comercial)).toBe(false);
    expect(isWithinBusinessHours(seg('12:30'), comAlmoco)).toBe(false);
  });
});

describe('calendário 24×7', () => {
  it('conta tudo, inclusive fim de semana', () => {
    const de = new Date('2026-08-28T12:00:00Z');
    const ate = new Date('2026-08-31T12:00:00Z');
    expect(businessMinutesBetween(de, ate, alwaysOpenCalendar())).toBe(3 * 24 * 60);
  });

  it('o prazo é o instante mais os minutos', () => {
    const de = new Date('2026-08-28T12:00:00Z');
    expect(addBusinessMinutes(de, 90, alwaysOpenCalendar()).toISOString()).toBe('2026-08-28T13:30:00.000Z');
  });

  it('sempre está dentro do horário', () => {
    expect(isWithinBusinessHours(sab('03:00'), alwaysOpenCalendar('America/Sao_Paulo'))).toBe(true);
  });
});

describe('configuração impossível falha alto', () => {
  const vazio: BusinessCalendar = { timeZone: 'UTC', windows: [], exceptions: [] };

  it('calendário sem janela nenhuma é recusado, não gira para sempre', () => {
    expect(() => businessMinutesBetween(seg('09:00'), ter('09:00'), vazio)).toThrow(EmptyCalendarError);
    expect(() => addBusinessMinutes(seg('09:00'), 60, vazio)).toThrow(EmptyCalendarError);
  });

  it('alvo grande demais para o calendário falha com mensagem que explica', () => {
    const umaHoraPorSemana: BusinessCalendar = {
      timeZone: 'UTC',
      windows: [{ weekday: 1, startsAt: '08:00', endsAt: '09:00' }],
      exceptions: [],
    };
    // 60 min/semana × 52 semanas < 100 000 min
    expect(() => addBusinessMinutes(seg('09:00'), 100_000, umaHoraPorSemana)).toThrow(
      /janelas curtas demais/
    );
  });
});

describe('horário de verão', () => {
  /**
   * Nova York muda a hora em 8 de março de 2026 (domingo). O teste usa a
   * semana da mudança para garantir que a soma de minutos úteis não ganha nem
   * perde uma hora fantasma.
   */
  const ny: BusinessCalendar = {
    timeZone: 'America/New_York',
    windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startsAt: '09:00', endsAt: '17:00' })),
    exceptions: [],
  };

  it('a semana da virada continua tendo cinco dias de oito horas', () => {
    const de = new Date('2026-03-08T00:00:00-05:00');
    const ate = new Date('2026-03-15T00:00:00-04:00');
    expect(businessMinutesBetween(de, ate, ny)).toBe(5 * 8 * 60);
  });

  it('o prazo atravessa a virada sem escorregar', () => {
    // sexta 16:00 (antes da virada) + 2 h → segunda 10:00 (depois da virada)
    const sexta = new Date('2026-03-06T16:00:00-05:00');
    const prazo = addBusinessMinutes(sexta, 120, ny);
    expect(zonedParts(prazo, 'America/New_York')).toMatchObject({ month: 3, day: 9, hour: 10 });
  });
});
