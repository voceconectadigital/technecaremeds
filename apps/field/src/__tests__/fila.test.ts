/**
 * Aurora — a fila de saída, provada comando a comando (EPIC-014 · SPEC §20).
 *
 * O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR
 *
 * A SPEC nomeia o risco em uma frase: "perda silenciosa de trabalho é o defeito
 * mais grave possível — exige testes determinísticos de conflito". É por isso
 * que o relógio e a rede são injetados: um teste de oito horas offline não pode
 * levar oito horas, e um teste de retentativa não pode depender de a máquina
 * estar lenta.
 *
 * Cada caso aqui encena uma forma DIFERENTE de perder trabalho. Elas não são
 * variações do mesmo defeito: são portas distintas, e fechar uma não fecha as
 * outras.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { baseEmMemoria, type BaseLocal } from '../armazenamento';
import {
  FilaDeSaida,
  esperaApos,
  type ComandoNaFila,
  type PendenciaDeAtencao,
  type RespostaDoEnvio,
} from '../fila';

/** Um relógio que anda quando o teste manda, e não quando a máquina quer. */
function relogio(inicio = '2026-08-29T08:00:00.000Z') {
  let t = new Date(inicio).getTime();
  return {
    agora: () => new Date(t),
    avancar(ms: number) {
      t += ms;
    },
    avancarHoras(h: number) {
      t += h * 3_600_000;
    },
  };
}

/** Uma rede que o teste liga e desliga. */
function rede() {
  const enviados: ComandoNaFila[] = [];
  let modo: 'ok' | 'sem-sinal' | 'servidor-fora' = 'ok';
  let respostaPara: (c: ComandoNaFila) => RespostaDoEnvio = () => ({
    status: 200,
    corpo: { ok: true },
  });

  return {
    enviados,
    desligar() {
      modo = 'sem-sinal';
    },
    ligar() {
      modo = 'ok';
    },
    servidorFora() {
      modo = 'servidor-fora';
    },
    responder(fn: (c: ComandoNaFila) => RespostaDoEnvio) {
      respostaPara = fn;
    },
    async enviar(c: ComandoNaFila): Promise<RespostaDoEnvio> {
      if (modo === 'sem-sinal') throw new TypeError('Failed to fetch');
      enviados.push(structuredClone(c));
      if (modo === 'servidor-fora') return { status: 503, corpo: null };
      return respostaPara(c);
    },
  };
}

let base: BaseLocal;
let fila: FilaDeSaida;
let t: ReturnType<typeof relogio>;
let net: ReturnType<typeof rede>;
let contador: number;

beforeEach(() => {
  base = baseEmMemoria();
  t = relogio();
  net = rede();
  contador = 0;
  fila = new FilaDeSaida(base.colecao<ComandoNaFila>('fila'), base.colecao<PendenciaDeAtencao>('atencao'), {
    enviar: (c) => net.enviar(c),
    agora: () => t.agora(),
    novoId: () => `op-${String(++contador).padStart(3, '0')}`,
  });
});

const comando = (n: number, agregado = 'work_order:os-1') => ({
  agregado,
  metodo: 'POST' as const,
  caminho: `/v1/work-orders/os-1/acao-${n}`,
  corpo: { passo: n },
  rotulo: `Passo ${n}`,
});

