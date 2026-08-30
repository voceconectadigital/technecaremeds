/**
 * Aurora — metrologia: A FRONTEIRA (SPEC v0.2 §EPIC-019 · US-DOC-002).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE ARQUIVO EXISTE PARA SEPARAR DUAS COISAS QUE PARECEM UMA.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A metrologia do Aurora tem uma parte que é ARITMÉTICA DE CALENDÁRIO e uma
 * parte que é CIÊNCIA DE MEDIÇÃO. As duas moram no mesmo certificado, e
 * confundi-las é o erro que custa uma acreditação.
 *
 * O QUE ESTÁ AQUI — porque não há nada a inventar:
 *
 *   · um padrão estava válido na data da medição? É comparar duas datas. A
 *     regra vem escrita da SPEC, palavra por palavra, e não tem grau de
 *     liberdade nenhum;
 *   · a emissão pode acontecer? É conferir a lista acima para cada padrão
 *     usado, e nomear os que reprovaram.
 *
 * O QUE **NÃO** ESTÁ AQUI, E NÃO VAI ESTAR SEM UM METROLOGISTA:
 *
 *   · CÁLCULO DE INCERTEZA EXPANDIDA — composição das contribuições, graus de
 *     liberdade efetivos, fator de abrangência k;
 *   · CORREÇÃO DE ERRO SISTEMÁTICO;
 *   · CRITÉRIO DE ACEITAÇÃO por ponto e o VEREDITO que sai dele;
 *   · LIMITES NORMATIVOS de teste de segurança elétrica;
 *   · REGRA DE ARREDONDAMENTO e algarismos significativos do certificado.
 *
 * Cada um desses itens é uma decisão técnica com consequência regulatória, e a
 * própria SPEC diz por quê: "erro de cálculo metrológico tem consequência
 * regulatória — exige suíte de testes com casos de referência validados por um
 * metrologista antes do lançamento".
 *
 * Escrever uma fórmula plausível aqui seria pior do que não ter nada. Um campo
 * vazio a pessoa preenche; um número errado com cara de certo vai para um
 * certificado, o certificado vai para uma auditoria, e ninguém confere a conta
 * de um sistema que sempre respondeu.
 *
 * **Ver `docs/AURORA-METROLOGIA-FRONTEIRA.md`** para o que precisa ser validado,
 * por quem, e com quais casos de referência.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE A VALIDADE É AVALIADA NA DATA DA MEDIÇÃO, E NÃO NA DA EMISSÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * É a US-DOC-002, AC2: "padrão que vence entre a medição e a emissão — a
 * emissão é permitida, pois a validade é avaliada na data da medição".
 *
 * A razão é física, e não administrativa: o que o certificado afirma é o que o
 * instrumento fazia NAQUELE DIA, comparado com um padrão que naquele dia era
 * rastreável. O padrão vencer depois não desfaz a medição — desfazer seria
 * invalidar trabalho correto por burocracia. E o contrário — aceitar padrão
 * vencido NA medição porque ele "ainda estava no prazo quando a OS abriu" —
 * invalidaria a cadeia de rastreabilidade, que é a única coisa que dá valor ao
 * documento.
 *
 * O PDF registra AS DUAS DATAS, e é isso que permite a um auditor refazer o
 * raciocínio sem falar com ninguém.
 */

/* -------------------------------------------------------------------------- */
/* o padrão                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Um padrão de medição, como a emissão precisa vê-lo.
 *
 * Só o que a regra de data usa. O perfil de incerteza do padrão, a faixa e a
 * resolução também são dele — e ficam de fora daqui de propósito, porque
 * pertencem à parte que um metrologista precisa definir.
 */
export interface PadraoDeMedicao {
  /** Como ele aparece na recusa: "Multímetro de referência MM-04". */
  nome: string;
  /** O número do certificado do padrão, emitido pelo laboratório. */
  numeroDoCertificado: string;
  /** Quem emitiu — o laboratório acreditado. Vai no PDF, na rastreabilidade. */
  laboratorio: string;
  /**
   * O dia em que o certificado do padrão vence, em `YYYY-MM-DD`.
   *
   * DATA CIVIL, e não instante. Um certificado vence num DIA, não às 14h32 —
   * e tratar isso como instante faria a validade depender do fuso de quem
   * pergunta: o mesmo padrão seria válido em Manaus e vencido em Brasília, na
   * mesma medição.
   */
  venceEm: string;
}

/** O texto de uma reprovação, pronto para a pessoa ler. */
export interface PadraoReprovado {
  padrao: PadraoDeMedicao;
  motivo: string;
}

const DATA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O padrão estava válido no dia da medição?
 *
 * A comparação é de TEXTO, e isso é deliberado: datas civis em `YYYY-MM-DD`
 * ordenam lexicograficamente igual a como ordenam cronologicamente, e comparar
 * texto não passa por fuso, horário de verão nem construtor de `Date`. Um
 * `new Date('2026-03-15')` é meia-noite UTC, que no Brasil é o dia 14 — e o
 * padrão estaria vencido um dia antes do que deveria.
 *
 * O DIA DO VENCIMENTO AINDA VALE. Um certificado que diz "válido até
 * 2026-03-15" cobre o dia 15 inteiro; excluí-lo encurtaria em um dia toda
 * validade do sistema, e ninguém entenderia por quê.
 */
