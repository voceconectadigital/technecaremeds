/**
 * Aurora — a fila de saída (SPEC v0.2 §20 · EPIC-014).
 *
 * ESTE É O ARQUIVO EM QUE A PERDA DE TRABALHO ACONTECE OU NÃO ACONTECE.
 *
 * A SPEC nomeia o risco: "perda silenciosa de trabalho é o defeito mais grave
 * possível". Toda decisão aqui é uma resposta a isso, e a regra que organiza
 * todas elas é uma só:
 *
 *   NADA SAI DA FILA SEM UMA RESPOSTA DO SERVIDOR SOBRE AQUELE COMANDO.
 *
 * Não sai por tempo, não sai por número de tentativas, não sai por erro de
 * rede, não sai por o aparelho achar que "provavelmente foi". Sai quando o
 * servidor disse "feito" — ou quando disse "recusado", e aí vai para a tela de
 * atenção, que é o outro lugar onde trabalho pode esperar por gente.
 *
 * QUATRO DECISÕES
 *
 * 1. ORDEM POR AGREGADO, E NÃO GLOBAL
 *    Comandos da mesma OS são aplicados em sequência; comandos de OS diferentes
 *    podem ir em paralelo (§20). Uma fila global faria a OS travada bloquear as
 *    outras sete do dia — e o técnico ficaria sem sincronizar nada porque uma
 *    delas conflitou.
 *
 * 2. O IDENTIFICADOR NASCE COM O COMANDO, E NUNCA MUDA
 *    É gerado no momento em que a pessoa toca o botão, antes de qualquer
 *    tentativa, e vai igual em todas elas. É o que faz a retentativa ser
 *    reconhecida como retentativa pelo servidor.
 *
 * 3. UM AGREGADO PARADO NÃO PARA O DIA
 *    Quando um comando falha por conflito, os seguintes DAQUELA OS ficam
 *    parados — aplicá-los sobre um estado que já divergiu produziria lixo. Os
 *    das outras seguem.
 *
 * 4. A ESPERA CRESCE, MAS TEM TETO
 *    Retentativa imediata em rede intermitente vira uma tempestade de
 *    requisições que gasta a bateria e não entrega nada. E uma espera sem teto
 *    faz o aparelho que reencontrou sinal ficar dez minutos sem tentar.
 */

/**
 * DE QUEM É O TRABALHO: a organização e a pessoa da sessão que o criou.
 *
 * A fila mora no APARELHO, e o aparelho não é de uma pessoa só — o celular da
 * equipe passa de mão no fim do turno, e um técnico pode atender por duas
 * prestadoras. Sem isto, o cabeçalho de autenticação era lido na hora do ENVIO:
 * o "concluir" que Ana tocou às 15h sairia às 19h com a credencial de Bruno, ou
 * na organização errada — e o servidor aceitaria, porque para ele é um pedido
 * válido de quem está logado.
 *
 * `usuario` é o e-mail com que a pessoa entrou neste aparelho; `organizacao`, a
 * escolhida na entrada. Os dois podem faltar em sessões abertas antes desta
 * versão — ver `mesmaIdentidade`.
 */
export interface Identidade {
  organizacao: string | null;
  usuario: string | null;
}

/**
 * O comando pertence à sessão atual?
 *
 * COMPATIBILIDADE COM O QUE JÁ ESTÁ NOS APARELHOS: comando SEM identidade foi
 * gravado por uma versão que não carimbava dono, e é tratado como da sessão
 * atual — que é o que a versão anterior fazia com ele. Recusá-lo deixaria
 * preso para sempre o trabalho de quem atualizou o aplicativo no meio do dia.
 *
 * Cada metade só é comparada quando os DOIS lados a conhecem: uma sessão aberta
 * antes desta versão não sabe o e-mail de quem entrou, e isso não pode bastar
 * para parar a fila de quem só atualizou o aplicativo. A organização, quando
 * conhecida dos dois lados, decide sozinha — mandar trabalho para a prestadora
 * errada é o erro que não tem volta.
 */
export function mesmaIdentidade(dono: Identidade | null | undefined, atual: Identidade | null): boolean {
  if (!dono || !atual) return true;
  if (dono.organizacao && atual.organizacao && dono.organizacao !== atual.organizacao) return false;
  if (dono.usuario && atual.usuario && dono.usuario !== atual.usuario) return false;
  return true;
}

