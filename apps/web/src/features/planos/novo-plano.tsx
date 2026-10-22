/**
 * Aurora — criar plano de manutenção, passo a passo.
 *
 * Cliente → Setor → Equipamentos → Tipo → Procedimento → Periodicidade → Revisão.
 *
 * A ORDEM É A DO MUNDO: primeiro ONDE (o hospital e o setor), depois O QUÊ (os
 * equipamentos e o tipo de serviço), depois COMO (o checklist) e QUANDO (a
 * periodicidade). Cada passo só oferece o que cabe no anterior — os setores
 * do cliente escolhido, os equipamentos do setor, os procedimentos do tipo —
 * e o servidor confere tudo de novo ao salvar.
 *
 * O CONTEXTO CONTRATUAL APARECE, MAS NÃO DECIDE NADA. Mostrar "sem contrato"
 * ou "serviço completo" ajuda quem cadastra; regras automáticas por nível de
 * contrato (Básico/Completo/Expert) NÃO existem nesta rodada. E tipo de
 * contrato não é tipo de procedimento.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Bot,
  Check,
  ClipboardCheck,
  GraduationCap,
  ShieldCheck,
  Thermometer,
  Wrench,
  Zap,
} from 'lucide-react';
import { Button, Dialog, Field, Input, Select, StatusChip, cn, useToast } from '@aurora/ui';
import {
  assetsList,
  contractsList,
  customersDetail,
  customersList,
  plansBoard,
  plansCreate,
  plansFormOptions,
  plansList,
  plansSchedule,
  type AssetRow,
  type ContractRow,
  type Customer,
  type CustomerLocation,
} from '@aurora/contracts';
import { ApiError, hojeLocal, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';
import { rotuloTipo } from '../painel/rotulos';

type Tipo = 'preventive' | 'calibration' | 'electrical_safety' | 'qualification';
type Unidade = 'day' | 'week' | 'month' | 'quarter' | 'semester' | 'year';

interface FormOptions {
  kinds: Array<{ key: Tipo; available: boolean; work_order_type: string; procedure_kind: string | null }>;
  templates: Array<{
    key: string;
    title: string;
    version: number;
    procedure_kind: string | null;
    item_count: number;
  }>;
}

const PASSOS = [
  'Cliente',
  'Setor',
  'Equipamentos',
  'Tipo',
  'Procedimento',
  'Periodicidade',
  'Revisão',
] as const;

const TIPOS: Array<{ key: Tipo | 'education'; titulo: string; texto: string; icone: typeof Wrench }> = [
  { key: 'preventive', titulo: 'Preventiva', texto: 'Inspeção e manutenção programada', icone: Wrench },
  { key: 'calibration', titulo: 'Calibração', texto: 'Protocolo com pontos de medição', icone: Thermometer },
  { key: 'electrical_safety', titulo: 'TSE', texto: 'Teste de segurança elétrica', icone: Zap },
  { key: 'qualification', titulo: 'Qualificação', texto: 'Qualificação de equipamento', icone: ShieldCheck },
  {
    key: 'education',
    titulo: 'Educação continuada',
    texto: 'Treinamento — ainda não suportado',
    icone: GraduationCap,
  },
];

const UNIDADES: Array<{ v: Unidade; um: string; varios: string }> = [
  { v: 'week', um: 'semana', varios: 'semanas' },
  { v: 'month', um: 'mês', varios: 'meses' },
  { v: 'quarter', um: 'trimestre', varios: 'trimestres' },
  { v: 'semester', um: 'semestre', varios: 'semestres' },
  { v: 'year', um: 'ano', varios: 'anos' },
  { v: 'day', um: 'dia', varios: 'dias' },
];

/** Natureza do contrato (enum `contract_kind`, 0031) → rótulo de tela. */
export const ROTULO_CONTRATO: Record<string, string> = {
  full_service: 'Serviço completo',
  preventive_only: 'Só preventiva',
  on_demand: 'Sob demanda',
  rental: 'Locação',
  loan: 'Comodato',
  warranty: 'Garantia',
};

/** Hoje no calendário local (PF-72) — e não em UTC, que às 22 h já é amanhã. */
function hojeIso(): string {
  return hojeLocal();
}

