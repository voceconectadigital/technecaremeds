/**
 * Aurora — conformidade dos planos na tela (PLN-10, PLN-11, REL-12).
 *
 * UMA CONTA SÓ. A taxa de qualquer fatia (plano, cliente, setor, tipo) é a mesma do servidor e do
 * indicador: realizados ÷ (programados − dispensados). O denominador vem ESCRITO na tela — "de
 * quanto?" é a primeira pergunta de quem vê um percentual, e a resposta muda a leitura: 50 % de 2
 * não é 50 % de 200.
 *
 * O RANKING É PELA TAXA, e não pelo volume. O plano com mais atividades não sobe por isso; empate
 * na taxa, quem tem mais atividades no denominador fica à frente.
 */
import { useEffect, useState } from 'react';
import { FileSpreadsheet, Trophy } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  FilterChip,
  SegmentGroup,
  Skeleton,
  cn,
  useToast,
} from '@aurora/ui';
import { plansComplianceReport, type ComplianceRankRow } from '@aurora/contracts';
import { useApi, useApiMutation } from '@aurora/app-kit';
import { baixarRelatorio } from '../painel/baixar';

export const DEFINICAO_DO_DENOMINADOR =
  'Conformidade = realizados ÷ (programados − dispensados). Programados são os itens de ciclo com ' +
  'vencimento no período (realizados, pendentes e vencidos); dispensados com justificativa saem ' +
  'do denominador; previstos ainda não gerados não entram.';

type Estados = { done: number; pending: number; late: number; skipped: number };

/** A taxa da fatia, em %, uma casa; nula sem denominador (nulo não é zero). */
export function taxaDeConformidade(l: Estados): number | null {
  const denominador = l.done + l.pending + l.late;
  return denominador > 0 ? Number(((l.done / denominador) * 100).toFixed(1)) : null;
}

