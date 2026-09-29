/**
 * Aurora — agenda (SPEC v0.2 §13 · EPIC-012).
 *
 * CONFERIR ANTES DE SALVAR. É a regra inteira desta tela.
 *
 * Quando o coordenador escolhe pessoa e horário, a tela pergunta ao servidor
 * o que aquela combinação criaria de conflito — e mostra ANTES de ele
 * confirmar. Descobrir depois de salvar é o que faz programar custar mais do
 * que ligar para o técnico.
 *
 * BLOQUEIO E AVISO SÃO COISAS DIFERENTES, e a tela não os mistura:
 *
 *   · AUSÊNCIA BLOQUEIA. Não existe "marcar assim mesmo" para férias — a
 *     pessoa não está lá, e um agendamento por cima só produz um chamado que
 *     ninguém atende;
 *   · SOBRECARGA AVISA. Só o coordenador sabe que aquele chamado é do hospital
 *     que está sem ventilador reserva.
 *
 * E a carga aparece junto com o motivo: "Rafael, 6 de 8 horas ocupadas" é o
 * que evita o técnico com onze chamados e o colega com dois.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Ban, User } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  Progress,
  Select,
  SkeletonList,
  StatStrip,
  StatusChip,
  cn,
  useToast,
} from '@aurora/ui';
import {
  scheduleBuckets,
  scheduleCheck,
  scheduleResources,
  scheduleSet,
  workOrdersBoard,
  workOrdersList,
  type ScheduleConflict,
  type ResourceLoad,
  type AgendaBucketItem,
} from '@aurora/contracts';
import { ApiError, useApi, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';

/**
 * O item vem do contrato, e não de uma interface escrita à mão aqui.
 *
 * A que existia antes tinha `id: string` e `[k: string]: unknown`. A assinatura
 * de índice fazia QUALQUER campo compilar, e o `id` afirmava um campo que a
 * consulta nunca devolveu — então `os.id` era `undefined` em silêncio: chave
 * duplicada na lista, e `workOrderId: undefined` na hora de gravar.
 */
type Balde = AgendaBucketItem;

