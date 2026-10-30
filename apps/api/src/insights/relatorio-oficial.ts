/**
 * Aurora — o layout dos PDFs dos relatórios (22/10/2026; Basic em 29/10/2026).
 *
 *   · ADVANCED: segue o modelo "Completo" do cliente (Complexo Hospitalar Samuel Libânio) —
 *     cabeçalho, texto de abertura, uma seção por indicador (texto + gráfico de 12 meses com a
 *     linha da meta) e assinaturas;
 *   · BASIC (REL-08, WhatsApp 19/10/2026: "layout sugestivo, clean, bonito, inovador com
 *     gráficos/dashboards"): o MESMO padrão visual do Advanced, aberto por um painel de cartões
 *     (um por indicador, com a situação da meta) e fechado pela lista do que está pendente de
 *     definição. O modelo Basic do cliente (Lagoa Santa) não foi enviado; quando vier, ajusta-se
 *     o texto, não os números;
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
import { MARCA_DO_PRODUTO } from '@aurora/config';
import { NO_TARGET_LABEL, addDaysToDay, dayOf, findIndicator, formulaInfo } from '@aurora/domain';
import type { PendingIndicator, ReportSection, ReportSeries } from '@aurora/db';
import type { AssinaturaPdf, CartaoPdf, LinhaPdf } from '../documents/pdf';

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
    case 'work_orders_opened':
      return `Ordens de serviço abertas no período: ${texto}.`;
    case 'work_orders_completed':
      return `Ordens de serviço concluídas no período (canceladas não contam): ${texto}.`;
    case 'compliance_calibration':
      return `O índice de conformidade dos planos de calibração foi de ${texto}.`;
    case 'compliance_electrical_safety':
      return `O índice de conformidade dos planos de teste de segurança elétrica (TSE) foi de ${texto}.`;
    case 'compliance_qualification':
      return `O índice de conformidade dos planos de qualificação foi de ${texto}.`;
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
      `mensurados é o sistema de gestão de Engenharia Clínica ${MARCA_DO_PRODUTO.produto}.`,
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

    const grafico = graficoDaSecao(sec, d.serie, familia, figura + 1, sigla);
    if (grafico.some((l) => l.grafico)) figura += 1;
    linhas.push(...grafico);
  });

  linhas.push(...notaDasFormulas(d.secoes));
  linhas.push({ texto: 'Atenciosamente,', espacoAntes: 16 });
  linhas.push({
    texto: '',
    assinaturas: d.assinaturas && d.assinaturas.length > 0 ? d.assinaturas : ASSINATURAS_PADRAO,
  });
  return {
    linhas,
    rodape: `Relatório Advanced — ${local}${competencia ? ` — ${competencia}` : ''}`,
  };
}

/**
 * O gráfico de 12 meses de uma seção (com a linha da meta), ou a nota de por que não há série.
 * Nada quando a série não foi pedida. Comum ao Advanced e ao Basic.
 */
function graficoDaSecao(
  sec: ReportSection,
  serie: ReportSeries | null,
  familia: Familia,
  numeroDaFigura: number,
  sigla: string
): LinhaPdf[] {
  const pontos = serie?.series[sec.key];
  const semSerie = serie?.unavailable[sec.key];
  if (semSerie) {
    // Sem série mensal não há o que desenhar: uma nota basta, e não um quadro vazio.
    return [{ texto: `Sem gráfico mensal: ${semSerie}`, recuo: 6, tamanho: 8, espacoAntes: 2 }];
  }
  if (!pontos) return [];
  const rotulos = pontos.map((p) => {
    const [ano, mes] = p.month.split('-');
    return `${MESES_CURTOS[Number(mes) - 1]}/${ano!.slice(2)}`;
  });
  return [
    {
      texto: `Gráfico ${doisDigitos(numeroDaFigura)}: ${sigla}`,
      // A legenda não fica sozinha no pé da página: vai junto com o gráfico.
      comOProximo: true,
      negrito: true,
      tamanho: 8,
      recuo: 6,
      espacoAntes: 4,
    },
    {
      texto: '',
      grafico: {
        rotulos,
        valores: pontos.map((p) => (p.value === null ? null : paraExibicao(familia, sec.unit, p.value))),
        metas: pontos.map((p) =>
          p.target === null ? null : paraExibicao(familia, p.target_unit ?? sec.unit, p.target)
        ),
        casas: CASAS[familia],
        sufixo: SUFIXO_GRAFICO[familia],
        altura: 140,
      },
    },
  ];
}

/**
 * A versão da fórmula de cada indicador do relatório, com a data e a fonte da definição
 * (REL-07). Relatórios antigos (seção sem versão) usam a do catálogo de hoje.
 */
