/**
 * Aurora — o layout dos PDFs oficiais do cliente (22/10/2026).
 *
 *   · COMPLETO (Advanced): modelo do Complexo Hospitalar Samuel Libânio — cabeçalho, texto de
 *     abertura, uma seção por indicador (texto + gráfico de 12 meses com a linha da meta) e
 *     assinaturas;
 *   · EXPERT: a casca do IMR do HJXXIII — as 16 linhas, as colunas de resultado, meta,
 *     desconto e glosa, e os totais.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ
 *
 * Não calcula nada. Todo número vem de `buildReport` / `buildReportSeries`, que são as mesmas
 * funções do Painel. Só converte unidade para exibir (minutos → h:mm, minutos → meses) e escreve a
 * frase. No IMR, o item sem definição do cliente sai "Aguardando definição", e desconto, glosa e
 * faturamento NÃO são calculados: a regra do IMR (faixas, pesos, valor do contrato) não existe.
 */
import { NO_TARGET_LABEL, addDaysToDay, dayOf, findIndicator } from '@aurora/domain';
import type { ReportSection, ReportSeries } from '@aurora/db';
import type { AssinaturaPdf, LinhaPdf } from '../documents/pdf';

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
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const num = (v: number, casas: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const doisDigitos = (v: number) => String(v).padStart(2, '0');

// --- unidades de exibição -------------------------------------------------------------------

type Familia = 'horas_hm' | 'meses' | 'percent' | 'score' | 'hours' | 'minutes' | 'count';

function familiaDe(key: string, unit: string): Familia {
  if (key === 'mttr') return 'horas_hm';
  // 1 mês = 30 dias: a unidade do cliente é "meses", e o sistema calcula em minutos (P-02).
  if (key === 'mtbf') return 'meses';
  if (unit === 'percent' || unit === 'score' || unit === 'hours' || unit === 'minutes') return unit;
  return 'count';
}

/** Leva o valor (na unidade em que foi calculado) para a unidade de exibição da família. */
export function paraExibicao(familia: Familia, unidadeOrigem: string, v: number): number {
  if (familia === 'horas_hm') return unidadeOrigem === 'hours' ? v : v / 60;
  if (familia === 'meses') return unidadeOrigem === 'hours' ? v / 720 : v / 43_200;
  return v;
}

export function textoDoValor(familia: Familia, v: number): string {
  switch (familia) {
    case 'horas_hm': {
      let h = Math.floor(v);
      let m = Math.round((v - h) * 60);
      if (m === 60) {
        h += 1;
        m = 0;
      }
      return `${h}:${doisDigitos(m)}h`;
    }
    case 'meses':
      return `${num(v, 2)} meses`;
    case 'percent':
      return `${num(v, 1)}%`;
    case 'score':
      return num(v, 1);
    case 'hours':
      return `${num(v, 1)}h`;
    case 'minutes':
      return `${num(v, 0)} min`;
    default:
      return num(v, 0);
  }
}

const CASAS: Record<Familia, number> = {
  horas_hm: 1,
  meses: 2,
  percent: 1,
  score: 1,
  hours: 1,
  minutes: 0,
  count: 0,
};
const SUFIXO_GRAFICO: Partial<Record<Familia, string>> = { horas_hm: 'h', percent: '%', hours: 'h' };

// --- Completo -------------------------------------------------------------------------------

const SIGLAS: Record<string, string> = {
  service_rating: 'IAR',
  park_availability_snapshot: 'DPT',
  mttr: 'MTTR',
  mtbf: 'MTBF',
  compliance_preventive: 'IMP',
  opened_vs_closed: 'AxF',
};

const TITULOS: Record<string, string> = {
  service_rating: 'ATENDIMENTO/RELACIONAMENTO COM O CLIENTE E AVALIAÇÃO DOS CHAMADOS',
  park_availability_snapshot: 'DISPONIBILIDADE DO PARQUE TECNOLÓGICO',
  mttr: 'TEMPO MÉDIO DE REPARO (MTTR)',
  mtbf: 'TEMPO MÉDIO ENTRE FALHAS (MTBF)',
  compliance_preventive: 'ÍNDICE DE REGULARIDADE DOS PLANOS DE MANUTENÇÃO',
  opened_vs_closed: 'NÚMERO DE CHAMADOS ABERTOS x NÚMERO DE CHAMADOS ENCERRADOS',
};

function fraseDoValor(sec: ReportSection, texto: string): string {
  switch (sec.key) {
    case 'service_rating':
      return `A avaliação geral do serviço ficou em ${texto}.`;
    case 'park_availability_snapshot':
      return `O indicador mede a disponibilidade para uso dos equipamentos cadastrados no sistema de gestão. Disponibilidade atual do parque: ${texto} (situação de agora).`;
    case 'mttr':
      return `O Tempo Médio de Reparo (MTTR) da área técnica foi de ${texto}.`;
    case 'mtbf':
      return `O Tempo Médio entre Falhas (MTBF) da área técnica foi de ${texto}.`;
    case 'compliance_preventive':
      return `O índice de regularidade dos planos de manutenção programada da área técnica foi de ${texto}.`;
    case 'opened_vs_closed':
      return `A totalização do número de chamados abertos versus encerrados da área técnica foi de ${texto}.`;
    default:
      return `${sec.label}: ${texto}.`;
  }
}

function fraseDaMeta(sec: ReportSection, familia: Familia): string | null {
  if (sec.direction === 'INFORMATIONAL') return null;
  if (!sec.target)
    return `${NO_TARGET_LABEL.charAt(0)}${NO_TARGET_LABEL.slice(1).toLowerCase()} para este indicador.`;
  const sinal = sec.target.direction === 'HIGHER_IS_BETTER' ? '≥' : '≤';
  const meta = textoDoValor(familia, paraExibicao(familia, sec.target.unit, sec.target.value));
  if (sec.target_evaluation === 'met')
    return `Considerando a meta ${sinal} ${meta}, o índice atendeu a meta.`;
  if (sec.target_evaluation === 'not_met')
    return `Considerando a meta ${sinal} ${meta}, o índice não atendeu a meta.`;
  return `Meta ${sinal} ${meta}.`;
}

function fraseDaVariacao(sec: ReportSection, serie: ReportSeries | null, familia: Familia): string | null {
  const pontos = serie?.series[sec.key];
  if (!pontos || pontos.length < 2) return null;
  const atual = pontos[pontos.length - 1]!.value;
  const anterior = pontos[pontos.length - 2]!.value;
  if (atual === null || anterior === null) return null;
  const a = paraExibicao(familia, sec.unit, atual);
  const b = paraExibicao(familia, sec.unit, anterior);
  const casas = CASAS[familia];
  const [ra, rb] = [Number(a.toFixed(casas)), Number(b.toFixed(casas))];
  const mes = textoDoValor(familia, b);
  if (ra === rb) return `O índice se manteve em relação ao mês anterior (${mes}).`;
  return `O índice ${ra > rb ? 'subiu' : 'caiu'} em relação ao mês anterior (${mes}).`;
}

export interface DadosCompleto {
  organizacao: string;
  cliente: string | null;
  centroDeCusto: string | null;
  cidade: string | null;
  contrato: string | null;
  setor: string | null;
  /** Período pedido, em instantes ISO. */
  de: string;
  ate: string;
  fuso: string;
  geradoEm: Date;
  secoes: ReportSection[];
  serie: ReportSeries | null;
  assinaturas: AssinaturaPdf[] | null;
}

/** O período é um mês civil inteiro no fuso? Então é a "competência". */
export function competenciaDe(de: string, ate: string, fuso: string): { mes: number; ano: number } | null {
  const inicio = dayOf(new Date(de), fuso);
  const fim = dayOf(new Date(new Date(ate).getTime() - 1), fuso);
  // Do dia 1 ao último dia do mesmo mês: o dia seguinte ao fim é o dia 1 do mês que vem.
  if (!inicio.endsWith('-01') || inicio.slice(0, 7) !== fim.slice(0, 7)) return null;
  if (!addDaysToDay(fim, 1).endsWith('-01')) return null;
  return { ano: Number(inicio.slice(0, 4)), mes: Number(inicio.slice(5, 7)) };
}

const dataExtensa = (d: Date, fuso: string) => {
  const dia = dayOf(d, fuso);
  return `${Number(dia.slice(8, 10))} de ${MESES[Number(dia.slice(5, 7)) - 1]} de ${dia.slice(0, 4)}`;
};
const dataCurta = (iso: string, fuso: string) => {
  const dia = dayOf(new Date(iso), fuso);
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
};

export const ASSINATURAS_PADRAO: AssinaturaPdf[] = [
  { nome: '', cargo: 'Responsável pela Engenharia Clínica' },
  { nome: '', cargo: 'Diretor Técnico' },
];

export function montarCompleto(d: DadosCompleto): { linhas: LinhaPdf[]; rodape: string } {
  const comp = competenciaDe(d.de, d.ate, d.fuso);
  const competencia = comp ? `${MESES[comp.mes - 1]!.toUpperCase()} / ${comp.ano}` : null;
  const periodo = `${dataCurta(d.de, d.fuso)} a ${dataCurta(new Date(new Date(d.ate).getTime() - 1).toISOString(), d.fuso)}`;
  const local = d.cliente ?? 'Clientes do escopo do relatório';
  const emissao = `${d.cidade ? `${d.cidade}, ` : ''}${dataExtensa(d.geradoEm, d.fuso)}.`;

  const linhas: LinhaPdf[] = [
    { texto: 'A/C Srs. Diretores', tamanho: 9 },
    { texto: 'Indicadores de Qualidade', titulo: true },
    { texto: competencia ? competencia.replace(' / ', '/') : `Período ${periodo}`, negrito: true },
    { texto: emissao, tamanho: 9 },
    { texto: local, negrito: true, espacoAntes: 6 },
  ];
  if (d.centroDeCusto) linhas.push({ texto: `Centro de Custo: ${d.centroDeCusto}` });
  if (d.contrato) linhas.push({ texto: `Contrato: ${d.contrato}` });
  if (d.setor) linhas.push({ texto: `Setor: ${d.setor}` });
  linhas.push({
    texto: competencia ? `Competência: ${competencia}` : `Período: ${periodo}`,
  });
  linhas.push({
    texto: 'Relatório de Atividades – Departamento de Engenharia Clínica',
    titulo: true,
    espacoAntes: 10,
  });
  linhas.push({
    texto:
      `O presente instrumento tem como objetivo reportar as atividades executadas pela empresa ${d.organizacao} ` +
      `${d.cliente ? `nas dependências de ${d.cliente}` : 'nas dependências dos clientes atendidos'}, conforme ` +
      `diretrizes e exigências do contrato de prestação de serviço no período do mês vigente. A fonte dos dados ` +
      `mensurados é o sistema de gestão de Engenharia Clínica Aurora.`,
    espacoAntes: 4,
  });
  if (d.secoes.some((s) => s.state === 'PROVISIONAL')) {
    linhas.push({
      texto:
        'Atenção: este relatório contém indicador(es) PROVISÓRIO(S), marcados no título da seção. A definição de ' +
        'cálculo ainda está em validação com o cliente e o número pode mudar.',
      tamanho: 8,
      espacoAntes: 4,
    });
  }

  let figura = 0;
  d.secoes.forEach((sec, i) => {
    const familia = familiaDe(sec.key, sec.unit);
    const sigla = SIGLAS[sec.key] ?? sec.label;
    const titulo = (TITULOS[sec.key] ?? sec.label).toUpperCase();
    linhas.push({
      texto: `${i + 1}. ${titulo}${sec.state === 'PROVISIONAL' ? ' (PROVISÓRIO)' : ''}`,
      titulo: true,
      espacoAntes: 14,
    });

    if (sec.value === null) {
      linhas.push({
        texto:
          sec.unit === 'none'
            ? `${sec.definition ?? 'Indicador de detalhamento.'} O detalhamento está na tela do sistema.`
            : ['Sem dados suficientes no período.', fraseDaMeta(sec, familia)].filter(Boolean).join(' '),
        recuo: 6,
      });
      return;
    }

    const partes = [
      fraseDoValor(sec, textoDoValor(familia, paraExibicao(familia, sec.unit, sec.value))),
      fraseDaMeta(sec, familia),
      // "Em relação ao mês anterior" só faz sentido quando o relatório é um mês civil inteiro:
      // comparar 30 dias corridos com um mês fechado diria "caiu" ou "subiu" sem ter caído nem subido.
      comp ? fraseDaVariacao(sec, d.serie, familia) : null,
    ].filter((x): x is string => !!x);
    linhas.push({ texto: partes.join(' '), recuo: 6 });
    if (sec.key === 'opened_vs_closed') {
      linhas.push({
        texto: 'Obs.: índice gerado considerando todas as ordens de serviço do período.',
        recuo: 6,
        tamanho: 8,
      });
    }
    if (sec.state === 'PROVISIONAL' && sec.note) linhas.push({ texto: sec.note, recuo: 6, tamanho: 8 });
    if (sec.key === 'mtbf') {
      linhas.push({ texto: 'Unidade: meses de 30 dias (a confirmar com o cliente).', recuo: 6, tamanho: 8 });
    }

    const pontos = d.serie?.series[sec.key];
    const semSerie = d.serie?.unavailable[sec.key];
    if (semSerie) {
      // Sem série mensal não há o que desenhar: uma nota basta, e não um quadro vazio.
      linhas.push({ texto: `Sem gráfico mensal: ${semSerie}`, recuo: 6, tamanho: 8, espacoAntes: 2 });
    } else if (pontos) {
      figura += 1;
      linhas.push({
        texto: `Gráfico ${doisDigitos(figura)}: ${sigla}`,
        negrito: true,
        tamanho: 8,
        recuo: 6,
        espacoAntes: 4,
      });
      const rotulos = (pontos ?? d.serie!.months.map((m) => ({ month: m }))).map((p) => {
        const [ano, mes] = p.month.split('-');
        return `${MESES_CURTOS[Number(mes) - 1]}/${ano!.slice(2)}`;
      });
      linhas.push({
        texto: '',
        grafico: {
          rotulos,
          valores: (pontos ?? []).map((p) =>
            p.value === null ? null : paraExibicao(familia, sec.unit, p.value)
          ),
          metas: (pontos ?? []).map((p) =>
            p.target === null ? null : paraExibicao(familia, p.target_unit ?? sec.unit, p.target)
          ),
          casas: CASAS[familia],
          sufixo: SUFIXO_GRAFICO[familia],
          altura: 140,
          semSerie,
        },
      });
    }
  });

  linhas.push({ texto: 'Atenciosamente,', espacoAntes: 16 });
  linhas.push({
    texto: '',
    assinaturas: d.assinaturas && d.assinaturas.length > 0 ? d.assinaturas : ASSINATURAS_PADRAO,
  });
  return {
    linhas,
    rodape: `Relatório Completo (Advanced) — ${local}${competencia ? ` — ${competencia}` : ''}`,
  };
}

// --- Expert (IMR) ---------------------------------------------------------------------------

/** As 16 linhas do IMR do HJXXIII, na ordem e com os nomes do PDF do cliente. */
export const ITENS_IMR: readonly { item: number; nome: string; key: string }[] = [
  { item: 1, nome: 'Tempo médio para o primeiro atendimento', key: 'first_response_time' },
  {
    item: 2,
    nome: 'Índice de disponibilidade do parque tecnológico – Interno',
    key: 'availability_internal',
  },
  {
    item: 3,
    nome: 'Índice de disponibilidade do parque tecnológico – Externo',
    key: 'availability_external',
  },
  { item: 4, nome: 'Índice de disponibilidade do parque tecnológico – Global', key: 'availability_global' },
  { item: 5, nome: 'Tempo médio de resolutividade das solicitações gerais – Interno', key: 'tmrg_internal' },
  { item: 6, nome: 'Tempo médio de resolutividade das solicitações gerais – Externo', key: 'tmrg_external' },
  { item: 7, nome: 'Tempo médio de resolutividade das solicitações gerais – Global', key: 'tmrg_global' },
  {
    item: 8,
    nome: 'Tempo médio de atendimento e resolutividade das solicitações críticas – Interno',
    key: 'critical_resolution_internal',
  },
  {
    item: 9,
    nome: 'Tempo médio de atendimento e resolutividade das solicitações críticas – Externo',
    key: 'critical_resolution_external',
  },
  {
    item: 10,
    nome: 'Tempo médio de atendimento e resolutividade das solicitações críticas – Global',
    key: 'critical_resolution_global',
  },
  { item: 11, nome: 'Chamados realizados / solicitados', key: 'requests_fulfilled_ratio' },
  {
    item: 12,
    nome: 'Adesão às atividades propostas pela qualidade dentro do prazo',
    key: 'quality_activities_on_time',
  },
  { item: 13, nome: 'Adesão ao cronograma de manutenção preventiva', key: 'compliance_preventive' },
  { item: 14, nome: 'Treinamentos realizados / solicitados', key: 'training_ratio' },
  { item: 15, nome: 'Avaliação da qualidade dos serviços', key: 'service_rating' },
  { item: 16, nome: 'Assiduidade nos postos de trabalho', key: 'attendance' },
];

/** Os indicadores do IMR que têm número hoje (os demais aguardam o cliente). */
export const CHAVES_IMR_COM_NUMERO = ITENS_IMR.map((i) => i.key).filter((k) => {
  const ind = findIndicator(k);
  return ind !== undefined && ind.state !== 'PENDING_DEFINITION';
});

export interface DadosImr {
  organizacao: string;
  cliente: string | null;
  de: string;
  ate: string;
  fuso: string;
  geradoEm: Date;
  secoes: ReportSection[];
}

const SEM_REGRA = 'não calculado';

export function montarImr(d: DadosImr): { linhas: LinhaPdf[]; rodape: string } {
  const comp = competenciaDe(d.de, d.ate, d.fuso);
  const competencia = comp ? `${MESES[comp.mes - 1]!.toUpperCase()}.${comp.ano}` : null;
  const periodo = `${dataCurta(d.de, d.fuso)} a ${dataCurta(new Date(new Date(d.ate).getTime() - 1).toISOString(), d.fuso)}`;
  const local = (d.cliente ?? d.organizacao).toUpperCase();

  const pendentes: { item: number; nome: string; motivo: string }[] = [];
  const linhasTabela = ITENS_IMR.map((it) => {
    const sec = d.secoes.find((s) => s.key === it.key);
    const ind = findIndicator(it.key);
    let resultado = 'Aguardando definição';
    let meta = '—';
    if (sec) {
      const familia = familiaDe(sec.key, sec.unit);
      resultado =
        sec.value === null
          ? 'Sem dados no período'
          : `${textoDoValor(familia, paraExibicao(familia, sec.unit, sec.value))}${sec.state === 'PROVISIONAL' ? ' (provisório)' : ''}`;
      meta = sec.target
        ? `${sec.target.direction === 'HIGHER_IS_BETTER' ? '≥' : '≤'} ${textoDoValor(familia, paraExibicao(familia, sec.target.unit, sec.target.value))}`
        : 'sem meta';
    } else {
      pendentes.push({
        item: it.item,
        nome: it.nome,
        motivo: (ind?.note ?? 'Aguardando definição do cliente.').replace(
          /^Indicador do IMR \(FHEMIG\) — /,
          ''
        ),
      });
    }
    return [String(it.item), it.nome, resultado, meta, '—', '—'];
  });

  const linhas: LinhaPdf[] = [
    {
      texto: `${local}${competencia ? ` ${competencia}` : ` — ${periodo}`} — INSTRUMENTO DE MEDIÇÃO DE RESULTADOS (IMR)`,
      titulo: true,
    },
    {
      texto: `Prestadora: ${d.organizacao}. Gerado em ${dataExtensa(d.geradoEm, d.fuso)}.`,
      tamanho: 8,
    },
    {
      texto: '',
      tabela: {
        colunas: [
          { titulo: 'Item', peso: 0.5, alinhar: 'c' },
          { titulo: 'Indicador', peso: 4.2 },
          { titulo: 'Resultado do indicador', peso: 1.5, alinhar: 'c' },
          { titulo: 'Meta', peso: 0.9, alinhar: 'c' },
          { titulo: 'Desconto (%)', peso: 0.9, alinhar: 'c' },
          { titulo: 'Glosa (R$)', peso: 0.9, alinhar: 'c' },
        ],
        linhas: linhasTabela,
        tamanho: 8,
      },
    },
    { texto: `Valor total do desconto a ser aplicado: ${SEM_REGRA}.`, negrito: true, espacoAntes: 6 },
    { texto: `Faturamento mensal total dos serviços após aplicação do IMR: ${SEM_REGRA}.`, negrito: true },
    {
      texto:
        'Desconto, glosa e faturamento não são calculados: as faixas, os pesos e o valor mensal do contrato do IMR ' +
        'ainda não foram definidos pelo cliente. Nenhum valor foi estimado.',
      tamanho: 8,
      espacoAntes: 2,
    },
  ];

  if (pendentes.length > 0) {
    linhas.push({ texto: 'Itens aguardando definição do cliente', titulo: true, espacoAntes: 14 });
    for (const p of pendentes) {
      linhas.push({ texto: `${p.item}. ${p.nome}`, negrito: true, tamanho: 8, espacoAntes: 3 });
      linhas.push({ texto: p.motivo, tamanho: 8, recuo: 10 });
    }
  }
  return { linhas, rodape: `Relatório Expert (IMR) — ${local}${competencia ? ` — ${competencia}` : ''}` };
}
