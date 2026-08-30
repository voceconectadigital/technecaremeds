/**
 * Aurora — os recursos do aparelho, no NAVEGADOR (EPIC-014).
 *
 * Estas implementações são as do PWA. Elas não são um degrau menor do que as
 * nativas: o técnico que abre o Aurora pelo navegador precisa conseguir
 * fotografar, ler o QR do equipamento e saber se está sem rede — exatamente
 * como o que instalou pela loja.
 *
 * O que muda é o mecanismo, e onde o navegador não tem mecanismo a porta diz
 * `disponivel(): false` — e a tela oferece o caminho alternativo em vez de um
 * botão que falha quando tocado.
 */
import type {
  AdaptadorDeCamera,
  AdaptadorDeLeituraDeCodigo,
  AdaptadorDePush,
  AdaptadorDeRede,
  CodigoLido,
  EstadoDaRede,
  FotoCapturada,
} from './porta';

/* -------------------------------------------------------------------------- */

/**
 * A câmera do navegador é um `<input type="file" capture>`.
 *
 * Parece pobre e é a escolha certa. A alternativa — `getUserMedia` com uma
 * prévia desenhada num `canvas` — significa escrever um aplicativo de câmera:
 * foco, exposição, orientação, o botão de virar a lente. O aplicativo de câmera
 * do aparelho já faz tudo isso, melhor, e é o que a pessoa conhece.
 *
 * `capture="environment"` pede a lente traseira, que é a que aponta para o
 * equipamento. Em desktop o atributo é ignorado e o seletor de arquivo aparece
 * — que é o comportamento correto para quem está na mesa.
 */
export function cameraDoNavegador(): AdaptadorDeCamera {
  return {
    nome: 'web:input-file',
    async disponivel() {
      return typeof document !== 'undefined';
    },
    capturar() {
      return new Promise<FotoCapturada | null>((resolver) => {
        const entrada = document.createElement('input');
        entrada.type = 'file';
        entrada.accept = 'image/*';
        entrada.setAttribute('capture', 'environment');
        entrada.style.display = 'none';

        /*
         * DESISTIR NÃO É ERRO, e o navegador não avisa quando alguém desiste.
         *
         * Não existe evento de "cancelou" confiável em todo navegador: o
         * `cancel` é recente e não universal. Sem o `focus` como rede de
         * segurança, a promessa ficaria pendurada para sempre e a tela ficaria
         * esperando uma foto que não vem.
         */
        let resolvido = false;
        const terminar = (r: FotoCapturada | null) => {
          if (resolvido) return;
          resolvido = true;
          entrada.remove();
          resolver(r);
        };

        entrada.addEventListener('change', async () => {
          const arquivo = entrada.files?.[0];
          if (!arquivo) return terminar(null);
          const bytes = new Uint8Array(await arquivo.arrayBuffer());
          terminar({
            bytes,
            tipo: arquivo.type || 'image/jpeg',
            nomeSugerido: arquivo.name || 'foto.jpg',
            largura: null,
            altura: null,
          });
        });
        entrada.addEventListener('cancel', () => terminar(null));
        window.addEventListener(
          'focus',
          () => {
            // O `focus` volta antes de o `change` disparar; o atraso dá tempo
            // ao arquivo chegar antes de concluirmos que ninguém escolheu.
            setTimeout(() => {
              if (!entrada.files?.length) terminar(null);
            }, 700);
          },
          { once: true }
        );

        document.body.appendChild(entrada);
        entrada.click();
      });
    },
  };
}

/* -------------------------------------------------------------------------- */

interface DetectorDeCodigo {
  detect(fonte: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
}

/**
 * O leitor de código do navegador usa `BarcodeDetector` quando existe.
 *
 * Ele é nativo do sistema, gratuito e rápido — e não está em todo navegador.
 * A alternativa seria embarcar um decodificador em WebAssembly, que pesa
 * centenas de kilobytes no pacote que precisa abrir sem rede.
 *
 * A decisão: usar o que existe, dizer quando não existe, e a tela oferece
 * digitar o número do patrimônio. Um leitor que não abre é pior do que um campo
 * de texto que abre.
 */
export function leitorDoNavegador(): AdaptadorDeLeituraDeCodigo {
  const Detector = (globalThis as Record<string, unknown>).BarcodeDetector as
    (new (o?: { formats?: string[] }) => DetectorDeCodigo) | undefined;

  return {
    nome: 'web:barcode-detector',
    async disponivel() {
      return Boolean(Detector) && Boolean(navigator.mediaDevices?.getUserMedia);
    },
    async ler(): Promise<CodigoLido | null> {
      if (!Detector) return null;

      const fluxo = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      const video = document.createElement('video');
      video.srcObject = fluxo;
      video.setAttribute('playsinline', 'true');
      await video.play();

      const detector = new Detector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });

      try {
        /*
         * O laço tem TETO. Uma câmera apontada para uma parede nunca lê nada, e
         * sem limite a promessa ficaria aberta com a lente ligada — gastando
         * bateria de um aparelho que precisa durar o turno.
         */
        const limite = Date.now() + 30_000;
        while (Date.now() < limite) {
          const achados = await detector.detect(video);
          if (achados.length > 0) {
            return { valor: achados[0]!.rawValue, formato: achados[0]!.format ?? null };
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        return null;
      } finally {
        // A LENTE PRECISA APAGAR. Uma câmera que fica ligada depois da leitura
        // é bateria consumida e um ponto vermelho que assusta quem está num
        // hospital.
        fluxo.getTracks().forEach((t) => t.stop());
        video.remove();
      }
    },
  };
}

/* -------------------------------------------------------------------------- */

export function redeDoNavegador(): AdaptadorDeRede {
  return {
    nome: 'web:navigator',
    async estado(): Promise<EstadoDaRede> {
      /*
       * `navigator.onLine` mente nos dois sentidos, e este adaptador não
       * esconde isso: ele devolve o que o sistema acha, e quem decide se vale
       * tentar é a fila — que sabe porque tentou.
       */
      return { conectado: typeof navigator === 'undefined' ? true : navigator.onLine, tipo: null };
    },
    aoMudar(ouvinte) {
      const subiu = () => ouvinte({ conectado: true, tipo: null });
      const caiu = () => ouvinte({ conectado: false, tipo: null });
      window.addEventListener('online', subiu);
      window.addEventListener('offline', caiu);
      return () => {
        window.removeEventListener('online', subiu);
        window.removeEventListener('offline', caiu);
      };
    },
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Push no navegador: o mecanismo existe, a infraestrutura ainda não.
 *
 * Notificação empurrada na web exige um servidor de push com chaves VAPID e uma
 * rota que guarde a inscrição de cada aparelho. Nada disso está decidido — e
 * inventar aqui produziria um botão que pede permissão e não entrega nada, que
 * é a forma mais rápida de fazer alguém negar a permissão para sempre.
 *
 * **A VALIDAR** — ver `docs/AURORA-FIELD-LOJAS.md`.
 */
export function pushDoNavegador(): AdaptadorDePush {
  return {
    nome: 'web:indisponivel',
    async disponivel() {
      return false;
    },
    async pedirPermissao() {
      return false;
    },
    async registrar() {
      return null;
    },
  };
}