describe('FILA-001 · o comando é gravado antes de qualquer tentativa', () => {
  it('mesmo com sinal cheio, ele existe no armazenamento antes de sair', async () => {
    /*
     * Tentar primeiro e guardar só se falhar abre uma janela em que o comando
     * existe apenas na memória. Nessa janela — o aplicativo fechado, a aba
     * recarregada, a bateria acabando — o trabalho some sem deixar rastro.
     *
     * A janela dura milissegundos, o que é exatamente o que faz o defeito
     * sobreviver a toda revisão de código e aparecer só em produção.
     */
    await fila.enfileirar(comando(1));

    expect(net.enviados).toHaveLength(0);
    const guardados = await fila.listar();
    expect(guardados).toHaveLength(1);
    expect(guardados[0]).toMatchObject({ rotulo: 'Passo 1', tentativas: 0, bloqueado: false });
  });

  it('o identificador nasce com o comando e vai igual em toda tentativa', async () => {
    /*
     * É o que faz o servidor reconhecer a retentativa como retentativa. Gerar
     * um identificador novo a cada envio transformaria cada tentativa numa
     * operação diferente — e a garantia de "no máximo uma vez" do servidor não
     * teria nada em que se apoiar.
     */
    const id = await fila.enfileirar(comando(1));

    net.servidorFora();
    await fila.escoar();
    t.avancar(esperaApos(1) + 1);
    await fila.escoar();

    expect(net.enviados).toHaveLength(2);
    expect(net.enviados.map((c) => c.id)).toEqual([id, id]);
  });
});

