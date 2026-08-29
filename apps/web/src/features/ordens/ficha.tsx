/**
 * Aurora — ficha da ordem de serviço (SPEC v0.2 §09, §10, §12 · EPIC-009).
 *
 * As transições vêm do servidor com `requires`: os campos que aquela transição
 * exige e que ainda não foram informados. A tela PEDE antes de enviar, em vez
 * de mandar, tomar 422 e traduzir o erro de volta em formulário.
 *
 * É a diferença prática entre "concluir" abrir um diálogo que pede a resolução
 * e "concluir" dar erro dizendo que falta a resolução.
 */
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { Clock, Play } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  Field,
  Select,
  Skeleton,
  StatusChip,
  Textarea,
  useToast,
} from '@aurora/ui';
import {
  workOrderDetail,
  workOrdersBoard,
  workOrdersList,
  workOrderTransition,
  type WorkOrderDetail,
  type WorkOrderTransition,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery } from '../../lib/api';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { PrioridadeChip, formatarDataRelativa } from '../../routes/hoje';
import { tomDaCategoria } from './lista';
import { useCatalogo, useMotivosDeEspera } from '../../lib/catalogos';

export function OrdemPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const toast = useToast();
  const [pedindo, setPedindo] = useState<WorkOrderTransition | null>(null);

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
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Situação"
              actions={
                <div className="flex items-center gap-2">
                  <PrioridadeChip prioridade={data.priority} />
                  <StatusChip tone={tomDaCategoria(data.status_category)}>{data.status_label}</StatusChip>
                </div>
              }
            />
            <div className="flex flex-col gap-4 p-4">
              {data.wait_reason_label && (
                <div className="flex items-start gap-2 rounded-control bg-warn-soft px-3 py-2">
                  <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn" />
                  <p className="text-sm text-warn-text">
                    Parada: {data.wait_reason_label}.{' '}
                    {/* Cronômetro pausado e correndo são coisas diferentes, e
                        a diferença muda quem cobra de quem. */}
                    {data.pauses_sla
                      ? 'O relógio do SLA está pausado enquanto isso.'
                      : 'O relógio do SLA continua correndo.'}
                  </p>
                </div>
              )}

              <p className="text-base whitespace-pre-wrap text-text">
                {data.description || <span className="text-subtle">Sem descrição.</span>}
              </p>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <Info rotulo="Natureza" valor={data.work_order_type_label} />
                <Info rotulo="Cliente" valor={data.customer_name} />
                <Info rotulo="Equipamento" valor={data.asset_name_snapshot} />
                <Info rotulo="Local" valor={data.location_name_snapshot} />
                <Info
                  rotulo="Programada para"
                  valor={data.scheduled_start ? new Date(data.scheduled_start).toLocaleString('pt-BR') : null}
                />
                <Info rotulo="Aberta" valor={formatarDataRelativa(data.created_at)} />
              </dl>
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Histórico" description="Cada mudança, e quanto tempo levou." />
          <ol className="flex flex-col gap-3 p-4">
            {data.history.length === 0 && <li className="text-sm text-subtle">Ainda sem movimentação.</li>}
            {data.history.map((h, i) => {
              const linha = h as Record<string, string | null>;
              return (
                <li key={i} className="flex gap-3 text-sm">
                  <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-border-strong" />
                  <span className="min-w-0">
                    <span className="block text-text">
                      {linha.from_label ? `${linha.from_label} → ` : ''}
                      {linha.to_label ?? linha.to_status ?? '—'}
                    </span>
                    {linha.changed_at && (
                      <span className="block text-xs text-muted">
                        {formatarDataRelativa(linha.changed_at)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
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

/**
 * O diálogo que pede o que falta.
 *
 * Os campos vêm de `requires`, que vem do servidor. Uma lista fixa aqui
 * divergiria do grafo de estados no dia em que alguém acrescentasse uma
 * exigência — e a divergência só apareceria como 422 na cara do usuário.
 */
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

function Info({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{rotulo}</dt>
      <dd className="mt-0.5 text-sm text-text">{valor || <span className="text-subtle">—</span>}</dd>
    </div>
  );
}
