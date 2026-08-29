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
import { AlertTriangle, CalendarDays, Ban } from 'lucide-react';
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
  StatusChip,
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
} from '@aurora/contracts';
import { ApiError, useApi, useApiMutation, useApiQuery } from '../../lib/api';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';

interface Balde {
  id: string;
  bucket: string;
  number: string | null;
  title: string;
  scheduled_start?: string | null;
  [k: string]: unknown;
}

export function AgendaPage() {
  const [programando, setProgramando] = useState<Balde | null>(null);

  const { data, isLoading, isError, error } = useApiQuery(scheduleBuckets) as {
    data: { labels: Record<string, string>; counts: Record<string, number>; items: Balde[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  if (isError) return <ErrorScreen error={error} />;

  const baldes = Object.keys(data?.labels ?? {});

  return (
    <AppShell title="Agenda" subtitle="O que está sem data, o que atrasou e o que é para hoje.">
      {isLoading ? (
        <SkeletonList rows={6} label="agenda" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {baldes.map((b) => {
            const itens = (data?.items ?? []).filter((i) => i.bucket === b);
            return (
              <Card key={b}>
                <CardHeader
                  title={data?.labels[b] ?? b}
                  actions={
                    <span className="text-sm font-semibold text-muted tabular-nums" data-numeric>
                      {data?.counts[b] ?? 0}
                    </span>
                  }
                />
                <div className="p-2">
                  {itens.length === 0 ? (
                    <EmptyState
                      icon={<CalendarDays className="size-5" />}
                      title="Vazio"
                      description={b === 'overdue' ? 'Nada atrasado.' : 'Nada aqui agora.'}
                      className="py-6"
                    />
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {itens.map((os) => (
                        <li key={os.id}>
                          <button
                            type="button"
                            onClick={() => setProgramando(os)}
                            className="w-full rounded-control px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
                          >
                            <span className="block truncate text-sm text-text">{os.title}</span>
                            <span className="block truncate text-xs text-muted" data-numeric>
                              {os.number ?? 'sem número'}
                              {os.scheduled_start
                                ? ` · ${new Date(os.scheduled_start).toLocaleString('pt-BR')}`
                                : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {programando && <DialogoProgramar ordem={programando} onFechar={() => setProgramando(null)} />}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

interface Recurso {
  membership_id?: string;
  membershipId?: string;
  name?: string;
  assigned_minutes?: number;
  capacity_minutes?: number;
  [k: string]: unknown;
}

function DialogoProgramar({ ordem, onFechar }: { ordem: Balde; onFechar: () => void }) {
  const api = useApi();
  const toast = useToast();

  const [responsavel, setResponsavel] = useState('');
  const [inicio, setInicio] = useState(() => proximaHoraCheia());
  const [duracao, setDuracao] = useState(60);
  const [conflitos, setConflitos] = useState<ScheduleConflict[] | null>(null);
  const [conferindo, setConferindo] = useState(false);

  const { data: recursos } = useApiQuery(scheduleResources, { query: {} }) as {
    data: { items: Recurso[] } | undefined;
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
            workOrderId: ordem.id,
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
  }, [api, ordem.id, inicio, fim, responsavel]);

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
                    workOrderId: ordem.id,
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
            {(recursos?.items ?? []).map((r) => {
              const id = String(r.membership_id ?? r.membershipId ?? '');
              return (
                <option key={id} value={id}>
                  {String(r.name ?? 'sem nome')}
                  {r.capacity_minutes
                    ? ` — ${Math.round((r.assigned_minutes ?? 0) / 60)} de ${Math.round(r.capacity_minutes / 60)} h ocupadas`
                    : ''}
                </option>
              );
            })}
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

function CargaDoResponsavel({ recursos, membershipId }: { recursos: Recurso[]; membershipId: string }) {
  if (!membershipId) return null;
  const r = recursos.find((x) => String(x.membership_id ?? x.membershipId) === membershipId);
  if (!r?.capacity_minutes) return null;

  return (
    <Progress
      label={`Carga de ${String(r.name ?? 'responsável')} no dia`}
      value={r.assigned_minutes ?? 0}
      max={r.capacity_minutes}
      tone={(r.assigned_minutes ?? 0) > r.capacity_minutes ? 'bad' : 'accent'}
    />
  );
}

/** O próximo horário cheio, no formato que `datetime-local` entende. */
function proximaHoraCheia(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