describe('FILA-002 · oito horas sem rede', () => {
  it('quarenta comandos de um dia inteiro sobrevivem, e saem em ordem quando o sinal volta', async () => {
    /*
     * O CRITÉRIO DO ÉPICO, ENCENADO: "oito horas de trabalho sem rede, com zero
     * perda de dados".
     *
     * Cinco OS, oito comandos cada, espalhados por oito horas. A rede está
     * desligada o tempo todo — e o aparelho tenta escoar a cada quinze
     * minutos, como tentaria de verdade.
     */
    net.desligar();

    const ids: string[] = [];
    for (let hora = 0; hora < 8; hora++) {
      for (let os = 1; os <= 5; os++) {
        ids.push(
          await fila.enfileirar({
            ...comando(hora, `work_order:os-${os}`),
            rotulo: `OS ${os}, hora ${hora}`,
          })
        );
      }
      // Quatro tentativas de escoar por hora, todas em vão.
      for (let q = 0; q < 4; q++) {
        await fila.escoar();
        t.avancar(15 * 60_000);
      }
    }

    // NADA saiu, e NADA sumiu.
    expect(net.enviados).toHaveLength(0);
    const guardados = await fila.listar();
    expect(guardados).toHaveLength(40);

    const estado = await fila.estado();
    expect(estado.pendentes).toBe(40);
    expect(estado.atencao).toBe(0);
    // O indicador permanente sabe desde quando: "40 pendências desde 08:00".
    expect(estado.maisAntigoEm).toBe('2026-08-29T08:00:00.000Z');

    // O estacionamento: o sinal volta.
    net.ligar();
    let total = 0;
    for (let volta = 0; volta < 10 && total < 40; volta++) {
      const r = await fila.escoar();
      total += r.enviados;
      t.avancar(MINUTO);
    }

    expect(total).toBe(40);
    expect(await fila.listar()).toEqual([]);

    /*
     * E A ORDEM DENTRO DE CADA OS FOI RESPEITADA.
     *
     * Entre OS diferentes a ordem não importa — a SPEC permite paralelo. Dentro
     * de uma, "iniciar" precisa chegar antes de "concluir", ou o servidor recusa
     * um comando perfeitamente válido e ele vai parar na tela de atenção por um
     * defeito de ordenação nosso.
     */
    for (let os = 1; os <= 5; os++) {
      const daOs = net.enviados.filter((c) => c.agregado === `work_order:os-${os}`);
      expect(daOs).toHaveLength(8);
      const rotulos = daOs.map((c) => c.rotulo);
      expect(rotulos).toEqual([...rotulos].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('recarregar o aplicativo no meio do dia não perde nada', async () => {
    /*
     * O aparelho é fechado e reaberto: sistema operacional recuperando memória,
     * a pessoa trocando de aplicativo, a aba recarregada sem querer. A fila é
     * outra INSTÂNCIA, sobre o mesmo armazenamento — que é exatamente o que
     * acontece de verdade.
     */
    net.desligar();
    await fila.enfileirar(comando(1));
    await fila.enfileirar(comando(2));
    await fila.escoar();

    const depoisDoReinicio = new FilaDeSaida(
      base.colecao<ComandoNaFila>('fila'),
      base.colecao<PendenciaDeAtencao>('atencao'),
      { enviar: (c) => net.enviar(c), agora: () => t.agora(), novoId: () => 'novo' }
    );

    expect(await depoisDoReinicio.listar()).toHaveLength(2);

    net.ligar();
    t.avancar(MINUTO);
    const r = await depoisDoReinicio.escoar();
    expect(r.enviados).toBe(2);
  });
});

describe('FILA-003 · a rede intermitente não vira tempestade', () => {
  it('a espera cresce a cada falha, e para de crescer num minuto', async () => {
    /*
     * Retentativa imediata em rede ruim é uma tempestade de requisições: gasta
     * bateria, não entrega nada, e ainda derruba o servidor quando cinquenta
     * técnicos saem do subsolo juntos.
     *
     * Mas a espera precisa de TETO. Sem ele, o aparelho que acabou de
     * reencontrar sinal ficaria quinze minutos parado, e o técnico veria "3
     * pendências" durante todo o caminho de volta sem entender por quê.
     */
    expect(esperaApos(1)).toBe(2_000);
    expect(esperaApos(2)).toBe(4_000);
    expect(esperaApos(5)).toBe(32_000);
    expect(esperaApos(6)).toBe(60_000);
    expect(esperaApos(20)).toBe(60_000);
  });

  it('antes da hora, o comando não é tentado de novo', async () => {
    net.servidorFora();
    await fila.enfileirar(comando(1));
    await fila.escoar();
    expect(net.enviados).toHaveLength(1);

    // Um segundo depois: ainda não. A espera é de dois.
    t.avancar(1_000);
    await fila.escoar();
    expect(net.enviados).toHaveLength(1);

    t.avancar(2_000);
    await fila.escoar();
    expect(net.enviados).toHaveLength(2);
  });

  it('o lote interrompido no meio não perde o que faltou', async () => {
    /*
     * CASO DE BORDA DA SPEC: "rede intermitente durante o envio de um lote".
     *
     * Três comandos, e a rede cai depois do primeiro. O primeiro saiu de
     * verdade — foi aceito — e os outros dois continuam na fila, intactos.
     */
    await fila.enfileirar(comando(1));
    await fila.enfileirar(comando(2));
    await fila.enfileirar(comando(3));

    let entregues = 0;
    net.responder(() => {
      entregues++;
      if (entregues > 1) throw new TypeError('Failed to fetch');
      return { status: 200, corpo: { ok: true } };
    });

    await fila.escoar();

    const restantes = await fila.listar();
    expect(restantes).toHaveLength(2);
    expect(restantes.map((c) => c.rotulo)).toEqual(['Passo 2', 'Passo 3']);
  });
});

describe('FILA-004 · o conflito para a OS, e só ela', () => {
  it('o comando recusado vai para a atenção COM o trabalho dentro', async () => {
    await fila.enfileirar({
      agregado: 'work_order:os-1',
      metodo: 'POST',
      caminho: '/v1/work-orders/os-1/transitions',
      corpo: {
        to: 'completed',
        resolution: 'Trocada a válvula de exalação; estanqueidade aprovada às 15h40.',
      },
      rotulo: 'Concluir OS-0042',
    });

    net.responder(() => ({
      status: 409,
      corpo: { code: 'invalid_transition', message: 'A OS foi cancelada às 14h12 por Ana.' },
    }));

    const r = await fila.escoar();
    expect(r).toEqual({ enviados: 0, recusados: 1 });

    // Saiu da fila — tentar de novo não adianta, a OS vai continuar cancelada.
    expect(await fila.listar()).toEqual([]);

    const pendencias = await fila.listarAtencao();
    expect(pendencias).toHaveLength(1);
    /*
     * O TRABALHO INTEIRO, do jeito que ele digitou. Guardar só "falhou" faria a
     * tela de atenção pedir que ele lembrasse o que escreveu duas horas antes —
     * e o que ele lembra não é o que ele escreveu.
     */
    expect(pendencias[0]!.corpo).toEqual({
      to: 'completed',
      resolution: 'Trocada a válvula de exalação; estanqueidade aprovada às 15h40.',
    });
    expect(pendencias[0]!.mensagem).toContain('cancelada');
  });

  it('os comandos seguintes DAQUELA OS ficam parados, intactos', async () => {
    /*
     * Decisão 3 do arquivo da fila. Aplicá-los sobre um estado que já divergiu
     * produziria lixo: mandar "concluir" depois de "iniciar" ter sido recusado
     * tenta concluir uma OS que nunca começou.
     *
     * PARADOS não é perdido nem recusado: eles continuam na fila, com o corpo
     * inteiro, esperando a decisão sobre o que conflitou.
     */
    await fila.enfileirar(comando(1));
    await fila.enfileirar(comando(2));
    await fila.enfileirar(comando(3));

    net.responder((c) =>
      c.rotulo === 'Passo 1'
        ? { status: 409, corpo: { code: 'conflict', message: 'não dá' } }
        : { status: 200, corpo: {} }
    );

    await fila.escoar();

    const restantes = await fila.listar();
    expect(restantes).toHaveLength(2);
    expect(restantes.every((c) => c.bloqueado)).toBe(true);
    // O corpo continua ali: nada foi mexido.
    expect(restantes[0]!.corpo).toEqual({ passo: 2 });

    // E uma nova tentativa não os manda: eles esperam gente.
    net.enviados.length = 0;
    t.avancar(MINUTO);
    await fila.escoar();
    expect(net.enviados).toHaveLength(0);
  });

  it('a OS que conflitou não trava as outras quatro do dia', async () => {
    /*
     * Uma fila global faria a OS travada bloquear o dia inteiro: o técnico
     * terminaria com "37 pendências" porque uma delas conflitou às 9h.
     */
    await fila.enfileirar(comando(1, 'work_order:os-1'));
    await fila.enfileirar(comando(1, 'work_order:os-2'));
    await fila.enfileirar(comando(1, 'work_order:os-3'));

    net.responder((c) =>
      c.agregado === 'work_order:os-1'
        ? { status: 409, corpo: { code: 'conflict', message: 'cancelada' } }
        : { status: 200, corpo: {} }
    );

    const r = await fila.escoar();
    expect(r).toEqual({ enviados: 2, recusados: 1 });
  });

  it('decidir o conflito solta os comandos parados da mesma OS', async () => {
    await fila.enfileirar(comando(1));
    await fila.enfileirar(comando(2));

    net.responder((c) =>
      c.rotulo === 'Passo 1'
        ? { status: 409, corpo: { code: 'conflict', message: 'não dá' } }
        : { status: 200, corpo: {} }
    );
    await fila.escoar();

    const [pendencia] = await fila.listarAtencao();
    await fila.resolverAtencao(pendencia!.id, { desbloquear: true });

    net.responder(() => ({ status: 200, corpo: {} }));
    t.avancar(MINUTO);
    const r = await fila.escoar();

    expect(r.enviados).toBe(1);
    expect(await fila.listarAtencao()).toEqual([]);
  });

  it('decidir sem desbloquear deixa os parados parados — de propósito', async () => {
    /*
     * "A OS foi cancelada mesmo, e o que eu ia fazer não vale mais" é uma
     * decisão legítima. Soltar os comandos automaticamente ao fechar a tela
     * mandaria para o servidor um trabalho que a pessoa acabou de descartar —
     * e ele voltaria como conflito, num laço que a tela não sabe quebrar.
     */
    await fila.enfileirar(comando(1));
    await fila.enfileirar(comando(2));
    net.responder((c) =>
      c.rotulo === 'Passo 1' ? { status: 409, corpo: { code: 'conflict' } } : { status: 200, corpo: {} }
    );
    await fila.escoar();

    const [p] = await fila.listarAtencao();
    await fila.resolverAtencao(p!.id, { desbloquear: false });

    const restantes = await fila.listar();
    expect(restantes).toHaveLength(1);
    expect(restantes[0]!.bloqueado).toBe(true);
  });
});

describe('FILA-005 · nada sai da fila sem resposta do servidor', () => {
  it('erro de servidor não descarta: o comando fica e é tentado de novo', async () => {
    net.servidorFora();
    await fila.enfileirar(comando(1));

    for (let i = 0; i < 30; i++) {
      await fila.escoar();
      t.avancar(MINUTO);
    }

    // Trinta tentativas, e ele CONTINUA lá. Não há contador que o descarte.
    const restantes = await fila.listar();
    expect(restantes).toHaveLength(1);
    expect(restantes[0]!.tentativas).toBeGreaterThan(20);
    expect(restantes[0]!.ultimoErro).toContain('503');
  });

  it('o único descarte é o explícito, a pedido de quem trabalhou', async () => {
    /*
     * Existe porque a alternativa é pior: uma fila que não pode ser esvaziada
     * fica travada para sempre num comando que nunca vai passar, e o técnico
     * perde o resto do dia junto.
     *
     * Mas é um caminho SÓ, com nome, chamado por uma tela que mostra o que está
     * sendo jogado fora. Não há descarte por tempo, por contagem, nem por
     * heurística.
     */
    const id = await fila.enfileirar(comando(1));
    await fila.descartar(id);
    expect(await fila.listar()).toEqual([]);
  });

  it('408 e 429 são "tente de novo", e não recusa', async () => {
    /*
     * Os dois têm cara de erro do cliente — são 4xx — e não são: um é tempo
     * esgotado, o outro é excesso de requisições. Tratá-los como recusa
     * mandaria para a tela de atenção um trabalho perfeitamente válido, e a
     * pessoa teria de decidir sobre algo que só precisava de trinta segundos.
     */
    for (const status of [408, 429]) {
      net.responder(() => ({ status, corpo: null }));
      const id = await fila.enfileirar(comando(1));
      await fila.escoar();

      expect(await fila.listarAtencao(), `status ${status} não devia virar atenção`).toEqual([]);
      const restantes = await fila.listar();
      expect(restantes.map((c) => c.id)).toContain(id);
      await fila.descartar(id);
    }
  });

  it('sem rede, o contador de tentativas sobe mas nada é perdido', async () => {
    net.desligar();
    const id = await fila.enfileirar(comando(1));

    for (let i = 0; i < 5; i++) {
      await fila.escoar();
      t.avancar(MINUTO);
    }

    const [c] = await fila.listar();
    expect(c!.id).toBe(id);
    expect(c!.tentativas).toBe(5);
    expect(c!.ultimoErro).toContain('Failed to fetch');
  });
});

describe('FILA-006 · o indicador permanente diz a verdade', () => {
  it('separa pendente de parado de esperando decisão', async () => {
    /*
     * Um número só — "12 pendências" — esconde a diferença que importa: 12
     * esperando rede é um dia normal; 12 esperando DECISÃO é um dia em que
     * alguém precisa parar e olhar. Somá-los faria o segundo caso desaparecer
     * dentro do primeiro.
     */
    await fila.enfileirar(comando(1, 'work_order:os-1'));
    await fila.enfileirar(comando(2, 'work_order:os-1'));
    await fila.enfileirar(comando(1, 'work_order:os-2'));

    net.responder((c) =>
      c.rotulo === 'Passo 1' && c.agregado === 'work_order:os-1'
        ? { status: 409, corpo: { code: 'conflict', message: 'cancelada' } }
        : { status: 200, corpo: {} }
    );
    await fila.escoar();

    expect(await fila.estado()).toMatchObject({ pendentes: 0, bloqueados: 1, atencao: 1 });
  });

  it('a fila vazia é dita como vazia, e não como zero pendências de algo', async () => {
    expect(await fila.estado()).toEqual({
      pendentes: 0,
      bloqueados: 0,
      atencao: 0,
      maisAntigoEm: null,
    });
  });
});

const MINUTO = 60_000;

describe('FILA-007 · a ordem não depende do relógio', () => {
  it('dois comandos no MESMO milissegundo continuam ordenados', async () => {
    /*
     * O RELÓGIO NÃO ORDENA NADA AQUI, e esta prova existe porque a primeira
     * versão achava que sim.
     *
     * Uma tela que salva vários campos de uma vez enfileira dois comandos no
     * mesmo milissegundo. Ordenando por data, "veio depois" era falso para os
     * dois — e o travamento por conflito não travava nada: os comandos
     * seguintes de uma OS que já divergiu seguiam para o servidor.
     *
     * O relógio também é a coisa errada por princípio: a SPEC lista "relógio do
     * dispositivo errado" entre os casos de borda, e um aparelho com a hora
     * trocada reordenaria a fila inteira.
     */
    const a = await fila.enfileirar(comando(1));
    const b = await fila.enfileirar(comando(2));
    const c = await fila.enfileirar(comando(3));

    const guardados = await fila.listar();
    expect(guardados.map((x) => x.id)).toEqual([a, b, c]);
    expect(guardados.map((x) => x.seq)).toEqual([1, 2, 3]);
    // Mesmo instante nos três: é o que quebrava a ordenação anterior.
    expect(new Set(guardados.map((x) => x.criadoEm)).size).toBe(1);
  });

  it('a posição continua crescendo depois de reabrir o aplicativo', async () => {
    /*
     * Um contador de instância voltaria a zero a cada reabertura, e os comandos
     * da tarde disputariam posição com os da manhã — reordenando a fila num
     * aparelho que só foi trocado de aplicativo.
     */
    net.desligar();
    await fila.enfileirar(comando(1));
    await fila.enfileirar(comando(2));

    const reaberta = new FilaDeSaida(
      base.colecao<ComandoNaFila>('fila'),
      base.colecao<PendenciaDeAtencao>('atencao'),
      { enviar: (c) => net.enviar(c), agora: () => t.agora(), novoId: () => 'op-tarde' }
    );
    await reaberta.enfileirar(comando(3));

    expect((await reaberta.listar()).map((x) => x.seq)).toEqual([1, 2, 3]);
  });
});

describe('FILA-008 · a rede voltando zera a espera', () => {
  it('o comando que estava em espera longa passa a ser tentado na hora', async () => {
    /*
     * A espera crescente existe para não martelar uma rede que não responde.
     * Quando o sistema operacional avisa que ela voltou, esse motivo deixou de
     * existir — e continuar esperando faz o técnico olhar "3 pendências" no
     * estacionamento, com sinal cheio, esperando um relógio interno que ele
     * não vê.
     */
    net.desligar();
    await fila.enfileirar(comando(1));

    /*
     * Seis falhas seguidas levam a espera ao teto de um minuto — e o relógio
     * avança ENTRE elas, nunca depois da última. Avançar depois anularia a
     * espera que o caso existe para exercitar, e o teste passaria por acidente.
     */
    for (let i = 0; i < 6; i++) {
      if (i > 0) t.avancar(esperaApos(i) + 1);
      await fila.escoar();
    }
    const antes = (await fila.listar())[0]!;
    expect(new Date(antes.proximaTentativaEm).getTime()).toBeGreaterThan(t.agora().getTime());

    net.ligar();
    await fila.aRedeVoltou();

    const r = await fila.escoar();
    expect(r.enviados).toBe(1);
  });

  it('mas NÃO solta o que está parado por conflito', async () => {
    /*
     * Parado por conflito não espera rede: espera DECISÃO. Soltá-lo aqui
     * mandaria para o servidor um trabalho que ninguém decidiu o que fazer com
     * — e ele voltaria como conflito, num laço que a tela não sabe quebrar.
     */
    await fila.enfileirar(comando(1));
    await fila.enfileirar(comando(2));
    net.responder((c) =>
      c.rotulo === 'Passo 1'
        ? { status: 409, corpo: { code: 'conflict', message: 'cancelada' } }
        : { status: 200, corpo: {} }
    );
    await fila.escoar();

    await fila.aRedeVoltou();
    net.enviados.length = 0;
    await fila.escoar();

    expect(net.enviados).toHaveLength(0);
    expect((await fila.listar())[0]!.bloqueado).toBe(true);
  });
});
