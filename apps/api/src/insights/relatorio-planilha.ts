/**
 * Aurora — o relatório Basic / Advanced / Expert em Excel (REL-10, WhatsApp 19/10/2026).
 *
 * Mesmos números do JSON e do PDF (`buildReport` / `buildReportSeries`); aqui só se escolhe o
 * TIPO de cada célula, para a planilha servir de verdade: valor e meta como número (o Excel
 * soma, ordena e faz gráfico), datas como data, e o que não tem número como texto. Indicador
 * pendente sai como "Pendente de definição" — nunca como zero.
 *
 * O valor fica na unidade em que foi calculado (MTTR em minutos, como no Painel), e a coluna
 * "Unidade" diz qual. A conversão para h:mm e meses é coisa do PDF, que é para ler.
 */
import { REPORT_TIER_LABEL, dayOf, type ReportTier } from '@aurora/domain';
import type { PendingIndicator, ReportSection, ReportSeries } from '@aurora/db';
import type { AbaXlsx, CelulaXlsx } from '../documents/xlsx';
import { PENDENTE_DE_DEFINICAO } from './relatorio-oficial';

const SITUACAO: Record<string, string> = {
  ACTIVE: 'Ativo',
  PROVISIONAL: 'Provisório',
  PENDING_DEFINITION: PENDENTE_DE_DEFINICAO,
};
const UNIDADE: Record<string, string> = {
  percent: '%',
  minutes: 'minutos',
  hours: 'horas',
  score: 'nota de 1 a 5',
  count: 'quantidade',
  none: '—',
};
const SENTIDO: Record<string, string> = {
  HIGHER_IS_BETTER: 'maior é melhor',
  LOWER_IS_BETTER: 'menor é melhor',
  INFORMATIONAL: 'informativo',
};
const AVALIACAO: Record<string, string> = {
  met: 'Atendida',
  not_met: 'Não atendida',
  no_value: 'Sem valor no período',
  no_target: 'Sem meta configurada',
  informational: 'Informativo',
};
const ORIGEM_DA_META: Record<string, string> = {
  contract: 'contrato',
  customer: 'cliente',
  organization: 'organização',
};
const TIPO_DE_PLANO: Record<string, string> = {
  preventive: 'Preventiva',
  calibration: 'Calibração',
  electrical_safety: 'TSE',
  qualification: 'Qualificação',
};

/** O número da célula, já com o formato da unidade. */
export function numeroDaUnidade(v: number, unidade: string): CelulaXlsx {
  if (unidade === 'percent') return { numero: v, formato: 'percentual' };
  if (unidade === 'count') return { numero: v, formato: 'inteiro' };
  return { numero: v, formato: 'decimal' };
}

export interface DadosPlanilha {
  tier: ReportTier;
  organizacao: string;
  filtros: Record<string, string | null>;
  secoes: ReportSection[];
  pendentes: PendingIndicator[];
  serie: ReportSeries | null;
  geradoEm: Date;
  fuso: string;
}

