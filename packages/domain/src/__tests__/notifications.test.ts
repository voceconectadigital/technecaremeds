/**
 * Aurora — notificações (SPEC v0.2 §23 · EPIC-023).
 *
 * O inimigo declarado deste épico é o excesso, e é ele que estes testes
 * protegem: silêncio que atravessa a meia-noite, duplicata na janela, e-mail
 * não verificado, e a diferença entre "não me acorde" e "não me conte".
 */
import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_TYPES,
  notificationTypesFor,
  notificationType,
  inQuietHours,
  decideDelivery,
  dedupeKey,
  extractMentions,
  type DeliveryContext,
} from '../notifications';

const SLA_VIOLADO = notificationType('sla_breached')!;
const ATRIBUIDA = notificationType('work_order_assigned')!;
const REAGENDADA = notificationType('work_order_rescheduled')!;

function ctx(over: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    type: REAGENDADA,
    channel: 'email',
    preference: { channel: 'email', enabled: true, digest: 'immediate' },
    quiet: null,
    minuteOfDay: 10 * 60,
    weekday: 3,
    emailVerified: true,
    duplicateWithinWindow: false,
    ...over,
  };
}

describe('catálogo', () => {
  it('todo tipo aponta para um evento e ao menos um canal', () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(t.event).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(t.channels.length).toBeGreaterThan(0);
      // Aviso de automação não tem público por papel: a regra escolhe quem recebe.
      if (t.event !== 'automation.schedule') expect(t.audiences.length).toBeGreaterThan(0);
    }
  });

  it('o evento resolve para os tipos que o escutam', () => {
    expect(notificationTypesFor('sla.breached').map((t) => t.key)).toEqual(['sla_breached']);
    expect(notificationTypesFor('nada.acontece')).toEqual([]);
  });

  it('só o SLA violado fura o silêncio no MVP', () => {
    const furam = NOTIFICATION_TYPES.filter((t) => t.phase === 'MVP' && t.bypassesQuietHours);
    expect(furam.map((t) => t.key)).toEqual(['sla_breached']);
  });
});

describe('silêncio', () => {
  const noturno = { startMinute: 20 * 60, endMinute: 7 * 60, fullDays: [] };

  it('a janela que atravessa a meia-noite vale a noite inteira', () => {
    expect(inQuietHours(noturno, 21 * 60, 3)).toBe(true);
    expect(inQuietHours(noturno, 2 * 60, 3)).toBe(true);
    expect(inQuietHours(noturno, 6 * 60 + 59, 3)).toBe(true);
  });

  it('e não vale durante o dia', () => {
    expect(inQuietHours(noturno, 7 * 60, 3)).toBe(false);
    expect(inQuietHours(noturno, 14 * 60, 3)).toBe(false);
    expect(inQuietHours(noturno, 19 * 60 + 59, 3)).toBe(false);
  });

  it('a janela que não atravessa também funciona', () => {
    const almoco = { startMinute: 12 * 60, endMinute: 13 * 60, fullDays: [] };
    expect(inQuietHours(almoco, 12 * 60 + 30, 3)).toBe(true);
    expect(inQuietHours(almoco, 11 * 60, 3)).toBe(false);
  });

  it('dia inteiro em silêncio ignora o horário', () => {
    const fimDeSemana = { startMinute: 0, endMinute: 0, fullDays: [0, 6] };
    expect(inQuietHours(fimDeSemana, 10 * 60, 0)).toBe(true);
    expect(inQuietHours(fimDeSemana, 10 * 60, 3)).toBe(false);
  });

  it('início igual ao fim é silêncio desligado, não silêncio de 24 h', () => {
    expect(inQuietHours({ startMinute: 0, endMinute: 0, fullDays: [] }, 500, 3)).toBe(false);
  });
});

