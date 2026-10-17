/**
 * Aurora — "Gerar relatório" do Painel (reunião 16/10/2026, Fase 9 — fundação).
 *
 * Modelo BASIC, ADVANCED ou EXPERT (nível de RELATÓRIO, não de contrato),
 * seleção de indicadores e os filtros aplicáveis. Os números vêm das MESMAS
 * funções do Painel, com o mesmo recorte de quem pede.
 *
 * O que ainda não tem fórmula ou definição aparece marcado, sem número. O PDF é
 * provisório: o layout oficial dos três modelos está AGUARDANDO MODELO PDF
 * OFICIAL, e será refinado em rodada dedicada com os PDFs do cliente.
 */
import { useMemo, useState } from 'react';
import { FileDown, FileText } from 'lucide-react';
import { Button, Dialog, Field, Select, StatusChip, cn, useToast } from '@aurora/ui';
import { assetsFormOptions, reportsCatalog, reportsGenerate } from '@aurora/contracts';
import { ApiError, lerSessaoGuardada, useApi, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { intervaloDoPainel, type FiltrosDoPainel } from './dados';

type Tier = 'basic' | 'advanced' | 'expert';
type Indicador = {
  key: string;
  label: string;
  tier: Tier;
  status: 'available' | 'awaiting_official_model' | 'awaiting_definition';
  note?: string;
};
type Secao = {
  key: string;
  label: string;
  status: Indicador['status'];
  note: string | null;
  value: number | null;
  unit: 'count' | 'minutes' | 'hours' | 'percent' | 'none';
  samples: number | null;
  definition: string | null;
};

const ORDEM: Record<Tier, number> = { basic: 0, advanced: 1, expert: 2 };
const DESCRICAO: Record<Tier, string> = {
  basic: 'Disponibilidade do parque, MTTR, MTBF, chamados e conformidades.',
  advanced: 'Basic + SLA, evolução dos chamados, backlog, OS por situação, obsolescência.',
  expert: 'Advanced + indicadores avançados (modelo FHEMIG e outros).',
};

const TIPOS_DE_PLANO = [
  ['', 'Todos os tipos de plano'],
  ['preventive', 'Preventiva'],
  ['calibration', 'Calibração'],
  ['electrical_safety', 'TSE'],
  ['qualification', 'Qualificação'],
] as const;

function valorDe(s: Secao): string {
  if (s.status === 'awaiting_official_model') return 'AGUARDANDO MODELO PDF OFICIAL';
  if (s.status === 'awaiting_definition') return 'Aguardando definição do cliente';
  if (s.value === null) return 'Sem dados suficientes no período';
  const v = s.value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return s.unit === 'percent'
    ? `${v} %`
    : s.unit === 'minutes'
      ? `${v} min`
      : s.unit === 'hours'
        ? `${v} h`
        : v;
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
  const [tier, setTier] = useState<Tier>('basic');
  const [marcados, setMarcados] = useState<string[] | null>(null);
  const [tipoPlano, setTipoPlano] = useState('');
  const [categoria, setCategoria] = useState('');
  const [resultado, setResultado] = useState<Secao[] | null>(null);
  const [baixando, setBaixando] = useState(false);
  const { data: catalogo } = useApiQuery(reportsCatalog) as {
    data: { indicators: Indicador[]; layout_note: string } | undefined;
  };
  const { data: opcoes } = useApiQuery(assetsFormOptions) as {
    data: { categories: { id: string; name: string; family_key?: string | null }[] } | undefined;
  };
  const gerar = useApiMutation(reportsGenerate, {
    onError: (e: ApiError) => toast.error('Relatório não gerado', e.problem.message),
  });

  const doNivel = useMemo(
    () => (catalogo?.indicators ?? []).filter((i) => ORDEM[i.tier] <= ORDEM[tier]),
    [catalogo, tier]
  );
  const escolhidos = marcados ?? doNivel.map((i) => i.key);
  const intervalo = intervaloDoPainel(f);

  function corpo() {
    if (intervalo.problema !== null) return null;
    return {
      tier,
      indicators: escolhidos.filter((k) => doNivel.some((i) => i.key === k)),
      from: intervalo.from,
      to: intervalo.to,
      ...(f.cliente ? { customer_id: f.cliente } : {}),
      ...(f.setor ? { sector_id: f.setor } : {}),
      ...(tipoPlano ? { plan_kind: tipoPlano as 'preventive' } : {}),
      ...(categoria ? { asset_category_id: categoria } : {}),
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

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onFechar()}
      title="Gerar relatório"
      description="Modelo, indicadores e filtros. Usa o período, o cliente e o setor escolhidos no Painel."
      footer={
        <>
          <Button onClick={onFechar}>Fechar</Button>
          <Button
            icon={<FileDown className="size-4" />}
            loading={baixando}
            disabled={Boolean(intervalo.problema)}
            onClick={() => void baixarPdf()}
          >
            Baixar PDF (provisório)
          </Button>
          <Button
            variant="primary"
            loading={gerar.isPending}
            disabled={Boolean(intervalo.problema)}
            onClick={() => {
              const b = corpo();
              if (b)
                gerar.mutate(
                  { body: b },
                  { onSuccess: (r) => setResultado((r as { sections: Secao[] }).sections) }
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
          Layout final: AGUARDANDO MODELO PDF OFICIAL. {catalogo?.layout_note}
        </p>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Modelo de relatório</legend>
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
                  {t === 'basic' ? 'Basic' : t === 'advanced' ? 'Advanced' : 'Expert'}
                </span>
                <span className="text-xs text-muted">{DESCRICAO[t]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Indicadores</legend>
          <ul className="grid gap-1 sm:grid-cols-2">
            {doNivel.map((i) => (
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
                  {i.status !== 'available' && (
                    <StatusChip size="sm" tone="warn" hint={i.note}>
                      {i.status === 'awaiting_official_model' ? 'Aguardando modelo' : 'Aguardando definição'}
                    </StatusChip>
                  )}
                </label>
              </li>
            ))}
          </ul>
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
        {intervalo.problema && <p className="text-sm text-bad-text">{intervalo.problema}</p>}

        {resultado && (
          <section
            aria-label="Prévia do relatório"
            className="flex flex-col divide-y divide-border-subtle rounded-control border border-border-subtle"
          >
            {resultado.map((s) => (
              <div key={s.key} className="flex flex-col gap-0.5 px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-text">{s.label}</span>
                  <span
                    className={cn(
                      'text-sm font-semibold tabular-nums',
                      s.status !== 'available' && 'text-warn-text'
                    )}
                  >
                    {valorDe(s)}
                  </span>
                </div>
                {(s.definition || s.note) && (
                  <span className="text-xs text-muted">
                    {[s.definition, s.note].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </Dialog>
  );
}
