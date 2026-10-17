/**
 * Aurora — ficha da solicitação e triagem (SPEC v0.2 §08 · EPIC-007).
 *
 * A TRIAGEM É O PONTO EM QUE UM PEDIDO VIRA TRABALHO — ou não vira, com o
 * motivo registrado. As duas saídas precisam ser igualmente fáceis: uma
 * interface que facilita só o "aceitar" produz aceites por cansaço.
 *
 * AS AÇÕES POSSÍVEIS VÊM DO SERVIDOR. A tela não deduz o que dá para fazer a
 * partir da situação — ela recebe `available_transitions`, já filtrado pelas
 * permissões desta pessoa, e mostra exatamente isso. Deduzir aqui criaria um
 * segundo grafo de estados, e os dois divergiriam na primeira mudança.
 */
import { useParams, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Check, ClipboardList, X } from 'lucide-react';
import { Button, Card, CardHeader, Dialog, Field, Select, Skeleton, Textarea, useToast } from '@aurora/ui';
import {
  requestDetail,
  requestTransition,
  requestsQueue,
  workOrdersFromRequest,
  type ServiceRequestDetail,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';
import { TIPOS_DE_SOLICITACAO } from './nova';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { PrioridadeChip, formatarDataRelativa } from '../../routes/hoje';
import { SituacaoChip } from './lista';
import { useCatalogo } from '../../lib/catalogos';

export function SolicitacaoPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const toast = useToast();
  const [aceiteAberto, setAceiteAberto] = useState(false);
  const [recusaAberta, setRecusaAberta] = useState(false);
  const [pedindoInfo, setPedindoInfo] = useState(false);
  const { can } = usePermissions();

  const { data, isLoading, isError, error } = useApiQuery(requestDetail, { params: { id } }) as {
    data: ServiceRequestDetail | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const transicao = useApiMutation(requestTransition, {
    invalidates: [requestDetail, requestsQueue],
    onError: (e: ApiError) => toast.error('Não foi possível mudar a situação', e.problem.message),
  });

  if (isError) return <ErrorScreen error={error} />;

  if (isLoading || !data) {
    return (
      <AppShell title="Solicitação">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </AppShell>
    );
  }

  const podeAceitar = data.available_transitions.some((t) => t.to === 'accepted');
  const podeRecusar = data.available_transitions.some((t) => t.to === 'rejected');
  // "Assumir triagem" é ato de quem tria (reunião 16/10/2026): o solicitante
  // acompanha a própria solicitação e não vê este botão.
  const podeTriar =
    can('service_request.triage') && data.available_transitions.some((t) => t.to === 'triage');
  const podePedirInfo = data.available_transitions.some((t) => t.to === 'info_needed');

  return (
    <AppShell
      title={data.summary}
      subtitle={`${data.number} · ${data.customer_name}`}
      breadcrumbs={[{ label: 'Solicitações', href: '/solicitacoes' }, { label: data.number }]}
      actions={
        <div className="flex items-center gap-2">
          {podeTriar && (
            <Button
              onClick={() =>
                transicao.mutate({ params: { id }, body: { to: 'triage', version: data.version } })
              }
              loading={transicao.isPending}
            >
              Assumir triagem
            </Button>
          )}
          {podePedirInfo && <Button onClick={() => setPedindoInfo(true)}>Pedir informação</Button>}
          {podeRecusar && (
            <Button variant="ghost" icon={<X className="size-4" />} onClick={() => setRecusaAberta(true)}>
              Recusar
            </Button>
          )}
          {podeAceitar && (
            <Button
              variant="primary"
              icon={<Check className="size-4" />}
              onClick={() => setAceiteAberto(true)}
            >
              Aceitar e gerar OS
            </Button>
          )}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="O que foi pedido"
              actions={
                <div className="flex items-center gap-2">
                  <PrioridadeChip prioridade={data.priority} />
                  <SituacaoChip status={data.status} />
                </div>
              }
            />
            <div className="flex flex-col gap-4 p-4">
              <p className="text-base whitespace-pre-wrap text-text">
                {data.description || <span className="text-subtle">Sem descrição.</span>}
              </p>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <Info rotulo="Cliente" valor={data.customer_name} />
                <Info rotulo="Local" valor={data.location_name} />
                <Info rotulo="Equipamento" valor={data.asset_name} />
                <Info
                  rotulo="Tipo"
                  valor={data.requested_type ? TIPOS_DE_SOLICITACAO[data.requested_type] : null}
                />
                {/* O campo saiu da abertura (16/10/2026); o dado antigo continua visível. */}
                {data.reported_failure_label && (
                  <Info rotulo="Sintoma relatado" valor={data.reported_failure_label} />
                )}
                <Info rotulo="Quem pediu" valor={data.requester_name} />
                <Info rotulo="Aberta" valor={formatarDataRelativa(data.created_at)} />
              </dl>

              {data.rejection_reason_label && (
                <div className="rounded-control bg-bad-soft px-3 py-2">
                  <p className="text-sm text-bad-text">Recusada: {data.rejection_reason_label}</p>
                </div>
              )}
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Histórico" description="Cada mudança, e quanto tempo levou." />
          <ol className="flex flex-col gap-3 p-4">
            {data.history.map((h, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-border-strong" />
                <span className="min-w-0">
                  <span className="block text-text">
                    {h.from_status ? `${rotuloDe(h.from_status)} → ` : ''}
                    {rotuloDe(h.to_status)}
                  </span>
                  <span className="block text-xs text-muted">
                    {formatarDataRelativa(h.changed_at)}
                    {h.seconds_in_from && ` · ${duracao(Number(h.seconds_in_from))} na situação anterior`}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <DialogoAceite
        open={aceiteAberto}
        onOpenChange={setAceiteAberto}
        solicitacao={data}
        onPronto={(quantas) => {
          toast.success(
            quantas === 1 ? 'Ordem de serviço criada' : `${quantas} ordens de serviço criadas`,
            'A solicitação foi aceita e o trabalho está na fila.'
          );
          void navigate({ to: '/ordens' });
        }}
      />

      <DialogoRecusa
        open={recusaAberta}
        onOpenChange={setRecusaAberta}
        onConfirmar={(motivoId, observacao) =>
          transicao.mutate(
            {
              params: { id },
              body: {
                to: 'rejected',
                rejection_reason_id: motivoId,
                ...(observacao.trim() ? { rejection_note: observacao.trim() } : {}),
                version: data.version,
              },
            },
            // A confirmação nomeia o registro: "salvo" sozinho não diz o quê.
            { onSuccess: () => toast.success(`${data.number} recusada`) }
          )
        }
      />
      <DialogoPedirInfo
        open={pedindoInfo}
        onOpenChange={setPedindoInfo}
        enviando={transicao.isPending}
        onConfirmar={(pergunta) =>
          transicao.mutate(
            { params: { id }, body: { to: 'info_needed', info_request: pergunta, version: data.version } },
            {
              onSuccess: () => {
                toast.success(`${data.number}: pedido de informação enviado`);
                setPedindoInfo(false);
              },
            }
          )
        }
      />
    </AppShell>
  );
}

/** A pergunta é obrigatória: "aguardando informação" sem dizer qual não destrava nada. */
function DialogoPedirInfo({
  open,
  onOpenChange,
  onConfirmar,
  enviando,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirmar: (pergunta: string) => void;
  enviando: boolean;
}) {
  const [pergunta, setPergunta] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Pedir informação"
      description="A solicitação fica aguardando a resposta de quem abriu. Diga exatamente o que falta."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button
            variant="primary"
            loading={enviando}
            onClick={() => {
              if (pergunta.trim().length < 5) {
                setErro('Escreva a pergunta (ao menos 5 caracteres).');
                return;
              }
              onConfirmar(pergunta.trim());
            }}
          >
            Enviar pergunta
          </Button>
        </>
      }
    >
      <Field label="O que falta saber" required error={erro}>
        <Textarea
          value={pergunta}
          rows={3}
          onChange={(e) => {
            setPergunta(e.target.value);
            setErro(null);
          }}
          placeholder="Ex.: qual o número de série na etiqueta traseira do equipamento?"
        />
      </Field>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O aceite.
 *
 * Uma solicitação pode virar VÁRIAS ordens: "os três ventiladores da UTI estão
 * com alarme" é um pedido só e três trabalhos. Este diálogo começa com uma
 * ordem — o caso comum — e permite acrescentar.
 */
function DialogoAceite({
  open,
  onOpenChange,
  solicitacao,
  onPronto,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  solicitacao: ServiceRequestDetail;
  onPronto: (quantas: number) => void;
}) {
  const toast = useToast();
  const naturezas = useCatalogo('work_order_type');
  const [escolhida, setNatureza] = useState('');
  // Sem escolha explícita, a natureza proposta é a do TIPO pedido (mesma chave de sistema).
  const proposta = solicitacao.requested_type
    ? (naturezas.find((n) => n.system_key === solicitacao.requested_type)?.id ?? '')
    : '';
  const natureza = escolhida || proposta;
  const [erro, setErro] = useState<string | null>(null);

  const criar = useApiMutation(workOrdersFromRequest, {
    invalidates: [requestDetail, requestsQueue],
    onError: (e: ApiError) => {
      setErro(e.problem.message);
      toast.error('Não foi possível gerar a ordem de serviço', e.problem.message);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Aceitar e gerar ordem de serviço"
      description="A solicitação é aceita e o trabalho entra na fila. As duas coisas acontecem juntas: solicitação aceita sem OS é trabalho que ninguém vai fazer."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="primary"
            loading={criar.isPending}
            onClick={() => {
              if (!natureza) {
                setErro('Escolha a natureza do trabalho.');
                return;
              }
              criar.mutate(
                {
                  params: { requestId: solicitacao.id },
                  body: {
                    targets: [
                      {
                        work_order_type_id: natureza,
                        asset_id: solicitacao.asset_id,
                        location_id: solicitacao.location_id,
                        title: solicitacao.summary,
                      },
                    ],
                  },
                },
                {
                  onSuccess: () => {
                    onOpenChange(false);
                    onPronto(1);
                  },
                }
              );
            }}
          >
            Gerar ordem de serviço
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-control bg-surface-sunken px-3 py-2 text-sm">
          <p className="font-medium text-text">{solicitacao.summary}</p>
          <p className="mt-0.5 text-muted">
            {[solicitacao.customer_name, solicitacao.location_name, solicitacao.asset_name]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <Field
          label="Natureza do trabalho"
          required
          error={erro}
          hint="Determina o SLA aplicável e os campos exigidos no fechamento."
        >
          <Select
            value={natureza}
            onChange={(e) => {
              setNatureza(e.target.value);
              setErro(null);
            }}
          >
            <option value="">Selecione…</option>
            {naturezas.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </Select>
        </Field>

        <p className="flex items-start gap-2 text-xs text-muted">
          <ClipboardList aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Precisa de mais de uma OS para este pedido? Gere a primeira e crie as demais a partir da ordem —
          assim cada uma nasce com o seu próprio equipamento e responsável.
        </p>
      </div>
    </Dialog>
  );
}

function DialogoRecusa({
  open,
  onOpenChange,
  onConfirmar,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirmar: (motivoId: string, observacao: string) => void;
}) {
  const motivos = useCatalogo('rejection_reason');
  const [motivo, setMotivo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Recusar solicitação"
      description="O motivo fica registrado e é o que o cliente vê. Recusa sem motivo vira reclamação — e a reclamação chega sem contexto."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (!motivo) {
                setErro('Escolha o motivo da recusa.');
                return;
              }
              onConfirmar(motivo, observacao);
              onOpenChange(false);
            }}
          >
            Recusar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Motivo" required error={erro}>
          <Select
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              setErro(null);
            }}
          >
            <option value="">Selecione…</option>
            {motivos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Observação para o cliente"
          hint="Opcional. Ajuda quem abriu a entender o que fazer em seguida."
        >
          <Textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
            placeholder="Ex.: este equipamento está coberto por garantia do fabricante até 12/2026."
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function Info({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{rotulo}</dt>
      <dd className="mt-0.5 text-sm text-text">{valor || <span className="text-subtle">—</span>}</dd>
    </div>
  );
}

const ROTULOS: Record<string, string> = {
  draft: 'Rascunho',
  submitted: 'Enviada',
  triage: 'Em triagem',
  info_needed: 'Aguardando informação',
  accepted: 'Aceita',
  rejected: 'Recusada',
  merged: 'Unida a outra',
  duplicate: 'Duplicada',
  in_service: 'Em atendimento',
  fulfilled: 'Atendida',
  closed: 'Encerrada',
  cancelled: 'Cancelada',
};

function rotuloDe(status: string): string {
  return ROTULOS[status] ?? status;
}

function duracao(segundos: number): string {
  if (segundos < 60) return `${Math.round(segundos)} s`;
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}
