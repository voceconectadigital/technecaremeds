/**
 * Aurora — notificações (SPEC v0.2 §23 · EPIC-023).
 *
 * A CAIXA E AS PREFERÊNCIAS NA MESMA TELA, e não em dois lugares.
 *
 * O momento em que alguém decide mexer nas preferências é o momento em que
 * está incomodado com o que chegou. Mandar essa pessoa procurar a
 * configuração noutra tela é o que faz a alternativa real ser desligar tudo —
 * e uma equipe com as notificações desligadas descobre o SLA estourado pelo
 * cliente.
 *
 * AS PREFERÊNCIAS SÃO POR (TIPO, CANAL).
 *
 * Querer o SLA por push e o resumo semanal por e-mail é o caso comum. Uma
 * chave por canal só obrigaria a escolher entre tudo e nada — que é como se
 * chega ao "desligar tudo".
 *
 * O HORÁRIO DE SILÊNCIO NÃO CALA TUDO, e a tela diz quais tipos atravessam.
 * Prometer silêncio absoluto e depois tocar seria pior do que não prometer; e
 * silenciar de verdade um SLA estourando às 3h num hospital seria pior ainda.
 */
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Bell, BellOff, Check, Volume2 } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Select,
  SkeletonList,
  StatusChip,
  Tabs,
  cn,
  tabIds,
  useToast,
} from '@aurora/ui';
import {
  notificationPreference,
  notificationQuietHours,
  notificationTypes,
  notificationsInbox,
  notificationsRead,
  notificationsReadAll,
  NOTIFICATION_CHANNELS,
  DIGEST_MODES,
  type DigestMode,
  type InboxItem,
  type NotificationChannel,
  type NotificationType,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery } from '../../lib/api';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { useUrlState } from '../../lib/url-state';
import { formatarDataRelativa } from '../../routes/hoje';

const ABAS = [
  { id: 'caixa', label: 'Caixa' },
  { id: 'preferencias', label: 'Preferências' },
] as const;

