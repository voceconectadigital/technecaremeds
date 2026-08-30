/**
 * Aurora — o contexto de campo: base local, fila e sincronização (EPIC-014).
 *
 * TUDO QUE A TELA MOSTRA VEM DA BASE LOCAL, E NUNCA DA REDE.
 *
 * É a decisão que organiza este arquivo, e ela não é uma otimização. Uma tela
 * que lê da rede "quando dá" tem dois modos: o rápido e o vazio. O segundo
 * aparece exatamente no subsolo — e o técnico não tem como saber se a OS não
 * está ali porque não existe ou porque o wi-fi não alcança.
 *
 * Lendo só do local, a tela tem UM modo. O que muda com a rede é apenas quão
 * recente é o dado, e isso a tela DIZ, com a hora da última sincronização.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { baseIndexedDb, type BaseLocal } from './armazenamento';
import { FilaDeSaida, type ComandoNaFila, type PendenciaDeAtencao, type EstadoDaFila } from './fila';
import { Sincronizacao, type PacoteDoDia, type ResultadoDaSincronizacao } from './sincronizacao';

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001/v1';

/**
 * O identificador da operação, gerado no APARELHO.
 *
 * `crypto.randomUUID` existe em todo navegador que suporta service worker, que
 * é o piso deste aplicativo. O ramo alternativo existe para contextos não
 * seguros (http sem TLS numa rede interna), onde a API não é exposta — e ali
 * um identificador com menos entropia é melhor do que nenhum, porque a
 * alternativa seria não ter idempotência.
 */
function novoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const h = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

function credencial(): { token: string | null; organizacao: string | null } {
  try {
    return {
      token: localStorage.getItem('aurora:token'),
      organizacao: localStorage.getItem('aurora:organizacao'),
    };
  } catch {
    return { token: null, organizacao: null };
  }
}

function cabecalhos(extra: Record<string, string> = {}): Record<string, string> {
  const { token, organizacao } = credencial();
  const h: Record<string, string> = { 'content-type': 'application/json', ...extra };
  if (token) h.authorization = `Bearer ${token}`;
  if (organizacao) h['x-aurora-organization'] = organizacao;
  return h;
}

export interface Campo {
  base: BaseLocal;
  fila: FilaDeSaida;
  sincronizacao: Sincronizacao;
  estado: EstadoDaFila;
  /** Quando o pacote do dia chegou. `null` = nunca sincronizou neste aparelho. */
  ultimaSincronizacao: string | null;
  sincronizando: boolean;
  ultimoResultado: ResultadoDaSincronizacao | null;
  online: boolean;
  sincronizar(): Promise<void>;
  /** Enfileira um comando e atualiza o indicador. */
  enfileirar(e: {
    agregado: string;
    metodo: ComandoNaFila['metodo'];
    caminho: string;
    corpo: unknown;
    rotulo: string;
  }): Promise<string>;
  resolverAtencao(id: string, opcoes: { desbloquear: boolean }): Promise<void>;
  descartar(id: string): Promise<void>;
  atualizarEstado(): Promise<void>;
}

const Ctx = createContext<Campo | null>(null);

export function useCampo(): Campo {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCampo precisa de <CampoProvider>');
  return c;
}

