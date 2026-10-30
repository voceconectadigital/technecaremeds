/**
 * Aurora — ▶ Executar: o assistente de execução da OS (reunião 16/10/2026, Fase 5).
 *
 * Oito passos, na ordem em que o técnico trabalha:
 *
 *   1. Resumo         — o que foi pedido, onde, qual equipamento; inicia a execução.
 *   2. Check-in       — chegada com a posição PONTUAL do aparelho (ou justificativa);
 *                        abre o cronômetro. Substitui digitar horas no começo.
 *   3. Procedimento   — o checklist da OS; cada resposta é gravada NA HORA.
 *   4. Preencher OS   — descrição do serviço, observações e peças (estoque, ou
 *                        fornecida pelo cliente).
 *   5. Anexos         — "Há anexos para esta OS?": foto antes e depois e
 *                        documento/manual (PDF ou imagem); "Não" segue sem anexo.
 *   6. Parecer final  — LIBERADO ou PARADO (uso do equipamento) e parecer.
 *   7. Revisão        — tudo junto, e o que ainda falta para concluir.
 *   8. Concluir       — check-out (fecha o cronômetro) e conclusão da OS. O botão só
 *                        habilita quando o servidor vai aceitar, e diz o que falta.
 *
 * SEM "SALVAR RASCUNHO". O progresso é o próprio registro no servidor: a
 * resposta do checklist, o texto da OS, a peça usada. Se a rede cai no meio,
 * reabrir o assistente retoma de onde parou — o passo fica na URL.
 *
 * NADA DE MOTOR NOVO: transição, checklist, peças de estoque, anexos e
 * cronômetro são os mesmos da ficha e do campo.
 */
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  MapPin,
  Package,
  Play,
  Printer,
} from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Skeleton,
  StatusChip,
  Textarea,
  cn,
  useToast,
} from '@aurora/ui';
import {
  checklistAnswer,
  checklistTemplatesList,
  inventoryBalances,
  inventoryConsumePart,
  workOrderAttachmentCreate,
  workOrderAttachments,
  workOrderChecklistAttach,
  workOrderChecklists,
  workOrderCheckIn,
  workOrderCheckOut,
  workOrderCompletion,
  workOrderCustomerParts,
  workOrderCustomerPartsAdd,
  workOrderDetail,
  workOrderParts,
  workOrderServiceReport,
  workOrderTransition,
  workOrderVisits,
  workOrdersBoard,
  workOrdersList,
  type Attachment,
  type StockBalance,
  type WorkOrderChecklist,
  type WorkOrderCustomerPart,
  type WorkOrderDetail,
  type WorkOrderPart,
  type WorkOrderVisit,
} from '@aurora/contracts';
import {
  ApiError,
  lerSessaoGuardada,
  useApi,
  useApiMutation,
  useApiQuery,
  usePermissions,
  useUrlState,
} from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';

const PASSOS = [
  { id: 'resumo', titulo: 'Resumo' },
  { id: 'checkin', titulo: 'Check-in' },
  { id: 'procedimento', titulo: 'Procedimento' },
  { id: 'os', titulo: 'Preencher OS' },
  { id: 'anexos', titulo: 'Anexos' },
  { id: 'parecer', titulo: 'Parecer final' },
  { id: 'revisao', titulo: 'Revisão' },
  { id: 'concluir', titulo: 'Concluir' },
] as const;
type PassoId = (typeof PASSOS)[number]['id'];

const ENCERRADA = new Set(['done', 'closed', 'cancelled']);