export function abasDoRelatorio(d: DadosPlanilha): AbaXlsx[] {
  const indicadores: AbaXlsx = {
    nome: 'Indicadores',
    colunas: [
      { titulo: 'Código', largura: 26 },
      { titulo: 'Indicador', largura: 44 },
      { titulo: 'Situação', largura: 22 },
      { titulo: 'Valor', largura: 14 },
      { titulo: 'Unidade', largura: 14 },
      { titulo: 'Meta', largura: 12 },
      { titulo: 'Sentido da meta', largura: 16 },
      { titulo: 'Avaliação da meta', largura: 22 },
      { titulo: 'Origem da meta', largura: 14 },
      { titulo: 'Base (amostras)', largura: 14 },
      { titulo: 'Como é calculado', largura: 60 },
      { titulo: 'Observação', largura: 80 },
      // REL-07: a versão da fórmula com que o número saiu, a data e a fonte da definição.
      { titulo: 'Versão da fórmula', largura: 16 },
      { titulo: 'Definição em', largura: 12 },
      { titulo: 'Fonte da definição', largura: 60 },
    ],
    linhas: [
      ...d.secoes.map((s): CelulaXlsx[] => [
        s.key,
        s.label,
        SITUACAO[s.state] ?? s.state,
        s.value === null
          ? s.unit === 'none'
            ? 'Detalhamento na tela do sistema'
            : 'Sem dados suficientes no período'
          : numeroDaUnidade(s.value, s.unit),
        UNIDADE[s.unit] ?? s.unit,
        s.target ? numeroDaUnidade(s.target.value, s.target.unit) : null,
        SENTIDO[s.direction] ?? s.direction,
        AVALIACAO[s.target_evaluation] ?? s.target_evaluation,
        s.target ? (ORIGEM_DA_META[s.target.scope] ?? s.target.scope) : null,
        s.samples === null ? null : { numero: s.samples, formato: 'inteiro' },
        s.definition,
        s.state === 'PROVISIONAL' ? s.note : null,
        s.formula_version,
        s.formula_defined_on ? { dia: s.formula_defined_on } : null,
        s.formula_source,
      ]),
      ...d.pendentes.map((p): CelulaXlsx[] => [
        p.key,
        p.label,
        PENDENTE_DE_DEFINICAO,
        PENDENTE_DE_DEFINICAO,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        p.note,
        p.formula_version,
        null,
        'Aguardando definição do cliente',
      ]),
    ],
  };

  const abas: AbaXlsx[] = [indicadores];
  const chaves = d.serie ? Object.keys(d.serie.series) : [];
  if (d.serie && chaves.length > 0) {
    const porChave = new Map(d.secoes.map((s) => [s.key, s]));
    abas.push({
      nome: 'Série mensal',
      colunas: [
        { titulo: 'Mês', largura: 12 },
        ...chaves.map((k) => {
          const s = porChave.get(k);
          return { titulo: `${s?.label ?? k} (${UNIDADE[s?.unit ?? ''] ?? ''})`, largura: 22 };
        }),
      ],
      linhas: d.serie.months.map((mes, i) => [
        { dia: mes },
        ...chaves.map((k): CelulaXlsx => {
          const v = d.serie!.series[k]![i]?.value ?? null;
          return v === null ? null : numeroDaUnidade(v, porChave.get(k)?.unit ?? 'count');
        }),
      ]),
    });
  }

  const dia = (iso: string | null | undefined, menos = 0): CelulaXlsx =>
    iso ? { dia: dayOf(new Date(new Date(iso).getTime() - menos), d.fuso) } : null;
  const f = d.filtros;
  abas.push({
    nome: 'Filtros',
    colunas: [
      { titulo: 'Filtro', largura: 28 },
      { titulo: 'Valor', largura: 40 },
    ],
    linhas: [
      ['Nível', REPORT_TIER_LABEL[d.tier]],
      ['Período: início', dia(f.from)],
      // `to` é exclusivo (o instante logo depois do fim): o último dia é o de 1 ms antes.
      ['Período: fim', dia(f.to, 1)],
      ['Cliente', f.customer ?? 'Todos os clientes do escopo'],
      ['Contrato', f.contract ?? '—'],
      ['Setor', f.sector ?? '—'],
      ['Tipo de plano', f.plan_kind ? (TIPO_DE_PLANO[f.plan_kind] ?? f.plan_kind) : 'Todos'],
      ['Tipo de manutenção', f.work_order_type_label ?? 'Todos'],
      ['Família / tipo de equipamento', f.asset_category ?? 'Todos'],
      ['Dia de referência da meta', f.target_day ? { dia: f.target_day } : null],
      ['Fuso horário', d.fuso],
      ['Prestadora', d.organizacao],
      ['Gerado em', { instante: d.geradoEm, fuso: d.fuso }],
    ],
  });
  return abas;
}