export function NovoPlanoDialog({
  open,
  onOpenChange,
  clienteInicial,
  setorInicial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clienteInicial?: string;
  setorInicial?: string;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [passo, setPasso] = useState(0);
  const [cliente, setCliente] = useState('');
  const [setor, setSetor] = useState('');
  const [todos, setTodos] = useState(true);
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [tipo, setTipo] = useState<Tipo | ''>('');
  const [modelo, setModelo] = useState('');
  const [intervalo, setIntervalo] = useState(6);
  const [unidade, setUnidade] = useState<Unidade>('month');
  const [inicio, setInicio] = useState(hojeIso());
  const [antecedencia, setAntecedencia] = useState(15);
  const [tolerancia, setTolerancia] = useState(5);
  const [automatico, setAutomatico] = useState(true);
  const [nome, setNome] = useState('');
  const [nomeTocado, setNomeTocado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPasso(clienteInicial ? (setorInicial ? 2 : 1) : 0);
    setCliente(clienteInicial ?? '');
    setSetor(setorInicial ?? '');
    setTodos(true);
    setEscolhidos(new Set());
    setTipo('');
    setModelo('');
    setIntervalo(6);
    setUnidade('month');
    setInicio(hojeIso());
    setAntecedencia(15);
    setTolerancia(5);
    setAutomatico(true);
    setNome('');
    setNomeTocado(false);
    setErro(null);
  }, [open, clienteInicial, setorInicial]);

  const { data: clientes } = useApiQuery(customersList, undefined, { enabled: open }) as {
    data: { items: Customer[] } | undefined;
  };
  const { data: det } = useApiQuery(
    customersDetail,
    { params: { id: cliente } },
    { enabled: open && Boolean(cliente) }
  ) as {
    data: { locations: CustomerLocation[] } | undefined;
  };
  const { data: contratos } = useApiQuery(
    contractsList,
    { query: { customerId: cliente } },
    { enabled: open && Boolean(cliente) && can('contract.read') }
  ) as { data: { items: ContractRow[] } | undefined };
  const { data: ativos, isLoading: carregandoAtivos } = useApiQuery(
    assetsList,
    { query: { location: setor, customer: cliente, limit: 500 } },
    { enabled: open && Boolean(setor) && Boolean(cliente) }
  ) as { data: { items: AssetRow[] } | undefined; isLoading: boolean };
  const { data: opcoes } = useApiQuery(plansFormOptions, undefined, { enabled: open }) as {
    data: FormOptions | undefined;
  };

  const setores = useMemo(() => (det?.locations ?? []).filter((l) => l.location_type_key === 'setor'), [det]);
  const listaAtivos = useMemo(
    () => (ativos?.items ?? []).filter((a) => a.status !== 'decommissioned' && a.status !== 'disposed'),
    [ativos]
  );
  const tipoInfo = opcoes?.kinds.find((k) => k.key === tipo);
  const modelos = (opcoes?.templates ?? []).filter(
    (t) => (t.procedure_kind ?? null) === (tipoInfo?.procedure_kind ?? null)
  );
  const nomeCliente = clientes?.items.find((c) => c.id === cliente)?.name ?? '';
  const nomeSetor = setores.find((s) => s.id === setor)?.name ?? '';
  const vigentes = (contratos?.items ?? []).filter((c) => c.status === 'active');
  const un = UNIDADES.find((u) => u.v === unidade)!;
  const periodicidade = `a cada ${intervalo === 1 ? un.um : `${intervalo} ${un.varios}`}`;

  // Nome sugerido, até a pessoa mexer nele.
  useEffect(() => {
    if (nomeTocado || !tipo) return;
    setNome(`${rotuloTipo(tipo)} ${periodicidade}${nomeSetor ? ` — ${nomeSetor}` : ''}`);
  }, [tipo, periodicidade, nomeSetor, nomeTocado]);

  const criar = useApiMutation(plansCreate, {
    invalidates: [plansList, plansBoard, plansSchedule],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  function podeAvancar(): string | null {
    if (passo === 0 && !cliente) return 'Escolha o cliente.';
    if (passo === 1 && !setor) return 'Escolha o setor.';
    if (passo === 2 && !todos && escolhidos.size === 0)
      return 'Escolha ao menos um equipamento, ou "todos do setor".';
    if (passo === 3 && !tipo) return 'Escolha o tipo de plano.';
    if (passo === 5 && (intervalo < 1 || !inicio)) return 'Informe a periodicidade e a data de início.';
    return null;
  }

  async function concluir() {
    setErro(null);
    if (nome.trim().length < 3) return setErro('Dê um nome ao plano (3+ letras).');
    try {
      const r = (await criar.mutateAsync({
        body: {
          name: nome.trim(),
          customer_id: cliente,
          sector_id: setor,
          asset_ids: todos ? [] : [...escolhidos],
          kind: tipo as Tipo,
          checklist_template_key: modelo || null,
          frequency_unit: unidade,
          frequency_interval: intervalo,
          anchor_date: inicio,
          lead_time_days: antecedencia,
          tolerance_days: tolerancia,
          auto_generate: automatico,
        },
      })) as { id: string; task_count: number };
      toast.success(
        'Plano criado',
        `${r.task_count} ${r.task_count === 1 ? 'tarefa' : 'tarefas'} — as atividades aparecem no cronograma.`
      );
      onOpenChange(false);
      void navigate({ to: '/planos/$id', params: { id: r.id } });
    } catch {
      // mensagem já exibida
    }
  }

  const ultimo = passo === PASSOS.length - 1;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Novo plano de manutenção"
      description="Onde, o quê, como e quando — e o plano gera as atividades sozinho."
      footer={
        <>
          <Button onClick={() => (passo === 0 ? onOpenChange(false) : setPasso(passo - 1))}>
            {passo === 0 ? 'Cancelar' : 'Voltar'}
          </Button>
          {ultimo ? (
            <Button variant="primary" loading={criar.isPending} onClick={() => void concluir()}>
              Criar plano
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                const motivo = podeAvancar();
                if (motivo) return setErro(motivo);
                setErro(null);
                setPasso(passo + 1);
              }}
            >
              Continuar
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/*
         * COMO CRIAR O PLANO (conversa com o cliente, 21/10/2026: "criar plano com ajuda de IA ou
         * criar plano manualmente"). A IA AINDA NÃO EXISTE no produto — a escolha aparece para o
         * cliente ver o caminho, desabilitada e dita como "em breve", e o plano manual segue como
         * o único modo. Fingir um assistente que não há seria pior do que não mostrá-lo.
         */}
        {passo === 0 && (
          <div role="radiogroup" aria-label="Como criar o plano" className="grid gap-2 sm:grid-cols-2">
            <div
              role="radio"
              aria-checked="true"
              tabIndex={0}
              className="flex min-h-12 flex-col gap-0.5 rounded-control border border-accent bg-accent-soft p-3 text-sm"
            >
              <span className="flex items-center gap-2 font-semibold text-text">
                <Wrench aria-hidden="true" className="size-4" /> Manualmente
              </span>
              <span className="text-xs text-muted">Você escolhe onde, o quê, como e quando.</span>
            </div>
            <div
              role="radio"
              aria-checked="false"
              aria-disabled="true"
              className="flex min-h-12 flex-col gap-0.5 rounded-control border border-border-subtle p-3 text-sm opacity-70"
            >
              <span className="flex items-center gap-2 font-semibold text-text">
                <Bot aria-hidden="true" className="size-4" /> Com ajuda de IA
                <StatusChip tone="neutral" size="sm" withoutDot>
                  em breve
                </StatusChip>
              </span>
              <span className="text-xs text-muted">
                Ainda não está ativa. Por enquanto, o plano é criado manualmente.
              </span>
            </div>
          </div>
        )}

        {/* Trilho dos passos: nome, não número — e o atual em três canais. */}
        <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Passos">
          {PASSOS.map((p, i) => (
            <li key={p} className="min-w-16 flex-1">
              <button
                type="button"
                disabled={i > passo}
                onClick={() => setPasso(i)}
                aria-current={i === passo ? 'step' : undefined}
                className="flex w-full flex-col gap-1 text-left disabled:cursor-default"
              >
                <span
                  className={cn(
                    'h-1 rounded-full',
                    i < passo ? 'bg-accent' : i === passo ? 'bg-accent' : 'bg-surface-sunken'
                  )}
                />
                <span
                  className={cn(
                    'truncate text-2xs',
                    i === passo ? 'font-semibold text-accent-text' : 'text-muted'
                  )}
                >
                  {i < passo && <Check className="mr-0.5 inline size-3" aria-hidden="true" />}
                  {p}
                </span>
              </button>
            </li>
          ))}
        </ol>

        {passo === 0 && (
          <div className="flex flex-col gap-4">
            <Field label="Cliente / Hospital" required>
              <Select
                value={cliente}
                onChange={(e) => {
                  setCliente(e.target.value);
                  setSetor('');
                  setEscolhidos(new Set());
                }}
              >
                <option value="">Escolha o cliente</option>
                {(clientes?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {cliente && can('contract.read') && (
              <div className="rounded-card border border-border-subtle bg-surface-subtle p-3 text-sm">
                <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                  Contexto do cliente
                </p>
                {vigentes.length === 0 ? (
                  <p className="text-text">Sem contrato vigente — o plano vale do mesmo jeito.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {vigentes.map((c) => (
                      <StatusChip key={c.id} tone="info" size="sm">
                        {c.number} · {ROTULO_CONTRATO[c.kind] ?? c.kind}
                      </StatusChip>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-subtle">
                  Informativo: o tipo de contrato não muda as regras do plano.
                </p>
              </div>
            )}
          </div>
        )}

        {passo === 1 && (
          <Field
            label="Setor"
            required
            hint={
              setores.length === 0
                ? `${nomeCliente} ainda não tem setores — crie em Clientes › ${nomeCliente} › Setores.`
                : undefined
            }
          >
            <Select
              value={setor}
              onChange={(e) => {
                setSetor(e.target.value);
                setEscolhidos(new Set());
              }}
            >
              <option value="">Escolha o setor</option>
              {setores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.asset_count !== undefined ? `(${s.asset_count})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {passo === 2 && (
          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-card border border-border p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input
                type="radio"
                name="alvo"
                checked={todos}
                onChange={() => setTodos(true)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-semibold text-text">
                  Todos os equipamentos de {nomeSetor}
                </span>
                <span className="block text-xs text-muted">
                  {listaAtivos.length} hoje — e os que chegarem ao setor depois entram sozinhos.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-card border border-border p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input
                type="radio"
                name="alvo"
                checked={!todos}
                onChange={() => setTodos(false)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-semibold text-text">Escolher equipamentos</span>
                <span className="block text-xs text-muted">Uma tarefa por equipamento.</span>
              </span>
            </label>
            {!todos && (
              <ul className="max-h-64 overflow-y-auto rounded-card border border-border-subtle">
                {carregandoAtivos ? (
                  <li className="p-3 text-sm text-muted">Carregando…</li>
                ) : listaAtivos.length === 0 ? (
                  <li className="p-3 text-sm text-muted">Nenhum equipamento neste setor.</li>
                ) : (
                  listaAtivos.map((a, i) => (
                    <li key={a.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-hover">
                        <input
                          type="checkbox"
                          checked={escolhidos.has(a.id)}
                          onChange={(e) => {
                            const n = new Set(escolhidos);
                            if (e.target.checked) n.add(a.id);
                            else n.delete(a.id);
                            setEscolhidos(n);
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-text">{a.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {[a.category_name, a.manufacturer_name, a.model_name, a.tag]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        )}

        {passo === 3 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {TIPOS.map((t) => {
              const info = opcoes?.kinds.find((k) => k.key === t.key);
              const suportado = t.key !== 'education';
              const disponivel = suportado && info?.available;
              const Icone = t.icone;
              return (
                <button
                  key={t.key}
                  type="button"
                  disabled={!disponivel}
                  aria-pressed={tipo === t.key}
                  onClick={() => {
                    setTipo(t.key as Tipo);
                    setModelo('');
                  }}
                  className={cn(
                    'flex items-start gap-3 rounded-card border p-3 text-left transition-colors',
                    tipo === t.key
                      ? 'border-accent bg-accent-soft'
                      : 'border-border hover:border-border-strong',
                    !disponivel && 'cursor-not-allowed opacity-55'
                  )}
                >
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-control bg-surface-hover text-accent-text"
                    aria-hidden="true"
                  >
                    <Icone className="size-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-text">{t.titulo}</span>
                    <span className="block text-xs text-muted">
                      {!suportado
                        ? 'Não suportado pelo domínio atual'
                        : info && !info.available
                          ? 'Natureza de OS não cadastrada no catálogo'
                          : t.texto}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {passo === 4 && (
          <div className="flex flex-col gap-3">
            <Field
              label="Checklist / procedimento"
              hint={
                modelos.length === 0
                  ? `Nenhum procedimento de ${rotuloTipo(tipo).toLowerCase()} publicado. Crie em "Procedimentos e checklists" — ou siga sem checklist.`
                  : 'A versão publicada mais recente é anexada a cada OS gerada.'
              }
            >
              <Select value={modelo} onChange={(e) => setModelo(e.target.value)}>
                <option value="">Sem checklist</option>
                {modelos.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.title} · v{m.version} · {m.item_count} itens
                  </option>
                ))}
              </Select>
            </Field>
            {tipo && tipo !== 'preventive' && (
              <p className="flex gap-2 rounded-control bg-info-soft px-3 py-2 text-xs text-info-text">
                <ClipboardCheck className="size-4 shrink-0" aria-hidden="true" />
                Nominal e tolerâncias do protocolo são registrados como dado. A conformidade da medição não é
                calculada automaticamente — depende de validação metrológica.
              </p>
            )}
          </div>
        )}

        {passo === 5 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Repetir a cada" required>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={intervalo}
                  onChange={(e) => setIntervalo(Math.max(1, Number(e.target.value) || 1))}
                  className="w-20"
                />
                <Select value={unidade} onChange={(e) => setUnidade(e.target.value as Unidade)}>
                  {UNIDADES.map((u) => (
                    <option key={u.v} value={u.v}>
                      {intervalo === 1 ? u.um : u.varios}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
            <Field
              label="Começa a contar em"
              required
              hint="O primeiro ciclo vence um período depois desta data."
            >
              <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </Field>
            <Field label="Antecedência (dias)" hint="Quantos dias antes do ciclo as atividades são geradas.">
              <Input
                type="number"
                min={0}
                max={365}
                value={antecedencia}
                onChange={(e) => setAntecedencia(Number(e.target.value) || 0)}
              />
            </Field>
            <Field
              label="Tolerância (dias)"
              hint="Até quantos dias depois do vencimento ainda conta como em dia."
            >
              <Input
                type="number"
                min={0}
                max={90}
                value={tolerancia}
                onChange={(e) => setTolerancia(Number(e.target.value) || 0)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-text sm:col-span-2">
              <input type="checkbox" checked={automatico} onChange={(e) => setAutomatico(e.target.checked)} />
              Gerar as ordens de serviço automaticamente quando o ciclo abrir
            </label>
          </div>
        )}

        {passo === 6 && (
          <div className="flex flex-col gap-4">
            <Field label="Nome do plano" required>
              <Input
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value);
                  setNomeTocado(true);
                }}
              />
            </Field>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-card border border-border-subtle bg-surface-subtle p-4 text-sm sm:grid-cols-2">
              <Resumo r="Cliente" v={nomeCliente} />
              <Resumo r="Setor" v={nomeSetor} />
              <Resumo
                r="Equipamentos"
                v={todos ? `Todos do setor (${listaAtivos.length} hoje)` : `${escolhidos.size} escolhidos`}
              />
              <Resumo r="Tipo" v={rotuloTipo(tipo)} />
              <Resumo r="Procedimento" v={modelos.find((m) => m.key === modelo)?.title ?? 'Sem checklist'} />
              <Resumo
                r="Periodicidade"
                v={`${periodicidade}, desde ${new Date(`${inicio}T00:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`}
              />
              <Resumo r="Antecedência / tolerância" v={`${antecedencia} / ${tolerancia} dias`} />
              <Resumo
                r="Ordens de serviço"
                v={automatico ? 'geradas automaticamente' : 'geradas à mão, após revisão'}
              />
            </dl>
          </div>
        )}

        {erro && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Resumo({ r, v }: { r: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{r}</dt>
      <dd className="font-medium text-text">{v || '—'}</dd>
    </div>
  );
}
