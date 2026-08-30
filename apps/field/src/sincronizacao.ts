/**
 * Aurora — descer o dia e subir o trabalho (SPEC v0.2 §20 · EPIC-014).
 *
 * DUAS DIREÇÕES, E A ORDEM ENTRE ELAS IMPORTA.
 *
 * Subir primeiro, descer depois. Se o pacote descesse antes, ele sobrescreveria
 * a base local com o estado do servidor — que ainda não sabe do trabalho que
 * está na fila. O técnico veria a OS voltar para "em execução" depois de ter
 * concluído, e concluiria de novo.
 *
 * A REDE NÃO É PERGUNTADA, É TENTADA.
 *
 * `navigator.onLine` mente nos dois sentidos: diz `true` num wi-fi de hospital
 * que não roteia nada, e `false` em algumas VPNs. Usá-lo para decidir se vale a
 * pena tentar produziria um aparelho que não sincroniza estando conectado. Aqui
 * ele serve só para a TELA dizer o que provavelmente está acontecendo.
 */
import type { BaseLocal } from './armazenamento';
import type { FilaDeSaida } from './fila';

/** O que o servidor devolve em `/field/sync`. Só o que esta camada usa. */
export interface PacoteDoDia {
  synced_at: string;
  incremental: boolean;
  work_orders: { id: string }[];
  assets: { id: string }[];
  locations: { id: string }[];
  checklist_templates: { id: string }[];
  catalogs: { id: string }[];
  statuses: { id: string }[];
  transitions: { from_key: string; to_key: string }[];
  wait_reasons: { id: string }[];
  stock: { item_id: string; warehouse_id: string }[];
  counts: Record<string, number>;
}

export interface ResultadoDaSincronizacao {
  enviados: number;
  recusados: number;
  baixados: Record<string, number>;
  em: string;
  /** O que impediu, quando impediu. A tela mostra isto, e não "erro". */
  falha: string | null;
  /**
   * A falha foi de REDE, e não do servidor.
   *
   * A distinção decide o que a tela diz. "Sem rede" é uma situação normal
   * deste aplicativo e a pessoa sabe o que fazer com ela — sair do subsolo.
   * "O servidor respondeu 500" é outra coisa inteiramente, e chamá-la de falta
   * de rede mandaria o técnico procurar sinal por uma hora.
   *
   * E é esta a fonte de verdade do indicador, e não `navigator.onLine`: aquele
   * mente nos dois sentidos — diz `true` num wi-fi de hospital que não roteia
   * nada. O aplicativo sabe que está sem rede porque TENTOU.
   */
  semRede: boolean;
}

/**
 * O `fetch` falhando por rede lança `TypeError`, e não devolve status.
 *
 * A checagem também olha o texto porque o navegador varia a mensagem, e porque
 * um erro nosso lançado no meio do caminho não pode ser confundido com falta de
 * sinal.
 */
function ehFalhaDeRede(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const texto = e instanceof Error ? e.message : String(e);
  return /failed to fetch|networkerror|network request failed|load failed|err_internet/i.test(texto);
}

/**
 * As coleções do pacote e a chave de cada registro.
 *
 * `transitions` e `stock` não têm identificador próprio: a chave é composta.
 * Sem isto, cada sincronização sobrescreveria a mesma linha e o aparelho
 * ficaria com uma transição só — e uma tela offline sem grafo oferece todos os
 * botões, o que é a origem de metade dos conflitos de um dia.
 */
const DESTINOS: {
  campo: keyof PacoteDoDia;
  colecao: string;
  chave: (r: Record<string, unknown>) => string;
}[] = [
  { campo: 'work_orders', colecao: 'ordens', chave: (r) => String(r.id) },
  { campo: 'assets', colecao: 'ativos', chave: (r) => String(r.id) },
  { campo: 'locations', colecao: 'locais', chave: (r) => String(r.id) },
  { campo: 'checklist_templates', colecao: 'checklists', chave: (r) => String(r.id) },
  { campo: 'catalogs', colecao: 'catalogos', chave: (r) => String(r.id) },
  { campo: 'statuses', colecao: 'situacoes', chave: (r) => String(r.id) },
  {
    campo: 'transitions',
    colecao: 'transicoes',
    chave: (r) => `${String(r.from_key)}->${String(r.to_key)}`,
  },
  { campo: 'wait_reasons', colecao: 'motivos', chave: (r) => String(r.id) },
  {
    campo: 'stock',
    colecao: 'estoque',
    chave: (r) => `${String(r.item_id)}@${String(r.warehouse_id)}`,
  },
];

export interface DependenciasDaSincronizacao {
  baixarPacote(desde: string | null): Promise<PacoteDoDia>;
  agora(): Date;
}

export class Sincronizacao {
  constructor(
    private readonly base: BaseLocal,
    private readonly fila: FilaDeSaida,
    private readonly deps: DependenciasDaSincronizacao
  ) {}

  /** O instante do último pacote que chegou INTEIRO. */
  async ultimaMarca(): Promise<string | null> {
    const meta = this.base.colecao<{ valor: string }>('meta');
    return (await meta.ler('synced_at'))?.valor ?? null;
  }

  async rodar(): Promise<ResultadoDaSincronizacao> {
    const em = this.deps.agora().toISOString();

    // SUBIR PRIMEIRO. Ver a nota do cabeçalho.
    const { enviados, recusados } = await this.fila.escoar();

    let pacote: PacoteDoDia;
    try {
      pacote = await this.deps.baixarPacote(await this.ultimaMarca());
    } catch (e) {
      /*
       * O QUE SUBIU, SUBIU. Falhar ao descer não desfaz o que foi enviado — e
       * o número precisa aparecer na tela, ou o técnico veria "falhou" depois
       * de a fila ter esvaziado, e sincronizaria de novo por desconfiança.
       */
      return {
        enviados,
        recusados,
        baixados: {},
        em,
        falha: e instanceof Error ? e.message : 'não foi possível baixar o dia',
        semRede: ehFalhaDeRede(e),
      };
    }

    const baixados: Record<string, number> = {};
    for (const d of DESTINOS) {
      const linhas = (pacote[d.campo] ?? []) as unknown as Record<string, unknown>[];
      const colecao = this.base.colecao<Record<string, unknown>>(d.colecao);

      /*
       * O PACOTE COMPLETO SUBSTITUI; O INCREMENTAL SOBREPÕE.
       *
       * Limpar sempre apagaria, na sincronização incremental, tudo que não
       * mudou — que é quase tudo. O técnico ficaria com uma OS na tela porque
       * foi a única alterada desde a manhã.
       */
      if (!pacote.incremental) await colecao.limpar();
      for (const linha of linhas) await colecao.gravar(d.chave(linha), linha);
      baixados[d.colecao] = linhas.length;
    }

    /*
     * A MARCA É GRAVADA POR ÚLTIMO, e só se tudo acima passou.
     *
     * Gravá-la antes faria uma falha no meio deixar o aparelho achando que
     * baixou o dia inteiro — e a próxima sincronização incremental pularia
     * justamente o que faltou. O pior caso desta ordem é baixar de novo o que
     * já estava; o pior caso da outra é um dia com buracos.
     */
    await this.base.colecao<{ valor: string }>('meta').gravar('synced_at', { valor: pacote.synced_at });

    return { enviados, recusados, baixados, em, falha: null, semRede: false };
  }
}
