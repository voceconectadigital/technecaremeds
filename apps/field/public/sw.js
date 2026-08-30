/**
 * Aurora — o service worker do aplicativo de campo (SPEC v0.2 §20 · EPIC-014).
 *
 * ELE GUARDA O CASCO, E SÓ O CASCO.
 *
 * A SPEC separa as duas coisas de propósito: "cache do shell" e "base local com
 * OS, ativos, checklists". Os dados do dia vivem no IndexedDB, gravados pela
 * sincronização, e é lá que eles precisam estar — um dado num cache de HTTP
 * não pode ser consultado, filtrado nem alterado pela aplicação.
 *
 * O que este arquivo resolve é uma coisa só, e ela é indispensável: fazer o
 * aplicativo ABRIR sem rede. Sem ele, o técnico com a base local cheia veria a
 * tela de "sem conexão" do navegador — e o trabalho do dia estaria a
 * centímetros dele, inalcançável.
 *
 * NENHUMA REQUISIÇÃO DA API É CACHEADA. Nunca.
 *
 * Uma resposta de API guardada aqui voltaria depois como se fosse fresca, e a
 * tela mostraria uma OS no estado de ontem sem nenhuma forma de saber disso. E
 * um POST cacheado seria pior ainda: a fila leria "200" de um comando que nunca
 * saiu do aparelho, e apagaria o trabalho da fila achando que chegou.
 */

const CASCO = 'aurora-campo-casco-v1';

/** O que existe com nome fixo, e portanto pode ser listado. */
const ESSENCIAL = ['/', '/index.html', '/manifest.webmanifest', '/icone.svg'];

/**
 * OS PEDAÇOS DA BUILD PRECISAM ENTRAR NO CACHE NA INSTALAÇÃO — e esta função é
 * a correção de um defeito que quase passou.
 *
 * A primeira versão guardava só o `index.html` e confiava no interceptador de
 * `fetch` para pegar o resto "quando fossem pedidos". Não funciona, e o motivo
 * é uma questão de ORDEM:
 *
 *   1. a página carrega e pede `/assets/index-abc.js`;
 *   2. só DEPOIS, no evento `load`, o service worker é registrado;
 *   3. `clients.claim()` faz ele controlar a página que já está aberta — mas
 *      os pedidos daqueles arquivos já aconteceram, e nenhum passou por ele.
 *
 * Resultado: no primeiro recarregamento sem rede, o `index.html` vinha do
 * cache e o JavaScript não vinha de lugar nenhum. A tela abria em branco, com
 * o trabalho do dia intacto no IndexedDB e inalcançável — exatamente o desastre
 * que este aplicativo existe para evitar, com a aparência de estar funcionando.
 *
 * O teste de ponta a ponta que recarrega em modo avião foi o que encontrou isto.
 *
 * A saída é ler o `index.html` e extrair dele os endereços dos pedaços. Os
 * nomes têm hash e mudam a cada build; o documento é a única fonte que os
 * conhece, e ele está aqui de qualquer forma.
 */
async function pedacosDaBuild() {
  try {
    const r = await fetch('/index.html', { cache: 'no-cache' });
    if (!r.ok) return [];
    const html = await r.text();
    const achados = new Set();
    // `src="..."` dos módulos e `href="..."` das folhas de estilo. A expressão
    // é deliberadamente estreita: só o que começa com `/` e mora nesta origem.
    for (const m of html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)) {
      achados.add(m[1]);
    }
    return [...achados];
  } catch {
    // Sem rede na instalação não há o que guardar. O aplicativo continua
    // funcionando online; o que se perde é abrir sem rede — e ele tenta de
    // novo na próxima instalação.
    return [];
  }
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CASCO);
      const pedacos = await pedacosDaBuild();
      /*
       * `addAll` é tudo-ou-nada: um 404 num arquivo derruba a instalação
       * inteira e o aplicativo fica sem casco. Guardar um a um faz o pior caso
       * ser "faltou um pedaço" em vez de "não há cache nenhum".
       */
      await Promise.all(
        [...ESSENCIAL, ...pedacos].map((u) =>
          cache.add(u).catch(() => {
            /* um endereço que não responde não derruba os outros */
          })
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== CASCO).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;

  // Só GET. Um POST cacheado seria a fila lendo sucesso de um comando que nunca
  // saiu do aparelho — ver a nota do cabeçalho.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Outra origem: a API mora noutro domínio, e nada dela é guardado.
  if (url.origin !== self.location.origin) return;

  /*
   * NAVEGAÇÃO: rede primeiro, casco depois.
   *
   * Com rede, a pessoa recebe a versão nova — um aplicativo de campo que só
   * atualiza quando alguém limpa o cache é um aplicativo que fica velho no
   * bolso de quem nunca limpa. Sem rede, o casco guardado responde, e é ele que
   * faz a base local do dia ser alcançável.
   *
   * A resposta é sempre `/index.html`: as rotas são do navegador, e pedir
   * `/ordens/abc` ao servidor de arquivos daria 404.
   */
  if (req.mode === 'navigate') {
    evento.respondWith(
      fetch(req)
        .then((r) => {
          const copia = r.clone();
          void caches.open(CASCO).then((c) => c.put('/index.html', copia));
          return r;
        })
        .catch(() =>
          caches.match('/index.html').then(
            (r) =>
              r ??
              new Response('Aplicativo não instalado neste aparelho.', {
                status: 503,
                headers: { 'content-type': 'text/plain; charset=utf-8' },
              })
          )
        )
    );
    return;
  }

  /*
   * PEDAÇOS DA BUILD: cache primeiro.
   *
   * Os nomes têm hash — um arquivo com aquele nome tem aquele conteúdo, para
   * sempre. Ir à rede antes seria gastar tempo e bateria para receber
   * exatamente o que já está guardado.
   */
  /*
   * `ignoreVary` NÃO É DETALHE — é o que faz a busca no cache acertar.
   *
   * O `<script type="module" crossorigin>` gerado pela build é pedido com
   * `mode: 'cors'` e `credentials: 'omit'`; o `cache.add(url)` da instalação
   * guardou a resposta sob uma requisição padrão. Se a resposta carrega
   * `Vary`, as duas deixam de casar — e o resultado é o pior possível: o
   * arquivo ESTÁ no cache, a busca não o encontra, e a página abre em branco
   * com o dia inteiro guardado e inalcançável.
   *
   * Foi exatamente isso que aconteceu aqui. Do lado da página, `caches.match`
   * com a URL em texto encontrava; do lado do worker, com a requisição real,
   * não encontrava. O teste em modo avião mostrou a tela vazia; os dois
   * `net::ERR_FAILED` eram o JavaScript e o CSS que já estavam guardados.
   */
  evento.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (guardado) =>
        guardado ??
        fetch(req).then((r) => {
          if (r.ok && r.type === 'basic') {
            const copia = r.clone();
            void caches.open(CASCO).then((c) => c.put(req, copia));
          }
          return r;
        })
    )
  );
});
