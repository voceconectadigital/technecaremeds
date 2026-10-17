/**
 * Aurora Field — empacotamento nativo (EPIC-014 · ADR-029).
 *
 * O MESMO CÓDIGO VIRA TRÊS DISTRIBUIÇÕES: navegador, Android e iOS. Este
 * arquivo é a única fronteira entre o que a build web produz e o que as lojas
 * instalam.
 *
 * TUDO QUE MUDA POR AMBIENTE VEM DE VARIÁVEL, e não está escrito aqui.
 *
 * O identificador do aplicativo é o exemplo que mais importa: `br.com.aurora.field`
 * e `br.com.aurora.field.homolog` precisam ser identificadores DIFERENTES, ou o
 * aparelho de quem testa e o de quem trabalha não podem conviver — e a
 * instalação de homologação por cima da de produção apagaria a base local com o
 * dia de trabalho dentro.
 *
 * Uma vez publicado, o identificador é IMUTÁVEL nas duas lojas. Trocá-lo cria
 * um aplicativo novo, sem as instalações, sem as avaliações e sem os aparelhos
 * já configurados. É por isso que ele é configuração, e não literal.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const identificador = process.env.AURORA_APP_ID ?? 'br.com.aurora.field';
// O nome INSTALADO no aparelho é público: o padrão é o da marca
// (`marca.config.json` → `campo.nomeNaTela`), nunca o codinome interno.
const nome = process.env.AURORA_APP_NAME ?? 'Téchne Care Campo';

/**
 * O servidor da API, e a lista de origens que o WebView pode alcançar.
 *
 * No aparelho, o conteúdo é servido de `https://localhost` (Android) ou
 * `capacitor://localhost` (iOS) — e toda chamada à API é, para o WebView, uma
 * requisição de origem cruzada. Sem a API declarada aqui, ela é bloqueada pela
 * política de segurança de conteúdo e a tela mostra "Failed to fetch" sem
 * nenhuma pista da causa.
 */
const api = process.env.VITE_API_URL ?? 'http://localhost:3001/v1';
const hostDaApi = (() => {
  try {
    return new URL(api).origin;
  } catch {
    return 'http://localhost:3001';
  }
})();

const config: CapacitorConfig = {
  appId: identificador,
  appName: nome,
  /*
   * A build web é a fonte. `npm run build` em `apps/field` produz `dist`, e
   * `npx cap sync` copia para os dois projetos nativos — não existe um segundo
   * conjunto de telas, e é esse o ponto do épico.
   */
  webDir: 'dist',
  /*
   * `bundledWebRuntime: false` — o runtime do Capacitor entra pelo pacote npm,
   * junto com o resto do código, e não como um arquivo solto copiado para os
   * projetos nativos. Um arquivo copiado envelhece sem ninguém notar.
   */
  bundledWebRuntime: false,

  server: {
    /*
     * `androidScheme: 'https'` e não `http`.
     *
     * O `localStorage`, o IndexedDB e o service worker só funcionam em contexto
     * seguro. Com `http`, o Android trata o conteúdo como inseguro e a base
     * local — onde mora o dia de trabalho — simplesmente não abre.
     */
    androidScheme: 'https',
    // A API é a única origem externa que o aplicativo alcança.
    allowNavigation: [new URL(hostDaApi).host],
  },

  android: {
    /*
     * O tráfego em claro é permitido APENAS em desenvolvimento, e por variável.
     *
     * Sem isto, apontar o aplicativo para uma API de desenvolvimento em
     * `http://` no laptop simplesmente não funciona, e o motivo não aparece em
     * lugar nenhum. Em produção fica desligado: a API é HTTPS, e permitir claro
     * seria abrir o token de sessão de um técnico numa rede de hospital.
     */
    allowMixedContent: process.env.AURORA_APP_AMBIENTE === 'desenvolvimento',
  },

  ios: {
    /*
     * `limitsNavigationsToAppBoundDomains` fica FORA de propósito.
     *
     * Ele restringe a navegação a domínios declarados no `Info.plist`, e a lista
     * de domínios de produção ainda não está definida — ver
     * `docs/AURORA-FIELD-LOJAS.md`. Ligar com a lista errada quebraria a
     * chamada à API dentro do aplicativo publicado, e o sintoma seria idêntico
     * ao de estar sem rede.
     *
     * **A VALIDAR** — domínio de produção da API.
     */
  },

  plugins: {
    /*
     * A tela de abertura fica no ar até o aplicativo dizer que montou.
     *
     * `launchAutoHide: false` é deliberado: o Aurora Field abre a base local
     * antes de mostrar qualquer coisa, e num aparelho lento isso leva um
     * instante. Com o esconde-automático, o técnico veria uma tela branca entre
     * a abertura e a lista — que é indistinguível de um aplicativo travado.
     */
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0f3d3a',
    },
  },
};

export default config;
