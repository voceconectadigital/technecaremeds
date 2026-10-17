/**
 * Aurora — ficha da ordem de serviço (SPEC v0.2 §09, §10, §12 · EPIC-009).
 *
 * O DESENHO: CABEÇALHO DE DECISÃO, RESUMO, ABAS.
 *
 * A ficha tem vinte e três informações a mostrar. Abertas de uma vez, numa
 * tela infinita, elas se anulam: quem abre para decidir o que fazer agora
 * rola por peças e anexos até achar a situação, e quem abre para conferir o
 * apontamento rola pelo diagnóstico até achar as horas.
 *
 * Então a tela responde em três camadas, na ordem em que as perguntas chegam:
 *
 *   1. CABEÇALHO — o que dá para fazer com esta OS agora. São os botões de
 *      transição, e eles vêm do servidor: só aparece o que esta pessoa pode
 *      fazer a partir deste estado.
 *   2. RESUMO — as seis coisas que decidem: situação, prazo, quem, quando,
 *      qual equipamento, onde. Ficam SEMPRE visíveis, fora das abas, porque
 *      são o contexto de tudo o que as abas dizem. Uma hora apontada sem
 *      saber que a OS está parada aguardando peça não significa nada.
 *   3. ABAS — o resto, sob demanda, cada uma buscando o seu quando é aberta.
 *
 * POR QUE AS ABAS BUSCAM SEPARADO
 *
 * Carregar horas, peças, anexos e conversa de toda OS que alguém abre paga
 * cinco consultas para mostrar uma. A maioria das aberturas é para ver a
 * situação e fechar.
 *
 * O QUE ESTA TELA NÃO FAZ, E POR QUÊ
 *
 * Não edita os campos da OS. Editar exige `work_order.update`, bloqueio
 * otimista por `version` e uma conversa sobre o que pode mudar depois de
 * fechada — é trabalho próprio, e enfiá-lo aqui produziria um formulário que
 * salva metade das coisas. A ficha LÊ e faz TRANSIÇÃO; as transições é que
 * escrevem, e escrevem pelo caminho que o servidor valida.
 */
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  Lock,
  MessageSquare,
  Package,
  Paperclip,
  Play,
  User,
} from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Progress,
  Select,
  Skeleton,
  SkeletonList,
  StatusChip,
  Tabs,
  Textarea,
  tabIds,
  useToast,
} from '@aurora/ui';
import {
  workOrderAttachments,
  workOrderComment,
  workOrderComments,
  workOrderDetail,
  workOrderParts,
  workOrderTimeEntries,
  workOrdersBoard,
  workOrdersList,
  workOrderTransition,
  type Attachment,
  type SlaClock,
  type TimeEntry,
  type WorkOrderComment,
  type WorkOrderDetail,
  type WorkOrderHistoryEntry,
  type WorkOrderPart,
  type WorkOrderTransition,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery, usePermissions, useUrlState } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { PrioridadeChip, formatarDataRelativa } from '../../routes/hoje';
import { tomDaCategoria } from './lista';
import { useCatalogo, useMotivosDeEspera } from '../../lib/catalogos';

// A aba "Conversa" saiu da navegação da OS (reunião 16/10/2026: não tem função
// nesse fluxo). Os comentários continuam gravados e no histórico — nada foi
// apagado; `?aba=conversa` em link antigo ainda abre.
const ABAS = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'execucao', label: 'Execução' },
  { id: 'anexos', label: 'Anexos' },
  { id: 'historico', label: 'Histórico' },
] as const;

/** Situações em que o assistente de execução faz sentido. */
const EXECUTAVEL = new Set(['open', 'scheduled', 'in_progress', 'waiting', 'review']);