/** O que o aparelho manda quando reencontra sinal. */
export interface ComandoNaFila {
  /** Gerado no aparelho, no momento do toque. Vai igual em toda tentativa. */
  id: string;
  /**
   * A POSIÇÃO NA FILA — e é ela que ordena, não o relógio.
   *
   * A primeira versão ordenava por `criadoEm`. Dois comandos enfileirados no
   * MESMO milissegundo — o que uma tela que salva vários campos de uma vez faz
   * o tempo todo — ficavam com o mesmo instante, e a comparação "veio depois"
   * era falsa para os dois. O efeito: o travamento por conflito não travava
   * nada, e os comandos seguintes de uma OS que já divergiu seguiam para o
   * servidor.
   *
   * O relógio também é a coisa errada por princípio aqui: a SPEC lista
   * "relógio do dispositivo errado" entre os casos de borda, e um aparelho com
   * a hora trocada reordenaria a fila inteira. Um número que só cresce não tem
   * esse problema.
   */
  seq: number;
  /** 'work_order:<uuid>' — o que sequencia. Ver decisão 1. */
  agregado: string;
  metodo: 'POST' | 'PATCH' | 'PUT';
  caminho: string;
  corpo: unknown;
  /** O que a tela mostra: "Concluir OS-0042". */
  rotulo: string;
  criadoEm: string;
  tentativas: number;
  /** Quando faz sentido tentar de novo. Ver decisão 4. */
  proximaTentativaEm: string;
  ultimoErro: string | null;
  /**
   * Parado porque um comando ANTERIOR do mesmo agregado conflitou.
   *
   * Não é erro deste comando: é a consequência de o mundo ter mudado antes
   * dele. Ele fica intacto, esperando a decisão sobre o outro.
   */
  bloqueado: boolean;
  /**
   * Quem criou o comando. Ver `Identidade`. Ausente nos comandos gravados por
   * versões anteriores — e esses são tratados como da sessão atual.
   */
  identidade?: Identidade;
}

/** O que o servidor recusou, esperando decisão de gente. */
export interface PendenciaDeAtencao {
  id: string;
  agregado: string;
  rotulo: string;
  caminho: string;
  corpo: unknown;
  codigo: string;
  mensagem: string;
  recusadoEm: string;
  /**
   * O COMANDO ORIGINAL, inteiro, como estava na fila.
   *
   * É o que permite "Tentar de novo" REENVIAR o que foi recusado. A primeira
   * versão guardava só o corpo para mostrar — e o botão apagava a pendência e
   * soltava os comandos seguintes, mas o recusado nunca voltava à fila: o
   * "concluir" com a resolução de duas horas sumia no toque que prometia
   * reenviá-lo. Ausente nas pendências gravadas antes desta versão; para elas o
   * reenvio é remontado a partir do que a pendência tem.
   */
  comando?: ComandoNaFila;
}

export interface RespostaDoEnvio {
  status: number;
  corpo: unknown;
}

