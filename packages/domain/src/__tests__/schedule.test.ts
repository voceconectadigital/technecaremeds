/**
 * Aurora — agenda: conflitos, carga e baldes (SPEC v0.2 §13 · EPIC-012).
 *
 * O que estes testes fixam é a decisão de produto do §13: ausência bloqueia,
 * sobreposição avisa. Trocar isso de lado, nos dois sentidos, é o que faz uma
 * agenda deixar de ser usada.
 */
import { describe, it, expect } from 'vitest';
import {
  instantsOverlap,
  overlapMinutes,
  windowMinutes,
  blocksScheduling,
  detectConflicts,
  blockingConflicts,
  summarizeLoad,
  isRescheduleSignal,
  shouldNotifyRequester,
  bucketFor,
  type BlockWindow,
  type BusyWindow,
} from '../schedule';

const h = (iso: string) => new Date(iso);
const JANELA = { startsAt: h('2025-03-10T09:00:00Z'), endsAt: h('2025-03-10T11:00:00Z') };

function entrada(over: Partial<Parameters<typeof detectConflicts>[0]> = {}) {
  return detectConflicts({
    candidate: { ...JANELA, workOrderId: 'wo-1', assigneeMembershipId: 'm-1' },
    blocks: [],
    busy: [],
    bookedMinutesToday: 0,
    capacityMinutes: 480,
    locationWindowFits: null,
    ...over,
  });
}

describe('janelas', () => {
  it('encostar não é sobrepor — 10 h fecha uma e abre a outra', () => {
    expect(
      instantsOverlap(JANELA, {
        startsAt: h('2025-03-10T11:00:00Z'),
        endsAt: h('2025-03-10T12:00:00Z'),
      })
    ).toBe(false);
  });

  it('um minuto dentro já é sobreposição', () => {
    expect(
      instantsOverlap(JANELA, {
        startsAt: h('2025-03-10T10:59:00Z'),
        endsAt: h('2025-03-10T12:00:00Z'),
      })
    ).toBe(true);
  });

  it('mede a interseção, não a janela inteira', () => {
    expect(
      overlapMinutes(JANELA, {
        startsAt: h('2025-03-10T10:30:00Z'),
        endsAt: h('2025-03-10T14:00:00Z'),
      })
    ).toBe(30);
    expect(windowMinutes(JANELA)).toBe(120);
  });
});

describe('ausência bloqueia, compromisso avisa', () => {
  const ferias: BlockWindow = {
    id: 'b-1',
    kind: 'vacation',
    note: null,
    startsAt: h('2025-03-10T00:00:00Z'),
    endsAt: h('2025-03-20T00:00:00Z'),
  };
  const treinamento: BlockWindow = {
    id: 'b-2',
    kind: 'training',
    note: 'NR-10',
    startsAt: h('2025-03-10T08:00:00Z'),
    endsAt: h('2025-03-10T12:00:00Z'),
  };

  it('férias e afastamento bloqueiam; treinamento e outros avisam', () => {
    expect(blocksScheduling('vacation')).toBe(true);
    expect(blocksScheduling('leave')).toBe(true);
    expect(blocksScheduling('training')).toBe(false);
    expect(blocksScheduling('other')).toBe(false);
  });

  it('agendar sobre férias é bloqueio, e a mensagem diz o que é', () => {
    const c = entrada({ blocks: [ferias] });
    expect(blockingConflicts(c)).toHaveLength(1);
    expect(c[0]!.detail).toMatch(/em férias/);
  });

  it('agendar sobre treinamento é aviso, com o motivo à vista', () => {
    const c = entrada({ blocks: [treinamento] });
    expect(blockingConflicts(c)).toHaveLength(0);
    expect(c[0]!.severity).toBe('warn');
    expect(c[0]!.detail).toMatch(/NR-10/);
  });

  it('bloco fora da janela não gera conflito nenhum', () => {
    const c = entrada({
      blocks: [
        {
          ...ferias,
          startsAt: h('2025-03-11T00:00:00Z'),
          endsAt: h('2025-03-12T00:00:00Z'),
        },
      ],
    });
    expect(c).toHaveLength(0);
  });
});

describe('sobreposição avisa — duas OS na ronda são legítimas', () => {
  const outra: BusyWindow = {
    workOrderId: 'wo-2',
    number: 'WO-2025-00042',
    startsAt: h('2025-03-10T10:00:00Z'),
    endsAt: h('2025-03-10T12:00:00Z'),
  };

  it('avisa, não bloqueia, e diz quantos minutos e com qual OS', () => {
    const c = entrada({ busy: [outra] });
    expect(blockingConflicts(c)).toHaveLength(0);
    expect(c[0]!.detail).toMatch(/WO-2025-00042.*60 min/);
  });

  it('a própria OS não conflita consigo mesma ao ser reagendada', () => {
    const c = entrada({
      busy: [{ ...outra, workOrderId: 'wo-1', number: 'WO-2025-00001' }],
    });
    expect(c).toHaveLength(0);
  });
});

