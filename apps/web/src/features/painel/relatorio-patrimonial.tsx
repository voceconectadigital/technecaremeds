/**
 * Aurora — aba "Patrimonial" do diálogo "Gerar relatório" (REL-11, WhatsApp 19/10/2026: "opção
 * de relatório patrimonial, com opção de ativos, em manutenção e obsoletos").
 *
 * Filtro de cliente (só os do escopo de quem pede — a lista de clientes já vem recortada) e de
 * situação. O servidor decide o que é "ativo", "em manutenção" e "obsoleto" a partir da situação
 * cadastrada, e decide também se o valor do bem aparece: sem `asset.read_financials`, os valores
 * nem chegam ao navegador, e a tela diz isso em vez de mostrar R$ 0,00.
 */
import { useState } from 'react';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { Button, Field, Select, StatStrip, StatusChip, useToast } from '@aurora/ui';
import { reportsAssets } from '@aurora/contracts';
import { ApiError, useApi, useApiMutation } from '@aurora/app-kit';
import { baixarRelatorio } from './baixar';
import { ROTULO_STATUS_ATIVO } from './rotulos';

type Situacao = 'all' | 'active' | 'maintenance' | 'obsolete';
const SITUACOES: [Situacao, string][] = [
  ['all', 'Todos'],
  ['active', 'Ativos'],
  ['maintenance', 'Em manutenção'],
  ['obsolete', 'Obsoletos'],
];

type Item = {
  id: string;
  name: string;
  tag: string | null;
  customer_name: string;
  location_name: string | null;
  status: string;
  acquired_at: string | null;
  percent_depreciated: number | null;
  obsolescence_report: string | null;
  currency: string | null;
  purchase_value: number | null;
  book_value: number | null;
};
type Resultado = {
  counts: { active: number; maintenance: number; obsolete: number; total: number };
  financials_visible: boolean;
  totals: { currency: string; purchase_value: number; book_value: number; assets_with_value: number }[];
  assets_without_value: number | null;
  items_truncated: boolean;
  items: Item[];
};

export function dinheiro(v: number, moeda: string): string {
  try {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: moeda });
  } catch {
    return `${moeda} ${v.toFixed(2)}`;
  }
}

const dia = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');