describe('a decisão de entregar', () => {
  it('entrega quando nada impede', () => {
    const d = decideDelivery(ctx());
    expect(d.deliver).toBe(true);
    expect(d.reason).toBe('delivered');
  });

  it('canal desligado pelo usuário vence tudo', () => {
    const d = decideDelivery(ctx({ preference: { channel: 'email', enabled: false, digest: 'immediate' } }));
    expect(d.reason).toBe('channel_disabled');
  });

  it('canal que o tipo não usa não entrega, mesmo com preferência ligada', () => {
    // "SLA em 80 %" só existe em aplicativo e push; pedir por e-mail não é
    // preferência, é canal inexistente para aquele aviso.
    const d = decideDelivery(
      ctx({
        type: notificationType('sla_warning')!,
        channel: 'email',
        preference: { channel: 'email', enabled: true, digest: 'immediate' },
      })
    );
    expect(d.reason).toBe('channel_disabled');
  });

  it('e-mail não verificado não recebe, e nem vai para resumo', () => {
    const d = decideDelivery(ctx({ emailVerified: false }));
    expect(d.reason).toBe('unverified_email');
    expect(d.digest).toBeNull();
  });

  it('a verificação vem antes da de-duplicação — não adianta guardar o que nunca sairá', () => {
    const d = decideDelivery(ctx({ emailVerified: false, duplicateWithinWindow: true }));
    expect(d.reason).toBe('unverified_email');
  });

  it('duplicata na janela é silenciada', () => {
    expect(decideDelivery(ctx({ duplicateWithinWindow: true })).reason).toBe('duplicate');
  });

  it('quem pediu resumo recebe junto, não perde', () => {
    const d = decideDelivery(ctx({ preference: { channel: 'email', enabled: true, digest: 'daily' } }));
    expect(d.deliver).toBe(false);
    expect(d.digest).toBe('daily');
  });

  it('o silêncio adia, não descarta: "não me acorde" não é "não me conte"', () => {
    const d = decideDelivery(
      ctx({ quiet: { startMinute: 20 * 60, endMinute: 7 * 60, fullDays: [] }, minuteOfDay: 23 * 60 })
    );
    expect(d.deliver).toBe(false);
    expect(d.reason).toBe('quiet_hours');
    expect(d.digest).toBe('daily');
  });

  it('SLA violado fura o silêncio; OS atribuída não', () => {
    const noite = {
      quiet: { startMinute: 20 * 60, endMinute: 7 * 60, fullDays: [] },
      minuteOfDay: 3 * 60,
    };

    expect(
      decideDelivery(ctx({ ...noite, type: SLA_VIOLADO, channel: 'in_app', preference: null })).deliver
    ).toBe(true);

    expect(
      decideDelivery(ctx({ ...noite, type: ATRIBUIDA, channel: 'in_app', preference: null })).deliver
    ).toBe(false);
  });

  it('sem preferência configurada, o padrão é entregar no canal que o tipo declara', () => {
    const d = decideDelivery(ctx({ preference: null, channel: 'in_app' }));
    expect(d.deliver).toBe(true);
  });
});

describe('de-duplicação', () => {
  it('a chave ignora o canal: aplicativo e e-mail do mesmo aviso são repetição', () => {
    expect(dedupeKey('sla_breached', 'm-1', 'wo-1')).toBe('sla_breached:m-1:wo-1');
    expect(dedupeKey('sla_breached', 'm-1', 'wo-1')).toBe(dedupeKey('sla_breached', 'm-1', 'wo-1'));
  });

  it('destinatários diferentes têm chaves diferentes', () => {
    expect(dedupeKey('sla_breached', 'm-1', 'wo-1')).not.toBe(dedupeKey('sla_breached', 'm-2', 'wo-1'));
  });
});

describe('menções', () => {
  it('extrai, normaliza e não repete', () => {
    expect(extractMentions('@ana.silva conferiu com @Bruno e @ana.silva confirmou')).toEqual([
      'ana.silva',
      'bruno',
    ]);
  });

  it('não confunde e-mail com menção de usuário', () => {
    // O endereço tem ponto e arroba, mas o que vem antes do arroba não é vazio:
    // a expressão só casa quando o arroba inicia o identificador.
    const achados = extractMentions('avise ana@hospital.test');
    expect(achados).not.toContain('hospital.test');
  });

  it('texto sem menção devolve lista vazia', () => {
    expect(extractMentions('trocado o filtro e testado')).toEqual([]);
  });
});