/** O que a fila precisa do mundo. Injetado para a suíte poder decidir tudo. */
export interface DependenciasDaFila {
  enviar(c: ComandoNaFila): Promise<RespostaDoEnvio>;
  agora(): Date;
  /** Gerado aqui e não no `enviar`: ver decisão 2. */
  novoId(): string;
  /**
   * Avisa que um comando foi ACEITO, com a resposta do servidor.
   *
   * Existe por causa dos anexos, e o desenho é deliberado. Registrar uma foto
   * devolve a chave de armazenamento que o servidor escolheu — e sem essa
   * chave os bytes não têm para onde ir. A fila não conhece anexo, nem deve:
   * ela avisa que o comando passou e entrega a resposta, e quem conhece anexo
   * faz o resto.
   *
   * A alternativa — a fila saber tratar cada tipo de comando — transformaria o
   * arquivo mais crítico do aplicativo num lugar onde regra de negócio se
   * acumula.
   *
   * Uma falha aqui NÃO desfaz o comando: ele foi aceito pelo servidor, e voltar
   * a enfileirá-lo produziria a duplicata que tudo isto existe para impedir.
   */
  aoConcluir?(c: ComandoNaFila, corpo: unknown): Promise<void>;
  /**
   * Última chance de completar o corpo com algo que só o SERVIDOR sabia.
   *
   * Existe por um caso concreto e inevitável: a assinatura aponta para o anexo
   * da imagem por `attachment_id` — e esse identificador é escolhido pelo
   * servidor, no registro do anexo, que no meio do mato ainda não aconteceu. No
   * momento do toque não há o que colocar ali.
   *
   * Adiar o comando não serve (a pessoa assinou, e o trabalho tem de ficar
   * guardado); mandar o identificador local não serve (o servidor recusa por
   * chave estrangeira, e o trabalho vai para a tela de atenção sem culpa de
   * ninguém). Então o comando fica na fila com uma REFERÊNCIA no lugar do
   * valor, e esta função a troca pelo valor de verdade um instante antes do
   * envio — quando o comando anterior do mesmo agregado já voltou do servidor.
   *
   * Devolver `{ pronto: false }` significa "a referência ainda não existe": o
   * comando FICA na fila, intacto, e o agregado inteiro espera — exatamente
   * como faz quando não há rede.
   *
   * A fila continua sem conhecer anexo: ela sabe que um corpo pode depender de
   * uma resposta anterior, e quem conhece anexo resolve.
   */
  resolverCorpo?(
    c: ComandoNaFila
  ): Promise<{ pronto: true; corpo: unknown } | { pronto: false; motivo: string }>;
  /**
   * A identidade da sessão ATUAL — ver `Identidade`. Carimbada no comando ao
   * enfileirar e conferida antes de cada envio. `null`, ou ausente, desliga a
   * conferência (a suíte antiga, e o aparelho sem sessão).
   */
  identidade?(): Identidade | null;
}

/** O desfecho de uma passada de escoamento. */
export interface ResultadoDoEscoamento {
  enviados: number;
  recusados: number;
  /**
   * O servidor respondeu 401: a credencial venceu (a sessão dura doze horas
   * sem uso no servidor). Presente só quando aconteceu.
   */
  sessaoExpirada?: true;
}

/** O texto que fica no comando parado por credencial vencida. */
export const MENSAGEM_SESSAO_EXPIRADA = 'A sessão expirou. Entre de novo para enviar — nada foi perdido.';

const MAX_ESPERA_MS = 60_000;
const BASE_ESPERA_MS = 2_000;

/**
 * A espera antes da próxima tentativa.
 *
 * Dobra a cada falha até um minuto. O teto existe porque o caso comum não é
 * "servidor fora do ar por horas": é o técnico saindo do subsolo. Uma espera
 * exponencial sem teto faria o aparelho que acabou de reencontrar sinal ficar
 * quinze minutos parado — e o técnico veria "3 pendências" durante todo o
 * caminho de volta, sem entender por quê.
 */
export function esperaApos(tentativas: number): number {
  return Math.min(BASE_ESPERA_MS * 2 ** Math.max(0, tentativas - 1), MAX_ESPERA_MS);
}

/**
 * Os desfechos que significam "o mundo mudou", e não "a rede falhou".
 *
 * A distinção decide tudo: rede falhou é para tentar de novo; mundo mudou é
 * para PARAR e chamar gente. Confundi-los produz ou uma fila que tenta para
 * sempre um comando que nunca vai passar, ou uma que desiste de algo que só
 * precisava de mais trinta segundos.
 */
function ehRecusaDefinitiva(status: number): boolean {
  // 408 e 429 são "tente de novo" com roupa de erro do cliente; 5xx é o
  // servidor, e o servidor volta.
  if (status === 408 || status === 429) return false;
  /*
   * 401 NÃO É O MUNDO MUDANDO: é a credencial que venceu.
   *
   * A sessão expira depois de doze horas sem uso no servidor — exatamente o
   * turno de quem passou o dia no subsolo. Tratá-lo como recusa despejava a
   * fila INTEIRA na tela de atenção no momento em que o técnico reencontrava
   * sinal, cada comando "recusado" por um motivo que não tem nada a ver com
   * ele. Ver o tratamento em `escoar`.
   *
   * O 403 continua sendo recusa: pode ser permissão retirada de verdade, e aí
   * é decisão de gente. Mas ele vai para a atenção com o comando inteiro, e
   * "Tentar de novo" o devolve à fila — depois de entrar de novo, passa.
   */
  if (status === 401) return false;
  return status >= 400 && status < 500;
}