export function padraoValidoEm(padrao: PadraoDeMedicao, dataDaMedicao: string): boolean {
  if (!DATA_CIVIL.test(padrao.venceEm)) {
    throw new Error(
      `vencimento do padrão "${padrao.nome}" precisa ser uma data civil YYYY-MM-DD, e veio "${padrao.venceEm}"`
    );
  }
  if (!DATA_CIVIL.test(dataDaMedicao)) {
    throw new Error(`a data da medição precisa ser uma data civil YYYY-MM-DD, e veio "${dataDaMedicao}"`);
  }
  return dataDaMedicao <= padrao.venceEm;
}

/**
 * Quais padrões impedem a emissão deste certificado.
 *
 * Devolve TODOS os reprovados, e não o primeiro: quem vai resolver precisa
 * saber quantos padrões recalibrar antes de tentar de novo. Uma recusa por vez
 * transforma um problema em três idas ao laboratório.
 *
 * A recusa NOMEIA o padrão, o número do certificado e a data — é a AC1 da
 * US-DOC-002, e a razão é que "padrão vencido" sem dizer qual manda a pessoa
 * conferir a papelada de todos.
 */
export function padroesQueImpedemEmissao(
  padroes: readonly PadraoDeMedicao[],
  dataDaMedicao: string
): PadraoReprovado[] {
  return padroes
    .filter((p) => !padraoValidoEm(p, dataDaMedicao))
    .map((padrao) => ({
      padrao,
      motivo:
        `o certificado ${padrao.numeroDoCertificado} do padrão "${padrao.nome}" ` +
        `(${padrao.laboratorio}) venceu em ${padrao.venceEm}, antes da medição de ${dataDaMedicao}`,
    }));
}

/**
 * A cadeia de rastreabilidade está completa?
 *
 * Um padrão sem laboratório ou sem número de certificado quebra a cadeia — e a
 * cadeia é a única coisa que faz um certificado de calibração valer mais do que
 * uma planilha. Um certificado emitido com a cadeia furada passa despercebido
 * até a auditoria, que é o pior momento para descobrir.
 *
 * Isto é conferência de PREENCHIMENTO, não de ciência: ou o campo está lá, ou
 * não está.
 */
export function furosNaRastreabilidade(padroes: readonly PadraoDeMedicao[]): string[] {
  const furos: string[] = [];
  if (padroes.length === 0) {
    furos.push('nenhum padrão foi declarado: sem padrão não há rastreabilidade');
  }
  for (const p of padroes) {
    if (!p.numeroDoCertificado.trim()) {
      furos.push(`o padrão "${p.nome}" está sem número de certificado`);
    }
    if (!p.laboratorio.trim()) {
      furos.push(`o padrão "${p.nome}" está sem o laboratório que o certificou`);
    }
  }
  return furos;
}

/* -------------------------------------------------------------------------- */
/* o que está bloqueado                                                       */
/* -------------------------------------------------------------------------- */

/**
 * As decisões metrológicas que este sistema NÃO toma — e não vai tomar sem que
 * um metrologista as defina e valide com casos de referência.
 *
 * A lista é código, e não comentário, de propósito: ela é lida pela prova que
 * garante que nenhuma delas apareceu implementada por acidente, e pelo
 * documento que a apresenta a quem for validá-las. Um item que sair daqui sai
 * porque alguém o validou — e o teste obriga a mexer nos dois lugares.
 */
export const DECISOES_METROLOGICAS_BLOQUEADAS = [
  {
    chave: 'incerteza_expandida',
    titulo: 'Cálculo de incerteza expandida',
    porque:
      'compor contribuições, apurar graus de liberdade efetivos e escolher o fator de abrangência k são decisões técnicas com consequência regulatória',
    precisaDe: 'o procedimento do laboratório e casos de referência com resultado conhecido',
  },
  {
    chave: 'erro_sistematico',
    titulo: 'Correção de erro sistemático',
    porque: 'aplicar ou não a correção, e com que sinal, muda o veredito do ponto medido',
    precisaDe: 'a política do laboratório, por escrito',
  },
  {
    chave: 'criterio_de_aceitacao',
    titulo: 'Critério de aceitação e veredito por ponto',
    porque:
      'o limite aceitável depende da norma aplicável ao equipamento, e não do sistema que registra a medição',
    precisaDe: 'a norma, a faixa e a tolerância de cada tipo de equipamento',
  },
  {
    chave: 'limites_seguranca_eletrica',
    titulo: 'Limites normativos de segurança elétrica',
    porque:
      'os limites vêm de norma e mudam por classe e tipo de parte aplicada; inventá-los aprovaria equipamento reprovado',
    precisaDe: 'a norma vigente e a classificação de cada equipamento',
  },
  {
    chave: 'arredondamento',
    titulo: 'Arredondamento e algarismos significativos',
    porque:
      'arredondar antes de comparar com a tolerância pode transformar reprovado em aprovado — e o inverso',
    precisaDe: 'a regra do laboratório, e casos de referência no limite',
  },
] as const;

export type DecisaoMetrologicaBloqueada = (typeof DECISOES_METROLOGICAS_BLOQUEADAS)[number]['chave'];
