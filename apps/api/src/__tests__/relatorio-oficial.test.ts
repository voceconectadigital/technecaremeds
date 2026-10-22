/**
 * Aurora — layout oficial do Completo e casca do IMR (22/10/2026).
 *
 * O que se prova: o texto sai dos números que o relatório já calculou (nenhum número novo), a
 * unidade de exibição do cliente (h:mm, meses) é só conversão, o IMR não inventa desconto nem
 * glosa, e o PDF continua um PDF válido e determinístico com gráfico, tabela e assinaturas.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportSection, ReportSeries } from '@aurora/db';
import { gerarPdf, type LinhaPdf } from '../documents/pdf';
import {
  CHAVES_IMR_COM_NUMERO,
  ITENS_IMR,
  competenciaDe,
  montarCompleto,
  montarImr,
  paraExibicao,
  textoDoValor,
} from '../insights/relatorio-oficial';

const sec = (
  p: Partial<ReportSection> & Pick<ReportSection, 'key' | 'label' | 'unit' | 'value'>
): ReportSection => ({
  state: 'ACTIVE',
  status: 'available',
  note: null,
  samples: null,
  detail: null,
  definition: null,
  direction: 'HIGHER_IS_BETTER',
  target: null,
  target_evaluation: 'no_target',
  target_label: 'SEM META CONFIGURADA',
  ...p,
});

const meta = (
  value: number,
  unit: string,
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' = 'HIGHER_IS_BETTER'
) => ({
  id: '00000000-0000-4000-8000-000000000001',
  value,
  unit,
  direction,
  scope: 'organization' as const,
  valid_from: '2026-01-01',
  valid_to: null,
});

const MESES = Array.from(
  { length: 12 },
  (_, i) => `${i < 3 ? '2025' : '2026'}-${String(((i + 9) % 12) + 1).padStart(2, '0')}-01`
);
const serieDe = (valores: (number | null)[], alvo: number | null, unidade = 'percent') =>
  valores.map((value, i) => ({
    month: MESES[i]!,
    value,
    target: alvo,
    target_unit: alvo === null ? null : unidade,
  }));

const secoes: ReportSection[] = [
  sec({
    key: 'service_rating',
    label: 'Avaliação da qualidade dos serviços',
    unit: 'score',
    value: 4.6,
    target: meta(3, 'score'),
    target_evaluation: 'met',
  }),
  sec({
    key: 'mttr',
    label: 'MTTR',
    unit: 'minutes',
    value: 829,
    state: 'PROVISIONAL',
    note: 'Definição do sistema (tempo corrido).',
    direction: 'LOWER_IS_BETTER',
    target: meta(72, 'hours', 'LOWER_IS_BETTER'),
    target_evaluation: 'met',
  }),
  sec({
    key: 'opened_vs_closed',
    label: 'Chamados Abertos x Encerrados',
    unit: 'percent',
    value: 97,
    target: meta(95, 'percent'),
    target_evaluation: 'met',
  }),
  sec({
    key: 'park_availability_snapshot',
    label: 'Disponibilidade do parque',
    unit: 'percent',
    value: 98,
    state: 'PROVISIONAL',
    target: meta(92, 'percent'),
    target_evaluation: 'met',
  }),
];

const serie: ReportSeries = {
  months: MESES,
  series: {
    service_rating: serieDe([4.9, 4.7, 4, 4, 4, 4, 4, 4, 4, 4.1, 4.5, 4.6], 3, 'score'),
    mttr: serieDe([540, 480, 660, 600, 612, 730, 780, 800, 3310, 840, 790, 829], 72 * 60, 'minutes').map(
      (p) => ({
        ...p,
        target: 72,
        target_unit: 'hours',
      })
    ),
    opened_vs_closed: serieDe([99, 97, 96, 125, 117, 99, 98, 98, 99, 99, 98, 97], 95),
  },
  unavailable: { park_availability_snapshot: 'Disponibilidade é a situação do parque agora.' },
};

const base = {
  organizacao: 'TéchneCare',
  cliente: 'Complexo Hospitalar Samuel Libânio',
  centroDeCusto: 'HCSL020',
  cidade: 'Pouso Alegre',
  contrato: null,
  setor: null,
  de: '2026-09-01T03:00:00.000Z',
  ate: '2026-10-01T02:59:59.999Z',
  fuso: 'America/Sao_Paulo',
  geradoEm: new Date('2026-09-21T15:00:00.000Z'),
  secoes,
  serie,
  assinaturas: [
    { nome: 'Natália Aurora Santos', cargo: 'Engenheira Clínica / Coordenadora' },
    { nome: 'Cleber Geraldo dos Santos', cargo: 'Diretor Técnico' },
  ],
};

const texto = (linhas: LinhaPdf[]) => linhas.map((l) => l.texto).join('\n');

describe('conversão de unidade (só exibição)', () => {
  it('MTTR em minutos vira h:mm; 829 min = 13:49h', () => {
    expect(textoDoValor('horas_hm', paraExibicao('horas_hm', 'minutes', 829))).toBe('13:49h');
    expect(textoDoValor('horas_hm', paraExibicao('horas_hm', 'hours', 72))).toBe('72:00h');
  });
  it('arredonda 59,6 min sem escrever 0:60', () => {
    expect(textoDoValor('horas_hm', 0.9999)).toBe('1:00h');
  });
  it('MTBF em minutos vira meses de 30 dias', () => {
    expect(paraExibicao('meses', 'minutes', 43_200 * 5)).toBe(5);
    expect(textoDoValor('meses', 5.1)).toBe('5,10 meses');
  });
});

describe('competência', () => {
  it('mês civil inteiro no fuso da organização é competência', () => {
    expect(competenciaDe(base.de, base.ate, base.fuso)).toEqual({ mes: 9, ano: 2026 });
  });
  it('período de 15 dias não é competência', () => {
    expect(competenciaDe('2026-09-01T03:00:00.000Z', '2026-09-16T03:00:00.000Z', base.fuso)).toBeNull();
  });
});

describe('Completo', () => {
  const { linhas, rodape } = montarCompleto(base);
  const t = texto(linhas);

  it('cabeçalho do modelo: cliente, centro de custo, competência, cidade e data', () => {
    expect(t).toContain('Complexo Hospitalar Samuel Libânio');
    expect(t).toContain('Centro de Custo: HCSL020');
    expect(t).toContain('Competência: SETEMBRO / 2026');
    expect(t).toContain('Pouso Alegre, 21 de setembro de 2026.');
    expect(t).toContain('Relatório de Atividades – Departamento de Engenharia Clínica');
    expect(t).toContain('pela empresa TéchneCare nas dependências de Complexo Hospitalar Samuel Libânio');
    expect(rodape).toContain('SETEMBRO / 2026');
  });

  it('cada seção traz valor, meta e variação a partir dos números recebidos', () => {
    expect(t).toContain('1. ATENDIMENTO/RELACIONAMENTO COM O CLIENTE E AVALIAÇÃO DOS CHAMADOS');
    expect(t).toContain('A avaliação geral do serviço ficou em 4,6.');
    expect(t).toContain('Considerando a meta ≥ 3,0, o índice atendeu a meta.');
    expect(t).toContain('O índice subiu em relação ao mês anterior (4,5).');
    expect(t).toContain('foi de 13:49h');
    expect(t).toContain('Considerando a meta ≤ 72:00h, o índice atendeu a meta.');
    expect(t).toContain('foi de 97,0%');
  });

  it('indicador provisório sai marcado, com o aviso e a nota', () => {
    expect(t).toContain('(PROVISÓRIO)');
    expect(t).toContain('Atenção: este relatório contém indicador(es) PROVISÓRIO(S)');
    expect(t).toContain('Definição do sistema (tempo corrido).');
  });

  it('gráfico de 12 meses com meta; a situação de agora não ganha série inventada', () => {
    const graficos = linhas.filter((l) => l.grafico);
    expect(graficos).toHaveLength(4);
    const iar = graficos[0]!.grafico!;
    expect(iar.valores).toHaveLength(12);
    expect(iar.metas.every((m) => m === 3)).toBe(true);
    const mttr = graficos[1]!.grafico!;
    expect(mttr.valores[11]).toBeCloseTo(829 / 60, 5);
    expect(mttr.metas[11]).toBe(72);
    const dpt = graficos[3]!.grafico!;
    expect(dpt.valores).toEqual([]);
    expect(dpt.semSerie).toMatch(/situação do parque agora/);
  });

  it('assinaturas: as informadas, ou as linhas em branco do modelo', () => {
    expect(linhas.at(-1)!.assinaturas).toEqual(base.assinaturas);
    const sem = montarCompleto({ ...base, assinaturas: null }).linhas.at(-1)!.assinaturas!;
    expect(sem.map((a) => a.nome)).toEqual(['', '']);
  });

  it('mês sem dado continua dizendo a meta e não desenha gráfico de número inventado', () => {
    const r = montarCompleto({
      ...base,
      serie: null,
      secoes: [
        sec({
          key: 'opened_vs_closed',
          label: 'Chamados Abertos x Encerrados',
          unit: 'percent',
          value: null,
          target: meta(95, 'percent'),
          target_evaluation: 'no_value',
        }),
      ],
    });
    const x = texto(r.linhas);
    expect(x).toContain('Sem dados suficientes no período. Meta >= 95,0%.'.replace('>=', '≥'));
    expect(r.linhas.some((l) => l.grafico)).toBe(false);
  });

  it('sem cliente nem centro de custo, o cabeçalho não inventa nada', () => {
    const r = montarCompleto({ ...base, cliente: null, centroDeCusto: null, cidade: null });
    const x = texto(r.linhas);
    expect(x).not.toContain('Centro de Custo');
    expect(x).toContain('nas dependências dos clientes atendidos');
    expect(x).toContain('21 de setembro de 2026.');
  });

  it('o PDF é válido, determinístico e traz o gráfico', () => {
    const pdf = gerarPdf(linhas, { titulo: 'Relatório Completo', autor: 'x', rodape });
    expect(pdf.equals(gerarPdf(linhas, { titulo: 'Relatório Completo', autor: 'x', rodape }))).toBe(true);
    const s = pdf.toString('latin1');
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('[4 3] 0 d'); // a linha de meta tracejada
    expect(s).toContain('(Gr\\341fico 01: IAR)');
    expect(s).not.toContain('AGUARDANDO MODELO');
    if (process.env.PDF_OUT) {
      mkdirSync(process.env.PDF_OUT, { recursive: true });
      writeFileSync(join(process.env.PDF_OUT, 'completo.pdf'), pdf);
    }
  });
});

describe('IMR (Expert)', () => {
  const imr = montarImr({
    organizacao: 'TéchneCare',
    cliente: 'Hospital João XXIII',
    de: base.de,
    ate: base.ate,
    fuso: base.fuso,
    geradoEm: base.geradoEm,
    secoes: [
      sec({
        key: 'compliance_preventive',
        label: 'Conformidade de preventivas',
        unit: 'percent',
        value: 100,
        state: 'PROVISIONAL',
        target: meta(100, 'percent'),
        target_evaluation: 'met',
      }),
      sec({
        key: 'service_rating',
        label: 'Avaliação',
        unit: 'score',
        value: null,
      }),
    ],
  });

  it('16 linhas, na ordem e com os nomes do PDF do cliente', () => {
    expect(ITENS_IMR).toHaveLength(16);
    const tabela = imr.linhas.find((l) => l.tabela)!.tabela!;
    expect(tabela.linhas).toHaveLength(16);
    expect(tabela.linhas.map((l) => l[0])).toEqual(Array.from({ length: 16 }, (_, i) => String(i + 1)));
    expect(tabela.linhas[12]![1]).toBe('Adesão ao cronograma de manutenção preventiva');
  });

  it('só os itens com número têm resultado; o resto diz "Aguardando definição"', () => {
    expect([...CHAVES_IMR_COM_NUMERO].sort()).toEqual(['compliance_preventive', 'service_rating']);
    const tabela = imr.linhas.find((l) => l.tabela)!.tabela!;
    expect(tabela.linhas[12]![2]).toBe('100,0% (provisório)');
    expect(tabela.linhas[12]![3]).toBe('≥ 100,0%');
    expect(tabela.linhas[14]![2]).toBe('Sem dados no período');
    const aguardando = tabela.linhas.filter((l) => l[2] === 'Aguardando definição');
    expect(aguardando).toHaveLength(14);
  });

  it('desconto e glosa NÃO são calculados em nenhuma linha, e os totais dizem isso', () => {
    const tabela = imr.linhas.find((l) => l.tabela)!.tabela!;
    expect(tabela.linhas.every((l) => l[4] === '—' && l[5] === '—')).toBe(true);
    const t = texto(imr.linhas);
    expect(t).toContain('Valor total do desconto a ser aplicado: não calculado.');
    expect(t).toContain('Faturamento mensal total dos serviços após aplicação do IMR: não calculado.');
    expect(t).toContain('Nenhum valor foi estimado.');
    expect(t).not.toMatch(/R\$\s*\d/);
  });

  it('lista por que cada item está em branco, sem repetir o prefixo do IMR', () => {
    const t = texto(imr.linhas);
    expect(t).toContain('Itens aguardando definição do cliente');
    expect(t).toContain('1. Tempo médio para o primeiro atendimento');
    expect(t).not.toContain('Indicador do IMR (FHEMIG) — ');
  });

  it('o PDF tem tabela e mais de uma página quando preciso', () => {
    const pdf = gerarPdf(imr.linhas, {
      titulo: 'IMR',
      autor: 'x',
      rodape: imr.rodape,
      faixa: 'IMR — DESCONTO E GLOSA NÃO CALCULADOS',
    });
    const s = pdf.toString('latin1');
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('(Glosa \\(R$\\))');
    if (process.env.PDF_OUT) writeFileSync(join(process.env.PDF_OUT, 'imr.pdf'), pdf);
  });
});

describe('escritor de PDF: blocos novos', () => {
  const opcoes = { titulo: 'T', autor: 'A', rodape: 'R' };
  it('tabela comprida atravessa páginas repetindo o cabeçalho', () => {
    const linhas: LinhaPdf[] = [
      {
        texto: '',
        tabela: {
          colunas: [
            { titulo: 'Item', peso: 1 },
            { titulo: 'Texto', peso: 5 },
          ],
          linhas: Array.from({ length: 120 }, (_, i) => [String(i + 1), `linha ${i + 1} com texto`]),
        },
      },
    ];
    const s = gerarPdf(linhas, opcoes).toString('latin1');
    expect(Number(/\/Count (\d+)/.exec(s)![1])).toBeGreaterThan(2);
    expect(s.match(/\(Item\) Tj/g)!.length).toBe(Number(/\/Count (\d+)/.exec(s)![1]));
  });
  it('gráfico com mês sem valor interrompe a linha; série vazia escreve a mensagem', () => {
    const g = {
      rotulos: ['a', 'b', 'c'],
      valores: [1, null, 3],
      metas: [2, 2, 2],
      casas: 0,
    };
    const s = gerarPdf([{ texto: '', grafico: g }], opcoes).toString('latin1');
    expect(s).toMatch(/ m .* m .*S Q/s); // dois trechos separados na linha de valor
    const v = gerarPdf(
      [{ texto: '', grafico: { ...g, valores: [], metas: [], semSerie: 'Sem série' } }],
      opcoes
    );
    expect(v.toString('latin1')).toContain('(Sem s\\351rie)');
  });
  it('quebra de página força página nova', () => {
    const s = gerarPdf([{ texto: 'a' }, { texto: 'b', quebraDePagina: true }], opcoes).toString('latin1');
    expect(Number(/\/Count (\d+)/.exec(s)![1])).toBe(2);
  });
});
