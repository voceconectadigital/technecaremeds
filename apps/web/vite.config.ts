import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

const raiz = resolve(__dirname, '..', '..');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Os pacotes do monorepo são consumidos pela FONTE, não pelo `dist`: o
    // ciclo de "compilar o pacote para ver a mudança na tela" mata o
    // desenvolvimento, e o bundler compila tudo junto de qualquer forma.
    alias: {
      '@aurora/contracts': resolve(raiz, 'packages/contracts/src'),
      '@aurora/ui': resolve(raiz, 'packages/ui/src'),
      '@aurora/domain': resolve(raiz, 'packages/domain/src'),
    },
  },
  server: { port: 5173 },
});