export function notaDasFormulas(secoes: readonly ReportSection[]): LinhaPdf[] {
  if (secoes.length === 0) return [];
  const itens = secoes.map((sec) => {
    const doCatalogo = findIndicator(sec.key);
    const fi = doCatalogo ? formulaInfo(doCatalogo) : null;
    const versao = sec.formula_version ?? fi?.version ?? '—';
    const dia = sec.formula_defined_on ?? fi?.definedOn ?? null;
    return {
      texto: `${SIGLAS[sec.key] ?? sec.label}: ${versao}${dia ? ` (${dia.split('-').reverse().join('/')})` : ''}`,
      fonte: sec.formula_source ?? fi?.source ?? null,
    };
  });
  const fontes = [...new Set(itens.map((i) => i.fonte).filter((f): f is string => !!f))];
  return [
    { texto: 'Versão das fórmulas', negrito: true, tamanho: 8, espacoAntes: 12 },
    { texto: itens.map((i) => i.texto).join('; ') + '.', tamanho: 7 },
    ...(fontes.length > 0 ? [{ texto: `Fonte das definições: ${fontes.join('; ')}.`, tamanho: 7 }] : []),
    {
      texto:
        '"v1-provisoria": o cálculo existe, mas a definição ainda depende de confirmação do cliente; o número pode mudar.',
      tamanho: 7,
    },
  ];
}

// --- Basic ----------------------------------------------------------------------------------

/** O texto de um indicador pendente, como sai em tela, PDF e Excel. */
export const PENDENTE_DE_DEFINICAO = 'Pendente de definição';

export interface DadosBasic extends DadosCompleto {
  /** Indicadores do modelo que aguardam definição: listados, nunca com número. */
  pendentes: PendingIndicator[];
}

/** Cartão do painel para uma seção calculada. O tom diz a situação; o número vem do relatório. */
export function cartaoDaSecao(sec: ReportSection): CartaoPdf {
  const familia = familiaDe(sec.key, sec.unit);
  const provisorio = sec.state === 'PROVISIONAL';
  const rotulo = `${sec.label}${provisorio ? ' (provisório)' : ''}`;
  if (sec.value === null) {
    return {
      rotulo,
      valor: '—',
      detalhe: sec.unit === 'none' ? 'Detalhamento na tela do sistema' : 'Sem dados suficientes no período',
      tom: provisorio ? 'aviso' : 'neutro',
    };
  }
  const valor = textoDoValor(familia, paraExibicao(familia, sec.unit, sec.value));
  let meta: string | null = null;
  if (sec.target) {
    const sinal = sec.target.direction === 'HIGHER_IS_BETTER' ? '≥' : '≤';
    meta = `Meta ${sinal} ${textoDoValor(familia, paraExibicao(familia, sec.target.unit, sec.target.value))}`;
  }
  const situacao =
    sec.target_evaluation === 'met'
      ? `${meta} · atendida`
      : sec.target_evaluation === 'not_met'
        ? `${meta} · não atendida`
        : sec.direction === 'INFORMATIONAL'
          ? 'Informativo'
          : 'Sem meta configurada';
  const tom: CartaoPdf['tom'] = provisorio
    ? 'aviso'
    : sec.target_evaluation === 'met'
      ? 'bom'
      : sec.target_evaluation === 'not_met'
        ? 'ruim'
        : 'neutro';
  return {
    rotulo,
    valor,
    detalhe: provisorio ? `Provisório · ${situacao}` : situacao,
    tom,
    ...(familia === 'percent'
      ? {
          barra: {
            valor: sec.value,
            meta: sec.target && sec.target.unit === 'percent' ? sec.target.value : null,
          },
        }
      : {}),
  };
}