describe('capacidade e calendário do local', () => {
  it('avisa quando o dia estoura a jornada, dizendo em quanto', () => {
    const c = entrada({ bookedMinutesToday: 400, capacityMinutes: 480 });
    expect(c[0]!.kind).toBe('over_capacity');
    expect(c[0]!.detail).toMatch(/108 %/);
  });

  it('sem jornada informada não há aviso de capacidade — nem falso alarme', () => {
    expect(entrada({ bookedMinutesToday: 5000, capacityMinutes: null })).toHaveLength(0);
  });

  it('fora da janela do local, avisa com o motivo que o local declarou', () => {
    const c = entrada({
      locationWindowFits: false,
      locationName: 'UTI',
      locationHint: 'só libera equipamento entre 14 h e 16 h',
    });
    expect(c[0]!.severity).toBe('warn');
    expect(c[0]!.detail).toMatch(/UTI.*14 h e 16 h/);
  });

  it('devolve todos os conflitos de uma vez, não o primeiro', () => {
    const c = entrada({
      blocks: [
        {
          id: 'b',
          kind: 'vacation',
          note: null,
          startsAt: h('2025-03-10T00:00:00Z'),
          endsAt: h('2025-03-20T00:00:00Z'),
        },
      ],
      busy: [
        {
          workOrderId: 'wo-9',
          number: 'WO-9',
          startsAt: h('2025-03-10T10:00:00Z'),
          endsAt: h('2025-03-10T12:00:00Z'),
        },
      ],
      bookedMinutesToday: 460,
      locationWindowFits: false,
    });
    expect(c.map((x) => x.kind)).toEqual([
      'absence',
      'overlap',
      'outside_location_calendar',
      'over_capacity',
    ]);
  });
});

describe('carga', () => {
  it('sem jornada, a ocupação é desconhecida — e não zero', () => {
    const l = summarizeLoad(300, null);
    expect(l.percent).toBeNull();
    expect(l.over).toBe(false);
  });

  it('a ocupação sai em percentual e marca o estouro', () => {
    expect(summarizeLoad(240, 8).percent).toBe(50);
    expect(summarizeLoad(540, 8).over).toBe(true);
  });
});

describe('reagendamento', () => {
  it('mais de três é sinal operacional', () => {
    expect(isRescheduleSignal(3)).toBe(false);
    expect(isRescheduleSignal(4)).toBe(true);
  });

  it('o solicitante só é avisado de mudança relevante', () => {
    const antes = h('2025-03-10T09:00:00Z');
    expect(shouldNotifyRequester(antes, h('2025-03-10T09:20:00Z'), 4)).toBe(false);
    expect(shouldNotifyRequester(antes, h('2025-03-13T09:00:00Z'), 4)).toBe(true);
    // Antecipar três dias também é mudança grande: o sinal é o módulo.
    expect(shouldNotifyRequester(antes, h('2025-03-07T09:00:00Z'), 4)).toBe(true);
  });
});

describe('baldes do painel lateral', () => {
  const AGORA = h('2025-03-15T12:00:00Z');
  const base = {
    scheduledStart: null,
    scheduledEnd: null,
    startedAt: null,
    dueAt: null,
    windowInvalidated: false,
  };

  it('OS já iniciada não fica em balde nenhum', () => {
    expect(bucketFor({ ...base, startedAt: AGORA }, AGORA)).toBeNull();
  });

  it('sem janela é "não agendada"', () => {
    expect(bucketFor(base, AGORA)).toBe('unscheduled');
  });

  it('janela vencida sem começar é "atrasada"', () => {
    expect(
      bucketFor(
        {
          ...base,
          scheduledStart: h('2025-03-14T08:00:00Z'),
          scheduledEnd: h('2025-03-14T10:00:00Z'),
        },
        AGORA
      )
    ).toBe('late');
  });

  it('janela invalidada vem antes de atrasada — são conversas diferentes', () => {
    expect(
      bucketFor(
        {
          ...base,
          scheduledStart: h('2025-03-14T08:00:00Z'),
          scheduledEnd: h('2025-03-14T10:00:00Z'),
          windowInvalidated: true,
        },
        AGORA
      )
    ).toBe('to_reschedule');
  });

  it('janela futura não está em balde nenhum', () => {
    expect(
      bucketFor(
        {
          ...base,
          scheduledStart: h('2025-03-16T08:00:00Z'),
          scheduledEnd: h('2025-03-16T10:00:00Z'),
        },
        AGORA
      )
    ).toBeNull();
  });
});
