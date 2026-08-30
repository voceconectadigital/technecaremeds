/**
 * Aurora — os recursos do aparelho, DENTRO DO APLICATIVO (EPIC-014).
 *
 * OS PLUGINS SÃO CARREGADOS SOB DEMANDA, e essa decisão é a razão de este
 * arquivo ser separado do `web.ts`.
 *
 * `import` estático de `@capacitor/camera` colocaria o plugin no pacote do PWA
 * — que precisa abrir sem rede, num celular, e cujo tamanho é o caminho crítico
 * do primeiro carregamento. O plugin não faz nada no navegador; ele só pesa.
 *
 * Com `import()` dentro do método, o navegador nunca baixa o que não vai usar,
 * e o aplicativo empacotado carrega na primeira chamada. O custo é uma
 * indireção; o benefício é o PWA não pagar pelo que existe para a loja.
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

export function cameraDoAparelho(): AdaptadorDeCamera {
  return {
    nome: 'capacitor:camera',
    async disponivel() {
      return true;
    },
    async capturar(opcoes): Promise<FotoCapturada | null> {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      try {
        const foto = await Camera.getPhoto({
          /*
           * `Base64` e não `Uri`.
           *
           * `Uri` devolveria um caminho para um arquivo temporário do sistema,
           * que o Android pode recolher a qualquer momento — inclusive antes de
           * o técnico terminar a OS. Os bytes precisam ser NOSSOS desde a
           * captura, guardados no nosso diretório, ou a foto some sem ninguém
           * ter apagado nada.
           */
          resultType: CameraResultType.Base64,
          source: CameraSource.Camera,
          quality: opcoes?.qualidade ?? 70,
          width: opcoes?.larguraMaxima ?? 1600,
          /*
           * Sem correção de perspectiva nem edição: a foto é EVIDÊNCIA. Uma
           * imagem que passou por edição no aparelho perde valor num laudo, e
           * o botão de editar convida exatamente a isso.
           */
          allowEditing: false,
          // A foto de laudo não vai para a galeria — ver a nota do adaptador
          // de arquivos sobre diretório privado.
          saveToGallery: false,
        });

        if (!foto.base64String) return null;
        return {
          bytes: deBase64(foto.base64String),
          tipo: `image/${foto.format || 'jpeg'}`,
          nomeSugerido: `foto.${foto.format || 'jpg'}`,
          largura: null,
          altura: null,
        };
      } catch (e) {
        /*
         * O plugin lança quando a pessoa fecha a câmera, e desistir não é erro.
         * A distinção é pela mensagem porque o plugin não oferece código —
         * e, na dúvida, tratamos como desistência: mostrar "falha ao capturar"
         * para quem mudou de ideia é pior do que engolir uma falha rara.
         */
        const texto = e instanceof Error ? e.message : String(e);
        if (/cancel/i.test(texto)) return null;
        throw e;
      }
    },
  };
}

/* -------------------------------------------------------------------------- */

export function leitorDoAparelho(): AdaptadorDeLeituraDeCodigo {
  return {
    nome: 'capacitor:barcode-scanner',
    async disponivel() {
      return true;
    },
    async ler(): Promise<CodigoLido | null> {
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } =
        await import('@capacitor/barcode-scanner');
      const r = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.ALL,
        scanInstructions: 'Aponte para a etiqueta do equipamento',
      });
      // Cadeia vazia é o que o plugin devolve quando a pessoa fecha o leitor.
      return r.ScanResult ? { valor: r.ScanResult, formato: null } : null;
    },
  };
}

/* -------------------------------------------------------------------------- */

export function redeDoAparelho(): AdaptadorDeRede {
  let cancelar: (() => void) | null = null;

  return {
    nome: 'capacitor:network',
    async estado(): Promise<EstadoDaRede> {
      const { Network } = await import('@capacitor/network');
      const s = await Network.getStatus();
      /*
       * O aparelho sabe MAIS do que o navegador: ele diz o tipo de conexão.
       *
       * Isso não muda quem decide sincronizar — continua sendo a fila, porque
       * ela tentou —, mas muda o que a tela pode explicar. "Sem rede" e "no
       * 3G, devagar" pedem coisas diferentes de quem está em campo.
       */
      return { conectado: s.connected, tipo: s.connectionType ?? null };
    },
    aoMudar(ouvinte) {
      void (async () => {
        const { Network } = await import('@capacitor/network');
        const h = await Network.addListener('networkStatusChange', (s) =>
          ouvinte({ conectado: s.connected, tipo: s.connectionType ?? null })
        );
        cancelar = () => void h.remove();
      })();
      return () => cancelar?.();
    },
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Push no aparelho: o plugin existe, o SERVIDOR ainda não.
 *
 * `registrar()` devolve o identificador que o servidor usaria — e não há rota
 * que o receba, nem projeto de Firebase, nem certificado da Apple. Tudo isso é
 * decisão do cliente e custa dinheiro; ver `docs/AURORA-FIELD-LOJAS.md`.
 *
 * O adaptador existe agora para que a tela e o domínio já falem com a porta
 * certa. Quando a infraestrutura for decidida, muda este arquivo e mais nada.
 *
 * **A VALIDAR** — projeto de push, chaves e rota de inscrição.
 */
export function pushDoAparelho(): AdaptadorDePush {
  return {
    nome: 'capacitor:push',
    async disponivel() {
      return true;
    },
    async pedirPermissao() {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const r = await PushNotifications.requestPermissions();
      return r.receive === 'granted';
    },
    async registrar() {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      return new Promise<string | null>((resolver) => {
        /*
         * O TETO EXISTE PORQUE O REGISTRO PODE NUNCA VOLTAR.
         *
         * Sem projeto de push configurado no aparelho, o `registration` não
         * dispara e nem o `registrationError` — a promessa ficaria pendurada e
         * a tela de perfil ficaria carregando para sempre.
         */
        const limite = setTimeout(() => resolver(null), 10_000);
        void PushNotifications.addListener('registration', (t) => {
          clearTimeout(limite);
          resolver(t.value);
        });
        void PushNotifications.addListener('registrationError', () => {
          clearTimeout(limite);
          resolver(null);
        });
        void PushNotifications.register();
      });
    },
  };
}

function deBase64(texto: string): Uint8Array {
  const bruto = atob(texto);
  const out = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i++) out[i] = bruto.charCodeAt(i);
  return out;
}