/** Só para a suíte: injeta a base pronta em vez de abrir o IndexedDB. */
export function CampoProvider({ children, baseDeTeste }: { children: ReactNode; baseDeTeste?: BaseLocal }) {
  const [base, setBase] = useState<BaseLocal | null>(baseDeTeste ?? null);
  const [erroAoAbrir, setErroAoAbrir] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoDaFila>({
    pendentes: 0,
    bloqueados: 0,
    atencao: 0,
    maisAntigoEm: null,
  });
  const [ultimaSincronizacao, setUltima] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState<ResultadoDaSincronizacao | null>(null);
  /*
   * O INDICADOR NASCE COM UM PALPITE E É CORRIGIDO PELA TENTATIVA.
   *
   *  entra como chute inicial — acerta o caso comum e não
   * custa nada. Quem decide de verdade é a primeira sincronização: se ela
   * falhou por rede, estamos sem rede; se passou, estamos com rede. É a única
   * forma de o indicador não mentir num wi-fi que conecta e não roteia.
   */
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    if (baseDeTeste) return;
    let vivo = true;
    baseIndexedDb()
      .then((b) => vivo && setBase(b))
      .catch((e: unknown) =>
        setErroAoAbrir(e instanceof Error ? e.message : 'não foi possível abrir a base local')
      );
    return () => {
      vivo = false;
    };
  }, [baseDeTeste]);

  const fila = useMemo(() => {
    if (!base) return null;
    return new FilaDeSaida(base.colecao<ComandoNaFila>('fila'), base.colecao<PendenciaDeAtencao>('atencao'), {
      agora: () => new Date(),
      novoId,
      async enviar(c) {
        /*
         * O IDENTIFICADOR DA FILA VIRA O CABEÇALHO DA OPERAÇÃO.
         *
         * É o mesmo em toda tentativa, e é o que faz o servidor reconhecer a
         * retentativa como retentativa em vez de aplicar o comando de novo.
         * Sem este cabeçalho, a fila estaria mandando comandos anônimos e a
         * garantia inteira do lado do servidor ficaria sem uso.
         */
        const r = await fetch(`${API}${c.caminho}`, {
          method: c.metodo,
          headers: cabecalhos({ 'x-aurora-client-operation': c.id }),
          body: JSON.stringify(c.corpo ?? {}),
        });
        let corpo: unknown = null;
        try {
          corpo = await r.json();
        } catch {
          /* 204, ou uma resposta que não é JSON. O status é o que decide. */
        }
        return { status: r.status, corpo };
      },
    });
  }, [base]);

  const sincronizacao = useMemo(() => {
    if (!base || !fila) return null;
    return new Sincronizacao(base, fila, {
      agora: () => new Date(),
      async baixarPacote(desde) {
        const url = new URL(`${API}/field/sync`);
        if (desde) url.searchParams.set('since', desde);
        const r = await fetch(url.toString(), { headers: cabecalhos() });
        if (!r.ok) throw new Error(`o servidor respondeu ${r.status} ao pedir o dia`);
        return (await r.json()) as PacoteDoDia;
      },
    });
  }, [base, fila]);

  const atualizarEstado = useCallback(async () => {
    if (!fila || !sincronizacao) return;
    setEstado(await fila.estado());
    setUltima(await sincronizacao.ultimaMarca());
  }, [fila, sincronizacao]);

  useEffect(() => {
    void atualizarEstado();
  }, [atualizarEstado]);

  const sincronizar = useCallback(async () => {
    if (!sincronizacao) return;
    setSincronizando(true);
    try {
      const r = await sincronizacao.rodar();
      setUltimoResultado(r);
      // O que a tentativa descobriu vale mais do que o palpite do navegador.
      setOnline(!r.semRede);
    } finally {
      setSincronizando(false);
      await atualizarEstado();
    }
  }, [sincronizacao, atualizarEstado]);

  /*
   * O SINAL VOLTOU: tenta escoar na hora.
   *
   * `navigator.onLine` mente nos dois sentidos — diz `true` num wi-fi que não
   * roteia nada. Por isso ele NÃO decide se vale a pena tentar: ele é só um
   * gatilho a mais, e a tentativa é que descobre. O relógio periódico continua
   * rodando de qualquer forma.
   */
  const sincronizarRef = useRef(sincronizar);
  sincronizarRef.current = sincronizar;
  const filaRef = useRef(fila);
  filaRef.current = fila;

  /*
   * A PRIMEIRA SINCRONIZAÇÃO ACONTECE SOZINHA, ao abrir.
   *
   * Sem ela, o aparelho recém-instalado ficava em "nunca sincronizou" até
   * alguém tocar no botão ou até o relógio de um minuto disparar — e o técnico
   * que abre o aplicativo às 7h55 e desce para o subsolo às 7h56 desceria com
   * a base vazia. Foi assim que o teste de ponta a ponta encontrou isto: a
   * tela abriu com "Nenhuma ordem no aparelho" tendo duas.
   *
   * Roda UMA vez, quando a base fica pronta. As tentativas seguintes vêm do
   * relógio e do evento de rede.
   */
  const jaAbriu = useRef(false);
  useEffect(() => {
    if (!sincronizacao || jaAbriu.current) return;
    jaAbriu.current = true;
    void sincronizarRef.current();
  }, [sincronizacao]);

  useEffect(() => {
    const subiu = () => {
      setOnline(true);
      /*
       * A espera é zerada ANTES de tentar.
       *
       * Sem isto, o evento de rede chega e a fila responde "ainda não é hora" —
       * porque a última falha empurrou a próxima tentativa para daqui a meio
       * minuto. O técnico ficaria com o indicador cheio no estacionamento, com
       * sinal, esperando um relógio interno que ele não vê. Foi assim que este
       * defeito apareceu no teste de modo avião.
       */
      void filaRef.current?.aRedeVoltou().then(() => sincronizarRef.current());
    };
    const caiu = () => setOnline(false);
    window.addEventListener('online', subiu);
    window.addEventListener('offline', caiu);
    return () => {
      window.removeEventListener('online', subiu);
      window.removeEventListener('offline', caiu);
    };
  }, []);

  /*
   * O RELÓGIO É A REDE DE SEGURANÇA, e a cadência dele segue o que está preso.
   *
   * O evento `online` do navegador é um gatilho, não uma garantia: ele não
   * chega em toda transição de rede, e depender dele deixaria a fila parada
   * indefinidamente com sinal cheio. Foi o que aconteceu no teste de modo
   * avião — o aparelho voltou a ter rede e o indicador seguiu marcando uma
   * operação pendente.
   *
   * COM COISA NA FILA, dez segundos: é trabalho de alguém esperando, e o
   * técnico está olhando o indicador. SEM NADA, um minuto: não há o que enviar,
   * e a consulta só serve para trazer o que a coordenação mudou.
   *
   * A alternativa — um intervalo curto fixo — gastaria bateria o dia inteiro
   * para cobrir os poucos minutos em que a fila não está vazia.
   */
  const temPendencia = estado.pendentes > 0;
  useEffect(() => {
    const intervalo = window.setInterval(
      () => {
        void filaRef.current?.aRedeVoltou().then(() => sincronizarRef.current());
      },
      temPendencia ? 10_000 : 60_000
    );
    return () => window.clearInterval(intervalo);
  }, [temPendencia]);

  const enfileirar = useCallback<Campo['enfileirar']>(
    async (e) => {
      if (!fila) throw new Error('a base local ainda não abriu');
      const id = await fila.enfileirar(e);
      await atualizarEstado();
      // Tenta na hora. Sem rede, falha e fica na fila — que é o comportamento
      // correto, e o único que a tela precisa conhecer.
      void sincronizarRef.current();
      return id;
    },
    [fila, atualizarEstado]
  );

  const resolverAtencao = useCallback<Campo['resolverAtencao']>(
    async (id, opcoes) => {
      if (!fila) return;
      await fila.resolverAtencao(id, opcoes);
      await atualizarEstado();
    },
    [fila, atualizarEstado]
  );

  const descartar = useCallback<Campo['descartar']>(
    async (id) => {
      if (!fila) return;
      await fila.descartar(id);
      await atualizarEstado();
    },
    [fila, atualizarEstado]
  );

  if (erroAoAbrir) {
    /*
     * SEM BASE LOCAL, ESTE APLICATIVO NÃO TEM SENTIDO — e dizer isso é melhor
     * do que degradar para "funciona só online". Um aplicativo de campo que
     * silenciosamente vira um site é um aplicativo que vai perder o trabalho do
     * dia na primeira vez que a rede cair.
     */
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="text-lg font-semibold text-text">Não foi possível abrir a base do aparelho</h1>
        <p className="text-sm text-muted">{erroAoAbrir}</p>
        <p className="text-sm text-muted">
          Sem ela o aplicativo não consegue guardar o seu trabalho quando a rede cair — e por isso ele não
          abre pela metade.
        </p>
      </main>
    );
  }

  if (!base || !fila || !sincronizacao) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center p-6">
        <p className="text-sm text-muted" role="status">
          Abrindo a base do aparelho…
        </p>
      </main>
    );
  }

  const valor: Campo = {
    base,
    fila,
    sincronizacao,
    estado,
    ultimaSincronizacao,
    sincronizando,
    ultimoResultado,
    online,
    sincronizar,
    enfileirar,
    resolverAtencao,
    descartar,
    atualizarEstado,
  };

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/** Lê uma coleção local e re-renderiza quando o estado da fila muda. */
export function useColecaoLocal<T>(nome: string): { linhas: T[]; carregando: boolean } {
  const { base, estado, ultimaSincronizacao } = useCampo();
  const [linhas, setLinhas] = useState<T[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    void base
      .colecao<T>(nome)
      .todos()
      .then((r) => {
        if (!vivo) return;
        setLinhas(r);
        setCarregando(false);
      });
    return () => {
      vivo = false;
    };
    // Relê quando a sincronização traz coisa nova ou a fila muda: são os dois
    // momentos em que o conteúdo local pode ter mudado.
  }, [base, nome, ultimaSincronizacao, estado.pendentes, estado.atencao]);

  return { linhas, carregando };
}
