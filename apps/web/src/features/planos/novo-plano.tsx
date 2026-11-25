/**
 * Aurora — criar plano de manutenção, passo a passo.
 *
 * Cliente → Setor → Equipamentos → Tipo → Procedimentos → Periodicidade → Revisão.
 *
 * A ORDEM É A DO MUNDO: primeiro ONDE (o hospital e o setor), depois O QUÊ (os
 * equipamentos e o tipo de serviço), depois COMO (o checklist de CADA
 * equipamento) e QUANDO (a periodicidade). Cada passo só oferece o que cabe no
 * anterior — os setores do cliente escolhido, os equipamentos do setor, os
 * procedimentos do tipo — e o servidor confere tudo de novo ao salvar.
 *
 * UM PROCEDIMENTO POR EQUIPAMENTO (vídeo do Anderson, 13/11/2026): "dentre os
 * equipamentos do setor tem outros tipos de equipamento, então todos vão
 * receber o checklist de ventilador pulmonar ... ele deveria obrigar a vir
 * equipamento por equipamento ... um maiszinho do lado de cada equipamento".
 * Antes, o passo Procedimento tinha UM checklist para o plano inteiro — e o
 * monitor, o eletrocardiógrafo e o respirador recebiam o mesmo. Agora cada
 * equipamento escolhe o seu (obrigatório), com o "+" para os adicionais e um
 * atalho para aplicar a escolha aos da mesma categoria.
 *
 * EDUCAÇÃO CONTINUADA: só calendário, sem procedimento, com a data de cada
 * equipamento (mesmo vídeo).
 *
 * O CONTEXTO CONTRATUAL APARECE, MAS NÃO DECIDE NADA. Tipo de contrato não é
 * tipo de procedimento.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Bot,
  Check,
  ClipboardCheck,
  GraduationCap,
  Plus,
  ShieldCheck,
  Thermometer,
  Wrench,
  X,
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

type Tipo = 'preventive' | 'calibration' | 'electrical_safety' | 'qualification' | 'education';
type Unidade = 'day' | 'week' | 'month' | 'quarter' | 'semester' | 'year';

export interface FormOptions {
  kinds: Array<{ key: Tipo; available: boolean; work_order_type: string; procedure_kind: string | null }>;
  templates: Array<{
    key: string;
    title: string;
    version: number;
    procedure_kind: string | null;
    item_count: number;
  }>;
}

/** O que cada equipamento recebe: o procedimento principal, os adicionais e (educação) a data. */
export interface EscolhaDoEquipamento {
  principal: string;
  adicionais: string[];
  data: string;
}

const PASSOS = [
  'Cliente',
  'Setor',
  'Equipamentos',
  'Tipo',
  'Procedimentos',
  'Periodicidade',
  'Revisão',
] as const;

const TIPOS: Array<{ key: Tipo; titulo: string; texto: string; icone: typeof Wrench }> = [
  { key: 'preventive', titulo: 'Preventiva', texto: 'Inspeção e manutenção programada', icone: Wrench },
  { key: 'calibration', titulo: 'Calibração', texto: 'Protocolo com pontos de medição', icone: Thermometer },
  { key: 'electrical_safety', titulo: 'TSE', texto: 'Teste de segurança elétrica', icone: Zap },
  { key: 'qualification', titulo: 'Qualificação', texto: 'Qualificação de equipamento', icone: ShieldCheck },
  {
    key: 'education',
    titulo: 'Educação continuada',
    texto: 'Só calendário: uma data por equipamento, sem procedimento',
    icone: GraduationCap,
  },
];