export function montarBasic(d: DadosBasic): { linhas: LinhaPdf[]; rodape: string } {
  const comp = competenciaDe(d.de, d.ate, d.fuso);
  const competencia = comp ? `${MESES[comp.mes - 1]!.toUpperCase()} / ${comp.ano}` : null;
  const periodo = `${dataCurta(d.de, d.fuso)} a ${dataCurta(new Date(new Date(d.ate).getTime() - 1).toISOString(), d.fuso)}`;
  const local = d.cliente ?? 'Clientes do escopo do relatório';
  const emissao = `${d.cidade ? `${d.cidade}, ` : ''}${dataExtensa(d.geradoEm, d.fuso)}`;

  const atendidas = d.secoes.filter((s) => s.target_evaluation === 'met').length;
  const abaixo = d.secoes.filter((s) => s.target_evaluation === 'not_met').length;
  const semMeta = d.secoes.filter((s) => s.target_evaluation === 'no_target').length;
  const provisorios = d.secoes.filter((s) => s.state === 'PROVISIONAL').length;

  const cabecalho = [
    d.centroDeCusto ? `Centro de Custo: ${d.centroDeCusto}` : null,
    d.contrato ? `Contrato: ${d.contrato}` : null,
    d.setor ? `Setor: ${d.setor}` : null,
  ].filter((x): x is string => !!x);

  const linhas: LinhaPdf[] = [
    { texto: d.organizacao.toUpperCase(), tamanho: 8, negrito: true },
    { texto: 'Relatório Basic', titulo: true, tamanho: 18, espacoAntes: 2 },
    { texto: 'Indicadores de manutenção do parque tecnológico', tamanho: 10 },
    {
      texto: `${local} · ${competencia ? `Competência ${competencia}` : `Período ${periodo}`}`,
      negrito: true,
      espacoAntes: 8,
    },
    ...(cabecalho.length > 0 ? [{ texto: cabecalho.join(' · '), tamanho: 9 }] : []),
    {
      texto: `Emitido em ${emissao}. Fonte: sistema de gestão de Engenharia Clínica ${MARCA_DO_PRODUTO.produto}.`,
      tamanho: 8,
    },

    { texto: 'Resumo do período', titulo: true, espacoAntes: 14 },
    {
      texto:
        `${d.secoes.length} indicador(es) calculado(s): ${atendidas} com a meta atendida, ${abaixo} abaixo da meta, ` +
        `${semMeta} sem meta configurada` +
        `${provisorios > 0 ? `; ${provisorios} provisório(s)` : ''}` +
        `${d.pendentes.length > 0 ? `. ${d.pendentes.length} pendente(s) de definição, sem número.` : '.'}`,
      tamanho: 8,
    },
    {
      texto: '',
      cartoes: [
        ...d.secoes.map(cartaoDaSecao),
        ...d.pendentes.map((p): CartaoPdf => ({
          rotulo: p.label,
          valor: '—',
          detalhe: PENDENTE_DE_DEFINICAO,
          tom: 'neutro',
        })),
      ],
      espacoAntes: 6,
    },
    {
      texto:
        'Legenda: verde, meta atendida · vermelho, abaixo da meta · âmbar, indicador provisório (definição ' +
        'em validação com o cliente; o número pode mudar) · cinza, sem meta, sem dados ou pendente de definição.',
      tamanho: 7,
    },
  ];

  let figura = 0;
  d.secoes.forEach((sec, i) => {
    const familia = familiaDe(sec.key, sec.unit);
    linhas.push({
      texto: `${i + 1}. ${sec.label.toUpperCase()}${sec.state === 'PROVISIONAL' ? ' (PROVISÓRIO)' : ''}`,
      titulo: true,
      espacoAntes: 14,
    });
    if (sec.value === null) {
      linhas.push({
        texto: ['Sem dados suficientes no período.', fraseDaMeta(sec, familia)].filter(Boolean).join(' '),
        recuo: 6,
      });
    } else {
      linhas.push({
        texto: [
          fraseDoValor(sec, textoDoValor(familia, paraExibicao(familia, sec.unit, sec.value))),
          fraseDaMeta(sec, familia),
          comp ? fraseDaVariacao(sec, d.serie, familia) : null,
        ]
          .filter((x): x is string => !!x)
          .join(' '),
        recuo: 6,
      });
    }
    if (sec.definition) linhas.push({ texto: `Como é calculado: ${sec.definition}.`, recuo: 6, tamanho: 8 });
    if (sec.samples !== null) linhas.push({ texto: `Base: ${sec.samples}.`, recuo: 6, tamanho: 8 });
    if (sec.state === 'PROVISIONAL' && sec.note) linhas.push({ texto: sec.note, recuo: 6, tamanho: 8 });
    if (sec.key === 'mtbf' && sec.value !== null) {
      linhas.push({ texto: 'Unidade: meses de 30 dias (a confirmar com o cliente).', recuo: 6, tamanho: 8 });
    }
    if (sec.value !== null) {
      const grafico = graficoDaSecao(sec, d.serie, familia, figura + 1, SIGLAS[sec.key] ?? sec.label);
      if (grafico.some((l) => l.grafico)) figura += 1;
      linhas.push(...grafico);
    }
  });

  if (d.pendentes.length > 0) {
    linhas.push({ texto: 'Indicadores pendentes de definição', titulo: true, espacoAntes: 16 });
    linhas.push({
      texto:
        'Fazem parte do modelo Basic, mas a fórmula ou o dado ainda dependem do cliente. Nenhum número foi ' +
        'estimado para eles.',
      tamanho: 8,
    });
    for (const p of d.pendentes) {
      linhas.push({
        texto: `${p.label} — ${PENDENTE_DE_DEFINICAO}`,
        negrito: true,
        tamanho: 8,
        espacoAntes: 4,
      });
      if (p.note) linhas.push({ texto: p.note, tamanho: 8, recuo: 10 });
    }
  }

  linhas.push(...notaDasFormulas(d.secoes));
  linhas.push({ texto: 'Atenciosamente,', espacoAntes: 16 });
  linhas.push({
    texto: '',
    assinaturas: d.assinaturas && d.assinaturas.length > 0 ? d.assinaturas : ASSINATURAS_PADRAO,
  });
  return { linhas, rodape: `Relatório Basic — ${local}${competencia ? ` — ${competencia}` : ''}` };
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
        motivo: (ind?.note ?? 'Aguardando definição do cliente.').replace(/^Indicador do IMR — /, ''),
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
  linhas.push(...notaDasFormulas(d.secoes));
  return { linhas, rodape: `Relatório Expert (IMR) — ${local}${competencia ? ` — ${competencia}` : ''}` };
}