export function ExecutarOrdemPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const [passo, setPasso] = useUrlState<string>('passo', 'resumo');
  const {
    data: os,
    isLoading,
    isError,
    error,
  } = useApiQuery(workOrderDetail, { params: { id } }) as {
    data: WorkOrderDetail | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  if (isError) return <ErrorScreen error={error} />;
  if (isLoading || !os) {
    return (
      <AppShell title="Executar ordem de serviço">
        <Skeleton className="h-64 w-full" />
      </AppShell>
    );
  }

  const indice = Math.max(
    0,
    PASSOS.findIndex((p) => p.id === passo)
  );
  const atual = PASSOS[indice]!.id as PassoId;
  const ir = (i: number) => setPasso(PASSOS[Math.min(Math.max(i, 0), PASSOS.length - 1)]!.id);

  return (
    <AppShell
      title={`Executar ${os.number ?? 'OS'}`}
      subtitle={`${os.title} · ${os.customer_name}`}
      breadcrumbs={[
        { label: 'Ordens de serviço', href: '/ordens' },
        { label: os.number ?? '—', href: `/ordens/${id}` },
        { label: 'Executar' },
      ]}
      // Imprimir aqui levaria só o passo aberto: o botão abre a folha completa da OS (OS-26).
      imprimir={false}
      actions={
        <Button
          variant="secondary"
          size="sm"
          className="aurora-no-print"
          icon={<Printer className="size-4" aria-hidden="true" />}
          onClick={() =>
            void navigate({ to: '/ordens/$id', params: { id }, search: { modo: 'impressao' } as never })
          }
        >
          Imprimir OS
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <nav aria-label="Passos da execução">
          <ol className="flex gap-1 overflow-x-auto pb-1">
            {PASSOS.map((p, i) => (
              <li key={p.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => ir(i)}
                  aria-current={i === indice ? 'step' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-2 rounded-control border px-3 text-sm',
                    i === indice
                      ? 'border-accent bg-accent-soft font-medium text-accent-text'
                      : i < indice
                        ? 'border-border-subtle text-text'
                        : 'border-border-subtle text-muted'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-6 place-items-center rounded-full text-xs',
                      i < indice ? 'bg-good-soft text-good-text' : 'bg-surface-subtle'
                    )}
                  >
                    {i < indice ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  {p.titulo}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {ENCERRADA.has(os.status_category) && (
          <p role="status" className="rounded-control bg-surface-subtle px-3 py-2 text-sm text-muted">
            Esta OS está em “{os.status_label}”: o assistente mostra o que foi registrado, mas não altera mais
            nada.
          </p>
        )}

        {atual === 'resumo' && <PassoResumo os={os} />}
        {atual === 'checkin' && <PassoVisita id={id} tipo="check_in" />}
        {atual === 'procedimento' && <PassoProcedimento id={id} />}
        {atual === 'os' && <PassoPreencherOS id={id} os={os} />}
        {atual === 'anexos' && <PassoAnexos id={id} />}
        {atual === 'parecer' && <PassoParecer id={id} os={os} />}
        {atual === 'revisao' && <PassoRevisao id={id} os={os} />}
        {atual === 'concluir' && <PassoConcluir id={id} os={os} />}

        <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-4">
          <Button
            icon={<ChevronLeft className="size-4" />}
            disabled={indice === 0}
            onClick={() => ir(indice - 1)}
          >
            Voltar
          </Button>
          {indice < PASSOS.length - 1 ? (
            <Button variant="primary" onClick={() => ir(indice + 1)}>
              Avançar <ChevronRight aria-hidden="true" className="ml-1 inline size-4" />
            </Button>
          ) : (
            <Link to="/ordens/$id" params={{ id }} className="text-sm text-accent-text underline">
              Voltar à ficha da OS
            </Link>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

function Info({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{rotulo}</dt>
      <dd className="mt-0.5 text-sm break-words text-text">
        {valor || <span className="text-subtle">—</span>}
      </dd>
    </div>
  );
}

function useTransicao() {
  const toast = useToast();
  return useApiMutation(workOrderTransition, {
    invalidates: [workOrderDetail, workOrdersList, workOrdersBoard],
    onError: (e: ApiError) => toast.error('A transição foi recusada', e.problem.message),
  });
}

/* 1 · Resumo ---------------------------------------------------------------- */

function PassoResumo({ os }: { os: WorkOrderDetail }) {
  const transicao = useTransicao();
  const iniciar = os.available_transitions.find((t) => t.to === 'in_progress' && t.requires.length === 0);
  return (
    <Card>
      <CardHeader
        title="O que foi pedido"
        description="Confira antes de ir ao equipamento."
        actions={
          os.status_category === 'in_progress' ? (
            <StatusChip tone="info">Em execução</StatusChip>
          ) : iniciar ? (
            <Button
              variant="primary"
              icon={<Play className="size-4" />}
              loading={transicao.isPending}
              onClick={() =>
                transicao.mutate({ params: { id: os.id }, body: { to: 'in_progress', version: os.version } })
              }
            >
              Iniciar execução
            </Button>
          ) : (
            <StatusChip tone="neutral">{os.status_label}</StatusChip>
          )
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <p className="text-base whitespace-pre-wrap text-text">{os.description || 'Sem descrição.'}</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Info rotulo="Cliente" valor={os.customer_name} />
          <Info rotulo="Equipamento" valor={os.asset_name_snapshot} />
          <Info rotulo="Local" valor={os.location_name_snapshot} />
          <Info rotulo="Natureza" valor={os.work_order_type_label} />
          <Info rotulo="Situação" valor={os.status_label} />
          <Info rotulo="Solicitação" valor={os.service_request_number} />
        </dl>
      </div>
    </Card>
  );
}

/* 2 e 8 · Check-in / Check-out -------------------------------------------- */

type Posicao = { latitude: number; longitude: number; accuracy_m: number };

/** Uma leitura PONTUAL. Nada de `watchPosition`: não há rastreamento contínuo. */
function lerPosicao(): Promise<Posicao> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Este navegador não oferece localização.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: Number(p.coords.latitude.toFixed(6)),
          longitude: Number(p.coords.longitude.toFixed(6)),
          accuracy_m: Math.round(p.coords.accuracy * 100) / 100,
        }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'A permissão de localização foi recusada.'
              : e.code === e.TIMEOUT
                ? 'O aparelho demorou demais para dar a posição.'
                : 'A posição do aparelho não está disponível.'
          )
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  });
}

function PassoVisita({ id, tipo }: { id: string; tipo: 'check_in' | 'check_out' }) {
  const toast = useToast();
  const { data } = useApiQuery(workOrderVisits, { params: { id } }) as {
    data: { items: WorkOrderVisit[] } | undefined;
  };
  const [falhaDePosicao, setFalhaDePosicao] = useState<string | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const minhas = (data?.items ?? []).filter((v) => v.mine);
  const ultima = minhas[minhas.length - 1];
  const dentro = ultima?.kind === 'check_in';
  const operacao = tipo === 'check_in' ? workOrderCheckIn : workOrderCheckOut;
  const enviar = useApiMutation(operacao, {
    invalidates: [workOrderVisits, workOrderDetail],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  const jaFeito = tipo === 'check_in' ? dentro : !dentro && ultima?.kind === 'check_out';
  const nome = tipo === 'check_in' ? 'Check-in' : 'Check-out';

  async function registrar() {
    setErro(null);
    setLendo(true);
    try {
      const p = await lerPosicao();
      enviar.mutate(
        { params: { id }, body: p },
        {
          onSuccess: () =>
            toast.success(`${nome} registrado`, `Posição com precisão de ${Math.round(p.accuracy_m)} m.`),
        }
      );
    } catch (e) {
      // Sem posição: o registro segue, MANUAL e justificado — nunca bloqueia o trabalho.
      setFalhaDePosicao((e as Error).message);
    } finally {
      setLendo(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={nome}
        description={
          tipo === 'check_in'
            ? 'Registra a chegada com a posição do aparelho NESTE instante e abre o cronômetro. Não há rastreamento contínuo.'
            : 'Registra a saída e fecha o cronômetro aberto no check-in.'
        }
      />
      <div className="flex flex-col gap-4 p-4">
        {jaFeito ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-control bg-good-soft px-3 py-2 text-sm text-good-text"
          >
            <Check aria-hidden="true" className="size-4" />
            {nome} feito em {new Date(ultima!.occurred_at).toLocaleString('pt-BR')}
            {ultima!.position_source === 'device'
              ? ` · ${ultima!.latitude?.toFixed(5)}, ${ultima!.longitude?.toFixed(5)}${ultima!.accuracy_m ? ` (±${Math.round(ultima!.accuracy_m)} m)` : ''}`
              : ' · sem posição (justificado)'}
          </p>
        ) : tipo === 'check_out' && !dentro ? (
          <p className="text-sm text-muted">Não há check-in seu aberto nesta OS.</p>
        ) : (
          <>
            <Button
              variant="primary"
              icon={<MapPin className="size-4" />}
              loading={lendo || enviar.isPending}
              onClick={() => void registrar()}
              className="min-h-12 self-start"
            >
              Fazer {nome.toLowerCase()} com a minha localização
            </Button>
            {falhaDePosicao && (
              <div className="flex flex-col gap-3 rounded-control border border-warn/40 bg-warn-soft p-3">
                <p className="text-sm text-warn-text">
                  {falhaDePosicao} Você pode registrar sem posição, explicando o motivo — fica na auditoria.
                </p>
                <Field label="Justificativa" required error={erro}>
                  <Textarea
                    rows={2}
                    value={justificativa}
                    onChange={(e) => setJustificativa(e.target.value)}
                    placeholder="Ex.: GPS do tablet bloqueado pela TI do hospital"
                  />
                </Field>
                <Button
                  className="self-start"
                  loading={enviar.isPending}
                  onClick={() =>
                    enviar.mutate(
                      { params: { id }, body: { justification: justificativa } },
                      { onSuccess: () => toast.success(`${nome} registrado sem posição`) }
                    )
                  }
                >
                  Registrar {nome.toLowerCase()} sem posição
                </Button>
              </div>
            )}
          </>
        )}
        {erro && !falhaDePosicao && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro}
          </p>
        )}
        {(data?.items.length ?? 0) > 0 && (
          <ul className="text-xs text-muted" aria-label="Registros de presença">
            {data!.items.map((v) => (
              <li key={v.id}>
                {v.kind === 'check_in' ? 'Check-in' : 'Check-out'} · {v.person_name ?? '—'} ·{' '}
                {new Date(v.occurred_at).toLocaleString('pt-BR')} ·{' '}
                {v.position_source === 'device' ? 'posição do aparelho' : `sem posição: ${v.justification}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* 3 · Procedimento ---------------------------------------------------------- */

export function PassoProcedimento({ id }: { id: string }) {
  const { can } = usePermissions();
  const { data, isLoading } = useApiQuery(workOrderChecklists, { params: { id } }) as {
    data: { items: WorkOrderChecklist[] } | undefined;
    isLoading: boolean;
  };
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const listas = data?.items ?? [];
  return (
    <div className="flex flex-col gap-4">
      {listas.length === 0 && (
        <Card>
          <CardHeader
            title="Nenhum procedimento nesta OS"
            description="A preventiva já nasce com o procedimento do plano. Para esta OS, escolha um publicado."
          />
          {can('work_order.execute') && <AnexarProcedimento id={id} />}
        </Card>
      )}
      {listas.map((c) => (
        <Card key={c.id}>
          <CardHeader
            title={`${c.template_key} · versão ${c.template_version}`}
            description="Cada resposta é gravada na hora. Corrigir depois pede o motivo, que fica no histórico."
          />
          <ul className="flex flex-col divide-y divide-border-subtle">
            {c.items.map((item) => (
              <li key={item.id} className="p-4">
                <ItemDoProcedimento
                  responseId={c.id}
                  item={item}
                  resposta={c.answers.find((a) => a.item_id === item.id)}
                />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function AnexarProcedimento({ id }: { id: string }) {
  const toast = useToast();
  const { data } = useApiQuery(checklistTemplatesList) as {
    data: { items: { id: string; title: string; status: string; version: number }[] } | undefined;
  };
  const [escolhido, setEscolhido] = useState('');
  const anexar = useApiMutation(workOrderChecklistAttach, {
    invalidates: [workOrderChecklists],
    onError: (e: ApiError) => toast.error('Não foi possível anexar', e.problem.message),
  });
  const publicados = (data?.items ?? []).filter((t) => t.status === 'published');
  return (
    <div className="flex flex-wrap items-end gap-2 p-4">
      <Field label="Procedimento publicado" className="min-w-60 flex-1">
        <Select value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
          <option value="">Escolha…</option>
          {publicados.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} (v{t.version})
            </option>
          ))}
        </Select>
      </Field>
      <Button
        disabled={!escolhido}
        loading={anexar.isPending}
        onClick={() => anexar.mutate({ params: { id }, body: { template_id: escolhido } })}
      >
        Anexar à OS
      </Button>
    </div>
  );
}

type ItemDoChecklist = WorkOrderChecklist['items'][number];
type Resposta = WorkOrderChecklist['answers'][number];

function ItemDoProcedimento({
  responseId,
  item,
  resposta,
}: {
  responseId: string;
  item: ItemDoChecklist;
  resposta: Resposta | undefined;
}) {
  const [corrigindo, setCorrigindo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const responder = useApiMutation(checklistAnswer, {
    invalidates: [workOrderChecklists],
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  const respondido = Boolean(resposta);
  const editavel = !respondido || corrigindo;

  function enviar(valor: Record<string, unknown>) {
    setErro(null);
    responder.mutate(
      {
        params: { responseId },
        body: { item_id: item.id, ...valor, ...(respondido ? { correction_reason: motivo } : {}) } as never,
      },
      { onSuccess: () => setCorrigindo(false) }
    );
  }

  const valorAtual = resposta
    ? (resposta.value_text ??
      (resposta.value_number !== null ? String(resposta.value_number) : null) ??
      (resposta.value_boolean !== null ? (resposta.value_boolean ? 'Sim' : 'Não') : null) ??
      resposta.value_options?.join(', ') ??
      resposta.value_date ??
      (resposta.photo_count ? `${resposta.photo_count} foto(s)` : '—'))
    : null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-text">
        {item.label}
        {item.required && (
          <span className="ml-1 text-bad-text" aria-label="obrigatório">
            *
          </span>
        )}
      </p>
      {respondido && !corrigindo && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-text">
          <StatusChip
            tone={resposta?.verdict === 'fail' ? 'bad' : resposta?.verdict === 'pass' ? 'good' : 'neutral'}
            size="sm"
          >
            {valorAtual}
          </StatusChip>
          <button
            type="button"
            className="text-xs text-accent-text underline"
            onClick={() => setCorrigindo(true)}
          >
            Corrigir
          </button>
        </p>
      )}
      {editavel && (
        <div className="flex flex-col gap-2">
          {corrigindo && (
            <Field label="Motivo da correção" required>
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </Field>
          )}
          {item.kind === 'boolean' && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => enviar({ boolean: true })}>
                Sim
              </Button>
              <Button size="sm" onClick={() => enviar({ boolean: false })}>
                Não
              </Button>
            </div>
          )}
          {item.kind === 'option' && (
            <Select
              aria-label={item.label}
              defaultValue=""
              onChange={(e) => e.target.value && enviar({ options: [e.target.value] })}
            >
              <option value="">Escolha…</option>
              {(item.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          )}
          {item.kind === 'multi_option' && (
            <MultiEscolha opcoes={item.options ?? []} onEnviar={(o) => enviar({ options: o })} />
          )}
          {(item.kind === 'number' || item.kind === 'text' || item.kind === 'date') && (
            <div className="flex flex-wrap items-end gap-2">
              <Input
                aria-label={item.label}
                type={item.kind === 'number' ? 'number' : item.kind === 'date' ? 'date' : 'text'}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                className="max-w-60"
              />
              {item.unit && <span className="text-sm text-muted">{item.unit}</span>}
              <Button
                size="sm"
                disabled={!texto.trim()}
                onClick={() =>
                  enviar(
                    item.kind === 'number'
                      ? { number: Number(texto) }
                      : item.kind === 'date'
                        ? { date: texto }
                        : { text: texto.trim() }
                  )
                }
              >
                Gravar
              </Button>
            </div>
          )}
          {item.kind === 'photo' && (
            <p className="text-xs text-muted">Tire a foto no passo Anexos e marque aqui quantas tirou.</p>
          )}
          {item.kind === 'photo' && (
            <Button size="sm" onClick={() => enviar({ photo_count: 1 })}>
              Registrar foto tirada
            </Button>
          )}
          {item.kind === 'measurement' && (
            <p className="text-xs text-muted">
              Ponto de medição: as leituras entram pela sessão de medição. Nominal e tolerância são DADO — o
              veredito metrológico depende de critério validado pelo especialista.
            </p>
          )}
        </div>
      )}
      {erro && (
        <p role="alert" className="text-sm text-bad-text">
          {erro}
        </p>
      )}
    </div>
  );
}

function MultiEscolha({ opcoes, onEnviar }: { opcoes: readonly string[]; onEnviar: (o: string[]) => void }) {
  const [marcadas, setMarcadas] = useState<string[]>([]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {opcoes.map((o) => (
        <label
          key={o}
          className="flex min-h-11 items-center gap-2 rounded-control border border-border-subtle px-3 text-sm"
        >
          <input
            type="checkbox"
            checked={marcadas.includes(o)}
            onChange={() =>
              setMarcadas(marcadas.includes(o) ? marcadas.filter((x) => x !== o) : [...marcadas, o])
            }
          />
          {o}
        </label>
      ))}
      <Button size="sm" disabled={marcadas.length === 0} onClick={() => onEnviar(marcadas)}>
        Gravar
      </Button>
    </div>
  );
}

/* 4 · Preencher OS ---------------------------------------------------------- */

function useRelatorio() {
  const toast = useToast();
  return useApiMutation(workOrderServiceReport, {
    invalidates: [workOrderDetail],
    onError: (e: ApiError) => toast.error('Não foi possível gravar', e.problem.message),
  });
}

export function PassoPreencherOS({ id, os }: { id: string; os: WorkOrderDetail }) {
  const toast = useToast();
  const { data: visitas } = useApiQuery(workOrderVisits, { params: { id } }) as {
    data: { items: WorkOrderVisit[] } | undefined;
  };
  const [descricao, setDescricao] = useState(os.service_description ?? '');
  const [observacoes, setObservacoes] = useState(os.service_observations ?? '');
  const relatorio = useRelatorio();
  const checkin = (visitas?.items ?? []).find((v) => v.kind === 'check_in');

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Preencher Ordem de Serviço"
          description="Já vem com o que a OS sabe. Grava ao sair de cada campo."
        />
        <div className="flex flex-col gap-4 p-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Info rotulo="Cliente" valor={os.customer_name} />
            <Info rotulo="Equipamento" valor={os.asset_name_snapshot} />
            <Info rotulo="Local" valor={os.location_name_snapshot} />
            <Info
              rotulo="Check-in"
              valor={checkin ? new Date(checkin.occurred_at).toLocaleString('pt-BR') : null}
            />
            <Info rotulo="Defeito alegado" valor={os.description} />
            <Info rotulo="Natureza" valor={os.work_order_type_label} />
          </dl>
          <Field label="Descrição do serviço" required hint="É o que vai para o relatório do cliente.">
            <Textarea
              rows={4}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              onBlur={() =>
                descricao !== (os.service_description ?? '') &&
                relatorio.mutate({ params: { id }, body: { service_description: descricao } })
              }
            />
          </Field>
          <Field label="Observações">
            <Textarea
              rows={3}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              onBlur={() =>
                observacoes !== (os.service_observations ?? '') &&
                relatorio.mutate(
                  { params: { id }, body: { service_observations: observacoes } },
                  { onSuccess: () => toast.success('Observações gravadas') }
                )
              }
            />
          </Field>
        </div>
      </Card>
      <PecasDaOS id={id} />
    </div>
  );
}

function PecasDaOS({ id }: { id: string }) {
  const toast = useToast();
  const { can } = usePermissions();
  const [origem, setOrigem] = useState<'estoque' | 'cliente'>('estoque');
  const { data: pecas } = useApiQuery(workOrderParts, { params: { id } }) as {
    data: { items: WorkOrderPart[] } | undefined;
  };
  const { data: doCliente } = useApiQuery(workOrderCustomerParts, { params: { id } }) as {
    data: { items: WorkOrderCustomerPart[] } | undefined;
  };
  const { data: saldos } = useApiQuery(
    inventoryBalances,
    { query: {} },
    { enabled: can('inventory.read') }
  ) as {
    data: { items: StockBalance[] } | undefined;
  };
  const [saldo, setSaldo] = useState('');
  const [qtd, setQtd] = useState('1');
  const [descricao, setDescricao] = useState('');
  const usar = useApiMutation(inventoryConsumePart, {
    invalidates: [workOrderParts, inventoryBalances],
    onError: (e: ApiError) => toast.error('A peça não foi baixada', e.problem.message),
  });
  const registrar = useApiMutation(workOrderCustomerPartsAdd, {
    invalidates: [workOrderCustomerParts],
    onError: (e: ApiError) => toast.error('A peça não foi registrada', e.problem.message),
  });
  const disponiveis = (saldos?.items ?? []).filter((s) => Number(s.available) > 0);
  const escolhido = disponiveis.find((s) => `${s.item_id}|${s.warehouse_id}` === saldo);

  return (
    <Card>
      <CardHeader
        title="Peças utilizadas"
        description="Peça de estoque sai do razão vinculada a esta OS — nunca baixa silenciosa. Peça do cliente é registrada à mão."
      />
      <div className="flex flex-col gap-4 p-4">
        <ul className="flex flex-col gap-1 text-sm" aria-label="Peças desta OS">
          {(pecas?.items ?? []).map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <Package aria-hidden="true" className="size-4 text-subtle" />
              {p.item_name} · {p.qty} {p.unit} ·{' '}
              {p.kind === 'return' ? 'devolvida' : `estoque: ${p.warehouse_name}`}
            </li>
          ))}
          {(doCliente?.items ?? []).map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <Package aria-hidden="true" className="size-4 text-subtle" />
              {p.description} · {p.quantity} {p.unit ?? ''} · fornecida pelo cliente
            </li>
          ))}
          {(pecas?.items.length ?? 0) + (doCliente?.items.length ?? 0) === 0 && (
            <li className="text-muted">Nenhuma peça registrada.</li>
          )}
        </ul>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-text">Adicionar peça</legend>
          <div role="radiogroup" aria-label="Origem da peça" className="flex flex-wrap gap-2">
            {(
              [
                ['estoque', 'Estoque (almoxarifado)'],
                ['cliente', 'Fornecida pelo cliente'],
              ] as const
            ).map(([v, r]) => (
              <label
                key={v}
                className="flex min-h-11 items-center gap-2 rounded-control border border-border-subtle px-3 text-sm"
              >
                <input type="radio" name="origem-peca" checked={origem === v} onChange={() => setOrigem(v)} />
                {r}
              </label>
            ))}
          </div>
          {origem === 'estoque' ? (
            can('inventory.move') ? (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Item e almoxarifado" className="min-w-60 flex-1">
                  <Select value={saldo} onChange={(e) => setSaldo(e.target.value)}>
                    <option value="">Escolha…</option>
                    {disponiveis.map((s) => (
                      <option key={`${s.item_id}|${s.warehouse_id}`} value={`${s.item_id}|${s.warehouse_id}`}>
                        {s.item_name} · {s.warehouse_name} · disponível {s.available} {s.unit}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Quantidade" className="w-28">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={qtd}
                    onChange={(e) => setQtd(e.target.value)}
                  />
                </Field>
                <Button
                  disabled={!escolhido || !(Number(qtd) > 0)}
                  loading={usar.isPending}
                  onClick={() =>
                    usar.mutate(
                      {
                        params: { id },
                        body: {
                          item_id: escolhido!.item_id,
                          warehouse_id: escolhido!.warehouse_id,
                          qty: Number(qtd),
                        },
                      },
                      { onSuccess: () => toast.success('Peça baixada do estoque para esta OS') }
                    )
                  }
                >
                  Usar peça
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted">Seu perfil não movimenta estoque.</p>
            )
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Descrição da peça" className="min-w-60 flex-1">
                <Input
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Ex.: sensor de fluxo do hospital"
                />
              </Field>
              <Field label="Quantidade" className="w-28">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={qtd}
                  onChange={(e) => setQtd(e.target.value)}
                />
              </Field>
              <Button
                disabled={descricao.trim().length < 3 || !(Number(qtd) > 0)}
                loading={registrar.isPending}
                onClick={() =>
                  registrar.mutate(
                    { params: { id }, body: { description: descricao.trim(), quantity: Number(qtd) } },
                    {
                      onSuccess: () => {
                        setDescricao('');
                        toast.success('Peça do cliente registrada');
                      },
                    }
                  )
                }
              >
                Registrar
              </Button>
            </div>
          )}
        </fieldset>
      </div>
    </Card>
  );
}

/* 5 · Anexos ---------------------------------------------------------------- */

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * O passo Anexos (OS-12): "Há anexos para esta OS?".
 *
 * Anexo é OPCIONAL: "Não" segue sem nenhum, e a resposta não é gravada — o que a
 * OS guarda são os anexos, não a pergunta. "Sim" abre as fotos de antes e depois e
 * o envio de documento/manual (PDF ou imagem), com a finalidade `document` que a
 * API já aceita. Quem já anexou alguma coisa cai direto no "Sim".
 */
export function PassoAnexos({ id }: { id: string }) {
  const { data } = useApiQuery(workOrderAttachments, { params: { id } }) as {
    data: { items: Attachment[] } | undefined;
  };
  const [resposta, setResposta] = useState<'' | 'sim' | 'nao'>('');
  const itens = data?.items ?? [];
  const efetiva = resposta || (itens.length > 0 ? 'sim' : '');
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Há anexos para esta OS?"
          description="Fotos, documentos e manuais são opcionais. Sem anexo, é só seguir."
        />
        <div role="radiogroup" aria-label="Há anexos para esta OS?" className="flex flex-wrap gap-2 p-4">
          {(
            [
              ['sim', 'Sim, anexar'],
              ['nao', 'Não, seguir sem anexo'],
            ] as const
          ).map(([v, r]) => (
            <label
              key={v}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm',
                efetiva === v ? 'border-accent bg-accent-soft text-accent-text' : 'border-border-subtle'
              )}
            >
              <input type="radio" name="ha-anexos" checked={efetiva === v} onChange={() => setResposta(v)} />
              {r}
            </label>
          ))}
        </div>
        {efetiva === 'nao' && (
          <p
            role="status"
            className="mx-4 mb-4 rounded-control bg-surface-subtle px-3 py-2 text-sm text-muted"
          >
            Sem anexos nesta OS. Pode avançar para o parecer final.
          </p>
        )}
      </Card>
      {efetiva === 'sim' && (
        <div className="grid gap-4 sm:grid-cols-3">
          {(['before', 'after', 'document'] as const).map((f) => (
            <EnvioDeAnexo key={f} id={id} finalidade={f} anexos={itens.filter((a) => a.purpose === f)} />
          ))}
        </div>
      )}
    </div>
  );
}

const ENVIO: Record<
  'before' | 'after' | 'document',
  { titulo: string; acao: string; aceita: string; padrao: string; foto: boolean }
> = {
  before: {
    titulo: 'Foto ANTES',
    acao: 'Tirar ou escolher a foto antes',
    aceita: 'image/*',
    padrao: 'image/jpeg',
    foto: true,
  },
  after: {
    titulo: 'Foto DEPOIS',
    acao: 'Tirar ou escolher a foto depois',
    aceita: 'image/*',
    padrao: 'image/jpeg',
    foto: true,
  },
  document: {
    titulo: 'Documento ou manual',
    acao: 'Escolher documento (PDF ou imagem)',
    aceita: 'application/pdf,image/*',
    padrao: 'application/pdf',
    foto: false,
  },
};

function EnvioDeAnexo({
  id,
  finalidade,
  anexos,
}: {
  id: string;
  finalidade: 'before' | 'after' | 'document';
  anexos: Attachment[];
}) {
  const toast = useToast();
  const api = useApi();
  const [enviando, setEnviando] = useState(false);
  const registrar = useApiMutation(workOrderAttachmentCreate, { invalidates: [workOrderAttachments] });
  const cfg = ENVIO[finalidade];
  const titulo = cfg.titulo;

  async function enviar(arquivo: File) {
    setEnviando(true);
    try {
      const bytes = await arquivo.arrayBuffer();
      const sha256 = await sha256Hex(bytes);
      const r = (await registrar.mutateAsync({
        params: { id },
        body: {
          purpose: finalidade,
          file_name: arquivo.name || `${finalidade}.${cfg.foto ? 'jpg' : 'pdf'}`,
          content_type: arquivo.type || cfg.padrao,
          byte_size: arquivo.size,
          sha256,
        },
      })) as { attachment_id: string };
      // Os bytes vão pela mesma rota do campo (envio retomável), numa fatia só.
      const base = api.urlFor(workOrderAttachments, { params: { id } }).split('/work-orders/')[0];
      const { token, organizationId } = lerSessaoGuardada();
      const resp = await fetch(`${base}/field/attachments/${r.attachment_id}/bytes`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          authorization: `Bearer ${token ?? ''}`,
          ...(organizationId ? { 'x-aurora-organization': organizationId } : {}),
          'x-aurora-offset': '0',
          'x-aurora-sha256': sha256,
          'x-aurora-final': '1',
        },
        body: bytes,
      });
      if (!resp.ok) throw new Error(`o envio dos bytes falhou (${resp.status})`);
      toast.success(`${titulo}: enviado`);
    } catch (e) {
      toast.error(
        `${titulo}: não foi enviado`,
        e instanceof ApiError ? e.problem.message : (e as Error).message
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card>
      <CardHeader title={titulo} description={`${anexos.length} enviado(s)`} />
      <div className="flex flex-col gap-3 p-4">
        <label
          className={cn(
            'flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-control border border-dashed border-border-strong px-3 text-sm',
            enviando && 'opacity-60'
          )}
        >
          {cfg.foto ? (
            <Camera aria-hidden="true" className="size-4" />
          ) : (
            <FileText aria-hidden="true" className="size-4" />
          )}
          {enviando ? 'Enviando…' : cfg.acao}
          <input
            type="file"
            accept={cfg.aceita}
            {...(cfg.foto ? { capture: 'environment' as const } : {})}
            className="sr-only"
            disabled={enviando}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void enviar(f);
              e.target.value = '';
            }}
          />
        </label>
        <ul className="text-xs text-muted">
          {anexos.map((f) => (
            <li key={f.id}>
              {f.file_name} · {new Date(f.uploaded_at).toLocaleString('pt-BR')}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/* 6 · Parecer final --------------------------------------------------------- */

function PassoParecer({ id, os }: { id: string; os: WorkOrderDetail }) {
  const toast = useToast();
  const [resultado, setResultado] = useState<'released' | 'stopped' | ''>(os.operational_result ?? '');
  const [parecer, setParecer] = useState(os.final_opinion ?? '');
  const relatorio = useRelatorio();
  useEffect(() => {
    setResultado(os.operational_result ?? '');
  }, [os.operational_result]);
  return (
    <Card>
      <CardHeader
        title="Parecer final"
        description="Situação de USO do equipamento depois do serviço. Não é veredito metrológico."
      />
      <p className="mx-4 rounded-control bg-surface-subtle px-3 py-2 text-xs text-muted">
        Obrigatório para concluir OS de equipamento. Na conclusão, PARADO coloca o equipamento “em
        manutenção”; LIBERADO o devolve “em operação” se ele estava em manutenção.
      </p>
      <div className="flex flex-col gap-4 p-4">
        <div role="radiogroup" aria-label="Resultado operacional" className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['released', 'LIBERADO', 'O equipamento pode voltar ao uso.'],
              ['stopped', 'PARADO', 'O equipamento NÃO deve ser usado.'],
            ] as const
          ).map(([v, r, d]) => (
            <label
              key={v}
              className={cn(
                'flex min-h-12 cursor-pointer flex-col gap-0.5 rounded-control border p-3 text-sm',
                resultado === v
                  ? v === 'released'
                    ? 'border-good bg-good-soft'
                    : 'border-bad bg-bad-soft'
                  : 'border-border-subtle'
              )}
            >
              <span className="flex items-center gap-2 font-semibold">
                <input
                  type="radio"
                  name="resultado"
                  checked={resultado === v}
                  onChange={() => {
                    setResultado(v);
                    relatorio.mutate({ params: { id }, body: { operational_result: v } });
                  }}
                />
                {r}
              </span>
              <span className="text-xs text-muted">{d}</span>
            </label>
          ))}
        </div>
        <Field label="Parecer técnico">
          <Textarea
            rows={4}
            value={parecer}
            onChange={(e) => setParecer(e.target.value)}
            onBlur={() =>
              parecer !== (os.final_opinion ?? '') &&
              relatorio.mutate(
                { params: { id }, body: { final_opinion: parecer } },
                { onSuccess: () => toast.success('Parecer gravado') }
              )
            }
          />
        </Field>
      </div>
    </Card>
  );
}

/* 7 · Revisão ---------------------------------------------------------------- */

function PassoRevisao({ id, os }: { id: string; os: WorkOrderDetail }) {
  const { data: falta } = useApiQuery(workOrderCompletion, { params: { id } }) as {
    data: Conclusao | undefined;
  };
  const { data: visitas } = useApiQuery(workOrderVisits, { params: { id } }) as {
    data: { items: WorkOrderVisit[] } | undefined;
  };
  const { data: anexos } = useApiQuery(workOrderAttachments, { params: { id } }) as {
    data: { items: Attachment[] } | undefined;
  };
  const pendencias = useMemo(() => {
    const p = faltasParaConcluir(os, falta);
    // Sem check-in a OS conclui (o servidor só cobra horas quando a natureza exige);
    // aqui é lembrete, não trava.
    if (!(visitas?.items ?? []).some((v) => v.kind === 'check_in')) p.push('Check-in (recomendado)');
    return p;
  }, [os, visitas, falta]);
  return (
    <Card>
      <CardHeader title="Revisão" description="Tudo o que vai para o registro da OS." />
      <div className="flex flex-col gap-4 p-4">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Info rotulo="Descrição do serviço" valor={os.service_description} />
          <Info rotulo="Observações" valor={os.service_observations} />
          <Info
            rotulo="Resultado"
            valor={
              os.operational_result === 'released'
                ? 'LIBERADO'
                : os.operational_result === 'stopped'
                  ? 'PARADO'
                  : null
            }
          />
          <Info rotulo="Parecer" valor={os.final_opinion} />
          <Info rotulo="Registros de presença" valor={`${visitas?.items.length ?? 0}`} />
          <Info
            rotulo="Fotos"
            valor={`${anexos?.items.filter((a) => a.purpose === 'before' || a.purpose === 'after').length ?? 0}`}
          />
        </dl>
        {pendencias.length > 0 ? (
          <div role="status" className="rounded-control bg-warn-soft px-3 py-2 text-sm text-warn-text">
            Falta: {pendencias.join(' · ')}
          </div>
        ) : (
          <p role="status" className="rounded-control bg-good-soft px-3 py-2 text-sm text-good-text">
            Nada pendente. Pode concluir.
          </p>
        )}
      </div>
    </Card>
  );
}

/* 8 · Concluir --------------------------------------------------------------- */

/** O que `GET /work-orders/:id/completion` devolve: a mesma lista com que a transição recusa. */
export type Conclusao = {
  ok: boolean;
  missing: Array<{ requirement?: string; label?: string; detail?: string } | string>;
  requires_operational_result?: boolean;
};

/** Onde, no assistente, se resolve cada exigência do servidor. */
const ONDE: Record<string, string> = {
  operational_result: 'passo Parecer final',
  checklist_complete: 'passo Procedimento',
  failed_items_have_photo: 'passo Procedimento',
  photo_before_after: 'passo Anexos',
  obsolescence_photo: 'passo Anexos',
  hours_logged: 'check-in e check-out',
  parts_confirmed: 'passo Preencher OS',
};

/**
 * O que ainda falta para concluir (OS-17), em texto, na ordem em que se resolve.
 *
 * A descrição do serviço vai como a resolução da OS na conclusão: por isso ela é
 * cobrada aqui, e a exigência "descrição da resolução" do servidor some quando a
 * descrição já tem o tamanho que ele pede — o próprio clique a entrega.
 */
export function faltasParaConcluir(
  os: Pick<WorkOrderDetail, 'service_description'>,
  conclusao: Conclusao | undefined
): string[] {
  const faltas: string[] = [];
  const descricao = os.service_description?.trim() ?? '';
  if (!descricao) faltas.push('Descrição do serviço (passo Preencher OS)');
  for (const m of conclusao?.missing ?? []) {
    if (typeof m === 'string') {
      faltas.push(m);
      continue;
    }
    if (m.requirement === 'resolution_filled' && descricao.length >= 10) continue;
    const onde = m.requirement ? ONDE[m.requirement] : undefined;
    const texto = m.label ?? m.requirement ?? 'requisito';
    faltas.push(`${texto.charAt(0).toUpperCase()}${texto.slice(1)}${onde ? ` (${onde})` : ''}`);
  }
  return faltas;
}

/**
 * O cartão de conclusão, sem rede nem rota: recebe o que falta e o que fazer.
 *
 * O botão só habilita sem pendência; enquanto houver, a lista diz o quê e onde. A
 * recusa do servidor (que pode chegar mesmo assim — outra pessoa mudou a OS) aparece
 * aqui, na tela, e não só num aviso que some.
 */
export function CartaoConcluir({
  faltas,
  disponivel,
  situacao,
  verificando,
  ocupado,
  concluida,
  erro,
  onConcluir,
}: {
  faltas: string[];
  disponivel: boolean;
  situacao: string;
  verificando: boolean;
  ocupado: boolean;
  concluida: boolean;
  erro: string | null;
  onConcluir: () => void;
}) {
  const pode = disponivel && !verificando && faltas.length === 0 && !concluida;
  return (
    <Card>
      <CardHeader title="Concluir a OS" description="Leva a descrição do serviço como solução registrada." />
      <div className="flex flex-col gap-3 p-4">
        {concluida ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-control bg-good-soft px-3 py-2 text-sm text-good-text"
          >
            <Check aria-hidden="true" className="size-4" />
            Ordem de serviço concluída. Abrindo a ficha…
          </p>
        ) : faltas.length > 0 ? (
          <div role="status" className="rounded-control bg-warn-soft px-3 py-2 text-sm text-warn-text">
            <p className="font-medium">Para concluir, falta:</p>
            <ul className="mt-1 list-disc pl-5" aria-label="O que falta para concluir">
              {faltas.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : (
          disponivel &&
          !verificando && (
            <p role="status" className="rounded-control bg-good-soft px-3 py-2 text-sm text-good-text">
              Tudo o que é obrigatório está preenchido. Pode concluir.
            </p>
          )
        )}
        {erro && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro}
          </p>
        )}
        <Button
          variant="primary"
          className="min-h-12 self-start"
          icon={<Check className="size-4" />}
          disabled={!pode}
          loading={ocupado}
          onClick={onConcluir}
        >
          Concluir ordem de serviço
        </Button>
        {!disponivel && !concluida && (
          <p className="text-xs text-muted">
            A conclusão não está disponível na situação “{situacao}” para o seu perfil.
          </p>
        )}
      </div>
    </Card>
  );
}

function PassoConcluir({ id, os }: { id: string; os: WorkOrderDetail }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [erro, setErro] = useState<string | null>(null);
  const [concluida, setConcluida] = useState(false);
  const transicao = useApiMutation(workOrderTransition, {
    invalidates: [workOrderDetail, workOrdersList, workOrdersBoard, workOrderCompletion],
    onError: (e: ApiError) => {
      // 412 traz a lista do que falta, item a item: mostra a lista, não só a frase.
      const faltando = (e.problem.details?.missing as Conclusao['missing'] | undefined) ?? [];
      const itens = faltasParaConcluir(os, { ok: false, missing: faltando });
      setErro(itens.length > 0 ? `O servidor recusou: falta ${itens.join('; ')}.` : e.problem.message);
      toast.error('A conclusão foi recusada', e.problem.message);
    },
  });
  const { data: conclusao, isLoading: verificando } = useApiQuery(workOrderCompletion, {
    params: { id },
  }) as { data: Conclusao | undefined; isLoading: boolean };
  const disponivel = os.available_transitions.some((t) => t.to === 'completed');
  return (
    <div className="flex flex-col gap-4">
      <PassoVisita id={id} tipo="check_out" />
      <CartaoConcluir
        faltas={faltasParaConcluir(os, conclusao)}
        disponivel={disponivel}
        situacao={os.status_label}
        verificando={verificando}
        ocupado={transicao.isPending}
        concluida={concluida}
        erro={erro}
        onConcluir={() => {
          setErro(null);
          transicao.mutate(
            {
              params: { id },
              body: { to: 'completed', version: os.version, resolution: os.service_description ?? '' },
            },
            {
              onSuccess: () => {
                setConcluida(true);
                toast.success(
                  `${os.number ?? 'OS'} concluída`,
                  'A conclusão ficou registrada no histórico da OS.'
                );
                void navigate({ to: '/ordens/$id', params: { id } });
              },
            }
          );
        }}
      />
    </div>
  );
}