const UNIDADES: Array<{ v: Unidade; um: string; varios: string; meses: number; dias: number }> = [
  { v: 'week', um: 'semana', varios: 'semanas', meses: 0, dias: 7 },
  { v: 'month', um: 'mês', varios: 'meses', meses: 1, dias: 0 },
  { v: 'quarter', um: 'trimestre', varios: 'trimestres', meses: 3, dias: 0 },
  { v: 'semester', um: 'semestre', varios: 'semestres', meses: 6, dias: 0 },
  { v: 'year', um: 'ano', varios: 'anos', meses: 12, dias: 0 },
  { v: 'day', um: 'dia', varios: 'dias', meses: 0, dias: 1 },
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

/** O primeiro vencimento pela âncora: a mesma conta do servidor (o dia é grampeado no fim do mês). */
export function primeiroVencimento(inicio: string, unidade: Unidade, intervalo: number): string {
  const [a, m, d] = inicio.split('-').map(Number) as [number, number, number];
  const u = UNIDADES.find((x) => x.v === unidade)!;
  if (u.dias > 0) {
    return new Date(Date.UTC(a, m - 1, d + u.dias * intervalo)).toISOString().slice(0, 10);
  }
  const mes = m - 1 + u.meses * intervalo;
  const ultimo = new Date(Date.UTC(a, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, mes, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

export function dataBr(dia: string): string {
  return dia ? dia.split('-').reverse().join('/') : '—';
}

/** "UTI Adulto" vira "Bloco A › UTI Adulto": dois setores de mesmo nome em unidades diferentes se distinguem. */
export function rotuloDoSetor(setor: CustomerLocation, todos: CustomerLocation[]): string {
  const porId = new Map(todos.map((l) => [l.id, l]));
  const nomes: string[] = [setor.name];
  let pai = setor.parent_id ? porId.get(setor.parent_id) : undefined;
  while (pai) {
    nomes.unshift(pai.name);
    pai = pai.parent_id ? porId.get(pai.parent_id) : undefined;
  }
  return nomes.join(' › ');
}

/** O que ainda falta para cada equipamento (vazio = completo). */
export function faltasDosEquipamentos(
  ids: readonly string[],
  escolhas: Record<string, EscolhaDoEquipamento>,
  educacao: boolean,
  hoje: string
): Map<string, string> {
  const faltas = new Map<string, string>();
  for (const id of ids) {
    const e = escolhas[id];
    if (educacao) {
      if (!e?.data) faltas.set(id, 'informe a data');
      else if (e.data < hoje) faltas.set(id, 'a data já passou');
    } else if (!e?.principal) {
      faltas.set(id, 'escolha o procedimento');
    }
  }
  return faltas;
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
  const [escolhas, setEscolhas] = useState<Record<string, EscolhaDoEquipamento>>({});
  const [intervalo, setIntervalo] = useState(6);
  const [unidade, setUnidade] = useState<Unidade>('month');
  const [inicio, setInicio] = useState(hojeLocal());
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
    setEscolhas({});
    setIntervalo(6);
    setUnidade('month');
    setInicio(hojeLocal());
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

  const locais = useMemo(() => det?.locations ?? [], [det]);
  const setores = useMemo(
    () =>
      locais
        .filter((l) => l.location_type_key === 'setor')
        .map((l) => ({ ...l, rotulo: rotuloDoSetor(l, locais) }))
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
    [locais]
  );
  const listaAtivos = useMemo(
    () => (ativos?.items ?? []).filter((a) => a.status !== 'decommissioned' && a.status !== 'disposed'),
    [ativos]
  );
  const alvo = useMemo(
    () => (todos ? listaAtivos : listaAtivos.filter((a) => escolhidos.has(a.id))),
    [todos, listaAtivos, escolhidos]
  );
  const educacao = tipo === 'education';
  const tipoInfo = opcoes?.kinds.find((k) => k.key === tipo);
  const modelos = (opcoes?.templates ?? []).filter(
    (t) => (t.procedure_kind ?? null) === (tipoInfo?.procedure_kind ?? null)
  );
  const todosModelos = opcoes?.templates ?? [];
  const tituloDe = (k: string) => todosModelos.find((t) => t.key === k)?.title ?? k;
  const nomeCliente = clientes?.items.find((c) => c.id === cliente)?.name ?? '';
  const nomeSetor = setores.find((s) => s.id === setor)?.name ?? '';
  const vigentes = (contratos?.items ?? []).filter((c) => c.status === 'active');
  const un = UNIDADES.find((u) => u.v === unidade)!;
  const periodicidade = `a cada ${intervalo === 1 ? un.um : `${intervalo} ${un.varios}`}`;
  const hoje = hojeLocal();
  const vencimento = inicio ? primeiroVencimento(inicio, unidade, intervalo) : '';
  const faltas = faltasDosEquipamentos(
    alvo.map((a) => a.id),
    escolhas,
    educacao,
    hoje
  );

  // Nome sugerido, até a pessoa mexer nele.
  useEffect(() => {
    if (nomeTocado || !tipo) return;
    setNome(
      `${educacao ? 'Educação continuada' : rotuloTipo(tipo)} ${periodicidade}${nomeSetor ? ` — ${nomeSetor}` : ''}`
    );
  }, [tipo, educacao, periodicidade, nomeSetor, nomeTocado]);

  const criar = useApiMutation(plansCreate, {
    invalidates: [plansList, plansBoard, plansSchedule],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  function escolher(id: string, mudanca: Partial<EscolhaDoEquipamento>) {
    setEscolhas((atual) => ({
      ...atual,
      [id]: { principal: '', adicionais: [], data: '', ...atual[id], ...mudanca },
    }));
  }

  /** Aplica a escolha de um equipamento aos da mesma categoria (só onde ainda não há escolha). */
  function aplicarNaCategoria(origem: AssetRow) {
    const e = escolhas[origem.id];
    if (!e) return;
    setEscolhas((atual) => {
      const novo = { ...atual };
      for (const a of alvo) {
        if (a.id === origem.id || a.asset_category_id !== origem.asset_category_id) continue;
        novo[a.id] = { principal: e.principal, adicionais: [...e.adicionais], data: e.data };
      }
      return novo;
    });
  }

  function podeAvancar(): string | null {
    if (passo === 0 && !cliente) return 'Escolha o cliente.';
    if (passo === 1 && !setor) return 'Escolha o setor.';
    if (passo === 2) {
      if (listaAtivos.length === 0) return `${nomeSetor} não tem equipamento ativo para entrar no plano.`;
      if (!todos && escolhidos.size === 0) return 'Escolha ao menos um equipamento, ou todos do setor.';
    }
    if (passo === 3 && !tipo) return 'Escolha o tipo de plano.';
    if (passo === 4 && faltas.size > 0) {
      return educacao
        ? `Informe uma data de hoje em diante para cada equipamento (faltam ${faltas.size}).`
        : `Cada equipamento precisa do procedimento dele (faltam ${faltas.size}).`;
    }
    if (passo === 5) {
      if (intervalo < 1) return 'Informe a periodicidade.';
      if (!educacao && !inicio) return 'Informe a data de início.';
      if (!educacao && vencimento < hoje) {
        return `Com esse início, o primeiro vencimento (${dataBr(vencimento)}) já passou. Use uma data mais recente.`;
      }
    }
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
          kind: tipo as Tipo,
          items: alvo.map((a) => {
            const e = escolhas[a.id];
            return educacao
              ? { asset_id: a.id, first_due_on: e?.data ?? null }
              : {
                  asset_id: a.id,
                  checklist_template_key: e?.principal || null,
                  extra_checklist_template_keys: (e?.adicionais ?? []).filter((k) => k !== e?.principal),
                };
          }),
          frequency_unit: unidade,
          frequency_interval: intervalo,
          anchor_date: educacao ? hoje : inicio,
          lead_time_days: antecedencia,
          tolerance_days: tolerancia,
          auto_generate: automatico,
        },
      })) as { id: string; task_count: number; cycles_opened: number; work_orders: number };
      const partes = [`${r.task_count} ${r.task_count === 1 ? 'equipamento' : 'equipamentos'}`];
      if (r.cycles_opened > 0)
        partes.push(`${r.cycles_opened} ${r.cycles_opened === 1 ? 'ciclo aberto' : 'ciclos abertos'} agora`);
      if (r.work_orders > 0) partes.push(`${r.work_orders} OS ${r.work_orders === 1 ? 'gerada' : 'geradas'}`);
      toast.success('Plano criado', `${partes.join(' · ')}. Acompanhe e edite na página do plano.`);
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
         * COMO CRIAR O PLANO (conversa com o cliente, 21/10/2026). A IA AINDA NÃO EXISTE: a escolha
         * aparece desabilitada e dita como "em breve", e o plano manual segue como o único modo.
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
                <span className={cn('h-1 rounded-full', i <= passo ? 'bg-accent' : 'bg-surface-sunken')} />
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
                  setEscolhas({});
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
                      <StatusChip key={c.id} tone={c.service_hold ? 'warn' : 'info'} size="sm">
                        {c.number} · {ROTULO_CONTRATO[c.kind] ?? c.kind}
                        {c.service_hold
                          ? c.service_hold === 'blocked'
                            ? ' · atendimento bloqueado'
                            : ' · atendimento suspenso'
                          : ''}
                      </StatusChip>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-subtle">
                  Informativo: o tipo de contrato não muda as regras do plano. Com o atendimento suspenso,
                  bloqueado ou o contrato vencido, o plano não gera OS para os equipamentos do contrato.
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
                : 'A unidade aparece antes do setor.'
            }
          >
            <Select
              value={setor}
              onChange={(e) => {
                setSetor(e.target.value);
                setEscolhidos(new Set());
                setEscolhas({});
              }}
            >
              <option value="">Escolha o setor</option>
              {setores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.rotulo} {s.asset_count !== undefined ? `(${s.asset_count})` : ''}
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
                  {listaAtivos.length} hoje — cada um recebe o procedimento dele no próximo passo. O que
                  chegar ao setor depois entra pela página do plano (Incluir equipamentos).
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
                <span className="block text-xs text-muted">Só os marcados entram no plano.</span>
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
              const disponivel = Boolean(info?.available);
              const Icone = t.icone;
              return (
                <button
                  key={t.key}
                  type="button"
                  disabled={!disponivel}
                  aria-pressed={tipo === t.key}
                  onClick={() => {
                    setTipo(t.key);
                    setEscolhas({});
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
                      {info && !info.available ? 'Natureza de OS não cadastrada no catálogo' : t.texto}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {passo === 4 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {educacao
                ? 'Educação continuada não leva procedimento: informe a data de cada equipamento.'
                : `Escolha o procedimento de CADA equipamento (${rotuloTipo(tipo).toLowerCase()}). Use “+” para juntar outros procedimentos na mesma OS.`}{' '}
              {faltas.size > 0 ? (
                <strong className="text-warn-text">Faltam {faltas.size}.</strong>
              ) : (
                <strong className="text-good-text">Todos prontos.</strong>
              )}
            </p>
            {!educacao && modelos.length === 0 && (
              <p role="alert" className="rounded-control bg-warn-soft px-3 py-2 text-sm text-warn-text">
                Nenhum procedimento de {rotuloTipo(tipo).toLowerCase()} publicado. Crie em “Procedimentos e
                checklists” antes de criar o plano.
              </p>
            )}
            <ul className="flex max-h-[26rem] flex-col overflow-y-auto rounded-card border border-border-subtle">
              {alvo.map((a, i) => (
                <LinhaDoEquipamento
                  key={a.id}
                  ativo={a}
                  primeiro={i === 0}
                  educacao={educacao}
                  escolha={escolhas[a.id]}
                  falta={faltas.get(a.id)}
                  modelos={modelos}
                  todosModelos={todosModelos}
                  hoje={hoje}
                  temMesmaCategoria={alvo.some(
                    (b) => b.id !== a.id && b.asset_category_id === a.asset_category_id
                  )}
                  onEscolher={(m) => escolher(a.id, m)}
                  onAplicarNaCategoria={() => aplicarNaCategoria(a)}
                />
              ))}
            </ul>
            {tipo && tipo !== 'preventive' && !educacao && (
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
                  aria-label="Intervalo"
                  value={intervalo}
                  onChange={(e) => setIntervalo(Math.max(1, Number(e.target.value) || 1))}
                  className="w-20"
                />
                <Select
                  aria-label="Unidade"
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value as Unidade)}
                >
                  {UNIDADES.map((u) => (
                    <option key={u.v} value={u.v}>
                      {intervalo === 1 ? u.um : u.varios}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
            {educacao ? (
              <p className="text-sm text-muted">
                A primeira data de cada equipamento foi informada no passo anterior; as próximas seguem a
                periodicidade a partir dela.
              </p>
            ) : (
              <Field
                label="Começa a contar em"
                required
                hint={vencimento ? `Primeiro vencimento: ${dataBr(vencimento)}.` : undefined}
              >
                <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
              </Field>
            )}
            <Field
              label="Antecedência (dias)"
              hint="Quantos dias antes do início do ciclo ele abre: é quando as atividades aparecem no cronograma e, com geração automática, as OS são abertas."
            >
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
            <label className="flex items-start gap-2 text-sm text-text sm:col-span-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={automatico}
                onChange={(e) => setAutomatico(e.target.checked)}
              />
              <span>
                Gerar as ordens de serviço automaticamente quando o ciclo abrir
                <span className="block text-xs text-muted">
                  Desmarcado, as OS são geradas na página do plano, no botão “Gerar OS deste ciclo”.
                </span>
              </span>
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
              <Resumo r="Setor" v={setores.find((s) => s.id === setor)?.rotulo ?? ''} />
              <Resumo r="Tipo" v={educacao ? 'Educação continuada' : rotuloTipo(tipo)} />
              <Resumo r="Equipamentos" v={`${alvo.length}`} />
              <Resumo
                r="Periodicidade"
                v={educacao ? periodicidade : `${periodicidade} · 1º vencimento ${dataBr(vencimento)}`}
              />
              <Resumo r="Antecedência / tolerância" v={`${antecedencia} / ${tolerancia} dias`} />
              <Resumo
                r="Ordens de serviço"
                v={automatico ? 'geradas automaticamente' : 'geradas à mão, na página do plano'}
              />
            </dl>
            <table className="w-full text-left text-sm" aria-label="Equipamentos do plano">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Equipamento</th>
                  <th className="py-1 font-medium">{educacao ? 'Primeira data' : 'Procedimentos'}</th>
                </tr>
              </thead>
              <tbody>
                {alvo.map((a) => {
                  const e = escolhas[a.id];
                  return (
                    <tr key={a.id} className="border-t border-border-subtle">
                      <td className="py-1.5 pr-3 text-text">{a.name}</td>
                      <td className="py-1.5 text-muted">
                        {educacao
                          ? dataBr(e?.data ?? '')
                          : [e?.principal, ...(e?.adicionais ?? [])]
                              .filter(Boolean)
                              .map((k) => tituloDe(k!))
                              .join(' + ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

/**
 * Uma linha do passo Procedimentos: o equipamento, o procedimento principal
 * (do tipo do plano), o "+" dos adicionais (qualquer tipo publicado) e o atalho
 * para a mesma categoria. Na educação continuada, a data no lugar do procedimento.
 */
export function LinhaDoEquipamento({
  ativo,
  primeiro,
  educacao,
  escolha,
  falta,
  modelos,
  todosModelos,
  hoje,
  temMesmaCategoria,
  onEscolher,
  onAplicarNaCategoria,
}: {
  ativo: AssetRow;
  primeiro: boolean;
  educacao: boolean;
  escolha: EscolhaDoEquipamento | undefined;
  falta: string | undefined;
  modelos: FormOptions['templates'];
  todosModelos: FormOptions['templates'];
  hoje: string;
  temMesmaCategoria: boolean;
  onEscolher: (m: Partial<EscolhaDoEquipamento>) => void;
  onAplicarNaCategoria: () => void;
}) {
  const [adicionando, setAdicionando] = useState(false);
  const adicionais = escolha?.adicionais ?? [];
  const disponiveisParaAdicionar = todosModelos.filter(
    (t) => t.key !== escolha?.principal && !adicionais.includes(t.key)
  );
  const pronto = escolha && (educacao ? Boolean(escolha.data) : Boolean(escolha.principal));
  return (
    <li
      className={cn('flex flex-col gap-2 px-3 py-2.5', !primeiro && 'border-t border-border-subtle')}
      aria-label={`Equipamento ${ativo.name}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-text">{ativo.name}</span>
          <span className="block truncate text-xs text-muted">
            {[ativo.category_name, ativo.model_name, ativo.tag].filter(Boolean).join(' · ')}
          </span>
        </span>
        {falta ? (
          <StatusChip tone="warn" size="sm">
            {falta}
          </StatusChip>
        ) : (
          <StatusChip tone="good" size="sm">
            pronto
          </StatusChip>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {educacao ? (
          <Input
            type="date"
            min={hoje}
            aria-label={`Data de ${ativo.name}`}
            value={escolha?.data ?? ''}
            onChange={(e) => onEscolher({ data: e.target.value })}
            className="w-44"
          />
        ) : (
          <>
            <Select
              aria-label={`Procedimento de ${ativo.name}`}
              value={escolha?.principal ?? ''}
              onChange={(e) => onEscolher({ principal: e.target.value })}
              className="min-w-56 flex-1"
            >
              <option value="">Escolha o procedimento</option>
              {modelos.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.title} · v{m.version} · {m.item_count} itens
                </option>
              ))}
            </Select>
            {disponiveisParaAdicionar.length > 0 && (
              <Button
                size="sm"
                icon={<Plus className="size-4" />}
                aria-label={`Adicionar procedimento a ${ativo.name}`}
                onClick={() => setAdicionando((v) => !v)}
              >
                Procedimento
              </Button>
            )}
          </>
        )}
        {pronto && temMesmaCategoria && (
          <Button size="sm" variant="ghost" onClick={onAplicarNaCategoria}>
            Aplicar a todos de {ativo.category_name}
          </Button>
        )}
      </div>
      {!educacao && adicionando && (
        <Select
          aria-label={`Procedimento adicional de ${ativo.name}`}
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            onEscolher({ adicionais: [...adicionais, e.target.value] });
            setAdicionando(false);
          }}
        >
          <option value="">Escolha o procedimento adicional (vai na mesma OS)</option>
          {disponiveisParaAdicionar.map((t) => (
            <option key={t.key} value={t.key}>
              {t.title} · {rotuloTipo(t.procedure_kind ?? 'preventive')} · v{t.version}
            </option>
          ))}
        </Select>
      )}
      {!educacao && adicionais.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {adicionais.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-xs text-text"
            >
              + {todosModelos.find((t) => t.key === k)?.title ?? k}
              <button
                type="button"
                aria-label={`Tirar ${todosModelos.find((t) => t.key === k)?.title ?? k}`}
                onClick={() => onEscolher({ adicionais: adicionais.filter((x) => x !== k) })}
                className="text-muted hover:text-text"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
    </li>
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