export function AgendaPage() {
  const [programando, setProgramando] = useState<Balde | null>(null);

  const { data, isLoading, isError, error } = useApiQuery(scheduleBuckets) as {
    data: { labels: Record<string, string>; counts: Record<string, number>; items: Balde[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  if (isError) return <ErrorScreen error={error} />;

  const itens = data?.items ?? [];
  const contagem = (b: string) => data?.counts[b] ?? 0;

  /*
   * A ORDEM DOS BALDES É UMA DECISÃO, e ela vem do §13.
   *
   * "Reagendar" vem antes de "atrasada": uma OS cuja janela caiu sobre férias
   * não está atrasada por culpa de ninguém, e misturar as duas junta o
   * problema de PROGRAMAÇÃO com o de EXECUÇÃO — que são conversas diferentes,
   * com pessoas diferentes.
   */
  const BALDES: { id: string; tom: 'bad' | 'warn' | 'accent'; explicacao: string }[] = [
    {
      id: 'to_reschedule',
      tom: 'warn',
      explicacao: 'A janela caiu sobre uma ausência criada depois. Remarque perto da data original.',
    },
    { id: 'late', tom: 'bad', explicacao: 'A janela marcada terminou e o trabalho não começou.' },
    { id: 'unscheduled', tom: 'warn', explicacao: 'Sem data: ninguém programou ainda.' },
  ];

  return (
    <AppShell title="Agenda" subtitle="O que está sem data, o que atrasou e o que é para hoje.">
      {isLoading ? (
        <SkeletonList rows={6} label="agenda" />
      ) : (
        <div className="flex flex-col gap-5">
          {/*
           * A faixa existe porque três cartões lado a lado com um número no
           * canto NÃO comunicam urgência — era o diagnóstico "parece três
           * caixas". Aqui os números têm o peso do que significam, e o
           * atrasado tem tom próprio.
           */}
          <StatStrip
            items={[
              { label: 'Atrasadas', value: contagem('late'), tone: contagem('late') > 0 ? 'bad' : 'good' },
              {
                label: 'Reagendar',
                value: contagem('to_reschedule'),
                tone: contagem('to_reschedule') > 0 ? 'warn' : 'good',
                hint: 'Janela invalidada por ausência criada depois',
              },
              {
                label: 'Sem data',
                value: contagem('unscheduled'),
                tone: contagem('unscheduled') > 0 ? 'warn' : 'good',
              },
              {
                label: 'Remarcadas 3+',
                value: itens.filter((i) => i.reschedule_count >= 3).length,
                tone: itens.some((i) => i.reschedule_count >= 3) ? 'warn' : 'neutral',
                hint: 'Remarcar muitas vezes é sinal de problema, não de rotina',
              },
            ]}
          />

          <div className="grid gap-4 lg:grid-cols-3">
            {BALDES.filter((b) => (data?.labels[b.id] ?? null) !== null).map((balde) => {
              const doBalde = itens.filter((i) => i.bucket === balde.id);
              return (
                <Card key={balde.id} className="flex flex-col">
                  <CardHeader
                    title={data?.labels[balde.id] ?? balde.id}
                    description={balde.explicacao}
                    actions={
                      <StatusChip tone={doBalde.length > 0 ? balde.tom : 'neutral'} size="sm" withoutDot>
                        {contagem(balde.id)}
                      </StatusChip>
                    }
                  />
                  <div className="min-h-0 flex-1 p-2">
                    {doBalde.length === 0 ? (
                      <EmptyState
                        icon={<CalendarDays className="size-5" />}
                        title={balde.id === 'late' ? 'Nada atrasado' : 'Vazio'}
                        description={
                          balde.id === 'late' ? 'Toda janela marcada está em dia.' : 'Nada neste balde agora.'
                        }
                        className="py-8"
                      />
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {doBalde.map((os) => (
                          <li key={os.work_order_id}>
                            <CartaoDaAgenda os={os} onProgramar={() => setProgramando(os)} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {programando && <DialogoProgramar ordem={programando} onFechar={() => setProgramando(null)} />}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O cartão de uma ordem dentro de um balde da agenda.
 *
 * Antes eram duas linhas de texto. O que faltava era tudo que a coordenação
 * usa para decidir A QUEM dar o trabalho e QUANDO: o responsável (ou a
 * ausência dele, que é a informação mais acionável do balde), o local, a
 * duração da janela e o histórico de remarcação.
 *
 * "Sem responsável" aparece em tom de atenção, e não como texto cinza: uma OS
 * marcada para hoje sem ninguém designado é a que não vai acontecer.
 */
function CartaoDaAgenda({ os, onProgramar }: { os: Balde; onProgramar: () => void }) {
  const critica = os.priority === 'emergency' || os.priority === 'very_urgent';

  return (
    <button
      type="button"
      onClick={onProgramar}
      className={cn(
        'relative w-full overflow-hidden rounded-card border border-border bg-surface p-3 pl-4 text-left shadow-card transition-all hover:border-border-strong hover:shadow-raised',
        os.window_invalidated_at && 'border-warn'
      )}
    >
      {critica && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-bad" />}

      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm leading-tight font-medium text-text">{os.title}</span>
          <span className="mt-1 block truncate text-2xs text-muted" data-numeric>
            {os.number ?? 'sem número'}
            {os.location_name ? ` · ${os.location_name}` : ''}
          </span>
        </span>
        {os.scheduled_start && (
          <span className="shrink-0 text-right">
            <span className="block text-sm font-semibold tabular-nums text-text" data-numeric>
              {new Date(os.scheduled_start).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {os.minutes !== null && <span className="block text-2xs text-subtle">{os.minutes} min</span>}
          </span>
        )}
      </span>

      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-2xs font-medium',
            os.assignee_name ? 'bg-surface-sunken text-muted' : 'bg-warn-soft text-warn-text'
          )}
        >
          <User aria-hidden="true" className="size-3" />
          {os.assignee_name ?? 'sem responsável'}
        </span>

        {os.reschedule_count >= 3 && (
          <StatusChip tone="warn" size="sm" hint={`Remarcada ${os.reschedule_count} vezes`}>
            {os.reschedule_count}× remarcada
          </StatusChip>
        )}

        {/* A janela invalidada carrega o MOTIVO, e é o que impede o telefonema:
            "a pessoa entrou em férias de 07/04 a 20/04" resolve sozinho. */}
        {os.window_invalidated_at && (
          <StatusChip tone="warn" size="sm" hint={os.window_invalidated_reason ?? undefined}>
            Reagendar
          </StatusChip>
        )}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function DialogoProgramar({ ordem, onFechar }: { ordem: Balde; onFechar: () => void }) {
  const api = useApi();
  const toast = useToast();

  const [responsavel, setResponsavel] = useState('');
  const [inicio, setInicio] = useState(() => proximaHoraCheia());
  const [duracao, setDuracao] = useState(60);
  const [conflitos, setConflitos] = useState<ScheduleConflict[] | null>(null);
  const [conferindo, setConferindo] = useState(false);

  const { data: recursos } = useApiQuery(scheduleResources, { query: {} }) as {
    data: { items: ResourceLoad[] } | undefined;
  };

  const fim = useMemo(
    () => new Date(new Date(inicio).getTime() + duracao * 60_000).toISOString(),
    [inicio, duracao]
  );

  /*
   * A conferência acontece a cada mudança, com atraso curto.
   *
   * É o equivalente ao arrasto: o coordenador vê o conflito enquanto escolhe,
   * e não depois de confirmar. 300ms é o bastante para não disparar uma
   * chamada por tecla digitada na hora.
   */
  useEffect(() => {
    if (!inicio) return;
    let vivo = true;
    setConferindo(true);
    const t = setTimeout(() => {
      void api
        .call(scheduleCheck, {
          body: {
            workOrderId: ordem.work_order_id,
            startsAt: new Date(inicio).toISOString(),
            endsAt: fim,
            assigneeMembershipId: responsavel || null,
          },
        })
        .then((r) => {
          if (vivo) setConflitos((r as { conflicts: ScheduleConflict[] }).conflicts);
        })
        .catch(() => {
          // Falhar a CONFERÊNCIA não pode impedir de tentar salvar: o servidor
          // confere de novo na gravação, e é essa conferência que vale.
          if (vivo) setConflitos(null);
        })
        .finally(() => vivo && setConferindo(false));
    }, 300);

    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [api, ordem.work_order_id, inicio, fim, responsavel]);

  const gravar = useApiMutation(scheduleSet, {
    invalidates: [scheduleBuckets, workOrdersList, workOrdersBoard],
    onError: (e: ApiError) => toast.error('Não foi possível programar', e.problem.message),
  });

  const bloqueios = (conflitos ?? []).filter((c) => c.severity === 'block');
  const avisos = (conflitos ?? []).filter((c) => c.severity === 'warn');

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title="Programar ordem de serviço"
      description="Escolha quem e quando. Os conflitos aparecem aqui antes de você confirmar."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button
            variant="primary"
            loading={gravar.isPending}
            // Ausência BLOQUEIA. Não existe "marcar assim mesmo" para férias: a
            // pessoa não está lá, e o chamado ficaria sem quem atendesse.
            disabled={bloqueios.length > 0}
            onClick={() =>
              gravar.mutate(
                {
                  body: {
                    workOrderId: ordem.work_order_id,
                    startsAt: new Date(inicio).toISOString(),
                    endsAt: fim,
                    assigneeMembershipId: responsavel || null,
                  },
                },
                {
                  onSuccess: () => {
                    toast.success(
                      `${ordem.number ?? 'OS'} programada`,
                      new Date(inicio).toLocaleString('pt-BR')
                    );
                    onFechar();
                  },
                }
              )
            }
          >
            Programar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-control bg-surface-sunken px-3 py-2 text-sm">
          <p className="font-medium text-text">{ordem.title}</p>
          <p className="mt-0.5 text-muted" data-numeric>
            {ordem.number ?? 'sem número'}
          </p>
        </div>

        <Field label="Responsável" hint="A carga do dia aparece ao lado de cada pessoa.">
          <Select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
            <option value="">Sem responsável definido</option>
            {(recursos?.items ?? []).map((r) => (
              <option key={r.membershipId} value={r.membershipId}>
                {r.name ?? 'sem nome'}
                {r.absent
                  ? ' — ausente neste dia'
                  : r.load.capacityMinutes
                    ? ` — ${horas(r.load.bookedMinutes)} de ${horas(r.load.capacityMinutes)} ocupadas`
                    : ' — jornada não cadastrada'}
              </option>
            ))}
          </Select>
        </Field>

        <CargaDoResponsavel recursos={recursos?.items ?? []} membershipId={responsavel} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Início" required>
            <Input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </Field>
          <Field label="Duração">
            <Select value={String(duracao)} onChange={(e) => setDuracao(Number(e.target.value))}>
              <option value="30">30 minutos</option>
              <option value="60">1 hora</option>
              <option value="120">2 horas</option>
              <option value="240">4 horas</option>
              <option value="480">8 horas</option>
            </Select>
          </Field>
        </div>

        {/* -------------------------------------------------- conferência */}

        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {conferindo && <p className="text-xs text-muted">Conferindo disponibilidade…</p>}

          {!conferindo && conflitos?.length === 0 && (
            <StatusChip tone="good">Sem conflitos nesta janela</StatusChip>
          )}

          {bloqueios.map((c, i) => (
            <div key={`b${i}`} className="flex items-start gap-2 rounded-control bg-bad-soft px-3 py-2">
              <Ban aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-bad" />
              <div>
                <p className="text-sm font-medium text-bad-text">Impede o agendamento</p>
                <p className="text-sm text-bad-text">{c.detail}</p>
              </div>
            </div>
          ))}

          {avisos.map((c, i) => (
            <div key={`a${i}`} className="flex items-start gap-2 rounded-control bg-warn-soft px-3 py-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn" />
              <div>
                <p className="text-sm font-medium text-warn-text">Atenção, mas você pode seguir</p>
                <p className="text-sm text-warn-text">{c.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function CargaDoResponsavel({ recursos, membershipId }: { recursos: ResourceLoad[]; membershipId: string }) {
  if (!membershipId) return null;
  const r = recursos.find((x) => x.membershipId === membershipId);
  if (!r) return null;

  // Ausente NÃO é dia livre, e por isso não vira barra de carga vazia — que é
  // exatamente o que convidaria a colocar trabalho em cima das férias.
  if (r.absent) {
    return (
      <p className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
        {r.name ?? 'Esta pessoa'} está ausente neste dia.
      </p>
    );
  }

  // Sem jornada cadastrada a ocupação é DESCONHECIDA, e não zero: mostrar 0%
  // seria dizer a coisa errada com confiança.
  if (r.load.capacityMinutes === null) {
    return (
      <p className="text-xs text-muted">
        {r.name ?? 'Esta pessoa'} não tem jornada cadastrada, então a ocupação do dia não é calculável. Já tem{' '}
        {horas(r.load.bookedMinutes)} agendadas.
      </p>
    );
  }

  return (
    <Progress
      label={`Carga de ${r.name ?? 'responsável'} no dia`}
      value={r.load.bookedMinutes}
      max={r.load.capacityMinutes}
      tone={r.load.over ? 'bad' : 'accent'}
    />
  );
}

/** Minutos em horas, para leitura humana. */
function horas(minutos: number): string {
  const h = minutos / 60;
  return `${h.toFixed(h % 1 === 0 ? 0 : 1).replace('.', ',')} h`;
}

/** O próximo horário cheio, no formato que `datetime-local` entende. */
function proximaHoraCheia(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
