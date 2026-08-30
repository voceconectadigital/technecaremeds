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
}

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
  return status >= 400 && status < 500;
}

export interface EstadoDaFila {
  pendentes: number;
  bloqueados: number;
  atencao: number;
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
  }): Promise<string> {
    const id = this.deps.novoId();
    const agora = this.deps.agora().toISOString();

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
  async escoar(): Promise<{ enviados: number; recusados: number }> {
    const agora = this.deps.agora();
    const todos = await this.comandos.todos();

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

    for (const [, comandos] of porAgregado) {
      for (const c of comandos) {
        if (c.bloqueado) break;
        if (new Date(c.proximaTentativaEm) > agora) break;

        let r: RespostaDoEnvio;
        try {
          r = await this.deps.enviar(c);
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
            await this.deps.aoConcluir?.(c, r.corpo);
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

        if (ehRecusaDefinitiva(r.status)) {
          /*
           * RECUSADO PELO SERVIDOR. Sai da fila e vai para a ATENÇÃO — com o
           * corpo inteiro, que é o trabalho da pessoa.
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
            corpo: c.corpo,
            codigo: problema.code ?? 'conflict',
            mensagem: problema.message ?? 'O servidor recusou esta operação.',
            recusadoEm: agora.toISOString(),
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

    return { enviados, recusados };
  }

  /**
   * Alguém decidiu o que fazer com um conflito.
   *
   * `desbloquear` solta os comandos do mesmo agregado que ficaram parados. Quem
   * chama precisa ter DECIDIDO — ou eles seguirão para um servidor cujo estado
   * continua incompatível, e voltarão como conflito de novo.
   */
  async resolverAtencao(id: string, opcoes: { desbloquear: boolean }): Promise<void> {
    const pendencias = await this.atencao.todos();
    const p = pendencias.find((x) => x.id === id);
    if (!p) return;

    await this.atencao.apagar(id);
    if (!opcoes.desbloquear) return;

    for (const c of await this.comandos.todos()) {
      if (c.agregado === p.agregado && c.bloqueado) {
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
    const agora = this.deps.agora().toISOString();
    for (const c of await this.comandos.todos()) {
      if (c.bloqueado || c.proximaTentativaEm <= agora) continue;
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
    await this.comandos.apagar(id);
    await this.atencao.apagar(id);
  }

  /** O que o indicador permanente de pendências mostra. */
  async estado(): Promise<EstadoDaFila> {
    const comandos = await this.comandos.todos();
    const pendencias = await this.atencao.todos();
    // O mais antigo pela POSIÇÃO, e não pela data: é a mesma ordem em que
    // ele vai sair, e é ela que a tela promete ao dizer "desde as 8h".
    const datas = [...comandos].sort((a, b) => a.seq - b.seq).map((c) => c.criadoEm);
    return {
      pendentes: comandos.filter((c) => !c.bloqueado).length,
      bloqueados: comandos.filter((c) => c.bloqueado).length,
      atencao: pendencias.length,
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
