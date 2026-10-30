/**
 * Aurora — o relatório PATRIMONIAL em PDF e em Excel (REL-11, WhatsApp 19/10/2026).
 *
 * Os números vêm prontos de `buildAssetReport` (`@aurora/db`): contagens, depreciação e totais.
 * Aqui só se desenha. O PDF segue o padrão dos relatórios Basic e Advanced: cabeçalho, painel de
 * cartões e a tabela; a planilha traz o recorte inteiro, com valor como número e data como data.
 *
 * Sem `asset.read_financials`, os valores já chegam nulos (a consulta nem os leu): as colunas de
 * dinheiro saem do PDF e da planilha, e o cartão diz que a informação exige a permissão.
 */
import {
  ASSET_REPORT_SITUATION_LABELS,
  ASSET_REPORT_SITUATION_NOTE,
  ASSET_STATUS_LABELS,
  dayOf,
} from '@aurora/domain';
import type { AssetReport } from '@aurora/db';
import { MARCA_DO_PRODUTO } from '@aurora/config';
import type { CartaoPdf, LinhaPdf } from '../documents/pdf';
import type { AbaXlsx, CelulaXlsx } from '../documents/xlsx';

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Linhas da tabela do PDF. Acima disso, o PDF avisa e manda para o Excel (que traz tudo). */
export const MAX_LINHAS_NO_PDF = 3000;

export const NOTA_DA_DEPRECIACAO =
  'Depreciação em linha reta a partir da data de aquisição: (valor de compra − valor residual) ÷ vida útil. ' +
  'Bem sem data de aquisição ou sem vida útil fica sem depreciação; bem sem valor de compra fica fora das somas.';

