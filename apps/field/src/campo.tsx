/**
 * Aurora — o contexto de campo: base local, fila, sincronização e aparelho
 * (EPIC-014 · ADR-029).
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
 *
 * E É AQUI QUE A PLATAFORMA É ESCOLHIDA, uma vez só.
 *
 * Armazenamento, arquivos, câmera, leitor de código e rede são resolvidos no
 * arranque e entregues às telas por porta. Nenhuma tela sabe se está num
 * navegador, num Android ou num iPhone — e é isso que permite as três
 * distribuições saírem da mesma base.
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
import { useSession } from '@aurora/app-kit';
import type { ArmazenamentoOffline, Colecao } from './armazenamento';
import {
  enviarAnexosPendentes,
  estadoDosAnexos,
  type AdaptadorDeArquivos,
  type AnexoPendente,
  type EstadoDosAnexos,
} from './arquivos';
import {
  capturarEvidencia,
  guardarEvidencia,
  registrarChaveDoServidor,
  resolverReferenciasAoAnexo,
} from './anexos';
import {
  pluginDeArquivosDoAparelho,
  resolverArmazenamento,
  resolverArquivos,
  resolverDispositivo,
  type Dispositivo,
} from './dispositivo';
import { FilaDeSaida, type ComandoNaFila, type PendenciaDeAtencao, type EstadoDaFila } from './fila';
import { identidadeAtual } from './identidade';
import {
  ErroDeSessaoExpirada,
  Sincronizacao,
  type PacoteDoDia,
  type ResultadoDaSincronizacao,
} from './sincronizacao';
import { umaPorVez } from './uma-por-vez';

export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001/v1';

/**
 * O identificador da operação, gerado no APARELHO.
 *
 * `crypto.randomUUID` existe em todo contexto seguro, que é o único em que este
 * aplicativo roda — o service worker e o IndexedDB também exigem. O ramo
 * alternativo cobre um `http://` de rede interna, onde a API não é exposta: ali
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
  base: ArmazenamentoOffline;
  fila: FilaDeSaida;
  sincronizacao: Sincronizacao;
  estado: EstadoDaFila;
  /**
   * Os recursos do aparelho, atrás das portas.
   *
   * A tela pede "uma foto" e recebe uma foto. Se isso vem de um seletor de
   * arquivo do navegador ou da câmera nativa é decisão do adaptador, tomada uma
   * vez no arranque — e nenhuma tela precisa saber.
   */
  dispositivo: Dispositivo;
  arquivos: AdaptadorDeArquivos | null;
  anexos: Colecao<AnexoPendente>;
  anexosEstado: EstadoDosAnexos;
  /** Quando o pacote do dia chegou. `null` = nunca sincronizou neste aparelho. */
  ultimaSincronizacao: string | null;
  sincronizando: boolean;
  ultimoResultado: ResultadoDaSincronizacao | null;
  online: boolean;
  /**
   * O servidor respondeu 401: a sessão venceu. A fila está intacta e PARADA —
   * os gatilhos automáticos deixam de tentar até a pessoa entrar de novo.
   */
  sessaoExpirada: boolean;
  /**
   * `manual`: o toque em "Sincronizar agora". É o único gatilho que tenta
   * mesmo com a sessão vencida — a pessoa pode estar conferindo.
   */
  sincronizar(opcoes?: { manual?: boolean }): Promise<void>;
  /** Enfileira um comando e atualiza o indicador. */
  enfileirar(e: {
    agregado: string;
    metodo: ComandoNaFila['metodo'];
    caminho: string;
    corpo: unknown;
    rotulo: string;
    id?: string;
  }): Promise<string>;
  /** Captura uma evidência. `null` quando a pessoa desiste. */
  capturarFoto(workOrderId: string, finalidade: string): Promise<AnexoPendente | null>;
  /**
   * Guarda bytes que já existem como evidência — a assinatura desenhada no dedo
   * produz um PNG sem passar por câmera nenhuma, e precisa terminar no MESMO
   * lugar que a foto: mesma fila, mesma retomada, mesmos defeitos conhecidos.
   */
  anexarBytes(
    workOrderId: string,
    finalidade: string,
    bytes: Uint8Array,
    tipo: string
  ): Promise<AnexoPendente | null>;
  resolverAtencao(id: string, opcoes: { desbloquear: boolean }): Promise<void>;
  /** Solta os parados de uma OS que não têm pendência à frente. */
  desbloquear(agregado: string): Promise<void>;
  descartar(id: string): Promise<void>;
  atualizarEstado(): Promise<void>;
}