export function PainelPatrimonial({
  clientes,
  clienteInicial,
}: {
  clientes: { id: string; name: string }[];
  clienteInicial: string;
}) {
  const toast = useToast();
  const api = useApi();
  const [cliente, setCliente] = useState(clienteInicial);
  const [situacao, setSituacao] = useState<Situacao>('all');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [baixando, setBaixando] = useState<'pdf' | 'xlsx' | null>(null);
  const gerar = useApiMutation(reportsAssets, {
    onError: (e: ApiError) => toast.error('Relatório não gerado', e.problem.message),
  });

  const corpo = () => ({ ...(cliente ? { customer_id: cliente } : {}), situation: situacao });

  async function baixar(formato: 'pdf' | 'xlsx') {
    setBaixando(formato);
    try {
      await baixarRelatorio(api.urlFor(reportsAssets), formato, corpo(), `relatorio-patrimonial.${formato}`);
    } catch (e) {
      toast.error(formato === 'pdf' ? 'PDF não gerado' : 'Planilha não gerada', (e as Error).message);
    } finally {
      setBaixando(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">
        Inventário de equipamentos do seu escopo, com depreciação em linha reta. Ativos: em operação, reserva
        ou emprestados. Em manutenção: situação cadastrada. Obsoletos: baixados ou descartados (com o laudo
        OBC quando a baixa veio dele).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cliente">
          <Select
            value={cliente}
            onChange={(e) => {
              setCliente(e.target.value);
              setResultado(null);
            }}
          >
            <option value="">Todos os clientes</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Situação">
          <Select
            value={situacao}
            onChange={(e) => {
              setSituacao(e.target.value as Situacao);
              setResultado(null);
            }}
          >
            {SITUACOES.map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          icon={<FileDown className="size-4" />}
          loading={baixando === 'pdf'}
          onClick={() => void baixar('pdf')}
        >
          Baixar PDF
        </Button>
        <Button
          icon={<FileSpreadsheet className="size-4" />}
          loading={baixando === 'xlsx'}
          onClick={() => void baixar('xlsx')}
        >
          Baixar Excel
        </Button>
        <Button
          variant="primary"
          loading={gerar.isPending}
          onClick={() =>
            gerar.mutate({ body: corpo() }, { onSuccess: (r) => setResultado(r as unknown as Resultado) })
          }
        >
          Ver relatório
        </Button>
      </div>

      {resultado && (
        <section aria-label="Prévia do relatório patrimonial" className="flex flex-col gap-3">
          <StatStrip
            items={[
              { label: 'Equipamentos', value: resultado.counts.total },
              { label: 'Ativos', value: resultado.counts.active, tone: 'good' },
              { label: 'Em manutenção', value: resultado.counts.maintenance, tone: 'warn' },
              { label: 'Obsoletos', value: resultado.counts.obsolete, tone: 'bad' },
            ]}
          />
          {resultado.financials_visible ? (
            <div className="flex flex-col gap-1 rounded-control border border-border-subtle px-3 py-2 text-sm">
              {resultado.totals.length === 0 && (
                <span className="text-muted">Nenhum bem com valor de compra informado.</span>
              )}
              {resultado.totals.map((t) => (
                <span key={t.currency} className="tabular-nums">
                  Valor de aquisição: <strong>{dinheiro(t.purchase_value, t.currency)}</strong> · Valor
                  contábil atual: <strong>{dinheiro(t.book_value, t.currency)}</strong>
                  <span className="text-xs text-muted"> ({t.assets_with_value} bem(ns) com valor)</span>
                </span>
              ))}
              {(resultado.assets_without_value ?? 0) > 0 && (
                <span className="text-xs text-muted">
                  {resultado.assets_without_value} bem(ns) sem valor de compra informado, fora das somas.
                </span>
              )}
            </div>
          ) : (
            <p role="note" className="text-xs text-muted">
              Valores do patrimônio (compra, valor contábil e totais) exigem a permissão financeira.
            </p>
          )}
          <div className="overflow-x-auto rounded-control border border-border-subtle">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-sunken text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Equipamento</th>
                  <th className="px-2 py-1.5 font-medium">Cliente / setor</th>
                  <th className="px-2 py-1.5 font-medium">Situação</th>
                  <th className="px-2 py-1.5 font-medium">Aquisição</th>
                  <th className="px-2 py-1.5 text-right font-medium">Depreciado</th>
                  {resultado.financials_visible && (
                    <>
                      <th className="px-2 py-1.5 text-right font-medium">Valor de aquisição</th>
                      <th className="px-2 py-1.5 text-right font-medium">Valor contábil</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {resultado.items.map((a) => (
                  <tr key={a.id}>
                    <td className="px-2 py-1.5">
                      {a.name}
                      {a.tag ? <span className="text-muted"> · {a.tag}</span> : null}
                    </td>
                    <td className="px-2 py-1.5">
                      {a.customer_name}
                      {a.location_name ? ` / ${a.location_name}` : ''}
                    </td>
                    <td className="px-2 py-1.5">
                      <StatusChip
                        size="sm"
                        tone={
                          a.status === 'under_maintenance'
                            ? 'warn'
                            : a.status === 'decommissioned' || a.status === 'disposed'
                              ? 'neutral'
                              : 'good'
                        }
                      >
                        {ROTULO_STATUS_ATIVO[a.status] ?? a.status}
                      </StatusChip>
                      {a.obsolescence_report && (
                        <span className="ml-1 text-muted">{a.obsolescence_report}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{dia(a.acquired_at)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {a.percent_depreciated === null
                        ? '—'
                        : `${a.percent_depreciated.toLocaleString('pt-BR')}%`}
                    </td>
                    {resultado.financials_visible && (
                      <>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {a.purchase_value === null ? '—' : dinheiro(a.purchase_value, a.currency ?? 'BRL')}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {a.book_value === null ? '—' : dinheiro(a.book_value, a.currency ?? 'BRL')}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {resultado.items.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted">Nenhum equipamento nesta situação.</p>
            )}
          </div>
          {resultado.items_truncated && (
            <p className="text-xs text-muted">
              A tela mostra os primeiros {resultado.items.length} equipamentos; o PDF e o Excel trazem todos.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