export interface EstadoDaFila {
  pendentes: number;
  bloqueados: number;
  atencao: number;
  /**
   * Comandos de OUTRA sessão — outra pessoa ou outra organização neste
   * aparelho. Ficam guardados, não são enviados com a credencial de quem está
   * agora, e esperam o dono entrar de novo. Ver `Identidade`.
   */
  deOutraSessao: number;
  /** O comando mais antigo esperando. É o que a tela mostra como "desde". */
  maisAntigoEm: string | null;
}

export class FilaDeSaida {
  constructor(
    private readonly comandos: {
      ler(k: string): Promise<ComandoNaFila | undefined>;
      gravar(k: string, v: ComandoNaFila): Promise<void>;
      apagar(k: string): Promise<void>;
      todos(): Promise<ComandoNaFila[]>;
    },
    private readonly atencao: {
      gravar(k: string, v: PendenciaDeAtencao): Promise<void>;
      apagar(k: string): Promise<void>;
      todos(): Promise<PendenciaDeAtencao[]>;
    },
    private readonly deps: DependenciasDaFila
  ) {}

  /*
   * AS ESCRITAS QUE LEEM ANTES DE GRAVAR ANDAM EM FILA INDIANA.
   *
   * `enfileirar` lê a maior posição e grava a seguinte. Dois toques quase
   * juntos — a foto e o registro da assinatura, que a tela dispara em
   * sequência sem esperar — liam o MESMO máximo e gravavam a MESMA posição; a
   * ordem entre os dois passava a depender de como o armazenamento desempata,
   * e o "concluir" podia sair antes do "iniciar". Uma corrente de promessas
   * basta: tudo aqui roda num processo só.
   *
   * O `escoar` NÃO entra nesta corrente: ele espera a rede, e o toque do
   * técnico não pode esperar a rede para ser guardado.
   */
  private trava: Promise<unknown> = Promise.resolve();