export function dinheiro(v: number, moeda: string): string {
  try {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: moeda });
  } catch {
    return `${moeda} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

const diaCurto = (dia: string | null) =>
  dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : '—';
const percentual = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export interface DadosPatrimonial {
  organizacao: string;
  relatorio: AssetReport;
  geradoEm: Date;
  fuso: string;
}

export function montarPatrimonial(d: DadosPatrimonial): { linhas: LinhaPdf[]; rodape: string } {
  const r = d.relatorio;
  const local = r.filters.customer ?? 'Todos os clientes do escopo';
  const situacao = ASSET_REPORT_SITUATION_LABELS[r.filters.situation];
  const hoje = dayOf(d.geradoEm, d.fuso);
  const emissao = `${Number(hoje.slice(8, 10))} de ${MESES[Number(hoje.slice(5, 7)) - 1]} de ${hoje.slice(0, 4)}`;
  const parte = (n: number) => (r.counts.total > 0 ? (n / r.counts.total) * 100 : 0);

  const cartoes: CartaoPdf[] = [
    {
      rotulo: 'Equipamentos no relatório',
      valor: String(r.counts.total),
      detalhe: `Situação: ${situacao}`,
      tom: 'neutro',
    },
    {
      rotulo: 'Ativos (em operação, reserva ou emprestados)',
      valor: String(r.counts.active),
      detalhe: `${percentual(parte(r.counts.active))} do total`,
      tom: 'bom',
      barra: { valor: parte(r.counts.active), meta: null },
    },
    {
      rotulo: 'Em manutenção',
      valor: String(r.counts.maintenance),
      detalhe: `${percentual(parte(r.counts.maintenance))} do total`,
      tom: 'aviso',
      barra: { valor: parte(r.counts.maintenance), meta: null },
    },
    {
      rotulo: 'Obsoletos (baixados ou descartados)',
      valor: String(r.counts.obsolete),
      detalhe: `${percentual(parte(r.counts.obsolete))} do total`,
      tom: 'ruim',
      barra: { valor: parte(r.counts.obsolete), meta: null },
    },
  ];
  if (r.financials_visible) {
    if (r.totals.length === 0) {
      cartoes.push({
        rotulo: 'Valor de aquisição',
        valor: '—',
        detalhe: 'Nenhum bem com valor de compra informado',
        tom: 'neutro',
      });
    }
    for (const t of r.totals) {
      cartoes.push({
        rotulo: `Valor de aquisição (${t.currency})`,
        valor: dinheiro(t.purchase_value, t.currency),
        detalhe: `${t.assets_with_value} bem(ns) com valor informado`,
        tom: 'neutro',
      });
      cartoes.push({
        rotulo: `Valor contábil atual (${t.currency})`,
        valor: dinheiro(t.book_value, t.currency),
        detalhe:
          t.assets_without_depreciation > 0
            ? `${t.assets_without_depreciation} bem(ns) sem data ou vida útil, fora da soma`
            : 'Depreciação em linha reta',
        tom: 'neutro',
        ...(t.purchase_value > 0
          ? { barra: { valor: (t.book_value / t.purchase_value) * 100, meta: null } }
          : {}),
      });
    }
  } else {
    cartoes.push({
      rotulo: 'Valores do patrimônio',
      valor: '—',
      detalhe: 'Exige a permissão financeira',
      tom: 'neutro',
    });
  }

  const linhas: LinhaPdf[] = [
    { texto: d.organizacao.toUpperCase(), tamanho: 8, negrito: true },
    { texto: 'Relatório Patrimonial', titulo: true, tamanho: 18, espacoAntes: 2 },
    { texto: 'Inventário de equipamentos por situação, com depreciação em linha reta', tamanho: 10 },
    { texto: `${local} · Situação: ${situacao}`, negrito: true, espacoAntes: 8 },
    {
      texto: `Emitido em ${emissao}. Fonte: cadastro de equipamentos do sistema ${MARCA_DO_PRODUTO.produto}.`,
      tamanho: 8,
    },
    { texto: 'Resumo', titulo: true, espacoAntes: 14 },
    { texto: '', cartoes, espacoAntes: 4 },
    { texto: ASSET_REPORT_SITUATION_NOTE, tamanho: 7 },
    { texto: NOTA_DA_DEPRECIACAO, tamanho: 7 },
  ];
  if (r.financials_visible && r.assets_without_value) {
    linhas.push({
      texto: `${r.assets_without_value} bem(ns) sem valor de compra informado: fora das somas.`,
      tamanho: 7,
    });
  }

  linhas.push({ texto: 'Equipamentos', titulo: true, espacoAntes: 14 });
  if (r.items.length === 0) {
    linhas.push({ texto: 'Nenhum equipamento nesta situação, no escopo e no cliente escolhidos.' });
  } else {
    const visiveis = r.items.slice(0, MAX_LINHAS_NO_PDF);
    if (r.items.length > visiveis.length) {
      linhas.push({
        texto: `O PDF traz os primeiros ${MAX_LINHAS_NO_PDF} de ${r.items.length} equipamentos; a planilha Excel traz todos. As contagens e os totais acima são do recorte inteiro.`,
        tamanho: 8,
      });
    }
    // Cabeçalho em negrito: a palavra mais longa de cada título cabe na coluna (inspeção dos PDFs,
    // 29/10/2026 — "Depreciado" com peso 0.9 estourava a largura).
    const colunas = [
      { titulo: 'Equipamento', peso: 2.2 },
      { titulo: 'Cliente / setor', peso: 1.9 },
      { titulo: 'Situação', peso: 1.4 },
      { titulo: 'Aquisição', peso: 1.2, alinhar: 'c' as const },
      { titulo: 'Vida útil', peso: 0.8, alinhar: 'c' as const },
      { titulo: 'Depreciado', peso: 1.3, alinhar: 'c' as const },
      ...(r.financials_visible
        ? [
            { titulo: 'Valor de aquisição', peso: 1.3, alinhar: 'c' as const },
            { titulo: 'Valor contábil', peso: 1.3, alinhar: 'c' as const },
          ]
        : []),
    ];
    linhas.push({
      texto: '',
      tabela: {
        colunas,
        tamanho: 7,
        linhas: visiveis.map((a) => {
          const ident = [a.tag, a.serial_number ? `série ${a.serial_number}` : null]
            .filter(Boolean)
            .join(' · ');
          const situ = `${ASSET_STATUS_LABELS[a.status]}${a.obsolescence_report ? ` (laudo ${a.obsolescence_report})` : ''}`;
          const base = [
            ident ? `${a.name} — ${ident}` : a.name,
            a.location_name ? `${a.customer_name} / ${a.location_name}` : a.customer_name,
            situ,
            diaCurto(a.acquired_at),
            a.useful_life_years === null ? '—' : `${a.useful_life_years} anos`,
            a.percent_depreciated === null ? '—' : percentual(a.percent_depreciated),
          ];
          if (!r.financials_visible) return base;
          const moeda = a.currency ?? 'BRL';
          return [
            ...base,
            a.purchase_value === null ? '—' : dinheiro(a.purchase_value, moeda),
            a.book_value === null ? '—' : dinheiro(a.book_value, moeda),
          ];
        }),
      },
    });
  }
  return { linhas, rodape: `Relatório Patrimonial — ${local} — ${situacao}` };
}

export function abasDoPatrimonial(d: DadosPatrimonial): AbaXlsx[] {
  const r = d.relatorio;
  const fin = r.financials_visible;
  const moedaCel = (v: number | null, moeda: string | null): CelulaXlsx =>
    v === null ? null : { numero: v, formato: (moeda ?? 'BRL') === 'BRL' ? 'moeda' : 'decimal' };

  const patrimonio: AbaXlsx = {
    nome: 'Patrimônio',
    colunas: [
      { titulo: 'Equipamento', largura: 36 },
      { titulo: 'Tag', largura: 14 },
      { titulo: 'Nº de série', largura: 18 },
      { titulo: 'Nº de patrimônio', largura: 16 },
      { titulo: 'Cliente', largura: 28 },
      { titulo: 'Setor', largura: 22 },
      { titulo: 'Categoria', largura: 22 },
      { titulo: 'Fabricante', largura: 18 },
      { titulo: 'Modelo', largura: 18 },
      { titulo: 'Situação no relatório', largura: 18 },
      { titulo: 'Situação cadastrada', largura: 18 },
      { titulo: 'Data de aquisição', largura: 14 },
      { titulo: 'Vida útil (anos)', largura: 12 },
      { titulo: '% depreciado', largura: 12 },
      { titulo: 'Baixado em', largura: 14 },
      { titulo: 'Motivo da baixa', largura: 40 },
      { titulo: 'Laudo de obsolescência', largura: 18 },
      ...(fin
        ? [
            { titulo: 'Moeda', largura: 8 },
            { titulo: 'NF de aquisição', largura: 16 },
            { titulo: 'Valor de aquisição', largura: 16 },
            { titulo: 'Valor residual', largura: 14 },
            { titulo: 'Depreciação acumulada', largura: 18 },
            { titulo: 'Valor contábil', largura: 16 },
          ]
        : []),
    ],
    linhas: r.items.map((a): CelulaXlsx[] => [
      a.name,
      a.tag,
      a.serial_number,
      a.asset_number,
      a.customer_name,
      a.location_name,
      a.category_name,
      a.manufacturer_name,
      a.model_name,
      ASSET_REPORT_SITUATION_LABELS[a.situation],
      ASSET_STATUS_LABELS[a.status],
      a.acquired_at ? { dia: a.acquired_at } : null,
      a.useful_life_years === null ? null : { numero: a.useful_life_years, formato: 'inteiro' },
      a.percent_depreciated === null ? null : { numero: a.percent_depreciated, formato: 'percentual' },
      a.decommissioned_at ? { dia: dayOf(new Date(a.decommissioned_at), d.fuso) } : null,
      a.decommission_reason,
      a.obsolescence_report,
      ...(fin
        ? [
            a.currency,
            a.acquisition_invoice,
            moedaCel(a.purchase_value, a.currency),
            moedaCel(a.residual_value, a.currency),
            moedaCel(a.accumulated_depreciation, a.currency),
            moedaCel(a.book_value, a.currency),
          ]
        : []),
    ]),
  };

  const inteiro = (n: number): CelulaXlsx => ({ numero: n, formato: 'inteiro' });
  const resumo: CelulaXlsx[][] = [
    ['Equipamentos no relatório', inteiro(r.counts.total)],
    ['Ativos (em operação, reserva ou emprestados)', inteiro(r.counts.active)],
    ['Em manutenção', inteiro(r.counts.maintenance)],
    ['Obsoletos (baixados ou descartados)', inteiro(r.counts.obsolete)],
    ...Object.entries(r.by_status).map(([k, n]): CelulaXlsx[] => [
      `Situação cadastrada: ${ASSET_STATUS_LABELS[k as keyof typeof ASSET_STATUS_LABELS] ?? k}`,
      inteiro(n ?? 0),
    ]),
  ];
  if (fin) {
    for (const t of r.totals) {
      resumo.push([`Valor de aquisição (${t.currency})`, moedaCel(t.purchase_value, t.currency)]);
      resumo.push([`Valor contábil atual (${t.currency})`, moedaCel(t.book_value, t.currency)]);
      resumo.push([`Bens com valor informado (${t.currency})`, inteiro(t.assets_with_value)]);
      resumo.push([`Bens sem data ou vida útil (${t.currency})`, inteiro(t.assets_without_depreciation)]);
    }
    resumo.push(['Bens sem valor de compra (fora das somas)', inteiro(r.assets_without_value ?? 0)]);
  } else {
    resumo.push(['Valores do patrimônio', 'Exige a permissão financeira (asset.read_financials)']);
  }

  return [
    patrimonio,
    {
      nome: 'Resumo',
      colunas: [
        { titulo: 'Item', largura: 48 },
        { titulo: 'Valor', largura: 20 },
      ],
      linhas: resumo,
    },
    {
      nome: 'Filtros',
      colunas: [
        { titulo: 'Filtro', largura: 28 },
        { titulo: 'Valor', largura: 60 },
      ],
      linhas: [
        ['Relatório', 'Patrimonial'],
        ['Cliente', r.filters.customer ?? 'Todos os clientes do escopo'],
        ['Situação', ASSET_REPORT_SITUATION_LABELS[r.filters.situation]],
        ['Critério das situações', ASSET_REPORT_SITUATION_NOTE],
        ['Depreciação', NOTA_DA_DEPRECIACAO],
        ['Fuso horário', d.fuso],
        ['Prestadora', d.organizacao],
        ['Gerado em', { instante: d.geradoEm, fuso: d.fuso }],
      ],
    },
  ];
}
