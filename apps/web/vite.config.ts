import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cabecalhosDoPages } from '../../tools/lib/cabecalhos-pages.mjs';

// `import.meta` e não `__dirname`: o carregador nativo do Vite 8 é ESM, e vai
// virar o padrão.
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const aqui = dirname(fileURLToPath(import.meta.url));

/**
 * A DEMONSTRAÇÃO E A API NÃO CONVIVEM NO MESMO BUILD.
 *
 * `VITE_DEMO_MODE=true` troca a fonte de dados inteira pelas respostas
 * gravadas (src/dados/provedor.tsx). Se o mesmo build também receber
 * `VITE_API_URL`, alguém está montando um ambiente conectado e ligou a
 * demonstração por engano — ou o contrário. Nos dois casos a resposta certa é
 * parar o build, e não escolher um dos dois em silêncio.
 */
function ambienteDaDemonstracao(demo: boolean): Plugin {
  return {
    name: 'technecare-demonstracao',
    enforce: 'pre',
    /*
     * No build CONECTADO, o provedor da demonstração vira um módulo vazio.
     * O ramo que o importa já é morto (`__MODO_DEMO__` é `false`), mas o
     * empacotador ainda emitia o pedaço como arquivo solto — 330 kB de
     * respostas gravadas publicados junto do produto, sem que nada os
     * carregasse. Assim eles não existem no pacote, e não só deixam de ser
     * usados.
     */
    resolveId: (fonte) => (!demo && fonte === '../demo/provedor' ? '\0demonstracao-desligada' : null),
    load: (id) =>
      id === '\0demonstracao-desligada'
        ? 'export default function DemonstracaoDesligada() { throw new Error("demonstração fora deste build"); }'
        : null,
    // O título da aba já diz o que é antes de o React montar.
    transformIndexHtml: (html) =>
      demo ? html.replace(/<title>(.*?)<\/title>/, '<title>$1 — Demonstração</title>') : html,
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, aqui, 'VITE_'), ...process.env };
  const demo = env.VITE_DEMO_MODE === 'true';
  if (demo && env.VITE_API_URL) {
    throw new Error(
      'VITE_DEMO_MODE=true e VITE_API_URL definidos no mesmo build. A demonstração não fala com API ' +
        'nenhuma — remova um dos dois.'
    );
  }

  return {
    /*
     * A raiz é a pasta da aplicação, e não o diretório de onde o comando foi
     * chamado. Sem isto, rodar o Vite da raiz do repositório (como o Playwright
     * faz) procura o `index.html` no lugar errado e o servidor sobe servindo
     * nada.
     */
    root: aqui,
    /*
     * `__MODO_DEMO__` vira `true` ou `false` LITERAL no código. Comparar
     * `import.meta.env.VITE_DEMO_MODE` direto não basta: o empacotador não
     * consegue provar o resultado, e o build conectado emitia o pedaço da
     * demonstração inteiro — 330 kB de respostas gravadas que ninguém usaria.
     * Com o literal, o ramo morto some, e o `import()` junto.
     */
    define: { __MODO_DEMO__: JSON.stringify(demo) },
    plugins: [
      react(),
      tailwindcss(),
      ambienteDaDemonstracao(demo),
      cabecalhosDoPages({ apiUrl: env.VITE_API_URL }),
    ],
    resolve: {
      // Os pacotes do monorepo são consumidos pela FONTE, não pelo `dist`: o
      // ciclo de "compilar o pacote para ver a mudança na tela" mata o
      // desenvolvimento, e o bundler compila tudo junto de qualquer forma.
      alias: {
        '@aurora/contracts': resolve(raiz, 'packages/contracts/src'),
        '@aurora/ui': resolve(raiz, 'packages/ui/src'),
        '@aurora/app-kit': resolve(raiz, 'packages/app-kit/src'),
        '@aurora/domain': resolve(raiz, 'packages/domain/src'),
      },
    },
    server: { port: 5173 },
  };
});