export function NotificacoesPage() {
  const [aba, setAba] = useUrlState<string>('aba', 'caixa');

  const { data, isLoading, isError, error } = useApiQuery(notificationsInbox, {
    query: { limit: 100 },
  }) as {
    data: { items: InboxItem[]; unread: number } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  if (isError) return <ErrorScreen error={error} />;

  const abas = ABAS.map((a) => ({
    ...a,
    count: a.id === 'caixa' && data?.unread ? data.unread : undefined,
  }));

  return (
    <AppShell
      title="Notificações"
      subtitle="O que o sistema te contou — e o que você quer que ele conte."
    >
      <div className="flex flex-col gap-4">
        <Tabs
          aria-label="Notificações"
          idPrefix="notif"
          items={abas}
          value={aba}
          onChange={setAba}
        />

        <div
          role="tabpanel"
          id={tabIds('notif', aba).painel}
          aria-labelledby={tabIds('notif', aba).aba}
        >
          {aba === 'caixa' ? (
            <Caixa itens={data?.items ?? []} naoLidas={data?.unread ?? 0} carregando={isLoading} />
          ) : (
            <Preferencias />
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

function Caixa({
  itens,
  naoLidas,
  carregando,
}: {
  itens: InboxItem[];
  naoLidas: number;
  carregando: boolean;
}) {
  const toast = useToast();

  const marcar = useApiMutation(notificationsRead, { invalidates: [notificationsInbox] });
  const marcarTudo = useApiMutation(notificationsReadAll, {
    invalidates: [notificationsInbox],
    onError: (e: ApiError) => toast.error('Não foi possível marcar', e.problem.message),
  });

  return (
    <Card>
      <CardHeader
        title="Caixa"
        description={naoLidas > 0 ? `${naoLidas} sem ler` : 'Tudo lido.'}
        actions={
          naoLidas > 0 && (
            <Button
              size="sm"
              icon={<Check className="size-4" />}
              loading={marcarTudo.isPending}
              onClick={() =>
                marcarTudo.mutate({}, { onSuccess: (r) => toast.success(`${(r as { marked: number }).marked} marcadas como lidas`) })
              }
            >
              Marcar tudo como lido
            </Button>
          )
        }
      />
      <div className="p-2">
        {carregando ? (
          <SkeletonList rows={6} label="notificações" />
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<BellOff className="size-5" />}
            title="Nada por aqui"
            description="Quando algo precisar da sua atenção, aparece aqui — e no sino."
            className="py-8"
          />
        ) : (
          <ul className="flex flex-col">
            {itens.map((n, i) => {
              const lida = n.read_at !== null;
              const conteudo = (
                <>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-sm',
                        lida ? 'text-muted' : 'font-medium text-text'
                      )}
                    >
                      {n.title}
                    </span>
                    {n.body && (
                      <span className="mt-0.5 block truncate text-xs text-muted">{n.body}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted" data-numeric>
                    {formatarDataRelativa(n.created_at)}
                  </span>
                </>
              );

              return (
                <li
                  key={n.id}
                  className={cn(
                    'flex items-baseline gap-3 px-2.5 py-2',
                    i > 0 && 'border-t border-border-subtle',
                    !lida && 'bg-accent-soft/40'
                  )}
                >
                  {/*
                    O aviso COM destino é um link; o sem destino é texto.
                    Fazer tudo clicável e não levar a lugar nenhum ensina que
                    clicar não adianta — e aí os que levam também deixam de ser
                    clicados.
                  */}
                  {n.link ? (
                    <Link
                      to={n.link}
                      className="flex min-w-0 flex-1 items-baseline gap-3"
                      onClick={() => !lida && marcar.mutate({ body: { ids: [n.id] } })}
                    >
                      {conteudo}
                    </Link>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-baseline gap-3">{conteudo}</span>
                  )}

                  {!lida && (
                    <button
                      type="button"
                      aria-label={`Marcar "${n.title}" como lida`}
                      onClick={() => marcar.mutate({ body: { ids: [n.id] } })}
                      className="shrink-0 rounded-control p-1 text-subtle transition-colors hover:bg-surface-hover hover:text-text"
                    >
                      <Check aria-hidden="true" className="size-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function Preferencias() {
  const toast = useToast();

  const { data, isLoading } = useApiQuery(notificationTypes, undefined, {
    staleTime: 30 * 60_000,
  }) as { data: { items: NotificationType[] } | undefined; isLoading: boolean };

  const salvar = useApiMutation(notificationPreference, {
    onError: (e: ApiError) => toast.error('Não foi possível salvar', e.problem.message),
  });

  return (
    <div className="flex flex-col gap-4">
      <SilencioNoturno />

      <Card>
        <CardHeader
          title="O que avisar, e por onde"
          description="A escolha é por tipo e por canal: querer o SLA por push e o resumo por e-mail é o caso comum."
        />
        <div className="p-2">
          {isLoading || !data ? (
            <SkeletonList rows={6} label="tipos de aviso" />
          ) : (
            <ul className="flex flex-col">
              {data.items.map((t, i) => (
                <li
                  key={t.key}
                  className={cn(
                    'flex flex-col gap-2 px-2.5 py-3 sm:flex-row sm:items-center',
                    i > 0 && 'border-t border-border-subtle'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm text-text">
                      {t.label}
                      {t.bypassesQuietHours && (
                        <StatusChip
                          tone="warn"
                          size="sm"
                          hint="Este aviso atravessa o horário de silêncio — um SLA estourando de madrugada precisa acordar alguém"
                        >
                          <Volume2 aria-hidden="true" className="mr-1 inline size-3" />
                          atravessa o silêncio
                        </StatusChip>
                      )}
                    </span>
                    <span className="block text-xs text-muted" data-numeric>
                      {t.key}
                    </span>
                  </span>

                  <span className="flex flex-wrap items-center gap-1.5">
                    {NOTIFICATION_CHANNELS.map((canal) => {
                      // O canal que o TIPO não suporta nem aparece: oferecer
                      // "WhatsApp" num aviso que não tem forma de WhatsApp é
                      // prometer o que não vai acontecer.
                      if (!t.channels.includes(canal)) return null;
                      return (
                        <CanalDoTipo
                          key={canal}
                          tipo={t.key}
                          canal={canal}
                          onSalvar={(enabled, digest) =>
                            salvar.mutate(
                              { body: { typeKey: t.key, channel: canal, enabled, digest } },
                              { onSuccess: () => toast.success('Preferência salva') }
                            )
                          }
                        />
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * Um canal de um tipo.
 *
 * O estado inicial NÃO é lido do servidor: a rota de preferências só escreve —
 * não há `GET`. A tela diz isso em vez de fingir que sabe: mostrar um botão
 * "ligado" que é palpite faria a pessoa desligar algo que já estava desligado
 * e concluir que o sistema ignora a escolha dela.
 */
function CanalDoTipo({
  tipo,
  canal,
  onSalvar,
}: {
  tipo: string;
  canal: NotificationChannel;
  onSalvar: (enabled: boolean, digest: DigestMode) => void;
}) {
  const [digest, setDigest] = useState<DigestMode>('immediate');

  return (
    <span className="flex items-center gap-1 rounded-control border border-border-subtle px-1.5 py-1">
      <span className="text-xs text-muted">{ROTULO_CANAL[canal]}</span>
      <Select
        aria-label={`Frequência de ${ROTULO_CANAL[canal]} para ${tipo}`}
        value={digest}
        onChange={(e) => {
          const d = e.target.value as DigestMode | 'off';
          if (d === 'off') {
            onSalvar(false, 'immediate');
            return;
          }
          setDigest(d);
          onSalvar(true, d);
        }}
        className="h-6 w-28 text-xs"
      >
        <option value="off">não avisar</option>
        {DIGEST_MODES.map((d) => (
          <option key={d} value={d}>
            {ROTULO_DIGEST[d]}
          </option>
        ))}
      </Select>
    </span>
  );
}

/* -------------------------------------------------------------------------- */

function SilencioNoturno() {
  const toast = useToast();
  const [inicio, setInicio] = useState('22:00');
  const [fim, setFim] = useState('07:00');

  const salvar = useApiMutation(notificationQuietHours, {
    onError: (e: ApiError) => toast.error('Não foi possível salvar', e.problem.message),
  });

  return (
    <Card>
      <CardHeader
        title="Horário de silêncio"
        description="Fora deste intervalo nada toca — exceto os avisos marcados como “atravessa o silêncio”."
      />
      <div className="flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1 text-xs text-subtle">
          Começa
          <Input
            type="time"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            className="w-28"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-subtle">
          Termina
          <Input type="time" value={fim} onChange={(e) => setFim(e.target.value)} className="w-28" />
        </label>

        <Button
          variant="secondary"
          loading={salvar.isPending}
          icon={<Bell className="size-4" />}
          onClick={() =>
            salvar.mutate(
              {
                body: {
                  // MINUTOS desde a meia-noite, e não texto de hora: assim a
                  // janela que atravessa a meia-noite (1320 → 420) é
                  // representável sem caso especial.
                  startMinute: emMinutos(inicio),
                  endMinute: emMinutos(fim),
                },
              },
              { onSuccess: () => toast.success('Horário de silêncio salvo') }
            )
          }
        >
          Salvar
        </Button>

        <Button
          variant="ghost"
          onClick={() =>
            salvar.mutate(
              { body: { startMinute: null, endMinute: null } },
              { onSuccess: () => toast.success('Silêncio removido', 'Tudo passa a tocar.') }
            )
          }
        >
          Remover silêncio
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

const ROTULO_CANAL: Record<string, string> = {
  in_app: 'no sistema',
  email: 'e-mail',
  push: 'push',
  whatsapp: 'WhatsApp',
};

const ROTULO_DIGEST: Record<string, string> = {
  immediate: 'na hora',
  daily: 'resumo diário',
  weekly: 'resumo semanal',
};

/** `22:30` → `1350`. Nulo se o texto não for uma hora. */
function emMinutos(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