export function OrdemPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [pedindo, setPedindo] = useState<WorkOrderTransition | null>(null);
  // A aba fica na URL: quem manda o link da conversa quer que o outro caia na
  // conversa, e recarregar a página não deve devolver a pessoa ao resumo.
  const [aba, setAba] = useUrlState<string>('aba', 'resumo');

  const { data, isLoading, isError, error } = useApiQuery(workOrderDetail, { params: { id } }) as {
    data: WorkOrderDetail | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const transicao = useApiMutation(workOrderTransition, {
    invalidates: [workOrderDetail, workOrdersList, workOrdersBoard],
    onError: (e: ApiError) => toast.error('A transição foi recusada', e.problem.message),
  });

  if (isError) return <ErrorScreen error={error} />;

  if (isLoading || !data) {
    return (
      <AppShell title="Ordem de serviço">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </AppShell>
    );
  }

  function pedir(t: WorkOrderTransition) {
    // Exige campo? Pergunta primeiro. Enviar e traduzir o 422 de volta em
    // formulário é o caminho que produz "o sistema não deixa e não diz por quê".
    if (t.requires.length > 0) {
      setPedindo(t);
      return;
    }
    transicao.mutate(
      { params: { id }, body: { to: t.to, version: data!.version } },
      { onSuccess: () => toast.success(`${data!.number ?? 'OS'} agora está em ${t.label}`) }
    );
  }

  return (
    <AppShell
      title={data.title}
      subtitle={`${data.number ?? 'sem número'} · ${data.customer_name}`}
      breadcrumbs={[{ label: 'Ordens de serviço', href: '/ordens' }, { label: data.number ?? '—' }]}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {EXECUTAVEL.has(data.status_category) &&
            (can('work_order.execute') || can('work_order.execute_any')) &&
            (data.available_transitions.length > 0 || data.status_category === 'in_progress') && (
              <Button
                variant="primary"
                icon={<Play className="size-4" />}
                onClick={() => void navigate({ to: '/ordens/$id/executar', params: { id } })}
              >
                Executar
              </Button>
            )}
          {data.available_transitions.map((t) => (
            <Button
              key={t.to}
              variant={t.category === 'done' ? 'primary' : 'secondary'}
              loading={transicao.isPending}
              onClick={() => pedir(t)}
              icon={t.category === 'in_progress' ? <Play className="size-4" /> : undefined}
            >
              {t.label}
            </Button>
          ))}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FaixaDeDecisao os={data} />

        <Tabs
          aria-label="Seções da ordem de serviço"
          idPrefix="os"
          items={[...ABAS]}
          value={aba}
          onChange={setAba}
        />

        <div
          role="tabpanel"
          id={tabIds('os', aba).painel}
          aria-labelledby={tabIds('os', aba).aba}
          tabIndex={0}
        >
          {aba === 'resumo' && <AbaResumo os={data} />}
          {aba === 'execucao' && <AbaExecucao id={id} />}
          {aba === 'anexos' && <AbaAnexos id={id} />}
          {aba === 'conversa' && <AbaConversa id={id} />}
          {aba === 'historico' && <AbaHistorico historico={data.history} />}
        </div>
      </div>

      {pedindo && (
        <DialogoDeTransicao
          transicao={pedindo}
          onFechar={() => setPedindo(null)}
          onConfirmar={(campos) => {
            transicao.mutate(
              { params: { id }, body: { to: pedindo.to, version: data.version, ...campos } },
              {
                onSuccess: () => {
                  toast.success(`${data.number ?? 'OS'} agora está em ${pedindo.label}`);
                  setPedindo(null);
                },
              }
            );
          }}
          ocupado={transicao.isPending}
        />
      )}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* A faixa de decisão                                                         */
/* -------------------------------------------------------------------------- */

/**
 * As seis coisas que decidem, sempre visíveis.
 *
 * Fica FORA das abas porque é o contexto de tudo o que elas dizem. Ler "3h
 * apontadas" sem saber que a OS está parada há dois dias aguardando peça leva
 * à conclusão errada — e é justamente na aba de execução que a pessoa está
 * quando pensa nisso.
 */
function FaixaDeDecisao({ os }: { os: WorkOrderDetail }) {
  return (
    <Card>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={tomDaCategoria(os.status_category)}>{os.status_label}</StatusChip>
          <PrioridadeChip prioridade={os.priority} />
          {os.criticality_label && (
            <StatusChip tone="neutral" size="sm">
              {os.criticality_label}
            </StatusChip>
          )}
          <span className="text-sm text-muted">{os.work_order_type_label}</span>
          {os.reschedule_count > 0 && (
            // Remarcar quatro vezes não é detalhe de agenda: é o sintoma de um
            // atendimento que ninguém está conseguindo fazer.
            <StatusChip tone="warn" size="sm">
              Remarcada {os.reschedule_count}×
            </StatusChip>
          )}
        </div>

        {os.wait_reason_label && (
          <div className="flex items-start gap-2 rounded-control bg-warn-soft px-3 py-2">
            <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn" />
            <p className="text-sm text-warn-text">
              Parada: {os.wait_reason_label}.{' '}
              {/* Cronômetro pausado e correndo são coisas diferentes, e a
                  diferença muda quem cobra de quem. */}
              {os.pauses_sla
                ? 'O relógio do SLA está pausado enquanto isso.'
                : 'O relógio do SLA continua correndo.'}
              {os.wait_note && <span className="mt-1 block text-warn-text/90">{os.wait_note}</span>}
            </p>
          </div>
        )}

        {os.window_invalidated_at && (
          <div className="flex items-start gap-2 rounded-control bg-bad-soft px-3 py-2">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-bad" />
            <p className="text-sm text-bad-text">
              A janela programada não vale mais
              {os.window_invalidated_reason ? `: ${os.window_invalidated_reason}` : '.'} Reprograme antes de
              contar com ela.
            </p>
          </div>
        )}

        <Sla relogios={os.sla} />

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <Info
            rotulo="Responsável"
            valor={os.assignee_name ?? os.team_name}
            icone={<User className="size-3.5" />}
            vazio="Sem responsável"
          />
          <Info
            rotulo="Programada"
            valor={os.scheduled_start ? new Date(os.scheduled_start).toLocaleString('pt-BR') : null}
            icone={<CalendarClock className="size-3.5" />}
            vazio="Sem data"
          />
          <Info rotulo="Equipamento" valor={os.asset_name_snapshot} vazio="Sem equipamento" />
          <Info rotulo="Local" valor={os.location_path_snapshot ?? os.location_name_snapshot} />
        </dl>
      </div>
    </Card>
  );
}

/**
 * Os relógios de prazo.
 *
 * A barra mostra o percentual consumido em tempo ÚTIL, e não em relógio de
 * parede: um chamado aberto sexta às 17h com prazo de 4 horas vence terça de
 * manhã. Mostrar o tempo corrido faria a barra encher no fim de semana e a
 * coordenação correr atrás de um prazo que não estava correndo.
 */
function Sla({ relogios }: { relogios: SlaClock[] | null }) {
  const ativos = (relogios ?? []).filter((r) => r.state !== 'cancelled');
  if (ativos.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {ativos.map((r) => {
        const estourou = r.breached_at !== null;
        const perto = !estourou && r.consumed_pct >= 80;
        return (
          <div key={r.id} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs text-subtle">{ROTULO_SLA[r.kind] ?? r.kind}</span>
            <Progress
              value={Math.min(r.consumed_pct, 100)}
              tone={estourou ? 'bad' : perto ? 'warn' : 'good'}
              label={`${ROTULO_SLA[r.kind] ?? r.kind}: ${r.consumed_pct}% do prazo`}
              className="flex-1"
            />
            <span
              className={
                'w-44 shrink-0 text-right text-xs tabular-nums ' +
                (estourou ? 'text-bad-text' : perto ? 'text-warn-text' : 'text-muted')
              }
              data-numeric
            >
              {estourou
                ? `estourou ${formatarDataRelativa(r.breached_at!)}`
                : `vence ${new Date(r.due_at).toLocaleString('pt-BR')}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const ROTULO_SLA: Record<string, string> = {
  response: 'Atendimento',
  resolution: 'Solução',
  first_response: 'Primeira resposta',
};

/* -------------------------------------------------------------------------- */
/* Aba: resumo                                                                */
/* -------------------------------------------------------------------------- */

function AbaResumo({ os }: { os: WorkOrderDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader title="O que foi relatado" />
          <div className="flex flex-col gap-4 p-4">
            <p className="text-base whitespace-pre-wrap text-text">
              {os.description || <span className="text-subtle">Sem descrição.</span>}
            </p>
            {os.reported_failure_label && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Info rotulo="Sintoma relatado" valor={os.reported_failure_label} />
              </dl>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Diagnóstico e solução"
            description="Preenchidos pelas transições de conclusão — é o que vai para o relatório do cliente."
          />
          <div className="flex flex-col gap-4 p-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Info rotulo="Causa" valor={os.cause_failure_label} vazio="Ainda não diagnosticada" />
              <Info rotulo="Ação tomada" valor={os.action_label} vazio="Ainda não registrada" />
            </dl>
            <div>
              <dt className="text-xs text-subtle">O que foi feito</dt>
              <dd className="mt-1 text-base whitespace-pre-wrap text-text">
                {os.resolution || (
                  <span className="text-subtle">Ainda não descrito. É pedido na transição de conclusão.</span>
                )}
              </dd>
            </div>
            {os.rework_reason && (
              <p className="rounded-control bg-warn-soft px-3 py-2 text-sm text-warn-text">
                Devolvida para retrabalho: {os.rework_reason}
              </p>
            )}
            {os.cancellation_reason && (
              <p className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
                Cancelada: {os.cancellation_reason}
              </p>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Identificação" />
        <dl className="flex flex-col gap-3 p-4 text-sm">
          <Info rotulo="Número" valor={os.number} />
          <Info rotulo="Cliente" valor={os.customer_name} />
          <Info rotulo="Patrimônio" valor={os.asset_serial_snapshot} />
          <Info rotulo="Aberta por" valor={os.created_by_name} />
          <Info rotulo="Aberta" valor={formatarDataRelativa(os.created_at)} />
          <Info rotulo="Veio da solicitação" valor={os.service_request_number} vazio="Aberta direto" />
          <Info
            rotulo="Iniciada"
            valor={os.started_at ? new Date(os.started_at).toLocaleString('pt-BR') : null}
            vazio="Ainda não iniciada"
          />
          <Info
            rotulo="Concluída"
            valor={os.completed_at ? new Date(os.completed_at).toLocaleString('pt-BR') : null}
            vazio="Ainda não concluída"
          />
        </dl>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Aba: execução — horas e peças                                              */
/* -------------------------------------------------------------------------- */

function AbaExecucao({ id }: { id: string }) {
  const { data: horas, isLoading: carregandoHoras } = useApiQuery(workOrderTimeEntries, {
    params: { id },
  }) as {
    data: { items: TimeEntry[]; total_minutes: number; open_entries: number } | undefined;
    isLoading: boolean;
  };
  const { data: pecas, isLoading: carregandoPecas } = useApiQuery(workOrderParts, {
    params: { id },
  }) as { data: { items: WorkOrderPart[] } | undefined; isLoading: boolean };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Horas"
          actions={
            horas && (
              <span className="text-sm font-semibold text-text tabular-nums" data-numeric>
                {formatarDuracao(horas.total_minutes)}
              </span>
            )
          }
        />
        <div className="p-2">
          {carregandoHoras ? (
            <SkeletonList rows={3} label="horas apontadas" />
          ) : !horas || horas.items.length === 0 ? (
            <EmptyState
              icon={<Clock className="size-5" />}
              title="Nenhuma hora apontada"
              description="O apontamento acontece no campo, pelo cronômetro ou pelo lançamento manual."
              className="py-6"
            />
          ) : (
            <>
              {horas.open_entries > 0 && (
                // O defeito operacional mais comum do apontamento: o
                // cronômetro que ninguém parou. Dizer é melhor do que somar
                // como se o total estivesse completo.
                <p className="mx-2 mb-2 rounded-control bg-warn-soft px-3 py-2 text-xs text-warn-text">
                  {horas.open_entries === 1
                    ? 'Há um cronômetro ainda correndo; o total não inclui esse tempo.'
                    : `Há ${horas.open_entries} cronômetros ainda correndo; o total não inclui esse tempo.`}
                </p>
              )}
              <ul className="flex flex-col">
                {horas.items.map((h, i) => (
                  <li
                    key={h.id}
                    className={
                      'flex items-baseline gap-3 px-2.5 py-2 ' +
                      (i > 0 ? 'border-t border-border-subtle' : '')
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text">
                        {h.person_name ?? 'Sem responsável'}
                      </span>
                      <span className="block text-xs text-muted" data-numeric>
                        {new Date(h.started_at).toLocaleString('pt-BR')}
                        {h.note ? ` · ${h.note}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-text tabular-nums" data-numeric>
                      {h.minutes === null ? (
                        <span className="text-warn-text">em curso</span>
                      ) : (
                        formatarDuracao(h.minutes)
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Peças" description="Sai e volta são linhas diferentes." />
        <div className="p-2">
          {carregandoPecas ? (
            <SkeletonList rows={3} label="peças" />
          ) : !pecas || pecas.items.length === 0 ? (
            <EmptyState
              icon={<Package className="size-5" />}
              title="Nenhuma peça movimentada"
              className="py-6"
            />
          ) : (
            <ul className="flex flex-col">
              {pecas.items.map((p, i) => (
                <li
                  key={p.id}
                  className={
                    'flex items-baseline gap-3 px-2.5 py-2 ' + (i > 0 ? 'border-t border-border-subtle' : '')
                  }
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">
                      {p.item_name ?? 'Item removido do cadastro'}
                    </span>
                    <span className="block truncate text-xs text-muted" data-numeric>
                      {p.item_sku ? `${p.item_sku} · ` : ''}
                      {p.warehouse_name ?? 'sem almoxarifado'}
                    </span>
                  </span>
                  <span
                    className={
                      'shrink-0 text-sm tabular-nums ' + (p.kind === 'return' ? 'text-muted' : 'text-text')
                    }
                    data-numeric
                  >
                    {p.kind === 'return' ? '−' : '+'}
                    {p.qty}
                    {p.unit ? ` ${p.unit}` : ''}
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

/* -------------------------------------------------------------------------- */
/* Aba: anexos                                                                */
/* -------------------------------------------------------------------------- */

function AbaAnexos({ id }: { id: string }) {
  const { data, isLoading } = useApiQuery(workOrderAttachments, { params: { id } }) as {
    data: { items: Attachment[] } | undefined;
    isLoading: boolean;
  };

  return (
    <Card>
      <CardHeader title="Anexos e fotos" />
      <div className="p-2">
        {isLoading ? (
          <SkeletonList rows={3} label="anexos" />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<Paperclip className="size-5" />}
            title="Nenhum anexo"
            description="As fotos de antes e depois entram pelo aplicativo de campo."
            className="py-6"
          />
        ) : (
          <ul className="flex flex-col">
            {data.items.map((a, i) => (
              <li
                key={a.id}
                className={
                  'flex items-baseline gap-3 px-2.5 py-2 ' + (i > 0 ? 'border-t border-border-subtle' : '')
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{a.file_name}</span>
                  <span className="block truncate text-xs text-muted" data-numeric>
                    {ROTULO_ANEXO[a.purpose] ?? a.purpose} · {formatarTamanho(a.byte_size)} ·{' '}
                    {a.uploaded_by_name ?? 'autor desconhecido'}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted" data-numeric>
                  {formatarDataRelativa(a.uploaded_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

const ROTULO_ANEXO: Record<string, string> = {
  before: 'Antes',
  after: 'Depois',
  evidence: 'Evidência',
  document: 'Documento',
  signature: 'Assinatura',
  other: 'Outro',
};

/* -------------------------------------------------------------------------- */
/* Aba: conversa                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Comentários e notas internas, no mesmo fio.
 *
 * NÃO são duas abas. Separá-las produziria exatamente o erro que a separação
 * de coluna existe para evitar: alguém responde na aba errada porque estava
 * lendo a outra. Aqui as duas conversas correm juntas, em ordem, e a nota
 * interna é visualmente inconfundível — fundo diferente, cadeado, e o rótulo
 * dizendo que o cliente não vê.
 *
 * Quem não pode ler nota interna simplesmente não recebe nenhuma do servidor,
 * e o seletor de destino nem aparece.
 */
function AbaConversa({ id }: { id: string }) {
  const toast = useToast();
  const [texto, setTexto] = useState('');
  const [interna, setInterna] = useState(true);

  const { data, isLoading } = useApiQuery(workOrderComments, { params: { id } }) as {
    data: { items: WorkOrderComment[]; can_write_internal: boolean } | undefined;
    isLoading: boolean;
  };

  const escrever = useApiMutation(workOrderComment, {
    invalidates: [workOrderComments],
    onError: (e: ApiError) => toast.error('Não foi possível publicar', e.problem.message),
  });

  const podeInterna = data?.can_write_internal ?? false;
  // Quem não pode escrever nota interna só tem um destino possível; deixar o
  // estado em `true` mandaria uma nota interna que o servidor recusaria.
  const destino = podeInterna && interna ? 'internal' : 'customer';

  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader title="Conversa" description="O que o cliente lê e o que fica entre a equipe." />

      <div className="p-2">
        {isLoading ? (
          <SkeletonList rows={3} label="comentários" />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={<MessageSquare className="size-5" />} title="Nada dito ainda" className="py-6" />
        ) : (
          <ul className="flex flex-col gap-2 p-1">
            {data.items.map((c) => (
              <li
                key={c.id}
                className={
                  'rounded-control px-3 py-2 ' +
                  (c.visibility === 'internal'
                    ? 'border border-border-subtle bg-surface-sunken'
                    : 'bg-info-soft')
                }
              >
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  {c.visibility === 'internal' && <Lock aria-hidden="true" className="size-3 shrink-0" />}
                  <span className="font-medium text-text">{c.author_name ?? 'Alguém'}</span>
                  <span>·</span>
                  <span data-numeric>{formatarDataRelativa(c.created_at)}</span>
                  <span>·</span>
                  <span>{c.visibility === 'internal' ? 'o cliente não vê' : 'o cliente vê'}</span>
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-text">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="flex flex-col gap-3 border-t border-border-subtle p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (texto.trim().length === 0) return;
          escrever.mutate(
            { params: { id }, body: { body: texto.trim(), visibility: destino } },
            { onSuccess: () => setTexto('') }
          );
        }}
      >
        <Field
          label={destino === 'internal' ? 'Nota interna' : 'Mensagem para o cliente'}
          hint={
            destino === 'internal'
              ? 'Fica entre a equipe. Não aparece no portal nem no relatório.'
              : 'O cliente lê isto no portal. Escreva como se ele estivesse lendo — porque está.'
          }
        >
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder={
              destino === 'internal'
                ? 'Ex.: já é a terceira vez neste equipamento; avaliar substituição.'
                : 'Ex.: peça encomendada, previsão de chegada na quinta-feira.'
            }
          />
        </Field>

        <div className="flex items-center justify-between gap-3">
          {podeInterna ? (
            <Select
              value={destino}
              aria-label="Quem vê este comentário"
              onChange={(e) => setInterna(e.target.value === 'internal')}
              className="w-56"
            >
              <option value="internal">Nota interna</option>
              <option value="customer">Visível para o cliente</option>
            </Select>
          ) : (
            <span className="text-xs text-muted">Este comentário é visível para o cliente.</span>
          )}
          <Button
            type="submit"
            variant="primary"
            loading={escrever.isPending}
            disabled={texto.trim().length === 0}
          >
            Publicar
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Aba: histórico                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A linha do tempo, com o tempo DENTRO de cada estado.
 *
 * "Mudou para Aguardando" não responde nada. "Ficou 6 dias em Aguardando"
 * responde à única pergunta que se faz olhando um histórico: onde foi parar o
 * tempo.
 */
function AbaHistorico({ historico }: { historico: WorkOrderHistoryEntry[] }) {
  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader title="Histórico" description="Cada mudança, e quanto tempo levou." />
      <ol className="flex flex-col gap-3 p-4">
        {historico.length === 0 && <li className="text-sm text-subtle">Ainda sem movimentação.</li>}
        {historico.map((h, i) => (
          <li key={`${h.changed_at}-${i}`} className="flex gap-3 text-sm">
            <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-border-strong" />
            <span className="min-w-0 flex-1">
              <span className="block text-text">
                {h.from_label ? `${h.from_label} → ` : ''}
                {h.to_label}
                {h.wait_reason_label && <span className="text-muted"> ({h.wait_reason_label})</span>}
              </span>
              <span className="block text-xs text-muted" data-numeric>
                {formatarDataRelativa(h.changed_at)}
                {h.seconds_in_from !== null &&
                  h.from_label &&
                  ` · ${formatarDuracao(Math.round(h.seconds_in_from / 60))} em ${h.from_label}`}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Diálogo de transição                                                       */
/* -------------------------------------------------------------------------- */

function DialogoDeTransicao({
  transicao,
  onFechar,
  onConfirmar,
  ocupado,
}: {
  transicao: WorkOrderTransition;
  onFechar: () => void;
  onConfirmar: (campos: Record<string, unknown>) => void;
  ocupado: boolean;
}) {
  const motivos = useMotivosDeEspera();
  const causas = useCatalogo('failure_cause');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);

  const precisa = (campo: string) => transicao.requires.includes(campo);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title={transicao.label}
      description={`Esta mudança exige ${transicao.requires.length === 1 ? 'uma informação' : 'algumas informações'} antes de ser registrada.`}
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button
            variant="primary"
            loading={ocupado}
            onClick={() => {
              const faltando = transicao.requires.filter((c) => !valores[c]?.trim());
              if (faltando.length > 0) {
                setErro('Preencha os campos obrigatórios.');
                return;
              }
              onConfirmar({
                ...(valores.wait_reason_id ? { wait_reason_id: valores.wait_reason_id } : {}),
                ...(valores.resolution ? { resolution: valores.resolution } : {}),
                ...(valores.cause_failure_code_id
                  ? { cause_failure_code_id: valores.cause_failure_code_id }
                  : {}),
                ...(valores.cancellation_reason ? { cancellation_reason: valores.cancellation_reason } : {}),
              });
            }}
          >
            {transicao.label}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {precisa('wait_reason_id') && (
          <Field
            label="Motivo da parada"
            required
            error={erro}
            hint="Alguns motivos pausam o relógio do SLA; outros não. A escolha aqui muda o indicador."
          >
            <Select
              value={valores.wait_reason_id ?? ''}
              onChange={(e) => setValores((v) => ({ ...v, wait_reason_id: e.target.value }))}
            >
              <option value="">Selecione…</option>
              {motivos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.pauses_sla ? ' (pausa o prazo)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {precisa('resolution') && (
          <Field
            label="O que foi feito"
            required
            error={erro}
            hint="É o que aparece no relatório do cliente e no histórico do equipamento."
          >
            <Textarea
              value={valores.resolution ?? ''}
              onChange={(e) => setValores((v) => ({ ...v, resolution: e.target.value }))}
              placeholder="Ex.: substituída a válvula de exalação e refeito o teste de vazamento."
            />
          </Field>
        )}

        {precisa('cause_failure_code_id') && (
          <Field label="Causa" required error={erro}>
            <Select
              value={valores.cause_failure_code_id ?? ''}
              onChange={(e) => setValores((v) => ({ ...v, cause_failure_code_id: e.target.value }))}
            >
              <option value="">Selecione…</option>
              {causas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {precisa('cancellation_reason') && (
          <Field label="Motivo do cancelamento" required error={erro}>
            <Textarea
              value={valores.cancellation_reason ?? ''}
              onChange={(e) => setValores((v) => ({ ...v, cancellation_reason: e.target.value }))}
            />
          </Field>
        )}

        {/* Exigência que a tela ainda não sabe pedir: dito, e não escondido. */}
        {transicao.requires.some(
          (c) => !['wait_reason_id', 'resolution', 'cause_failure_code_id', 'cancellation_reason'].includes(c)
        ) && (
          <p className="rounded-control bg-warn-soft px-3 py-2 text-xs text-warn-text">
            Esta transição também exige: {transicao.requires.join(', ')}. Alguns desses campos ainda não têm
            formulário nesta tela.
          </p>
        )}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function Info({
  rotulo,
  valor,
  icone,
  vazio,
}: {
  rotulo: string;
  valor: string | null | undefined;
  icone?: React.ReactNode;
  vazio?: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs text-subtle">
        {icone}
        {rotulo}
      </dt>
      <dd className="mt-0.5 text-sm text-text">
        {valor || <span className="text-subtle">{vazio ?? '—'}</span>}
      </dd>
    </div>
  );
}

/** "1h30", e não "90 min" nem "1.5h". */
function formatarDuracao(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * O tamanho vem como texto porque a coluna é `bigint`.
 *
 * Converter para número na entrada perderia precisão em silêncio acima de
 * 2^53 — e nada aqui precisa do valor numérico além de escolher a unidade.
 */
function formatarTamanho(bytes: string): string {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return `${bytes} B`;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
