/**
 * Aurora — notificações (SPEC v0.2 §23 · EPIC-023).
 *
 * Este épico tem um inimigo declarado, e não é a falta de aviso: é o EXCESSO.
 * Um canal que manda dez e-mails por hora sobre a mesma OS é um canal que o
 * destinatário filtra para uma pasta — e o aviso que importava se perde junto
 * com os nove que não importavam. Por isso os três controles do §23 (digest,
 * silêncio e de-duplicação) não são refinamento posterior: são a condição para
 * o canal continuar existindo.
 *
 * E há uma regra que a referência acertou e que copiamos literalmente:
 * **e-mail não verificado não recebe notificação**. Mandar para endereço não
 * confirmado queima a reputação do remetente e, pior, pode entregar informação
 * de manutenção hospitalar a quem digitou o endereço errado.
 */

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Como o destinatário é encontrado a partir do evento. */
export const AUDIENCES = [
  'assignee',
  'requester',
  'coordinators',
  'managers',
  'covering_team',
  'storekeepers',
  'finance',
  'mentioned',
  'customer_contacts',
] as const;
export type Audience = (typeof AUDIENCES)[number];

export interface NotificationTypeDefinition {
  readonly key: string;
  readonly label: string;
  /** Evento de domínio que dispara. */
  readonly event: string;
  readonly audiences: readonly Audience[];
  readonly channels: readonly NotificationChannel[];
  readonly phase: 'MVP' | 'F2' | 'F3';
  /**
   * Janela de de-duplicação em minutos: dentro dela, o mesmo tipo sobre o mesmo
   * agregado não gera um segundo aviso.
   */
  readonly dedupeMinutes: number;
  /**
   * Pode furar o silêncio?
   *
   * Só o que exige ação AGORA. SLA violado às três da manhã num hospital é
   * informação que muda o que a pessoa de plantão faz; "OS atribuída a você"
   * não é, e acordar alguém com isso é o caminho mais curto para o silêncio ser
   * configurado para sempre.
   */
  readonly bypassesQuietHours: boolean;
}

export const NOTIFICATION_TYPES: readonly NotificationTypeDefinition[] = Object.freeze([
  {
    key: 'request_received',
    label: 'Solicitação recebida',
    event: 'service_request.created',
    audiences: ['covering_team', 'coordinators'],
    channels: ['in_app', 'email'],
    phase: 'MVP',
    dedupeMinutes: 0,
    bypassesQuietHours: false,
  },
  {
    key: 'work_order_assigned',
    label: 'OS atribuída a você',
    event: 'work_order.assigned',
    audiences: ['assignee'],
    channels: ['in_app', 'push'],
    phase: 'MVP',
    dedupeMinutes: 15,
    bypassesQuietHours: false,
  },
  {
    key: 'work_order_rescheduled',
    label: 'OS reagendada',
    event: 'work_order.rescheduled',
    audiences: ['assignee', 'requester'],
    channels: ['in_app', 'email'],
    phase: 'MVP',
    dedupeMinutes: 60,
    bypassesQuietHours: false,
  },
  {
    key: 'comment_mention',
    label: 'Menção em comentário',
    event: 'work_order.commented',
    audiences: ['mentioned'],
    channels: ['in_app', 'email'],
    phase: 'MVP',
    dedupeMinutes: 0,
    bypassesQuietHours: false,
  },
  {
    key: 'sla_warning',
    label: 'SLA em 80 %',
    event: 'sla.warning',
    audiences: ['assignee', 'coordinators'],
    channels: ['in_app', 'push'],
    phase: 'MVP',
    dedupeMinutes: 240,
    bypassesQuietHours: false,
  },
  {
    key: 'sla_breached',
    label: 'SLA violado',
    event: 'sla.breached',
    audiences: ['assignee', 'coordinators', 'managers'],
    channels: ['in_app', 'email'],
    phase: 'MVP',
    dedupeMinutes: 240,
    // O único do MVP que fura o silêncio: prazo estourado em equipamento
    // hospitalar muda o que a pessoa de plantão faz agora.
    bypassesQuietHours: true,
  },
  {
    key: 'request_status_changed',
    label: 'Sua solicitação mudou de situação',
    event: 'service_request.triaged',
    audiences: ['requester'],
    channels: ['in_app', 'email'],
    phase: 'MVP',
    dedupeMinutes: 30,
    bypassesQuietHours: false,
  },
  {
    key: 'quote_approval_pending',
    label: 'Aprovação de orçamento pendente',
    event: 'quote.sent',
    audiences: ['customer_contacts'],
    channels: ['email'],
    phase: 'F2',
    dedupeMinutes: 1440,
    bypassesQuietHours: false,
  },
  {
    key: 'stock_below_minimum',
    label: 'Estoque abaixo do mínimo',
    event: 'stock.below_minimum',
    audiences: ['storekeepers'],
    channels: ['in_app', 'email'],
    phase: 'F2',
    dedupeMinutes: 1440,
    bypassesQuietHours: false,
  },
  {
    key: 'document_expiring',
    label: 'Documento vencendo',
    event: 'document.expiring',
    audiences: ['managers'],
    channels: ['email'],
    phase: 'F2',
    dedupeMinutes: 1440,
    bypassesQuietHours: false,
  },
  {
    key: 'contract_expiring',
    label: 'Contrato vencendo',
    event: 'contract.expiring',
    audiences: ['finance', 'managers'],
    channels: ['email'],
    phase: 'F3',
    dedupeMinutes: 1440,
    bypassesQuietHours: false,
  },
  /*
   * AVISOS DE AUTOMAÇÃO (pente-fino 17/10/2026). Não nascem de evento de
   * domínio — a regra já sabe quem recebe —, mas precisam estar no catálogo:
   * sem isto, a pessoa não conseguia desligar o e-mail do relatório agendado,
   * porque a rota de preferências recusa tipo desconhecido.
   */
  {
    key: 'automation.scheduled_report',
    label: 'Relatório agendado',
    event: 'automation.schedule',
    audiences: [],
    channels: ['in_app', 'email'],
    phase: 'F2',
    dedupeMinutes: 0,
    bypassesQuietHours: false,
  },
  {
    key: 'automation.reminder',
    label: 'Lembrete de automação',
    event: 'automation.schedule',
    audiences: [],
    channels: ['in_app', 'email'],
    phase: 'F2',
    dedupeMinutes: 0,
    bypassesQuietHours: false,
  },
  {
    key: 'automation.task',
    label: 'Tarefa de automação (5W2H/PDCA)',
    event: 'automation.schedule',
    audiences: [],
    channels: ['in_app', 'email'],
    phase: 'F2',
    dedupeMinutes: 0,
    bypassesQuietHours: false,
  },
]);

