/**
 * Aurora — "Gerar relatório" do Painel: modelos BASIC, ADVANCED e EXPERT
 * (reunião 16/10/2026; Fase 1 de indicadores, 17/10/2026).
 *
 * Fluxo: modelo → período → cliente (e contrato) → indicadores do modelo.
 *
 * O catálogo vem do servidor e é a fonte única:
 *
 *   · ACTIVE entra marcado; PROVISIONAL aparece desmarcado e identificado como
 *     provisório (a definição ainda não foi confirmada pelo cliente);
 *   · PENDING_DEFINITION não entra em relatório — a tela os lista à parte, com
 *     o motivo, e sem caixa de seleção;
 *   · o Expert não herda o Basic: cada modelo mostra só os seus indicadores.
 *
 * Os números vêm das MESMAS funções do Painel, com o recorte de quem pede. Cada
 * linha traz a meta vigente (contrato → cliente → organização) ou diz SEM META
 * CONFIGURADA.
 *
 * Saídas (WhatsApp 19/10/2026): tela, PDF e Excel (REL-10), com o nome do NÍVEL
 * (REL-01: "Relatório Basic/Advanced/Expert"; o Advanced segue o modelo do cliente,
 * o Basic o mesmo padrão visual — REL-08). A aba "Patrimonial" (REL-11) fica em
 * `relatorio-patrimonial.tsx`.
 *
 * Filtros (REL-03, 29/10/2026): cliente, SETOR (escolhido aqui, não só herdado do Painel), TIPO DE
 * MANUTENÇÃO das OS, família/tipo de equipamento, tipo de plano, período e indicadores — tudo
 * conferido de novo no servidor contra o escopo de quem pede. O mesmo diálogo abre do Painel e da
 * página própria `/relatorios`. "Criar automação com estes filtros" (REL-15) leva o recorte para a
 * Nova automação de relatório agendado.
 */