export function formatarTaxa(v: number | null): string {
  return v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/**
 * Barras horizontais empilhadas por estado — composição de cada linha — com o PERCENTUAL e a
 * fração ao lado ("50% · 1 de 2"). Ordena pelo volume (é composição, não ranking).
 */
export function Distribuicao({
  titulo,
  linhas,
}: {
  titulo: string;
  linhas: Array<{ key: string; label: string } & Estados>;
}) {
  const ordenadas = [...linhas]
    .sort((a, b) => b.done + b.pending + b.late + b.skipped - (a.done + a.pending + a.late + a.skipped))
    .slice(0, 8);
  const max = Math.max(1, ...ordenadas.map((l) => l.done + l.pending + l.late + l.skipped));
  const partes = [
    { k: 'done' as const, cor: 'bg-good', rotulo: 'Realizados' },
    { k: 'pending' as const, cor: 'bg-info', rotulo: 'Pendentes' },
    { k: 'late' as const, cor: 'bg-bad', rotulo: 'Vencidos' },
    { k: 'skipped' as const, cor: 'bg-border-strong', rotulo: 'Dispensados' },
  ];
  return (
    <Card>
      <CardHeader title={titulo} description="Conformidade: realizados de (programados − dispensados)." />
      <div className="flex flex-col gap-2.5 px-4 pb-4">
        {ordenadas.length === 0 ? (
          <p className="text-sm text-muted">Sem atividades.</p>
        ) : (
          ordenadas.map((l) => {
            const total = l.done + l.pending + l.late + l.skipped;
            const taxa = taxaDeConformidade(l);
            return (
              <div key={l.key} className="flex flex-col gap-1" data-testid={`conformidade-${l.key}`}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate text-muted" title={l.label}>
                    {l.label}
                  </span>
                  <span className="shrink-0 text-xs text-subtle tabular-nums" data-numeric>
                    <span className="font-semibold text-text">{formatarTaxa(taxa)}</span>
                    {' · '}
                    {l.done} de {total - l.skipped}
                    {l.late > 0 && <span className="ml-1.5 text-bad-text">{l.late} venc.</span>}
                  </span>
                </div>
                <div
                  className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-sunken"
                  style={{ width: `${Math.max((total / max) * 100, 6)}%` }}
                  role="img"
                  aria-label={`${l.label}: conformidade ${formatarTaxa(taxa)}; ${partes.map((p) => `${l[p.k]} ${p.rotulo.toLowerCase()}`).join(', ')}`}
                >
                  {partes.map((p) =>
                    l[p.k] > 0 ? <span key={p.k} className={p.cor} style={{ flexGrow: l[p.k] }} /> : null
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* vários setores (PLN-11)                                                     */
/* -------------------------------------------------------------------------- */

/** O parâmetro `setor` da URL guarda vários setores separados por vírgula. */
export function setoresDaUrl(v: string): string[] {
  return v ? v.split(',').filter(Boolean) : [];
}

/** Chips de alternar: cada setor entra ou sai do filtro; "Todos" limpa. */
export function FiltroDeSetores({
  setores,
  escolhidos,
  onChange,
}: {
  setores: Array<{ id: string; name: string }>;
  escolhidos: string[];
  onChange: (ids: string[]) => void;
}) {
  if (setores.length === 0) return null;
  const alternar = (id: string) =>
    onChange(escolhidos.includes(id) ? escolhidos.filter((x) => x !== id) : [...escolhidos, id]);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Setores">
      <FilterChip active={escolhidos.length === 0} onClick={() => onChange([])}>
        Todos os setores
      </FilterChip>
      {setores.map((s) => (
        <FilterChip key={s.id} active={escolhidos.includes(s.id)} onClick={() => alternar(s.id)}>
          {s.name}
        </FilterChip>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* relatório de conformidade (REL-12)                                          */
/* -------------------------------------------------------------------------- */

type Agrupamento = 'byPlan' | 'byCustomer' | 'bySector';
const AGRUPAMENTOS: Array<[Agrupamento, string, string]> = [
  ['byPlan', 'Por plano', 'Plano'],
  ['byCustomer', 'Por cliente', 'Cliente'],
  ['bySector', 'Por setor', 'Setor'],
];

interface Relatorio {
  definition: { numerator: string; denominator: string; formula: string };
  rate: number | null;
  totals: { done: number; denominator: number };
  byPlan: ComplianceRankRow[];
  byCustomer: ComplianceRankRow[];
  bySector: ComplianceRankRow[];
}

/** A tabela do ranking — pura, para a tela e para o teste. */
export function TabelaDoRanking({ linhas, rotulo }: { linhas: ComplianceRankRow[]; rotulo: string }) {
  if (linhas.length === 0) return <p className="px-4 pb-4 text-sm text-muted">Sem atividades no período.</p>;
  return (
    <div className="overflow-x-auto px-4 pb-4">
      <table className="w-full text-sm">
        <caption className="sr-only">Ranking de conformidade — {rotulo.toLowerCase()}</caption>
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="py-1.5 pr-2 font-medium">
              #
            </th>
            <th scope="col" className="py-1.5 pr-2 font-medium">
              {rotulo}
            </th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium">
              Conformidade
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Realizados de (programados − dispensados)
            </th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.key} className="border-t border-border-subtle">
              <td className="py-1.5 pr-2 text-muted tabular-nums">{l.rate === null ? '—' : l.position}</td>
              <td className="max-w-64 truncate py-1.5 pr-2 text-text" title={l.label}>
                {l.label}
              </td>
              <td
                className={cn(
                  'py-1.5 pr-2 text-right font-semibold tabular-nums',
                  l.rate === null ? 'text-subtle' : 'text-text'
                )}
              >
                {formatarTaxa(l.rate)}
              </td>
              <td className="py-1.5 text-right text-muted tabular-nums">
                {l.done} de {l.denominator}
                {l.skipped > 0 && <span className="ml-1 text-subtle">({l.skipped} disp.)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RelatorioDeConformidade({
  filtros,
}: {
  filtros: { from: string; to: string; customer_id?: string; sector_ids?: string[]; kind?: string };
}) {
  const api = useApi();
  const toast = useToast();
  const [grupo, setGrupo] = useState<Agrupamento>('byPlan');
  const [baixando, setBaixando] = useState(false);
  const corpo = {
    from: filtros.from,
    to: filtros.to,
    ...(filtros.customer_id ? { customer_id: filtros.customer_id } : {}),
    ...(filtros.sector_ids && filtros.sector_ids.length > 0 ? { sector_ids: filtros.sector_ids } : {}),
    ...(filtros.kind ? { kind: filtros.kind } : {}),
  };
  /*
   * POST de LEITURA (os filtros vão no corpo), como o relatório oficial: a chave de cache das
   * consultas não inclui o corpo, então a geração é uma mutação disparada quando o filtro muda.
   */
  const gerar = useApiMutation(plansComplianceReport);
  const chave = JSON.stringify(corpo);
  const { mutate } = gerar;
  useEffect(() => {
    mutate({ body: JSON.parse(chave) as unknown });
  }, [chave, mutate]);
  const data = gerar.data as Relatorio | undefined;
  const isLoading = gerar.isPending;
  const atual = AGRUPAMENTOS.find(([k]) => k === grupo)!;

  async function baixar() {
    setBaixando(true);
    try {
      await baixarRelatorio(api.urlFor(plansComplianceReport), 'xlsx', corpo, 'conformidade-dos-planos.xlsx');
    } catch (e) {
      toast.error('Planilha não gerada', (e as Error).message);
    } finally {
      setBaixando(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Ranking de conformidade"
        description={DEFINICAO_DO_DENOMINADOR}
        actions={
          <Button
            size="sm"
            icon={<FileSpreadsheet className="size-4" />}
            loading={baixando}
            onClick={() => void baixar()}
          >
            Excel
          </Button>
        }
      />
      <div className="px-4 pb-3">
        <SegmentGroup label="Agrupar por">
          {AGRUPAMENTOS.map(([k, r]) => (
            <FilterChip key={k} segment active={grupo === k} onClick={() => setGrupo(k)}>
              {r}
            </FilterChip>
          ))}
        </SegmentGroup>
      </div>
      {isLoading || !data ? (
        <div className="px-4 pb-4">
          <Skeleton className="h-32 rounded-card" />
        </div>
      ) : data[grupo].length === 0 ? (
        <EmptyState icon={<Trophy className="size-5" />} title="Sem atividades no período" className="py-6" />
      ) : (
        <TabelaDoRanking linhas={data[grupo]} rotulo={atual[2]} />
      )}
    </Card>
  );
}
