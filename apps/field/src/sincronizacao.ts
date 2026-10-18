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
import type { ArmazenamentoOffline } from './armazenamento';
import { MENSAGEM_SESSAO_EXPIRADA, mesmaIdentidade, type FilaDeSaida, type Identidade } from './fila';
import { CHAVE_DA_CONFIGURACAO, type ConfiguracaoDoCampo } from './parecer';

/**
 * A credencial venceu ao pedir o dia (401). Lançada por quem baixa o pacote,
 * para esta camada não confundir "entre de novo" com "sem rede" nem com
 * "o servidor caiu" — as três pedem coisas diferentes de quem está em campo.
 */
export class ErroDeSessaoExpirada extends Error {
  constructor() {
    super(MENSAGEM_SESSAO_EXPIRADA);
    this.name = 'ErroDeSessaoExpirada';
  }
}

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
  /**
   * O cronômetro aberto desta pessoa (PF-65). Opcional: um servidor anterior
   * não manda, e aí a coleção local não é tocada.
   */
  open_timers?: { id: string; work_order_id: string; started_at: string }[];
  /**
   * Regras da organização aplicadas offline (PF-41). Opcional pelo mesmo
   * motivo: sem ela, o aparelho mantém a que tinha.
   */
  settings?: ConfiguracaoDoCampo;
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
  /**
   * O servidor respondeu 401: a sessão venceu. A fila fica INTACTA e parada, e
   * a tela pede para entrar de novo — em vez de mandar o dia para a atenção.
   */
  sessaoExpirada: boolean;
}

/**
 * O que a tela mostra no lugar do texto cru do erro.
 *
 * "Failed to fetch" é a mensagem do navegador para "não houve resposta", em
 * inglês, e ela aparecia literalmente na tela da sincronização e embaixo de
 * cada comando esperando. Para quem está no subsolo, a informação útil é outra:
 * o trabalho está guardado e vai sozinho. O texto original continua no comando
 * (é o que diagnostica); só a TELA traduz.
 */
export function mensagemParaATela(falha: string | null | undefined): string | null {
  if (!falha) return null;
  if (ehFalhaDeRede(new Error(falha))) {
    return 'Sem conexão com o servidor. O trabalho fica guardado no aparelho e é enviado quando a rede voltar.';
  }
  const status = /o servidor respondeu (\d{3})/.exec(falha)?.[1];
  if (status) {
    return `O servidor não conseguiu atender agora (código ${status}). O aparelho tenta de novo sozinho.`;
  }
  return falha;
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
  /**
   * Vem INTEIRO em toda descida, inclusive na incremental — e por isso
   * substitui. É o caso do cronômetro aberto: parado na web, ele precisa sumir
   * do aparelho, e o corte incremental nunca traria a ausência dele.
   */
  sempreInteiro?: boolean;
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
  { campo: 'open_timers', colecao: 'cronometros', chave: (r) => String(r.id), sempreInteiro: true },
];

export interface DependenciasDaSincronizacao {
  baixarPacote(desde: string | null): Promise<PacoteDoDia>;
  agora(): Date;
  /** A identidade da sessão atual. Ver `conferirIdentidade`. */
  identidade?(): Identidade | null;
}

export class Sincronizacao {
  constructor(
    private readonly base: ArmazenamentoOffline,
    private readonly fila: FilaDeSaida,
    private readonly deps: DependenciasDaSincronizacao
  ) {}

  /** O instante do último pacote que chegou INTEIRO. */
  async ultimaMarca(): Promise<string | null> {
    const meta = this.base.colecao<{ valor: string }>('meta');
    return (await meta.ler('synced_at'))?.valor ?? null;
  }