const Ctx = createContext<Campo | null>(null);

export function useCampo(): Campo {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCampo precisa de <CampoProvider>');
  return c;
}

export function CampoProvider({
  children,
  baseDeTeste,
}: {
  children: ReactNode;
  /** Só para a suíte: injeta a base pronta em vez de abrir a do aparelho. */
  baseDeTeste?: ArmazenamentoOffline;
}) {
  const [base, setBase] = useState<ArmazenamentoOffline | null>(baseDeTeste ?? null);
  const [erroAoAbrir, setErroAoAbrir] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoDaFila>({
    pendentes: 0,
    bloqueados: 0,
    atencao: 0,
    deOutraSessao: 0,
    maisAntigoEm: null,
  });
  const [anexosEstado, setAnexosEstado] = useState<EstadoDosAnexos>({
    pendentes: 0,
    falhados: 0,
    bytesPendentes: 0,
    progresso: null,
    deOutraSessao: 0,
  });
  const [ultimaSincronizacao, setUltima] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState<ResultadoDaSincronizacao | null>(null);
  /*
   * O INDICADOR NASCE COM UM PALPITE E É CORRIGIDO PELA TENTATIVA.
   *
   * O que o sistema acha entra como chute inicial — acerta o caso comum e não
   * custa nada. Quem decide de verdade é a primeira sincronização: se ela
   * falhou por rede, estamos sem rede; se passou, estamos com rede. É a única
   * forma de o indicador não mentir num wi-fi que conecta e não roteia.
   */
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  /*
   * O dispositivo é resolvido UMA VEZ. `useMemo` sem dependências: a plataforma
   * não muda no meio da sessão, e recriar os adaptadores a cada render trocaria
   * o ouvinte de rede a cada atualização de tela.
   */
  const dispositivo = useMemo(() => resolverDispositivo(), []);
  const [arquivos, setArquivos] = useState<AdaptadorDeArquivos | null>(null);

  useEffect(() => {
    let vivo = true;
    void pluginDeArquivosDoAparelho()
      .then((plugin) => vivo && setArquivos(resolverArquivos(plugin)))
      .catch(() => vivo && setArquivos(resolverArquivos()));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (baseDeTeste) return;
    let vivo = true;
    /*
     * O ARMAZENAMENTO É ESCOLHIDO PELA PLATAFORMA, num lugar só.
     *
     * Hoje as três distribuições usam IndexedDB — o WebView do Android e do iOS
     * tem, e funciona. A troca para SQLite nativo é uma linha em
     * `resolverArmazenamento`, sem tocar em fila, sincronização ou tela: é
     * exatamente para isso que a porta existe.
     */
    resolverArmazenamento()
      .then((b) => vivo && setBase(b))
      .catch((e: unknown) =>
        setErroAoAbrir(e instanceof Error ? e.message : 'não foi possível abrir a base local')
      );
    return () => {
      vivo = false;
    };
  }, [baseDeTeste]);

  const anexos = useMemo(() => base?.colecao<AnexoPendente>('anexos') ?? null, [base]);
  const anexosRef = useRef(anexos);
  anexosRef.current = anexos;

  const fila = useMemo(() => {
    if (!base) return null;
    return new FilaDeSaida(base.colecao<ComandoNaFila>('fila'), base.colecao<PendenciaDeAtencao>('atencao'), {
      agora: () => new Date(),
      novoId,
      identidade: identidadeAtual,
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
      /*
       * O registro de anexo devolve a chave de armazenamento, e é ela que
       * libera o envio dos bytes. A fila não conhece anexo — ela avisa que o
       * comando passou, e quem conhece faz o resto.
       */
      /*
       * A assinatura aponta para o anexo pelo identificador DO SERVIDOR, que só
       * existe depois do registro. Ver `resolverReferenciasAoAnexo`.
       */
      async resolverCorpo(c) {
        if (!anexosRef.current) return { pronto: true, corpo: c.corpo };
        return resolverReferenciasAoAnexo(anexosRef.current, c.corpo);
      },
      async aoConcluir(c, corpo) {
        if (!anexosRef.current) return;
        if (!c.caminho.endsWith('/attachments')) return;
        await registrarChaveDoServidor(anexosRef.current, c.id, corpo);
      },
    });
  }, [base]);

  const sincronizacao = useMemo(() => {
    if (!base || !fila) return null;
    return new Sincronizacao(base, fila, {
      agora: () => new Date(),
      identidade: identidadeAtual,
      async baixarPacote(desde) {
        const url = new URL(`${API}/field/sync`);
        if (desde) url.searchParams.set('since', desde);
        const r = await fetch(url.toString(), { headers: cabecalhos() });
        if (r.status === 401) throw new ErroDeSessaoExpirada();
        if (!r.ok) throw new Error(`o servidor respondeu ${r.status} ao pedir o dia`);
        return (await r.json()) as PacoteDoDia;
      },
    });
  }, [base, fila]);

  const atualizarEstado = useCallback(async () => {
    if (!fila || !sincronizacao) return;
    setEstado(await fila.estado());
    setUltima(await sincronizacao.ultimaMarca());
    if (anexos) setAnexosEstado(await estadoDosAnexos(anexos, identidadeAtual()));
  }, [fila, sincronizacao, anexos]);

  useEffect(() => {
    void atualizarEstado();
  }, [atualizarEstado]);

  /*
   * SEM SESSÃO NÃO HÁ O QUE SINCRONIZAR.
   *
   * O provedor monta antes do login — é ele que abre a base local —, e o
   * relógio e a primeira sincronização disparavam na tela de entrar, levando
   * 401 da API. A sessão vem do contexto, e não do `localStorage`, para o
   * provedor saber quando ela muda.
   */
  const { token, organizationId } = useSession();
  const temSessaoRef = useRef(false);
  temSessaoRef.current = Boolean(token && organizationId);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  /*
   * A SESSÃO VENCIDA PARA OS GATILHOS AUTOMÁTICOS, e só eles.
   *
   * Guardamos o TOKEN que levou o 401. Enquanto for o mesmo, o relógio, o aviso
   * de rede e os toques não tentam: cada tentativa seria outro 401, e a tela já
   * disse o que fazer. Entrar de novo troca o token, e a fila volta a andar
   * sozinha — com os comandos intactos, porque o 401 não tira nada dela.
   */
  const [expirouNoToken, setExpirouNoToken] = useState<string | null>(null);
  const expirouRef = useRef<string | null>(null);
  const sessaoExpirada = expirouNoToken !== null && expirouNoToken === token;

  const passada = useCallback(async () => {
    if (!sincronizacao || !temSessaoRef.current) return;
    setSincronizando(true);
    try {
      const r = await sincronizacao.rodar();
      setUltimoResultado(r);
      // O que a tentativa descobriu vale mais do que o palpite do sistema.
      setOnline(!r.semRede);
      if (r.sessaoExpirada) {
        expirouRef.current = tokenRef.current;
        setExpirouNoToken(tokenRef.current);
        return;
      }
      if (!r.semRede) {
        expirouRef.current = null;
        setExpirouNoToken(null);
      }

      /*
       * AS FOTOS SOBEM DEPOIS DOS COMANDOS, e não junto.
       *
       * O comando é que cria o registro do anexo no servidor e devolve a chave;
       * sem ele, os bytes não têm para onde ir. Tentar os dois em paralelo faria
       * toda foto recém-capturada falhar uma vez antes de dar certo — barulho na
       * tela, tentativa contada, e nada ganho.
       */
      if (anexos && arquivos && !r.semRede) {
        await enviarAnexosPendentes(anexos, arquivos, {
          agora: () => new Date(),
          // Só sobem as fotos desta sessão (PF-66). Ver `AnexoPendente.identidade`.
          identidade: identidadeAtual,
          async enviarFatia({ anexo, offset, pedaco, ultima }) {
            /*
             * O IDENTIFICADOR DO SERVIDOR, e não o local.
             *
             * O `id` daqui é do aparelho; a linha no banco tem chave própria.
             * Mandar o local dava 404 numa rota que já existia — e o anexo
             * ficava "falhou" sem que ninguém entendesse por quê.
             */
            const resposta = await fetch(`${API}/field/attachments/${anexo.idNoServidor ?? anexo.id}/bytes`, {
              method: 'PUT',
              headers: cabecalhos({
                'content-type': 'application/octet-stream',
                'x-aurora-offset': String(offset),
                'x-aurora-sha256': anexo.sha256,
                'x-aurora-storage-key': anexo.chaveNoServidor ?? '',
                'x-aurora-final': ultima ? '1' : '0',
              }),
              body: pedaco as unknown as BodyInit,
            });
            let recebidos: number | undefined;
            try {
              const corpo = (await resposta.json()) as { received?: number };
              recebidos = corpo.received;
            } catch {
              /* resposta sem corpo: o status decide, e o deslocamento local segue. */
            }
            return { status: resposta.status, recebidos };
          },
        });
      }
    } finally {
      setSincronizando(false);
      await atualizarEstado();
    }
  }, [sincronizacao, atualizarEstado, anexos, arquivos]);

  /*
   * UMA SINCRONIZAÇÃO DE CADA VEZ — ver `umaPorVez`. A guarda vive fora do
   * ciclo de render (`useMemo` sem dependências, chamando pela referência):
   * recriá-la a cada render daria a cada gatilho uma guarda nova, e a guarda
   * não guardaria nada.
   */
  const passadaRef = useRef(passada);
  passadaRef.current = passada;
  const umaSo = useMemo(() => umaPorVez(() => passadaRef.current()), []);

  const sincronizar = useCallback<Campo['sincronizar']>(
    async (opcoes) => {
      if (!opcoes?.manual && expirouRef.current !== null && expirouRef.current === tokenRef.current) return;
      await umaSo();
    },
    [umaSo]
  );

  const sincronizarRef = useRef(sincronizar);
  sincronizarRef.current = sincronizar;
  const filaRef = useRef(fila);
  filaRef.current = fila;

  /*
   * A PRIMEIRA SINCRONIZAÇÃO ACONTECE SOZINHA, ao abrir.
   *
   * Sem ela, o aparelho recém-instalado ficava em "nunca sincronizou" até
   * alguém tocar no botão ou até o relógio disparar — e o técnico que abre o
   * aplicativo às 7h55 e desce para o subsolo às 7h56 desceria com a base
   * vazia. Foi assim que o teste de ponta a ponta encontrou isto.
   *
   * E ELA SE REPETE A CADA SESSÃO. Aberto sem sessão, o aplicativo não tem o
   * que baixar; depois de entrar, só o relógio de um minuto disparava — e o
   * técnico via o dia vazio logo depois do login. A chave é a sessão inteira:
   * trocar de organização também baixa o dia certo na hora.
   */
  const sincronizouNaSessao = useRef<string | null>(null);
  useEffect(() => {
    if (!sincronizacao || !token || !organizationId) return;
    const chave = `${token}|${organizationId}`;
    if (sincronizouNaSessao.current === chave) return;
    sincronizouNaSessao.current = chave;
    void sincronizarRef.current();
  }, [sincronizacao, token, organizationId]);

  /*
   * O AVISO DE REDE VEM DA PORTA, e não de `window`.
   *
   * No navegador o adaptador escuta `online`/`offline`; no aparelho, o plugin
   * de rede, que sabe mais — inclusive o tipo de conexão. Este arquivo e as
   * telas não mudam por causa disso, e é esse o ponto.
   *
   * O que ele NÃO faz é decidir se vale tentar: continua sendo um gatilho, e a
   * fila é que sabe, porque tentou.
   */
  useEffect(() => {
    return dispositivo.rede.aoMudar((e) => {
      setOnline(e.conectado);
      if (!e.conectado) return;
      void filaRef.current?.aRedeVoltou().then(() => sincronizarRef.current());
    });
  }, [dispositivo]);

  /*
   * O RELÓGIO É A REDE DE SEGURANÇA, e a cadência segue o que está preso.
   *
   * O aviso de rede é um gatilho, não uma garantia: ele não chega em toda
   * transição, e depender dele deixaria a fila parada com sinal cheio — foi o
   * que aconteceu no teste de modo avião.
   *
   * COM COISA NA FILA, dez segundos: é trabalho de alguém esperando. SEM NADA,
   * um minuto: não há o que enviar, e a consulta só traz o que a coordenação
   * mudou. Um intervalo curto fixo gastaria bateria o dia inteiro para cobrir
   * os poucos minutos em que a fila não está vazia.
   */
  const temPendencia = estado.pendentes > 0 || anexosEstado.pendentes > 0;
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

  const capturarFoto = useCallback<Campo['capturarFoto']>(
    async (workOrderId, finalidade) => {
      if (!fila || !arquivos || !anexos) return null;
      const anexo = await capturarEvidencia({
        workOrderId,
        finalidade,
        camera: dispositivo.camera,
        arquivos,
        anexos,
        novoId,
        agora: () => new Date(),
        identidade: identidadeAtual,
        enfileirar: (e) => fila.enfileirar(e),
      });
      await atualizarEstado();
      void sincronizarRef.current();
      return anexo;
    },
    [fila, arquivos, anexos, dispositivo, atualizarEstado]
  );

  const anexarBytes = useCallback<Campo['anexarBytes']>(
    async (workOrderId, finalidade, bytes, tipo) => {
      if (!fila || !arquivos || !anexos) return null;
      const anexo = await guardarEvidencia({
        workOrderId,
        finalidade,
        arquivos,
        anexos,
        novoId,
        agora: () => new Date(),
        identidade: identidadeAtual,
        bytes,
        tipo,
        enfileirar: (e) => fila.enfileirar(e),
      });
      await atualizarEstado();
      void sincronizarRef.current();
      return anexo;
    },
    [fila, arquivos, anexos, atualizarEstado]
  );

  const resolverAtencao = useCallback<Campo['resolverAtencao']>(
    async (id, opcoes) => {
      if (!fila) return;
      await fila.resolverAtencao(id, opcoes);
      await atualizarEstado();
      // "Tentar de novo AGORA": o comando voltou à fila, e o botão promete.
      if (opcoes.desbloquear) void sincronizarRef.current();
    },
    [fila, atualizarEstado]
  );

  const desbloquear = useCallback<Campo['desbloquear']>(
    async (agregado) => {
      if (!fila) return;
      await fila.desbloquearAgregado(agregado);
      await atualizarEstado();
      void sincronizarRef.current();
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

  if (!base || !fila || !sincronizacao || !anexos) {
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
    dispositivo,
    arquivos,
    anexos,
    anexosEstado,
    ultimaSincronizacao,
    sincronizando,
    ultimoResultado,
    online,
    sessaoExpirada,
    sincronizar,
    enfileirar,
    capturarFoto,
    anexarBytes,
    resolverAtencao,
    desbloquear,
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

/**
 * Um campo de formulário que SOBREVIVE ao aplicativo ser derrubado.
 *
 * O sistema operacional derruba o aplicativo de campo o tempo todo — memória
 * apertada, a pessoa trocando de aplicativo, a tela apagando por dez minutos.
 * Um `useState` some junto, e o que some é o diagnóstico que o técnico digitou
 * na frente do equipamento, que é a informação mais cara da OS inteira.
 *
 * Este gancho grava no aparelho a cada tecla, com um respiro: um `setTimeout`
 * curto junta as teclas de uma palavra numa gravação só. Gravar a cada tecla
 * sem o respiro faria uma escrita no IndexedDB por caractere — e a digitação
 * ficaria travada num aparelho lento, que é onde ela mais precisa ser fluida.
 *
 * O respiro é de 400ms, e não de dois segundos: o custo de perder o que foi
 * digitado nos últimos instantes antes de o sistema derrubar o aplicativo é
 * alto, e uma gravação de poucos bytes é barata.
 */
export function useRascunho(
  chave: string,
  inicial = ''
): [string, (v: string) => void, { carregado: boolean }] {
  const { base } = useCampo();
  const [valor, setValor] = useState(inicial);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void base
      .colecao<{ valor: string }>('rascunhos')
      .ler(chave)
      .then((r) => {
        if (!vivo) return;
        /*
         * O QUE ESTÁ NO APARELHO VENCE o valor inicial.
         *
         * Sem esta ordem, reabrir o aplicativo mostraria o campo vazio por um
         * instante e depois o texto — e, pior, uma tecla digitada nesse
         * instante gravaria por cima do que estava guardado.
         */
        if (r?.valor !== undefined) setValor(r.valor);
        setCarregado(true);
      });
    return () => {
      vivo = false;
    };
  }, [base, chave]);

  const definir = useCallback(
    (v: string) => {
      setValor(v);
      if (!carregado) return;
      const t = window.setTimeout(() => {
        void base.colecao<{ valor: string }>('rascunhos').gravar(chave, { valor: v });
      }, 400);
      return () => window.clearTimeout(t);
    },
    [base, chave, carregado]
  );

  return [valor, definir, { carregado }];
}

/** Apaga o rascunho depois de ele virar comando na fila. */
export async function limparRascunhos(base: ArmazenamentoOffline, chaves: readonly string[]): Promise<void> {
  const c = base.colecao<{ valor: string }>('rascunhos');
  for (const k of chaves) await c.apagar(k);
}