  private emSerie<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.trava.then(fn, fn);
    this.trava = r.catch(() => undefined);
    return r;
  }

  /*
   * UM ESCOAMENTO DE CADA VEZ.
   *
   * O escoamento é chamado por cada toque, pelo relógio e pelo aviso de rede —
   * e três ao mesmo tempo mandavam o MESMO comando três vezes. A idempotência
   * do servidor segura a duplicata, mas a segunda resposta chega para um
   * comando que a primeira já tirou da fila, e o aviso de conclusão do anexo
   * rodava duas vezes. Quem chama durante uma passada recebe o desfecho dela;
   * quem enfileirou no meio é pego pela próxima (a sincronização repete).
   */
  private escoando: Promise<ResultadoDoEscoamento> | null = null;

  /** A identidade da sessão atual, quando quem montou a fila a informa. */
  private identidadeAtual(): Identidade | null {
    return this.deps.identidade?.() ?? null;
  }

  /** O comando é desta sessão? Ver `mesmaIdentidade`. A tela usa para separar. */
  daSessaoAtual(c: ComandoNaFila): boolean {
    return mesmaIdentidade(c.identidade, this.identidadeAtual());
  }

  /**
   * Enfileira um comando. Devolve o identificador que vai ao servidor.
   *
   * A GRAVAÇÃO ACONTECE ANTES DE QUALQUER TENTATIVA, sempre — inclusive com
   * sinal cheio. Tentar primeiro e guardar só se falhar abre uma janela em que
   * o aplicativo pode ser fechado, a aba recarregada ou a bateria acabar com o
   * comando existindo apenas na memória. Nessa janela, o trabalho some sem
   * deixar rastro.
   */
  async enfileirar(entrada: {
    agregado: string;
    metodo: ComandoNaFila['metodo'];
    caminho: string;
    corpo: unknown;
    rotulo: string;
    /**
     * O IDENTIFICADOR DA OPERAÇÃO, quando quem chama já tem um.
     *
     * O anexo precisa disto: o `client_operation_id` do comando que registra a
     * foto é o mesmo identificador da foto no aparelho, e é por ele que o aviso
     * de conclusão reencontra o anexo para guardar a chave do servidor.
     *
     * Sem isto a fila sorteava um identificador próprio, `aoConcluir` procurava
     * um anexo que não existia com aquele nome, saía em silêncio — e a foto
     * ficava em "capturado" para sempre, sem nunca subir os bytes. Foi o que o
     * teste de sobrevivência offline pegou.
     */
    id?: string;
  }): Promise<string> {
    return this.emSerie(() => this.enfileirarAgora(entrada));
  }

  private async enfileirarAgora(entrada: Parameters<FilaDeSaida['enfileirar']>[0]): Promise<string> {
    const id = entrada.id ?? this.deps.novoId();
    const agora = this.deps.agora().toISOString();
    const identidade = this.identidadeAtual();

    /*
     * A posição é lida do ARMAZENAMENTO, e não de um contador em memória.
     *
     * O aplicativo é fechado e reaberto o tempo todo — o sistema recuperando
     * memória, a pessoa trocando de aplicativo. Um contador de instância
     * voltaria a zero a cada reabertura, e os comandos do resto do dia
     * disputariam posição com os da manhã.
     */
    const existentes = await this.comandos.todos();
    const seq = existentes.reduce((maior, c) => Math.max(maior, c.seq), 0) + 1;

    await this.comandos.gravar(id, {
      id,
      seq,
      agregado: entrada.agregado,
      metodo: entrada.metodo,
      caminho: entrada.caminho,
      corpo: entrada.corpo,
      rotulo: entrada.rotulo,
      criadoEm: agora,
      tentativas: 0,
      proximaTentativaEm: agora,
      ultimoErro: null,
      bloqueado: false,
      ...(identidade ? { identidade } : {}),
    });
    return id;
  }

  /**
   * Tenta escoar a fila.
   *
   * Devolve quantos comandos saíram e quantos foram parar na tela de atenção.
   * É chamada quando a rede volta, quando o aplicativo abre, e periodicamente —
   * e é segura de chamar sem rede: cada comando simplesmente falha e volta a
   * esperar.
   */
  escoar(): Promise<ResultadoDoEscoamento> {
    if (this.escoando) return this.escoando;
    const passada = this.escoarAgora().finally(() => {
      this.escoando = null;
    });
    this.escoando = passada;
    return passada;
  }

  private async escoarAgora(): Promise<ResultadoDoEscoamento> {
    const agora = this.deps.agora();
    const todos = await this.comandos.todos();
    const identidade = this.identidadeAtual();

    /*
     * A ORDEM DENTRO DE UM AGREGADO É A DE CRIAÇÃO.
     *
     * "Iniciar" antes de "concluir"; a resposta do item antes do fechamento do
     * checklist. Mandar fora de ordem faria o servidor recusar comandos
     * perfeitamente válidos — e a recusa apareceria como conflito, mandando
     * para a tela de atenção um trabalho que só estava na ordem errada.
     */
    const porAgregado = new Map<string, ComandoNaFila[]>();
    for (const c of todos.sort((a, b) => a.seq - b.seq)) {
      const lista = porAgregado.get(c.agregado) ?? [];
      lista.push(c);
      porAgregado.set(c.agregado, lista);
    }

    let enviados = 0;
    let recusados = 0;
    let sessaoExpirada = false;

    agregados: for (const [, comandos] of porAgregado) {
      for (const c of comandos) {
        if (c.bloqueado) break;
        /*
         * TRABALHO DE OUTRA SESSÃO NÃO SAI COM A CREDENCIAL DESTA. Ver
         * `Identidade`. Ele fica guardado, intacto, esperando o dono entrar de
         * novo — e o agregado PARA aqui, porque mandar os seguintes desta OS
         * seria mandá-los na frente de um comando anterior a eles.
         */
        if (!mesmaIdentidade(c.identidade, identidade)) break;
        if (new Date(c.proximaTentativaEm) > agora) break;

        /*
         * A RESOLUÇÃO TARDIA VEM ANTES DO ENVIO. Ver `resolverCorpo`.
         *
         * O comando gravado NÃO é alterado: se o envio falhar, a próxima
         * tentativa resolve de novo, com o que se souber então.
         */
        let aEnviar = c;
        if (this.deps.resolverCorpo) {
          const resolvido = await this.deps.resolverCorpo(c);
          if (!resolvido.pronto) {
            await this.comandos.gravar(c.id, {
              ...c,
              ultimoErro: resolvido.motivo,
              proximaTentativaEm: new Date(agora.getTime() + esperaApos(c.tentativas + 1)).toISOString(),
            });
            /*
             * O agregado inteiro para aqui. O que este comando espera é a
             * resposta de um comando ANTERIOR deste mesmo agregado; os
             * seguintes dependem deste, e mandá-los agora seria mandar fora de
             * ordem. As tentativas NÃO sobem: esperar não é falhar, e contá-lo
             * como falha empurraria a espera para um minuto sem motivo.
             */
            break;
          }
          aEnviar = { ...c, corpo: resolvido.corpo };
        }

        let r: RespostaDoEnvio;
        try {
          r = await this.deps.enviar(aEnviar);
        } catch (e) {
          /*
           * SEM REDE. O comando FICA. Nada é descartado, nada é marcado como
           * feito, e a próxima tentativa é adiada.
           *
           * O `break` para o agregado inteiro: se a rede caiu, os seguintes
           * desta OS também vão falhar, e tentá-los só gasta bateria. Os
           * outros agregados seguem — porque o defeito pode ser desta
           * requisição, e não da rede.
           */
          await this.comandos.gravar(c.id, {
            ...c,
            tentativas: c.tentativas + 1,
            ultimoErro: e instanceof Error ? e.message : 'falha de rede',
            proximaTentativaEm: new Date(agora.getTime() + esperaApos(c.tentativas + 1)).toISOString(),
          });
          break;
        }

        if (r.status >= 200 && r.status < 300) {
          /*
           * ACEITO. E SÓ AQUI o comando sai da fila.
           *
           * É o único caminho de remoção deste arquivo. Qualquer outro seria
           * uma forma de descartar trabalho sem resposta do servidor.
           */
          /*
           * O AVISO VEM ANTES DE O COMANDO SAIR DA FILA.
           *
           * Se o processo morrer entre uma coisa e outra, o comando é reenviado
           * — e o servidor, que é idempotente por `client_operation_id`,
           * devolve o mesmo desfecho. Na ordem inversa, um comando aceito cujo
           * aviso não rodou deixaria o anexo sem chave para sempre, sem nada na
           * fila para tentar de novo.
           */
          try {
            await this.deps.aoConcluir?.(aEnviar, r.corpo);
          } catch {
            /*
             * O comando FOI aceito. Uma falha ao processar a resposta não pode
             * desfazer isso nem devolvê-lo à fila: reenviá-lo produziria a
             * duplicata que a idempotência existe para impedir.
             */
          }
          await this.comandos.apagar(c.id);
          enviados++;
          continue;
        }

        if (r.status === 401) {
          /*
           * A CREDENCIAL VENCEU. O comando FICA — e a passada inteira para.
           *
           * Não é recusa (ver `ehRecusaDefinitiva`) nem falha de rede: as
           * tentativas não sobem e a espera não cresce, porque o que falta não
           * é tempo, é a pessoa entrar de novo. E PARA TUDO, e não só este
           * agregado: com a mesma credencial, cada comando seguinte levaria o
           * mesmo 401, e a fila gastaria a bateria colecionando a mesma
           * resposta. Quem chama recebe `sessaoExpirada` e diz isso na tela.
           */
          await this.comandos.gravar(c.id, { ...c, ultimoErro: MENSAGEM_SESSAO_EXPIRADA });
          sessaoExpirada = true;
          break agregados;
        }

        if (ehRecusaDefinitiva(r.status)) {
          /*
           * RECUSADO PELO SERVIDOR. Sai da fila e vai para a ATENÇÃO — com o
           * corpo inteiro, que é o trabalho da pessoa, e com o COMANDO
           * original, que é o que "Tentar de novo" devolve à fila.
           *
           * Tentar de novo não adiantaria: a OS foi cancelada, e vai continuar
           * cancelada. O que falta não é rede, é decisão de gente.
           */
          const problema = (r.corpo ?? {}) as { code?: string; message?: string };
          await this.atencao.gravar(c.id, {
            id: c.id,
            agregado: c.agregado,
            rotulo: c.rotulo,
            caminho: c.caminho,
            // O corpo RESOLVIDO, e não o guardado: é o que o servidor recusou,
            // e é o que quem for decidir precisa ver.
            corpo: aEnviar.corpo,
            codigo: problema.code ?? 'conflict',
            mensagem: problema.message ?? 'O servidor recusou esta operação.',
            recusadoEm: agora.toISOString(),
            // O GUARDADO, e não o resolvido: uma referência ao anexo precisa
            // continuar referência, para ser resolvida de novo no reenvio.
            comando: c,
          });
          await this.comandos.apagar(c.id);
          recusados++;

          /*
           * E OS SEGUINTES DESTA OS FICAM PARADOS — decisão 3.
           *
           * Aplicá-los sobre um estado que já divergiu produziria lixo: mandar
           * "concluir" depois de "iniciar" ter sido recusado tenta concluir uma
           * OS que nunca começou. Eles não são perdidos, nem recusados: ficam
           * intactos, esperando a decisão sobre o que conflitou.
           */
          for (const seguinte of comandos) {
            if (seguinte.seq > c.seq && !seguinte.bloqueado) {
              await this.comandos.gravar(seguinte.id, { ...seguinte, bloqueado: true });
            }
          }
          break;
        }

        /* 5xx, 408, 429: o servidor volta. Adia e para este agregado. */
        await this.comandos.gravar(c.id, {
          ...c,
          tentativas: c.tentativas + 1,
          ultimoErro: `o servidor respondeu ${r.status}`,
          proximaTentativaEm: new Date(agora.getTime() + esperaApos(c.tentativas + 1)).toISOString(),
        });
        break;
      }
    }

    return sessaoExpirada ? { enviados, recusados, sessaoExpirada: true } : { enviados, recusados };
  }

  /**
   * Alguém decidiu o que fazer com um conflito.
   *
   * `desbloquear` solta os comandos do mesmo agregado que ficaram parados. Quem
   * chama precisa ter DECIDIDO — ou eles seguirão para um servidor cujo estado
   * continua incompatível, e voltarão como conflito de novo.
   */
  async resolverAtencao(id: string, opcoes: { desbloquear: boolean }): Promise<void> {
    return this.emSerie(async () => {
      const pendencias = await this.atencao.todos();
      const p = pendencias.find((x) => x.id === id);
      if (!p) return;

      if (opcoes.desbloquear) {
        /*
         * "TENTAR DE NOVO" REENVIA O QUE FOI RECUSADO — e ele volta ANTES.
         *
         * A primeira versão apagava a pendência e soltava só os comandos
         * SEGUINTES: o recusado nunca voltava à fila, e o trabalho que a tela
         * prometia reenviar sumia no toque. Agora ele volta com:
         *
         *   · o MESMO identificador — se o servidor chegou a aplicá-lo (a
         *     resposta se perdeu, o 409 era de uma corrida), a idempotência
         *     por `x-aurora-client-operation` devolve o desfecho em vez de
         *     aplicar duas vezes;
         *   · a MESMA posição — menor que a dos seguintes, que estavam parados
         *     atrás dele. Reenfileirá-lo no fim mandaria o "concluir" depois do
         *     que dependia dele, e a ordem por OS (decisão 1) quebraria
         *     justamente no comando que já tinha dado problema;
         *   · tentativas zeradas, e pronto para sair agora.
         *
         * A GRAVAÇÃO VEM ANTES DE A PENDÊNCIA SAIR: se o processo morrer no
         * meio, o pior caso é o trabalho em dois lugares, e não em nenhum.
         */
        const agora = this.deps.agora().toISOString();
        const todos = await this.comandos.todos();
        const original = p.comando;
        const seqDoAgregado = todos.filter((c) => c.agregado === p.agregado).map((c) => c.seq);
        const seq =
          original?.seq ??
          // Pendência de versão anterior, sem o comando guardado: a posição é
          // remontada logo antes do primeiro parado desta OS — ou no fim.
          (seqDoAgregado.length > 0
            ? Math.min(...seqDoAgregado) - 1
            : todos.reduce((maior, c) => Math.max(maior, c.seq), 0) + 1);
        await this.comandos.gravar(p.id, {
          id: p.id,
          seq,
          agregado: p.agregado,
          // Todo comando do campo hoje é POST; é o que a pendência antiga tinha.
          metodo: original?.metodo ?? 'POST',
          caminho: original?.caminho ?? p.caminho,
          corpo: original ? original.corpo : p.corpo,
          rotulo: p.rotulo,
          criadoEm: original?.criadoEm ?? p.recusadoEm,
          tentativas: 0,
          proximaTentativaEm: agora,
          ultimoErro: null,
          bloqueado: false,
          ...(original?.identidade ? { identidade: original.identidade } : {}),
        });
      }

      await this.atencao.apagar(id);
      if (!opcoes.desbloquear) return;
      await this.soltarAgregado(p.agregado);
    });
  }

  /**
   * Solta os comandos parados de uma OS que NÃO têm pendência à frente.
   *
   * Acontece depois de "Já resolvi de outro jeito": a pendência sai e os
   * seguintes ficam parados, de propósito. Sem este caminho eles ficavam
   * parados PARA SEMPRE — a sincronização dizia "esperando a sua decisão" e a
   * tela de atenção dizia "nada parado", porque só listava pendências.
   */
  async desbloquearAgregado(agregado: string): Promise<void> {
    return this.emSerie(() => this.soltarAgregado(agregado));
  }

  private async soltarAgregado(agregado: string): Promise<void> {
    for (const c of await this.comandos.todos()) {
      if (c.agregado === agregado && c.bloqueado) {
        await this.comandos.gravar(c.id, {
          ...c,
          bloqueado: false,
          proximaTentativaEm: this.deps.agora().toISOString(),
        });
      }
    }
  }

  /**
   * A REDE VOLTOU: zera a espera de quem estava aguardando ela.
   *
   * A espera crescente existe por um motivo só — não martelar uma rede que não
   * responde. Quando o sistema operacional diz "a rede voltou", esse motivo
   * deixou de existir, e continuar esperando trinta segundos é fazer o técnico
   * olhar "3 pendências" no estacionamento com sinal cheio.
   *
   * O que NÃO é tocado: os comandos parados por conflito. Eles não esperam
   * rede, esperam DECISÃO — e soltá-los aqui mandaria para o servidor um
   * trabalho que ninguém decidiu o que fazer com.
   */
  async aRedeVoltou(): Promise<void> {
    // Uma passada em curso pode estar parando comandos por conflito agora
    // mesmo; esperá-la evita regravar por cima um `bloqueado` recém-posto.
    if (this.escoando) await this.escoando.catch(() => undefined);
    const agora = this.deps.agora().toISOString();
    for (const visto of await this.comandos.todos()) {
      if (visto.bloqueado || visto.proximaTentativaEm <= agora) continue;
      // Relido na hora de gravar, pelo mesmo motivo: nunca soltar o parado.
      const c = await this.comandos.ler(visto.id);
      if (!c || c.bloqueado) continue;
      await this.comandos.gravar(c.id, { ...c, proximaTentativaEm: agora });
    }
  }

  /**
   * Descarta um comando parado, a pedido EXPLÍCITO de quem trabalhou.
   *
   * É o único caminho pelo qual trabalho não enviado deixa de existir, e ele
   * exige um toque de gente numa tela que mostra o que está sendo jogado fora.
   * Existe porque a alternativa é pior: uma fila que não pode ser esvaziada
   * fica travada para sempre num comando que nunca vai passar, e aí o técnico
   * perde o resto do dia junto.
   */
  async descartar(id: string): Promise<void> {
    return this.emSerie(async () => {
      await this.comandos.apagar(id);
      await this.atencao.apagar(id);
    });
  }

  /** O que o indicador permanente de pendências mostra. */
  async estado(): Promise<EstadoDaFila> {
    const todos = await this.comandos.todos();
    const pendencias = await this.atencao.todos();
    const identidade = this.identidadeAtual();
    const meus = todos.filter((c) => mesmaIdentidade(c.identidade, identidade));
    // O mais antigo pela POSIÇÃO, e não pela data: é a mesma ordem em que
    // ele vai sair, e é ela que a tela promete ao dizer "desde as 8h".
    const datas = [...todos].sort((a, b) => a.seq - b.seq).map((c) => c.criadoEm);
    return {
      pendentes: meus.filter((c) => !c.bloqueado).length,
      bloqueados: meus.filter((c) => c.bloqueado).length,
      atencao: pendencias.length,
      deOutraSessao: todos.length - meus.length,
      maisAntigoEm: datas[0] ?? null,
    };
  }

  async listar(): Promise<ComandoNaFila[]> {
    return (await this.comandos.todos()).sort((a, b) => a.seq - b.seq);
  }

  async listarAtencao(): Promise<PendenciaDeAtencao[]> {
    return (await this.atencao.todos()).sort((a, b) => b.recusadoEm.localeCompare(a.recusadoEm));
  }
}