const POR_EVENTO = new Map<string, NotificationTypeDefinition[]>();
for (const t of NOTIFICATION_TYPES) {
  const lista = POR_EVENTO.get(t.event) ?? [];
  lista.push(t);
  POR_EVENTO.set(t.event, lista);
}

export function notificationTypesFor(event: string): readonly NotificationTypeDefinition[] {
  return POR_EVENTO.get(event) ?? [];
}

export function notificationType(key: string): NotificationTypeDefinition | undefined {
  return NOTIFICATION_TYPES.find((t) => t.key === key);
}

/* -------------------------------------------------------------------------- */
/* preferências                                                                */
/* -------------------------------------------------------------------------- */

export const DIGEST_MODES = ['immediate', 'daily', 'weekly'] as const;
export type DigestMode = (typeof DIGEST_MODES)[number];

export interface QuietHours {
  /** Minuto do dia em que o silêncio começa, no fuso do usuário. */
  readonly startMinute: number;
  readonly endMinute: number;
  /** Dias da semana em silêncio integral (0 = domingo). */
  readonly fullDays: readonly number[];
}

export interface Preference {
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly digest: DigestMode;
}

/**
 * O silêncio está valendo neste instante?
 *
 * A janela pode ATRAVESSAR a meia-noite — "das 20 h às 7 h" é o caso comum, e é
 * o que uma comparação ingênua (`início <= agora && agora < fim`) responde
 * errado sempre: como 20 h > 7 h, ela devolveria falso a noite inteira e o
 * silêncio nunca valeria justamente nas horas em que foi pedido.
 */
export function inQuietHours(quiet: QuietHours, minuteOfDay: number, weekday: number): boolean {
  if (quiet.fullDays.includes(weekday)) return true;
  if (quiet.startMinute === quiet.endMinute) return false;

  return quiet.startMinute < quiet.endMinute
    ? minuteOfDay >= quiet.startMinute && minuteOfDay < quiet.endMinute
    : minuteOfDay >= quiet.startMinute || minuteOfDay < quiet.endMinute;
}