  /**
   * O DIA BAIXADO É DE UMA SESSÃO, e não do aparelho.
   *
   * O servidor filtra o pacote por quem pediu (as OS atribuídas a ela, na
   * organização escolhida), mas a marca `synced_at` era uma só por aparelho.
   * Trocar de pessoa ou de organização fazia a próxima sincronização ser
   * INCREMENTAL a partir da marca do outro: o novo dono via as OS de quem saiu
   * e não recebia as dele que não mudaram desde então.
   *
   * Quando a identidade muda, o que foi BAIXADO é limpo e a marca some — a
   * próxima descida é completa. A fila, a atenção, os anexos e os rascunhos NÃO
   * são tocados: são trabalho de alguém, e a fila sabe de quem (ver
   * `Identidade` em `fila.ts`).
   *
   * Marca sem identidade gravada (aparelho que veio da versão anterior) é
   * adotada pela sessão atual, sem limpar — é o que a versão anterior faria.
   */
  private async conferirIdentidade(atual: Identidade): Promise<void> {
    const meta = this.base.colecao<Identidade>('meta');
    const anterior = await meta.ler('identidade');
    if (anterior && mesmaIdentidade(anterior, atual)) {
      // Completa o que a sessão antiga não sabia (o e-mail), sem limpar nada.
      if (!anterior.usuario && atual.usuario) await meta.gravar('identidade', atual);
      return;
    }
    if (anterior) {
      for (const d of DESTINOS) await this.base.colecao(d.colecao).limpar();
      await this.base.colecao('meta').apagar('synced_at');
      // A regra é da ORGANIZAÇÃO: a da sessão anterior não vale para esta.
      await this.base.colecao('meta').apagar(CHAVE_DA_CONFIGURACAO);
    }
    await meta.gravar('identidade', atual);
  }

  async rodar(): Promise<ResultadoDaSincronizacao> {
    const em = this.deps.agora().toISOString();

    const identidade = this.deps.identidade?.() ?? null;
    if (identidade) await this.conferirIdentidade(identidade);

    // SUBIR PRIMEIRO. Ver a nota do cabeçalho.
    const { enviados, recusados, sessaoExpirada } = await this.fila.escoar();

    const expirou = (): ResultadoDaSincronizacao => ({
      enviados,
      recusados,
      baixados: {},
      em,
      falha: MENSAGEM_SESSAO_EXPIRADA,
      semRede: false,
      sessaoExpirada: true,
    });
    // Com a credencial vencida, pedir o dia só traria outro 401.
    if (sessaoExpirada) return expirou();

    let pacote: PacoteDoDia;
    try {
      pacote = await this.deps.baixarPacote(await this.ultimaMarca());
    } catch (e) {
      if (e instanceof ErroDeSessaoExpirada) return expirou();
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
        sessaoExpirada: false,
      };
    }

    const baixados: Record<string, number> = {};
    for (const d of DESTINOS) {
      // Campo que o servidor não mandou não apaga o que o aparelho sabe.
      if (d.sempreInteiro && pacote[d.campo] === undefined) continue;
      const linhas = (pacote[d.campo] ?? []) as unknown as Record<string, unknown>[];
      const colecao = this.base.colecao<Record<string, unknown>>(d.colecao);

      /*
       * O PACOTE COMPLETO SUBSTITUI; O INCREMENTAL SOBREPÕE.
       *
       * Limpar sempre apagaria, na sincronização incremental, tudo que não
       * mudou — que é quase tudo. O técnico ficaria com uma OS na tela porque
       * foi a única alterada desde a manhã.
       */
      if (!pacote.incremental || d.sempreInteiro) await colecao.limpar();
      for (const linha of linhas) await colecao.gravar(d.chave(linha), linha);
      baixados[d.colecao] = linhas.length;
    }

    // As regras da organização vêm inteiras em toda descida (PF-41).
    if (pacote.settings) {
      await this.base.colecao<ConfiguracaoDoCampo>('meta').gravar(CHAVE_DA_CONFIGURACAO, {
        require_operational_result: pacote.settings.require_operational_result === true,
      });
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

    return { enviados, recusados, baixados, em, falha: null, semRede: false, sessaoExpirada: false };
  }
}
