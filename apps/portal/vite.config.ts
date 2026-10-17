// Aurora — a build do PORTAL DO CLIENTE.
//
// Aplicação própria, e não uma rota da web: a SPEC §19 pede navegação,
// vocabulário e densidade próprios, e a superfície de escrita mínima só é
// auditável se o código do portal não puder alcançar o resto por acidente.
//
// A porta é outra porque os dois sobem juntos em desenvolvimento — e porque
// em produção são dois domínios diferentes, com dois conjuntos de cabeçalhos.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cabecalhosDoPages } from '../../tools/lib/cabecalhos-pages.mjs';

// `import.meta` e não `__dirname`: o carregador nativo do Vite 8 é ESM, e vai
// virar o padrão.
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export default defineConfig({
  /*
   * A raiz é a pasta da aplicação, e não o diretório de onde o comando foi
   * chamado. Sem isto, rodar o Vite da raiz do repositório (como o Playwright
   * faz) procura o `index.html` no lugar errado e o servidor sobe servindo
   * nada.
   */
  root: dirname(fileURLToPath(import.meta.url)),
  plugins: [react(), tailwindcss(), cabecalhosDoPages({ apiUrl: process.env.VITE_API_URL })],
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
  server: { port: 5174 },
});
