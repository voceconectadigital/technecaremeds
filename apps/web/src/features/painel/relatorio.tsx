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
 * CONFIGURADA. O PDF é provisório: o layout oficial está AGUARDANDO MODELO PDF
 * OFICIAL.
 */
import { useMemo, useState } from 'react';
import { FileDown, FileText } from 'lucide-react';
import { Button, Dialog, Field, Input, Select, StatusChip, cn, useToast } from '@aurora/ui';
import {
  assetsFormOptions,
  contractsList,
  customersList,
  reportsCatalog,
  reportsGenerate,
} from '@aurora/contracts';
import {
  ApiError,
  lerSessaoGuardada,
  useApi,
  useApiMutation,
  useApiQuery,
  usePermissions,
} from '@aurora/app-kit';
import { intervaloDoPainel, type FiltrosDoPainel } from './dados';
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
const DESCRICAO: Record<Tier, string> = {
  basic: 'Chamados, conformidades de planos e avaliação da qualidade.',
  advanced: 'Basic + SLA, evolução dos chamados, backlog, OS por situação e abertos × encerrados.',
  expert: 'Conjunto contratual do FHEMIG (IMR). Não herda o Basic nem o Advanced.',
};

const ROTULO_PDF: Record<Tier, string> = {
  basic: 'Baixar PDF (provisório)',
  advanced: 'Baixar PDF (modelo Completo)',
  expert: 'Baixar PDF (IMR)',
};
const AVISO_DO_LAYOUT: Record<Tier, string> = {
  basic: 'Layout final: AGUARDANDO MODELO PDF OFICIAL.',
  advanced:
    'O PDF segue o modelo Completo do cliente, com gráfico de 12 meses e linha da meta. Indicador provisório sai marcado.',
  expert:
    'O PDF é a casca do IMR: só os itens com definição têm resultado. Desconto, glosa e faturamento não são calculados — a regra do IMR ainda não foi definida pelo cliente.',
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

export function BotaoGerarRelatorio({ f }: { f: FiltrosDoPainel }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button icon={<FileText className="size-4" />} onClick={() => setAberto(true)}>
        Gerar relatório
      </Button>
      {aberto && <DialogoRelatorio f={f} onFechar={() => setAberto(false)} />}
    </>
  );
}

function DialogoRelatorio({ f, onFechar }: { f: FiltrosDoPainel; onFechar: () => void }) {
  const toast = useToast();
  const api = useApi();
  const { can } = usePermissions();
  const [tier, setTier] = useState<Tier>('basic');
  const [marcados, setMarcados] = useState<string[] | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>(f.periodo);
  const [de, setDe] = useState(f.de);
  const [ate, setAte] = useState(f.ate);
  const [cliente, setCliente] = useState(f.cliente);
  const [contrato, setContrato] = useState('');
  const [tipoPlano, setTipoPlano] = useState('');
  const [categoria, setCategoria] = useState('');
  // Cabeçalho e assinaturas do PDF Completo (Advanced); não são dados do sistema.
  const [centroDeCusto, setCentroDeCusto] = useState('');
  const [cidade, setCidade] = useState('');
  const [assinante1, setAssinante1] = useState({ nome: '', cargo: '' });
  const [assinante2, setAssinante2] = useState({ nome: '', cargo: '' });
  const [resultado, setResultado] = useState<{ sections: Secao[]; pending: Pendente[] } | null>(null);
  const [baixando, setBaixando] = useState(false);

  const { data: catalogo } = useApiQuery(reportsCatalog) as {
    data: { indicators: Indicador[]; layout_note: string } | undefined;
  };
  const { data: opcoes } = useApiQuery(assetsFormOptions) as {
    data: { categories: { id: string; name: string; family_key?: string | null }[] } | undefined;
  };
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
  const setorValido = cliente === f.cliente && f.setor !== '';

  function corpo() {
    if (intervalo.problema !== null) return null;
    return {
      tier,
      indicators: escolhidos.filter((k) => selecionaveis.some((i) => i.key === k)),
      from: intervalo.from,
      to: intervalo.to,
      ...(cliente ? { customer_id: cliente } : {}),
      ...(contrato ? { contract_id: contrato } : {}),
      ...(setorValido ? { sector_id: f.setor } : {}),
      ...(tipoPlano ? { plan_kind: tipoPlano as 'preventive' } : {}),
      ...(categoria ? { asset_category_id: categoria } : {}),
      ...(tier === 'advanced' ? cabecalhoDoCompleto() : {}),
    };
  }

  function cabecalhoDoCompleto() {
    const assinaturas = [assinante1, assinante2]
      .filter((a) => a.cargo.trim() !== '')
      .map((a) => ({ name: a.nome.trim(), role: a.cargo.trim() }));
    return {
      ...(centroDeCusto.trim() ? { cost_center: centroDeCusto.trim() } : {}),
      ...(cidade.trim() ? { city: cidade.trim() } : {}),
      ...(assinaturas.length > 0 ? { signatories: assinaturas } : {}),
    };
  }

  async function baixarPdf() {
    const b = corpo();
    if (!b) return;
    setBaixando(true);
    try {
      const { token, organizationId } = lerSessaoGuardada();
      const resp = await fetch(`${api.urlFor(reportsGenerate)}?format=pdf`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token ?? ''}`,
          ...(organizationId ? { 'x-aurora-organization': organizationId } : {}),
        },
        body: JSON.stringify(b),
      });
      if (!resp.ok) throw new Error(`o servidor respondeu ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-${tier}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('PDF não gerado', (e as Error).message);
    } finally {
      setBaixando(false);
    }
  }

  const semNada = escolhidos.filter((k) => selecionaveis.some((i) => i.key === k)).length === 0;

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onFechar()}
      title="Gerar relatório"
      description="Escolha o modelo, o período, o cliente e os indicadores."
      footer={
        <>
          <Button onClick={onFechar}>Fechar</Button>
          <Button
            icon={<FileDown className="size-4" />}
            loading={baixando}
            disabled={Boolean(intervalo.problema) || semNada}
            onClick={() => void baixarPdf()}
          >
            {ROTULO_PDF[tier]}
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
      }
    >
      <div className="flex flex-col gap-4">
        <p role="note" className="rounded-control bg-warn-soft px-3 py-2 text-xs text-warn-text">
          {AVISO_DO_LAYOUT[tier]}
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
                <span className="text-xs text-muted">{DESCRICAO[t]}</span>
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

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo de plano (conformidades)">
            <Select value={tipoPlano} onChange={(e) => setTipoPlano(e.target.value)}>
              {TIPOS_DE_PLANO.map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Categoria de equipamento">
            <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Todas</option>
              {(opcoes?.categories ?? [])
                .filter((c) => !c.family_key)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        {tier === 'advanced' && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text">
              4. Cabeçalho e assinaturas do PDF Completo
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
    </Dialog>
  );
}
