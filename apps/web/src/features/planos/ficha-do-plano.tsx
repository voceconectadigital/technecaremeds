/**
 * Aurora — o que se FAZ na página do plano (vídeo do Anderson, 13/11/2026):
 * "eu sinto falta que também na hora que o plano tá criado ... visualizar o
 * plano, editar o plano, entende, que depois esses planos eles vão para onde".
 *
 *   · "Para onde vai este plano": o caminho do plano até a OS, dito na tela;
 *   · editar o plano (nome, descrição, geração automática);
 *   · editar cada equipamento (periodicidade, prazos, procedimentos);
 *   · incluir equipamentos (cada um com o seu procedimento) e retirar (com motivo);
 *   · gerar as OS do ciclo aberto quando o plano não gera sozinho;
 *   · o histórico (trilha de auditoria do plano e dos equipamentos).
 *
 * Tudo é conferido de novo no servidor; a tela só não oferece o que vai ser recusado.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { History, ListPlus, Pencil, PlayCircle, Route, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  Field,
  Input,
  Select,
  StatusChip,
  Textarea,
  cn,
  useToast,
} from '@aurora/ui';
import {
  assetsList,
  planDetail,
  planMaterialize,
  plansAddItems,
  plansBoard,
  plansFormOptions,
  plansHistory,
  plansList,
  plansRemoveTask,
  plansSchedule,
  plansUpdate,
  plansUpdateTask,
  cycleCompliance,
  type AssetRow,
  type PlanTask,
} from '@aurora/contracts';
import { ApiError, Can, hojeLocal, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { formatarDataRelativa } from '../../routes/hoje';
import { rotuloTipo } from '../painel/rotulos';
import {
  LinhaDoEquipamento,
  dataBr,
  faltasDosEquipamentos,
  type EscolhaDoEquipamento,
  type FormOptions,
} from './novo-plano';

const INVALIDA = [planDetail, plansList, plansBoard, plansSchedule, plansHistory];

const UNIDADES: Array<{ v: string; um: string; varios: string }> = [
  { v: 'week', um: 'semana', varios: 'semanas' },
  { v: 'month', um: 'mês', varios: 'meses' },
  { v: 'quarter', um: 'trimestre', varios: 'trimestres' },
  { v: 'semester', um: 'semestre', varios: 'semestres' },
  { v: 'year', um: 'ano', varios: 'anos' },
  { v: 'day', um: 'dia', varios: 'dias' },
];

/** O tipo do plano pela primeira tarefa (todas nascem do mesmo tipo). */
export function tipoDoPlano(tarefas: readonly PlanTask[]): string {
  return tarefas.find((t) => t.kind)?.kind ?? 'preventive';
}

/* -------------------------------------------------------------------------- */
/* para onde vai                                                               */
/* -------------------------------------------------------------------------- */