export interface DeliveryDecision {
  readonly deliver: boolean;
  /** `null` para entrega imediata; a modalidade quando vai para resumo. */
  readonly digest: DigestMode | null;
  /** Por que não entrega agora — texto para a trilha, não para o usuário. */
  readonly reason:
    'delivered' | 'channel_disabled' | 'quiet_hours' | 'digest' | 'unverified_email' | 'duplicate';
}

export interface DeliveryContext {
  readonly type: NotificationTypeDefinition;
  /** O canal que está sendo decidido — explícito, não deduzido da preferência. */
  readonly channel: NotificationChannel;
  /** A preferência DESTE canal. `null` quando o usuário nunca configurou nada. */
  readonly preference: Preference | null;
  readonly quiet: QuietHours | null;
  readonly minuteOfDay: number;
  readonly weekday: number;
  readonly emailVerified: boolean;
  /** Já houve aviso igual dentro da janela de de-duplicação? */
  readonly duplicateWithinWindow: boolean;
}

/**
 * Decide o destino de um aviso num canal.
 *
 * A ordem das perguntas é a ordem das razões, da mais forte para a mais fraca:
 *
 * 1. **canal desligado** — decisão explícita do usuário, vale sobre tudo;
 * 2. **e-mail não verificado** — não é preferência, é a regra do §23: endereço
 *    não confirmado não recebe. Vem antes da de-duplicação porque não adianta
 *    guardar para depois o que nunca poderá ser enviado;
 * 3. **duplicata na janela** — silencia o segundo aviso igual;
 * 4. **resumo** — o usuário quis receber, mas junto;
 * 5. **silêncio** — hora errada; só o que fura passa.
 *
 * O aviso silenciado por horário NÃO some: vira resumo diário. Descartá-lo
 * transformaria "não me acorde" em "não me conte", que é outra coisa.
 */
export function decideDelivery(ctx: DeliveryContext): DeliveryDecision {
  const pref = ctx.preference;

  // O tipo declara em quais canais ele existe. Pedir "SLA em 80 % por e-mail"
  // quando o tipo só sai por aplicativo e push não é preferência: é canal que
  // não existe para aquele aviso.
  if (!ctx.type.channels.includes(ctx.channel)) {
    return { deliver: false, digest: null, reason: 'channel_disabled' };
  }

  if (pref && !pref.enabled) {
    return { deliver: false, digest: null, reason: 'channel_disabled' };
  }

  if (ctx.channel === 'email' && !ctx.emailVerified) {
    return { deliver: false, digest: null, reason: 'unverified_email' };
  }

  if (ctx.duplicateWithinWindow) {
    return { deliver: false, digest: null, reason: 'duplicate' };
  }

  if (pref && pref.digest !== 'immediate') {
    return { deliver: false, digest: pref.digest, reason: 'digest' };
  }

  if (ctx.quiet && inQuietHours(ctx.quiet, ctx.minuteOfDay, ctx.weekday)) {
    if (!ctx.type.bypassesQuietHours) {
      return { deliver: false, digest: 'daily', reason: 'quiet_hours' };
    }
  }

  return { deliver: true, digest: null, reason: 'delivered' };
}

/* -------------------------------------------------------------------------- */
/* de-duplicação                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A chave que identifica "o mesmo aviso".
 *
 * Tipo + destinatário + agregado. O CANAL fica de fora de propósito: se a
 * pessoa recebeu no aplicativo há dois minutos, mandar o mesmo por e-mail é
 * repetir, não complementar.
 */
export function dedupeKey(typeKey: string, membershipId: string, aggregateId: string): string {
  return `${typeKey}:${membershipId}:${aggregateId}`;
}

/* -------------------------------------------------------------------------- */
/* menções                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * O arroba só inicia menção quando não vem colado em outra palavra.
 *
 * Sem o `(?<![\w.@-])`, o comentário "avise ana@hospital.test" produziria a
 * menção `hospital.test` — o domínio de um e-mail virando nome de usuário. O
 * resultado seria uma busca que não acha ninguém no melhor caso e que acha a
 * pessoa errada no pior.
 */
const MENCAO = /(?<![\w.@-])@([a-z0-9][a-z0-9._-]{1,62}[a-z0-9])/gi;

/**
 * Extrai as menções de um comentário.
 *
 * Aceita a forma `@nome.sobrenome` e devolve em minúsculas, sem repetição:
 * citar alguém duas vezes no mesmo comentário é ênfase, não dois avisos.
 */
export function extractMentions(text: string): string[] {
  const achados = new Set<string>();
  for (const m of text.matchAll(MENCAO)) achados.add(m[1]!.toLowerCase());
  return [...achados];
}
