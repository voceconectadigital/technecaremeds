/**
 * Aurora — notificações (SPEC v0.2 §23 · EPIC-023).
 *
 * A CAIXA E AS PREFERÊNCIAS SÃO DA PESSOA, e não da organização.
 *
 * Nenhuma destas rotas recebe um identificador de destinatário: o servidor usa
 * o vínculo de quem pergunta. Aceitar `membershipId` no corpo criaria uma rota
 * que lê a caixa de entrada dos outros — e a primeira integração a usaria
 * "para conferir se chegou".
 *
 * O HORÁRIO DE SILÊNCIO NÃO CALA TUDO.
 *
 * Alguns tipos atravessam: `bypassesQuietHours` está no catálogo, por tipo, e
 * não numa configuração global. Um SLA estourando às 3h da manhã num hospital
 * é exatamente o que precisa acordar alguém — e a alternativa (silêncio
 * absoluto) faz a equipe desligar o silêncio, e aí nada é silenciado.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Com que frequência o canal entrega.
 *
 * `immediate` para o que exige ação agora; `daily`/`weekly` para o que só
 * precisa ser sabido. Sem o resumo, a única defesa contra volume é desligar o
 * tipo — e aí a informação some inteira em vez de chegar junta.
 */
export const DIGEST_MODES = ['immediate', 'daily', 'weekly'] as const;
export type DigestMode = (typeof DIGEST_MODES)[number];

export const NotificationType = z.object({
  key: z.string(),
  label: z.string(),
  /** Os canais em que ESTE tipo faz sentido. */
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)),
  phase: z.string(),
  /**
   * Se atravessa o horário de silêncio.
   *
   * É por TIPO, e não uma chave global: um SLA estourando às 3h num hospital
   * precisa acordar alguém, e "aviso de orçamento visto" não.
   */
  bypassesQuietHours: z.boolean(),
});
export type NotificationType = z.infer<typeof NotificationType>;

export const notificationTypes = defineOperation({
  operationId: 'notifications.types',
  method: 'GET',
  path: '/notifications/types',
  summary: 'O catálogo de tipos, para a tela de preferências',
  public: false,
  response: z.object({ items: z.array(NotificationType) }),
});

export const InboxItem = z.object({
  id: Uuid,
  type_key: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  /** Para onde ir ao clicar. Nulo quando o aviso não tem destino. */
  link: z.string().nullable(),
  aggregate_type: z.string().nullable(),
  aggregate_id: Uuid.nullable(),
  created_at: Timestamp,
  read_at: Timestamp.nullable(),
});
export type InboxItem = z.infer<typeof InboxItem>;

export const notificationsInbox = defineOperation({
  operationId: 'notifications.list',
  method: 'GET',
  path: '/notifications',
  summary: 'A caixa de quem está perguntando',
  description:
    'A contagem de não lidas vem JUNTO: o sino da interface precisa dela em toda carga, e uma ' +
    'segunda requisição só para exibir um número é a que sempre atrasa.',
  public: false,
  query: z.object({
    unread: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
  }),
  response: z.object({
    items: z.array(InboxItem),
    unread: z.number().int(),
  }),
});

export const notificationsRead = defineOperation({
  operationId: 'notifications.read',
  method: 'POST',
  path: '/notifications/read',
  summary: 'Marca avisos como lidos',
  public: false,
  body: z.object({ ids: z.array(Uuid).max(500) }),
  response: z.object({ marked: z.number().int() }),
  status: 201,
  errors: ['validation_failed'],
});

export const notificationsReadAll = defineOperation({
  operationId: 'notifications.readAll',
  method: 'POST',
  path: '/notifications/read-all',
  summary: 'Marca tudo como lido',
  public: false,
  response: z.object({ marked: z.number().int() }),
  status: 201,
});

export const notificationPreference = defineOperation({
  operationId: 'notifications.preference',
  method: 'POST',
  path: '/notifications/preferences',
  summary: 'Liga ou desliga um tipo num canal',
  description:
    'A preferência é por (tipo, canal): querer o SLA por push e o resumo semanal por e-mail é o ' +
    'caso comum, e uma chave por canal só obrigaria a escolher entre tudo e nada.',
  public: false,
  body: z.object({
    typeKey: z.string(),
    channel: z.enum(NOTIFICATION_CHANNELS),
    enabled: z.boolean(),
    digest: z.enum(DIGEST_MODES).optional(),
  }),
  response: z.object({ saved: z.literal(true) }),
  status: 201,
  errors: ['validation_failed'],
});

export const notificationQuietHours = defineOperation({
  operationId: 'notifications.quietHours',
  method: 'POST',
  path: '/notifications/quiet-hours',
  summary: 'Define o horário de silêncio de quem está pedindo',
  description:
    'Em MINUTOS desde a meia-noite, e não em texto de hora: 22:30 é 1350, e a janela que atravessa ' +
    'a meia-noite (1350 → 360) é representável sem caso especial.',
  public: false,
  body: z.object({
    startMinute: z.number().int().min(0).max(1439).nullable(),
    endMinute: z.number().int().min(0).max(1439).nullable(),
    fullDays: z.array(z.number().int().min(0).max(6)).optional(),
  }),
  response: z.object({ saved: z.literal(true) }),
  status: 201,
  errors: ['validation_failed'],
});