export function ParaOndeVai({ automatico, ativo }: { automatico: boolean; ativo: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Para onde vai este plano"
        description="O caminho do plano até o serviço feito."
        actions={<Route aria-hidden="true" className="size-4 text-muted" />}
      />
      <ol className="flex flex-col gap-1.5 px-4 pb-4 text-sm text-text" aria-label="Caminho do plano">
        <li>
          1. <strong>Ciclo:</strong> {ativo ? '' : '(plano desligado — nada abre até ser ativado) '}cada
          equipamento abre um ciclo na antecedência configurada, com o vencimento no fim do período.
        </li>
        <li>
          2. <strong>Ordem de serviço:</strong>{' '}
          {automatico
            ? 'o ciclo vira OS sozinho, com o procedimento do equipamento anexado.'
            : 'o plano NÃO gera OS sozinho: use “Gerar OS deste ciclo” em cada equipamento.'}{' '}
          As OS aparecem em{' '}
          <Link to="/ordens" className="text-accent-text underline">
            Ordens de serviço
          </Link>
          , na Agenda e em Hoje.
        </li>
        <li>
          3. <strong>Execução:</strong> o técnico executa a OS (checklist, horários, parecer); concluída, o
          item do ciclo conta como realizado.
        </li>
        <li>
          4. <strong>Acompanhamento:</strong> a conformidade aparece aqui, no Cronograma e no Painel de
          planos.
        </li>
      </ol>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* editar o plano                                                              */
/* -------------------------------------------------------------------------- */

export function EditarPlano({
  plano,
}: {
  plano: { id: string; name: string; description: string | null; auto_generate: boolean };
}) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(plano.name);
  const [descricao, setDescricao] = useState(plano.description ?? '');
  const [automatico, setAutomatico] = useState(plano.auto_generate);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!aberto) return;
    setNome(plano.name);
    setDescricao(plano.description ?? '');
    setAutomatico(plano.auto_generate);
    setErro(null);
  }, [aberto, plano]);
  const salvar = useApiMutation(plansUpdate, {
    invalidates: INVALIDA,
    onSuccess: () => {
      setAberto(false);
      toast.success('Plano atualizado');
    },
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  return (
    <>
      <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setAberto(true)}>
        Editar plano
      </Button>
      <Dialog
        open={aberto}
        onOpenChange={setAberto}
        size="sm"
        title="Editar plano"
        description="O que já foi gerado (ciclos e OS) não muda."
        footer={
          <>
            <Button onClick={() => setAberto(false)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={salvar.isPending}
              onClick={() =>
                salvar.mutate({
                  params: { id: plano.id },
                  body: {
                    name: nome.trim(),
                    description: descricao.trim() || null,
                    auto_generate: automatico,
                  },
                })
              }
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Nome do plano" required>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} />
          </Field>
          <Field label="Descrição">
            <Textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={automatico} onChange={(e) => setAutomatico(e.target.checked)} />
            Gerar as ordens de serviço automaticamente quando o ciclo abrir
          </label>
          {erro && (
            <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
              {erro}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* editar / retirar um equipamento                                             */
/* -------------------------------------------------------------------------- */

export function EditarTarefa({ tarefa, kind }: { tarefa: PlanTask; kind: string }) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const educacao = kind === 'education';
  const [unidade, setUnidade] = useState<string>(tarefa.frequency_unit);
  const [intervalo, setIntervalo] = useState<number>(tarefa.frequency_interval);
  const [antecedencia, setAntecedencia] = useState<number>(tarefa.lead_time_days);
  const [tolerancia, setTolerancia] = useState<number>(tarefa.tolerance_days);
  const [principal, setPrincipal] = useState<string>(tarefa.checklist_template_key ?? '');
  const [adicionais, setAdicionais] = useState<string[]>(tarefa.extra_checklist_template_keys ?? []);
  const [primeira, setPrimeira] = useState<string>(tarefa.first_due_on ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const { data: opcoes } = useApiQuery(plansFormOptions, undefined, { enabled: aberto }) as {
    data: FormOptions | undefined;
  };
  const procedimentoDoTipo = opcoes?.kinds.find((k) => k.key === kind)?.procedure_kind ?? null;
  const modelos = (opcoes?.templates ?? []).filter((t) => (t.procedure_kind ?? null) === procedimentoDoTipo);
  const podeMudarPrimeira = (tarefa.cycle_count ?? 0) === 0;
  useEffect(() => {
    if (!aberto) return;
    setUnidade(tarefa.frequency_unit);
    setIntervalo(tarefa.frequency_interval);
    setAntecedencia(tarefa.lead_time_days);
    setTolerancia(tarefa.tolerance_days);
    setPrincipal(tarefa.checklist_template_key ?? '');
    setAdicionais(tarefa.extra_checklist_template_keys ?? []);
    setPrimeira(tarefa.first_due_on ?? '');
    setErro(null);
  }, [aberto, tarefa]);
  const salvar = useApiMutation(plansUpdateTask, {
    invalidates: INVALIDA,
    onSuccess: () => {
      setAberto(false);
      toast.success('Equipamento do plano atualizado', 'Vale para os próximos ciclos e as próximas OS.');
    },
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  const rotulo = tarefa.target_asset_name ?? tarefa.name;
  return (
    <>
      <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setAberto(true)}>
        Editar
      </Button>
      <Dialog
        open={aberto}
        onOpenChange={setAberto}
        title={`Editar — ${rotulo}`}
        description="Periodicidade e prazos valem para os próximos ciclos; o procedimento, para as próximas OS."
        footer={
          <>
            <Button onClick={() => setAberto(false)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={salvar.isPending}
              onClick={() =>
                salvar.mutate({
                  params: { taskId: tarefa.id },
                  body: {
                    frequency_unit: unidade as PlanTask['frequency_unit'],
                    frequency_interval: intervalo,
                    lead_time_days: antecedencia,
                    tolerance_days: tolerancia,
                    ...(educacao
                      ? {}
                      : {
                          checklist_template_key: principal || null,
                          extra_checklist_template_keys: adicionais.filter((k) => k !== principal),
                        }),
                    ...(podeMudarPrimeira && primeira !== (tarefa.first_due_on ?? '')
                      ? { first_due_on: primeira || null }
                      : {}),
                  },
                })
              }
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Repetir a cada" required>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                max={60}
                aria-label="Intervalo"
                value={intervalo}
                onChange={(e) => setIntervalo(Math.max(1, Number(e.target.value) || 1))}
                className="w-20"
              />
              <Select aria-label="Unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                {UNIDADES.map((u) => (
                  <option key={u.v} value={u.v}>
                    {intervalo === 1 ? u.um : u.varios}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field
            label={educacao ? 'Data (primeiro vencimento)' : 'Primeiro vencimento (opcional)'}
            hint={
              podeMudarPrimeira
                ? 'Só muda antes de o primeiro ciclo abrir.'
                : 'O primeiro ciclo já abriu: as próximas datas seguem a periodicidade.'
            }
          >
            <Input
              type="date"
              min={hojeLocal()}
              disabled={!podeMudarPrimeira}
              value={primeira}
              onChange={(e) => setPrimeira(e.target.value)}
            />
          </Field>
          <Field label="Antecedência (dias)">
            <Input
              type="number"
              min={0}
              max={365}
              value={antecedencia}
              onChange={(e) => setAntecedencia(Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Tolerância (dias)">
            <Input
              type="number"
              min={0}
              max={90}
              value={tolerancia}
              onChange={(e) => setTolerancia(Number(e.target.value) || 0)}
            />
          </Field>
          {!educacao && (
            <>
              <Field label="Procedimento" required className="sm:col-span-2">
                <Select value={principal} onChange={(e) => setPrincipal(e.target.value)}>
                  <option value="">Escolha o procedimento</option>
                  {modelos.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.title} · v{m.version} · {m.item_count} itens
                    </option>
                  ))}
                </Select>
              </Field>
              <fieldset className="flex flex-col gap-1 sm:col-span-2">
                <legend className="text-sm font-medium text-text">Procedimentos adicionais (mesma OS)</legend>
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {(opcoes?.templates ?? [])
                    .filter((t) => t.key !== principal)
                    .map((t) => (
                      <label key={t.key} className="flex items-center gap-2 text-sm text-text">
                        <input
                          type="checkbox"
                          checked={adicionais.includes(t.key)}
                          onChange={() =>
                            setAdicionais((a) =>
                              a.includes(t.key) ? a.filter((k) => k !== t.key) : [...a, t.key]
                            )
                          }
                        />
                        {t.title} · {rotuloTipo(t.procedure_kind ?? 'preventive')} · v{t.version}
                      </label>
                    ))}
                </div>
              </fieldset>
            </>
          )}
          {erro && (
            <p
              role="alert"
              className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text sm:col-span-2"
            >
              {erro}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}

export function RetirarTarefa({ tarefa }: { tarefa: PlanTask }) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const retirar = useApiMutation(plansRemoveTask, {
    invalidates: INVALIDA,
    onSuccess: () => {
      setAberto(false);
      setMotivo('');
      toast.success('Equipamento retirado do plano');
    },
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  const rotulo = tarefa.target_asset_name ?? tarefa.name;
  return (
    <>
      <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setAberto(true)}>
        Retirar
      </Button>
      <Dialog
        open={aberto}
        onOpenChange={setAberto}
        size="sm"
        title={`Retirar ${rotulo} do plano?`}
        description="As OS já geradas continuam. O item ainda pendente do ciclo aberto é dispensado com este motivo."
        footer={
          <>
            <Button onClick={() => setAberto(false)}>Cancelar</Button>
            <Button
              variant="danger"
              loading={retirar.isPending}
              disabled={motivo.trim().length < 10}
              onClick={() =>
                retirar.mutate({ params: { taskId: tarefa.id }, body: { reason: motivo.trim() } })
              }
            >
              Retirar
            </Button>
          </>
        }
      >
        <Field label="Motivo" required hint="Ao menos 10 caracteres; fica no histórico do plano.">
          <Textarea rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Field>
        {erro && (
          <p role="alert" className="mt-2 rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro}
          </p>
        )}
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* gerar as OS do ciclo (plano sem geração automática)                         */
/* -------------------------------------------------------------------------- */

export function GerarOsDoCiclo({ tarefa }: { tarefa: PlanTask }) {
  const toast = useToast();
  const gerar = useApiMutation(planMaterialize, {
    invalidates: [...INVALIDA, cycleCompliance],
    onSuccess: (r: unknown) => {
      const n = (r as { work_orders: number }).work_orders;
      if (n > 0) toast.success(`${n} ${n === 1 ? 'OS gerada' : 'OS geradas'}`);
      else
        toast.error(
          'Nenhuma OS gerada',
          'O item pendente pode estar com o contrato parado (vencido, suspenso ou bloqueado).'
        );
    },
    onError: (e: ApiError) => toast.error('Não foi possível gerar as OS', e.problem.message),
  });
  if (!tarefa.open_cycle_id || (tarefa.pending_count ?? 0) === 0) return null;
  return (
    <Can permission="maintenance_plan.generate_cycle">
      <Button
        size="sm"
        variant="primary"
        icon={<PlayCircle className="size-4" />}
        loading={gerar.isPending}
        onClick={() => gerar.mutate({ params: { cycleId: tarefa.open_cycle_id! } })}
      >
        Gerar OS deste ciclo ({tarefa.pending_count})
      </Button>
    </Can>
  );
}

/* -------------------------------------------------------------------------- */
/* incluir equipamentos                                                        */
/* -------------------------------------------------------------------------- */

export function IncluirEquipamentos({
  planId,
  customerId,
  kind,
  jaNoPlano,
}: {
  planId: string;
  customerId: string;
  kind: string;
  jaNoPlano: readonly string[];
}) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [escolhas, setEscolhas] = useState<Record<string, EscolhaDoEquipamento>>({});
  const [erro, setErro] = useState<string | null>(null);
  const educacao = kind === 'education';
  const hoje = hojeLocal();
  useEffect(() => {
    if (!aberto) return;
    setMarcados(new Set());
    setEscolhas({});
    setErro(null);
  }, [aberto]);
  const { data: ativos } = useApiQuery(
    assetsList,
    { query: { customer: customerId, limit: 500 } },
    { enabled: aberto }
  ) as { data: { items: AssetRow[] } | undefined };
  const { data: opcoes } = useApiQuery(plansFormOptions, undefined, { enabled: aberto }) as {
    data: FormOptions | undefined;
  };
  const candidatos = useMemo(
    () =>
      (ativos?.items ?? []).filter(
        (a) => !jaNoPlano.includes(a.id) && a.status !== 'decommissioned' && a.status !== 'disposed'
      ),
    [ativos, jaNoPlano]
  );
  const alvo = candidatos.filter((a) => marcados.has(a.id));
  const procedimentoDoTipo = opcoes?.kinds.find((k) => k.key === kind)?.procedure_kind ?? null;
  const modelos = (opcoes?.templates ?? []).filter((t) => (t.procedure_kind ?? null) === procedimentoDoTipo);
  const faltas = faltasDosEquipamentos(
    alvo.map((a) => a.id),
    escolhas,
    educacao,
    hoje
  );
  const incluir = useApiMutation(plansAddItems, {
    invalidates: INVALIDA,
    onSuccess: (r: unknown) => {
      const x = r as { task_count: number; work_orders: number };
      setAberto(false);
      toast.success(
        `${x.task_count} ${x.task_count === 1 ? 'equipamento incluído' : 'equipamentos incluídos'}`,
        x.work_orders > 0 ? `${x.work_orders} OS geradas agora.` : undefined
      );
    },
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  return (
    <>
      <Button size="sm" icon={<ListPlus className="size-4" />} onClick={() => setAberto(true)}>
        Incluir equipamentos
      </Button>
      <Dialog
        open={aberto}
        onOpenChange={setAberto}
        size="lg"
        title="Incluir equipamentos no plano"
        description="Cada equipamento recebe o seu procedimento. Periodicidade e prazos são os do plano."
        footer={
          <>
            <Button onClick={() => setAberto(false)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={incluir.isPending}
              disabled={alvo.length === 0 || faltas.size > 0}
              onClick={() =>
                incluir.mutate({
                  params: { id: planId },
                  body: {
                    items: alvo.map((a) => {
                      const e = escolhas[a.id];
                      return educacao
                        ? { asset_id: a.id, first_due_on: e?.data ?? null }
                        : {
                            asset_id: a.id,
                            checklist_template_key: e?.principal || null,
                            extra_checklist_template_keys: e?.adicionais ?? [],
                          };
                    }),
                  },
                })
              }
            >
              Incluir {alvo.length > 0 ? `(${alvo.length})` : ''}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {candidatos.length === 0 ? (
            <p className="text-sm text-muted">
              Todos os equipamentos ativos deste cliente já estão no plano.
            </p>
          ) : (
            <ul
              className="max-h-48 overflow-y-auto rounded-card border border-border-subtle"
              aria-label="Candidatos"
            >
              {candidatos.map((a, i) => (
                <li key={a.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      checked={marcados.has(a.id)}
                      onChange={(e) => {
                        const n = new Set(marcados);
                        if (e.target.checked) n.add(a.id);
                        else n.delete(a.id);
                        setMarcados(n);
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-text">
                      {a.name}{' '}
                      <span className="text-xs text-muted">
                        {[a.category_name, a.location_name].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {alvo.length > 0 && (
            <ul className="flex max-h-72 flex-col overflow-y-auto rounded-card border border-border-subtle">
              {alvo.map((a, i) => (
                <LinhaDoEquipamento
                  key={a.id}
                  ativo={a}
                  primeiro={i === 0}
                  educacao={educacao}
                  escolha={escolhas[a.id]}
                  falta={faltas.get(a.id)}
                  modelos={modelos}
                  todosModelos={opcoes?.templates ?? []}
                  hoje={hoje}
                  temMesmaCategoria={false}
                  onEscolher={(m) =>
                    setEscolhas((at) => ({
                      ...at,
                      [a.id]: { principal: '', adicionais: [], data: '', ...at[a.id], ...m },
                    }))
                  }
                  onAplicarNaCategoria={() => undefined}
                />
              ))}
            </ul>
          )}
          {erro && (
            <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
              {erro}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* histórico                                                                   */
/* -------------------------------------------------------------------------- */

const ROTULO_ACAO: Record<string, string> = {
  insert: 'criou',
  update: 'alterou',
  delete: 'apagou',
};

const ROTULO_CAMPO: Record<string, string> = {
  name: 'nome',
  description: 'descrição',
  auto_generate: 'geração automática',
  is_active: 'ativo',
  active_change_reason: 'motivo',
  frequency_unit: 'unidade da periodicidade',
  frequency_interval: 'periodicidade',
  lead_time_days: 'antecedência',
  tolerance_days: 'tolerância',
  checklist_template_key: 'procedimento',
  extra_checklist_template_keys: 'procedimentos adicionais',
  first_due_on: 'primeiro vencimento',
  archived_at: 'retirado do plano',
};

export function HistoricoDoPlano({ planId }: { planId: string }) {
  const { data } = useApiQuery(plansHistory, { params: { id: planId } }) as {
    data:
      | {
          items: Array<{
            occurred_at: string;
            actor_name: string | null;
            entity: 'plan' | 'task';
            entity_label: string | null;
            action: string;
            changes: Record<string, unknown> | null;
          }>;
        }
      | undefined;
  };
  const itens = data?.items ?? [];
  return (
    <Card>
      <CardHeader
        title="Histórico"
        description="Cada mudança do plano e dos equipamentos dele, com autor e data."
        actions={<History aria-hidden="true" className="size-4 text-muted" />}
      />
      {itens.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">Sem registros.</p>
      ) : (
        <ul className="flex flex-col px-2 pb-2" aria-label="Histórico do plano">
          {itens.slice(0, 50).map((h, i) => {
            const campos = Object.keys(h.changes ?? {}).filter((c) => ROTULO_CAMPO[c]);
            return (
              <li
                key={`${h.occurred_at}-${i}`}
                className={cn('px-2.5 py-2 text-sm', i > 0 && 'border-t border-border-subtle')}
              >
                <span className="text-text">
                  {h.actor_name ?? 'Sistema'} {ROTULO_ACAO[h.action] ?? h.action}{' '}
                  {h.entity === 'plan' ? 'o plano' : `o equipamento “${h.entity_label ?? ''}”`}
                  {campos.length > 0 && h.action === 'update'
                    ? `: ${campos.map((c) => ROTULO_CAMPO[c]).join(', ')}`
                    : ''}
                </span>
                <span className="ml-2 text-xs text-muted" data-numeric>
                  {formatarDataRelativa(h.occurred_at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** O procedimento e a primeira data da tarefa, numa linha. */
export function DetalheDaTarefa({ tarefa }: { tarefa: PlanTask }) {
  const partes: string[] = [];
  if (tarefa.kind === 'education') partes.push('Educação continuada (sem procedimento)');
  else if (tarefa.checklist_title) partes.push(`Procedimento: ${tarefa.checklist_title}`);
  else partes.push('Sem procedimento');
  if (tarefa.first_due_on) partes.push(`1º vencimento ${dataBr(tarefa.first_due_on)}`);
  return (
    <p className="px-4 pb-2 text-xs text-muted">
      {partes.join(' · ')}
      {tarefa.kind && tarefa.kind !== 'education' && (
        <StatusChip tone="neutral" size="sm" withoutDot className="ml-2">
          {rotuloTipo(tarefa.kind)}
        </StatusChip>
      )}
    </p>
  );
}
