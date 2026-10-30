/**
 * Aurora — o relatório de conformidade dos planos em Excel (REL-12).
 *
 * Os MESMOS números do JSON (`planComplianceReport`): aqui só se escolhe o tipo de cada célula.
 * Taxa e contagens como número (o Excel ordena e soma), e a fatia sem denominador como texto
 * "Sem denominador" — nunca zero, que diria "nada foi cumprido".
 *
 * A primeira aba é a DEFINIÇÃO: quem abre a planilha sem a tela precisa saber o que entra no
 * numerador e no denominador antes de comparar um plano com outro.
 */
import type { ComplianceRankRow } from '@aurora/contracts';
import type { AbaXlsx, CelulaXlsx } from '../documents/xlsx';

export interface DadosDaConformidade {
  definition: { numerator: string; denominator: string; formula: string };
  period: { from: string; to: string };
  totals: {
    scheduled: number;
    done: number;
    pending: number;
    late: number;
    skipped: number;
    denominator: number;
  };
  rate: number | null;
  byPlan: ComplianceRankRow[];
  byCustomer: ComplianceRankRow[];
  bySector: ComplianceRankRow[];
}

export const SEM_DENOMINADOR = 'Sem denominador';

const taxa = (v: number | null): CelulaXlsx =>
  v === null ? SEM_DENOMINADOR : { numero: v, formato: 'percentual' };
const inteiro = (v: number): CelulaXlsx => ({ numero: v, formato: 'inteiro' });

function abaDoRanking(nome: string, rotulo: string, linhas: ComplianceRankRow[]): AbaXlsx {
  return {
    nome,
    colunas: [
      { titulo: 'Posição', largura: 9 },
      { titulo: rotulo, largura: 40 },
      { titulo: 'Conformidade', largura: 14 },
      { titulo: 'Realizados', largura: 12 },
      { titulo: 'Programados − dispensados', largura: 26 },
      { titulo: 'Programados', largura: 13 },
      { titulo: 'Pendentes', largura: 11 },
      { titulo: 'Vencidos', largura: 10 },
      { titulo: 'Dispensados', largura: 12 },
    ],
    linhas: linhas.map((l) => [
      inteiro(l.position),
      l.label,
      taxa(l.rate),
      inteiro(l.done),
      inteiro(l.denominator),
      inteiro(l.scheduled),
      inteiro(l.pending),
      inteiro(l.late),
      inteiro(l.skipped),
    ]),
  };
}

export function abasDaConformidade(d: DadosDaConformidade): AbaXlsx[] {
  const definicao: AbaXlsx = {
    nome: 'Definição',
    colunas: [
      { titulo: 'Campo', largura: 24 },
      { titulo: 'Valor', largura: 110 },
    ],
    linhas: [
      ['Fórmula', d.definition.formula],
      ['Numerador', d.definition.numerator],
      ['Denominador', d.definition.denominator],
      ['Ordem do ranking', 'Maior conformidade primeiro; empate: mais atividades no denominador.'],
      ['Período (início)', d.period.from.slice(0, 10)],
      ['Período (fim, exclusivo)', d.period.to.slice(0, 10)],
      ['Conformidade geral', taxa(d.rate)],
      ['Realizados', inteiro(d.totals.done)],
      ['Programados − dispensados', inteiro(d.totals.denominator)],
      ['Programados', inteiro(d.totals.scheduled)],
      ['Dispensados', inteiro(d.totals.skipped)],
    ],
  };
  return [
    definicao,
    abaDoRanking('Por plano', 'Plano', d.byPlan),
    abaDoRanking('Por cliente', 'Cliente', d.byCustomer),
    abaDoRanking('Por setor', 'Setor', d.bySector),
  ];
}