import { useMemo, useState } from 'react';
import { CalendarClock, FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import { Button, Dialog, Field, Input, Select, StatusChip, Tabs, cn, useToast } from '@aurora/ui';
import {
  assetsFormOptions,
  contractsList,
  customersList,
  reportsCatalog,
  reportsGenerate,
  reportsOptions,
} from '@aurora/contracts';
import { ApiError, useApi, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';
import { baixarRelatorio } from './baixar';
import { intervaloDoPainel, type FiltrosDoPainel } from './dados';
import { DialogoNovaAutomacao } from '../automacoes/nova';
import { automacaoDoRelatorio, type RelatorioAgendadoInicial } from '../automacoes/do-relatorio';
import { PainelPatrimonial } from './relatorio-patrimonial';
import { PERIODOS, type Periodo } from './rotulos';

type Tier = 'basic' | 'advanced' | 'expert';
export type Estado = 'ACTIVE' | 'PROVISIONAL' | 'PENDING_DEFINITION';
type Indicador = {
  key: string;
  label: string;
  description: string;
  unit: string;
  tiers: Tier[];
  state: Estado;
  target_direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'INFORMATIONAL';
  note?: string;
};
export type Meta = {
  value: number;
  unit: string;
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
  scope: 'contract' | 'customer' | 'organization';
};
export type Secao = {
  key: string;
  label: string;
  state: Estado;
  note: string | null;
  value: number | null;
  unit: string;
  samples: number | null;
  definition: string | null;
  target: Meta | null;
  target_evaluation: 'met' | 'not_met' | 'no_value' | 'no_target' | 'informational';
  target_label: string | null;
};
type Pendente = { key: string; label: string; state: Estado; note: string | null };

const NOMES: Record<Tier, string> = { basic: 'Basic', advanced: 'Advanced', expert: 'Expert' };
const DESCRICAO: Record<Exclude<Tier, 'expert'>, string> = {
  basic: 'Chamados, conformidades de planos e avaliação da qualidade.',
  advanced: 'Basic + SLA, evolução dos chamados, backlog, OS por situação e abertos × encerrados.',
};

/**
 * O cartão do Expert (REL-16). O cliente pediu "17+ indicadores em tempo real", mas a maior parte
 * do IMR depende de fórmulas que o cliente ainda não definiu: o cartão diz quantos estão
 * previstos e quantos têm cálculo hoje, contados do catálogo — nunca um número de propaganda.
 */
export function descricaoDoExpert(indicadores: { tiers: string[]; state: Estado }[]): string {
  const doExpert = indicadores.filter((i) => i.tiers.includes('expert'));
  if (doExpert.length === 0) return 'Indicadores de desempenho do contrato (IMR).';
  const comCalculo = doExpert.filter((i) => i.state !== 'PENDING_DEFINITION').length;
  return (
    `Indicadores de desempenho do contrato (IMR): ${doExpert.length} previstos, ${comCalculo} com cálculo hoje; ` +
    'os que dependem das fórmulas do cliente aparecem como pendentes.'
  );
}

const AVISO_DO_LAYOUT: Record<Tier, string> = {
  basic:
    'O PDF Relatório Basic abre com um painel da situação de cada indicador e traz o gráfico dos últimos 12 meses. Indicador provisório sai marcado; o pendente de definição aparece listado, sem número.',
  advanced:
    'O PDF Relatório Advanced segue o modelo de relatório do cliente, com gráfico de 12 meses e linha da meta. Indicador provisório sai marcado.',
  expert:
    'O PDF Relatório Expert é a casca do IMR: só os itens com definição têm resultado. Desconto, glosa e faturamento não são calculados — a regra do IMR ainda não foi definida pelo cliente.',
};

const TIPOS_DE_PLANO = [
  ['', 'Todos os tipos de plano'],
  ['preventive', 'Preventiva'],
  ['calibration', 'Calibração'],
  ['electrical_safety', 'TSE'],
  ['qualification', 'Qualificação'],
] as const;

const SUFIXO: Record<string, string> = { percent: ' %', minutes: ' min', hours: ' h', score: ' de 5' };
const ESCOPO: Record<Meta['scope'], string> = {
  contract: 'do contrato',
  customer: 'do cliente',
  organization: 'da organização',
};

function numero(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export function valorDe(s: Pick<Secao, 'value' | 'unit'>): string {
  return s.value === null ? 'Sem dados suficientes no período' : `${numero(s.value)}${SUFIXO[s.unit] ?? ''}`;
}

/** Meta da seção, "SEM META CONFIGURADA" ou nada (informativo). Também no relatório agendado. */
export function MetaDaSecao({ s }: { s: Pick<Secao, 'target' | 'target_evaluation' | 'target_label'> }) {
  if (s.target_evaluation === 'informational') return null;
  if (!s.target) {
    return <span className="text-xs font-medium text-muted">{s.target_label ?? 'SEM META CONFIGURADA'}</span>;
  }
  const sinal = s.target.direction === 'HIGHER_IS_BETTER' ? '≥' : '≤';
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
      Meta {sinal} {numero(s.target.value)}
      {SUFIXO[s.target.unit] ?? ''} ({ESCOPO[s.target.scope]})
      {s.target_evaluation === 'met' && (
        <StatusChip size="sm" tone="good">
          Meta cumprida
        </StatusChip>
      )}
      {s.target_evaluation === 'not_met' && (
        <StatusChip size="sm" tone="bad">
          Abaixo da meta
        </StatusChip>
      )}
    </span>
  );
}

/** O recorte com que o diálogo abre (o do Painel, ou nenhum na página `/relatorios`). */
export type RecorteInicial = Pick<FiltrosDoPainel, 'periodo' | 'de' | 'ate' | 'cliente' | 'setor'>;

export function BotaoGerarRelatorio({
  f,
  abertoNoInicio = false,
}: {
  f: RecorteInicial;
  abertoNoInicio?: boolean;
}) {
  const [aberto, setAberto] = useState(abertoNoInicio);
  // REL-15: o relatório fecha e a Nova automação abre já preenchida.
  const [automacao, setAutomacao] = useState<RelatorioAgendadoInicial | null>(null);
  return (
    <>
      <Button icon={<FileText className="size-4" />} onClick={() => setAberto(true)}>
        Gerar relatório
      </Button>
      {aberto && (
        <DialogoRelatorio
          f={f}
          onFechar={() => setAberto(false)}
          onCriarAutomacao={(inicial) => {
            setAberto(false);
            setAutomacao(inicial);
          }}
        />
      )}
      {automacao && <DialogoNovaAutomacao inicial={automacao} onFechar={() => setAutomacao(null)} />}
    </>
  );
}

/** Reserva enquanto as opções do servidor não chegam: os sete tipos de `request-types`. */
const TIPOS_DE_MANUTENCAO_PADRAO = [
  { key: 'corrective', label: 'Corretiva' },
  { key: 'preventive', label: 'Preventiva' },
  { key: 'technical_instruction', label: 'Instrução Técnica' },
  { key: 'training', label: 'Treinamento' },
  { key: 'calibration', label: 'Calibração' },
  { key: 'electrical_safety', label: 'Teste de Segurança Elétrica' },
  { key: 'qualification', label: 'Qualificação' },
] as const;

export type Categoria = { id: string; name: string; parent_id: string | null; family_key: string | null };

/** Famílias com os tipos delas, e as categorias soltas (sem família) no fim. */
export function gruposDeCategoria(cats: readonly Categoria[]): {
  familias: { familia: Categoria; tipos: Categoria[] }[];
  soltas: Categoria[];
} {
  const familias = cats
    .filter((c) => c.family_key)
    .map((familia) => ({ familia, tipos: cats.filter((c) => c.parent_id === familia.id) }));
  const comFamilia = new Set(familias.flatMap((g) => [g.familia.id, ...g.tipos.map((t) => t.id)]));
  return { familias, soltas: cats.filter((c) => !comFamilia.has(c.id)) };
}

function DialogoRelatorio({
  f,
  onFechar,
  onCriarAutomacao,
}: {
  f: RecorteInicial;
  onFechar: () => void;
  onCriarAutomacao: (inicial: RelatorioAgendadoInicial) => void;
}) {
  const toast = useToast();
  const api = useApi();
  const { can } = usePermissions();
  const vePatrimonio = can('asset.read');
  const [aba, setAba] = useState<'indicadores' | 'patrimonial'>('indicadores');
  const [tier, setTier] = useState<Tier>('basic');
  const [marcados, setMarcados] = useState<string[] | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>(f.periodo);
  const [de, setDe] = useState(f.de);
  const [ate, setAte] = useState(f.ate);
  const [cliente, setCliente] = useState(f.cliente);
  // O setor do Painel vem como ponto de partida; aqui ele se escolhe (REL-03).
  const [setor, setSetor] = useState(f.setor);
  const [contrato, setContrato] = useState('');
  const [tipoPlano, setTipoPlano] = useState('');
  const [tipoManutencao, setTipoManutencao] = useState('');
  const [categoria, setCategoria] = useState('');
  const podeAutomatizar = can('automation.create');
  // Cabeçalho e assinaturas do PDF Basic e Advanced; não são dados do sistema.
  const [centroDeCusto, setCentroDeCusto] = useState('');
  const [cidade, setCidade] = useState('');
  const [assinante1, setAssinante1] = useState({ nome: '', cargo: '' });
  const [assinante2, setAssinante2] = useState({ nome: '', cargo: '' });
  const [resultado, setResultado] = useState<{ sections: Secao[]; pending: Pendente[] } | null>(null);
  const [baixando, setBaixando] = useState<'pdf' | 'xlsx' | null>(null);

  const { data: catalogo } = useApiQuery(reportsCatalog) as {
    data: { indicators: Indicador[]; layout_note: string } | undefined;
  };
  const { data: opcoesDoGerador } = useApiQuery(reportsOptions) as {
    data:
      | {
          sectors: { id: string; name: string; customer_id: string }[];
          work_order_types: { key: string; label: string }[];
          asset_categories: Categoria[];
        }
      | undefined;
  };
  // As categorias do formulário de equipamento ficam de reserva enquanto as opções carregam.
  const { data: opcoes } = useApiQuery(assetsFormOptions) as {
    data: { categories: { id: string; name: string; family_key?: string | null }[] } | undefined;
  };
  const setores = (opcoesDoGerador?.sectors ?? []).filter((x) => !cliente || x.customer_id === cliente);
  const tiposDeManutencao = opcoesDoGerador?.work_order_types ?? TIPOS_DE_MANUTENCAO_PADRAO;
  const grupos = gruposDeCategoria(
    opcoesDoGerador?.asset_categories ??
      (opcoes?.categories ?? [])
        .filter((c) => !c.family_key)
        .map((c) => ({ id: c.id, name: c.name, parent_id: null, family_key: null }))
  );
  const { data: clientes } = useApiQuery(customersList) as {
    data: { items: { id: string; name: string }[] } | undefined;
  };
  const veContratos = can('contract.read');
  const { data: contratos } = useApiQuery(
    contractsList,
    { query: { customerId: cliente } },
    { enabled: veContratos && cliente !== '' }
  ) as { data: { items: { id: string; number: string; title: string | null }[] } | undefined };
  const gerar = useApiMutation(reportsGenerate, {
    onError: (e: ApiError) => toast.error('Relatório não gerado', e.problem.message),
  });

  const doModelo = useMemo(
    () => (catalogo?.indicators ?? []).filter((i) => i.tiers.includes(tier)),
    [catalogo, tier]
  );
  const selecionaveis = doModelo.filter((i) => i.state !== 'PENDING_DEFINITION');
  const pendentes = doModelo.filter((i) => i.state === 'PENDING_DEFINITION');
  // ACTIVE entra sozinho; PROVISIONAL só se a pessoa marcar.
  const escolhidos = marcados ?? selecionaveis.filter((i) => i.state === 'ACTIVE').map((i) => i.key);
  const intervalo = intervaloDoPainel({ periodo, de, ate });

  function corpo() {
    if (intervalo.problema !== null) return null;
    return {
      tier,
      indicators: escolhidos.filter((k) => selecionaveis.some((i) => i.key === k)),
      from: intervalo.from,
      to: intervalo.to,
      ...(cliente ? { customer_id: cliente } : {}),
      ...(contrato ? { contract_id: contrato } : {}),
      ...(setor ? { sector_id: setor } : {}),
      ...(tipoPlano ? { plan_kind: tipoPlano as 'preventive' } : {}),
      ...(tipoManutencao ? { work_order_type: tipoManutencao as 'corrective' } : {}),
      ...(categoria ? { asset_category_id: categoria } : {}),
      ...(tier !== 'expert' ? cabecalhoDoPdf() : {}),
    };
  }

  function cabecalhoDoPdf() {
    const assinaturas = [assinante1, assinante2]
      .filter((a) => a.cargo.trim() !== '')
      .map((a) => ({ name: a.nome.trim(), role: a.cargo.trim() }));
    return {
      ...(centroDeCusto.trim() ? { cost_center: centroDeCusto.trim() } : {}),
      ...(cidade.trim() ? { city: cidade.trim() } : {}),
      ...(assinaturas.length > 0 ? { signatories: assinaturas } : {}),
    };
  }

  async function baixar(formato: 'pdf' | 'xlsx') {
    const b = corpo();
    if (!b) return;
    setBaixando(formato);
    try {
      await baixarRelatorio(api.urlFor(reportsGenerate), formato, b, `relatorio-${tier}.${formato}`);
    } catch (e) {
      toast.error(formato === 'pdf' ? 'PDF não gerado' : 'Planilha não gerada', (e as Error).message);
    } finally {
      setBaixando(null);
    }
  }

  const semNada = escolhidos.filter((k) => selecionaveis.some((i) => i.key === k)).length === 0;

  function criarAutomacao() {
    const b = corpo();
    if (!b) return;
    const nomeDoCliente = (clientes?.items ?? []).find((c) => c.id === cliente)?.name;
    onCriarAutomacao(automacaoDoRelatorio(b, nomeDoCliente));
  }

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onFechar()}
      title="Gerar relatório"
      description={
        aba === 'patrimonial'
          ? 'Equipamentos ativos, em manutenção e obsoletos, com depreciação.'
          : 'Escolha o modelo, o período, o cliente e os indicadores.'
      }
      footer={
        aba === 'patrimonial' ? (
          <Button onClick={onFechar}>Fechar</Button>
        ) : (
          <>
            <Button onClick={onFechar}>Fechar</Button>
            {podeAutomatizar && (
              <Button
                icon={<CalendarClock className="size-4" />}
                disabled={Boolean(intervalo.problema) || semNada}
                onClick={criarAutomacao}
              >
                Criar automação com estes filtros
              </Button>
            )}
            <Button
              icon={<FileDown className="size-4" />}
              loading={baixando === 'pdf'}
              disabled={Boolean(intervalo.problema) || semNada}
              onClick={() => void baixar('pdf')}
            >
              Baixar PDF
            </Button>
            <Button
              icon={<FileSpreadsheet className="size-4" />}
              loading={baixando === 'xlsx'}
              disabled={Boolean(intervalo.problema) || semNada}
              onClick={() => void baixar('xlsx')}
            >
              Baixar Excel
            </Button>
            <Button
              variant="primary"
              loading={gerar.isPending}
              disabled={Boolean(intervalo.problema) || semNada}
              onClick={() => {
                const b = corpo();
                if (b)
                  gerar.mutate(
                    { body: b },
                    { onSuccess: (r) => setResultado(r as { sections: Secao[]; pending: Pendente[] }) }
                  );
              }}
            >
              Ver relatório
            </Button>
          </>
        )
      }
    >
      {vePatrimonio && (
        <Tabs
          aria-label="Tipo de relatório"
          idPrefix="rel"
          className="mb-4"
          items={[
            { id: 'indicadores', label: 'Indicadores' },
            { id: 'patrimonial', label: 'Patrimonial' },
          ]}
          value={aba}
          onChange={(id) => setAba(id as 'indicadores' | 'patrimonial')}
        />
      )}
      {aba === 'patrimonial' ? (
        <div role="tabpanel" id="rel-painel-patrimonial" aria-labelledby="rel-aba-patrimonial">
          <PainelPatrimonial clientes={clientes?.items ?? []} clienteInicial={cliente} />
        </div>
      ) : (
        <div
          className="flex flex-col gap-4"
          {...(vePatrimonio
            ? { role: 'tabpanel', id: 'rel-painel-indicadores', 'aria-labelledby': 'rel-aba-indicadores' }
            : {})}
        >
          <p
            role="note"
            className={cn(
              'rounded-control px-3 py-2 text-xs',
              tier === 'expert' ? 'bg-warn-soft text-warn-text' : 'bg-accent-soft text-text'
            )}
          >
            {AVISO_DO_LAYOUT[tier]} Também em Excel (.xlsx), com os mesmos números.
          </p>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text">1. Modelo de relatório</legend>
            <div role="radiogroup" aria-label="Modelo de relatório" className="grid gap-2 sm:grid-cols-3">
              {(['basic', 'advanced', 'expert'] as const).map((t) => (
                <label
                  key={t}
                  className={cn(
                    'flex min-h-12 cursor-pointer flex-col gap-0.5 rounded-control border p-3 text-sm',
                    tier === t ? 'border-accent bg-accent-soft' : 'border-border-subtle'
                  )}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <input
                      type="radio"
                      name="tier"
                      checked={tier === t}
                      onChange={() => {
                        setTier(t);
                        setMarcados(null);
                        setResultado(null);
                      }}
                    />
                    {NOMES[t]}
                  </span>
                  <span className="text-xs text-muted">
                    {t === 'expert' ? descricaoDoExpert(catalogo?.indicators ?? []) : DESCRICAO[t]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text">2. Período e cliente</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Período">
                <Select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
                  {PERIODOS.map((p) => (
                    <option key={p.valor} value={p.valor}>
                      Últimos {p.rotulo}
                    </option>
                  ))}
                  <option value="custom">Personalizado</option>
                </Select>
              </Field>
              <Field label="Cliente">
                <Select
                  value={cliente}
                  onChange={(e) => {
                    setCliente(e.target.value);
                    setContrato('');
                    // Setor é sempre DE um cliente.
                    setSetor('');
                  }}
                >
                  <option value="">Todos os clientes</option>
                  {(clientes?.items ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Setor" hint="Recorta OS, SLA, avaliações e planos pela área do setor">
                <Select value={setor} onChange={(e) => setSetor(e.target.value)}>
                  <option value="">Todos os setores</option>
                  {setores.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {periodo === 'custom' && (
                <>
                  <Field label="De">
                    <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
                  </Field>
                  <Field label="Até">
                    <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
                  </Field>
                </>
              )}
              {veContratos && cliente !== '' && (contratos?.items.length ?? 0) > 0 && (
                <Field label="Contrato" hint="Escolhe a meta do contrato; os números seguem o cliente">
                  <Select value={contrato} onChange={(e) => setContrato(e.target.value)}>
                    <option value="">Sem contrato específico</option>
                    {(contratos?.items ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.number}
                        {c.title ? ` — ${c.title}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            {intervalo.problema && <p className="mt-2 text-sm text-bad-text">{intervalo.problema}</p>}
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text">
              3. Indicadores do modelo {NOMES[tier]}
            </legend>
            <ul className="grid gap-1 sm:grid-cols-2">
              {selecionaveis.map((i) => (
                <li key={i.key}>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={escolhidos.includes(i.key)}
                      onChange={(e) =>
                        setMarcados(
                          e.target.checked ? [...escolhidos, i.key] : escolhidos.filter((k) => k !== i.key)
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">{i.label}</span>
                    {i.state === 'PROVISIONAL' && (
                      <StatusChip size="sm" tone="warn" hint={i.note}>
                        Provisório
                      </StatusChip>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            {pendentes.length > 0 && (
              <details className="mt-2 rounded-control border border-border-subtle px-3 py-2">
                <summary className="cursor-pointer text-sm text-muted">
                  {pendentes.length} indicador(es) do modelo aguardando definição — fora do relatório
                </summary>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {pendentes.map((i) => (
                    <li key={i.key} className="text-xs text-muted">
                      <span className="font-medium text-text">{i.label}</span>
                      {i.note ? ` — ${i.note}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tipo de manutenção" hint="Das ordens de serviço">
              <Select value={tipoManutencao} onChange={(e) => setTipoManutencao(e.target.value)}>
                <option value="">Todos os tipos</option>
                {tiposDeManutencao.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo de plano (conformidades)">
              <Select value={tipoPlano} onChange={(e) => setTipoPlano(e.target.value)}>
                {TIPOS_DE_PLANO.map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Família / tipo de equipamento">
              <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">Todos</option>
                {grupos.familias.map((g) => (
                  <optgroup key={g.familia.id} label={g.familia.name}>
                    <option value={g.familia.id}>{g.familia.name} (família inteira)</option>
                    {g.tipos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {grupos.soltas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {tier !== 'expert' && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-text">
                4. Cabeçalho e assinaturas do PDF Relatório {NOMES[tier]}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Centro de custo" hint="Opcional; sai no cabeçalho">
                  <Input
                    value={centroDeCusto}
                    maxLength={60}
                    onChange={(e) => setCentroDeCusto(e.target.value)}
                  />
                </Field>
                <Field label="Cidade" hint="Opcional; sai antes da data">
                  <Input value={cidade} maxLength={60} onChange={(e) => setCidade(e.target.value)} />
                </Field>
                {(
                  [
                    ['Assinatura 1', assinante1, setAssinante1],
                    ['Assinatura 2', assinante2, setAssinante2],
                  ] as const
                ).map(([rotulo, valor, alterar]) => (
                  <div key={rotulo} className="flex flex-col gap-2">
                    <Field label={`${rotulo}: nome`} hint="Em branco, sai só a linha">
                      <Input
                        value={valor.nome}
                        maxLength={80}
                        onChange={(e) => alterar({ ...valor, nome: e.target.value })}
                      />
                    </Field>
                    <Field label={`${rotulo}: cargo`}>
                      <Input
                        value={valor.cargo}
                        maxLength={80}
                        onChange={(e) => alterar({ ...valor, cargo: e.target.value })}
                      />
                    </Field>
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          {resultado && (
            <section
              aria-label="Prévia do relatório"
              className="flex flex-col divide-y divide-border-subtle rounded-control border border-border-subtle"
            >
              {resultado.sections.map((s) => (
                <div key={s.key} className="flex flex-col gap-0.5 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm text-text">
                      {s.label}
                      {s.state === 'PROVISIONAL' && (
                        <StatusChip size="sm" tone="warn" hint={s.note ?? undefined}>
                          Provisório
                        </StatusChip>
                      )}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{valorDe(s)}</span>
                  </div>
                  <MetaDaSecao s={s} />
                  {s.definition && <span className="text-xs text-muted">{s.definition}</span>}
                </div>
              ))}
              {resultado.sections.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted">Nenhum indicador selecionado.</p>
              )}
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}
