// Aurora — a build do APLICATIVO DE CAMPO.
//
// Aplicação própria, e não uma rota da web ou do portal. As três atendem
// pessoas diferentes em situações diferentes, e esta é a única que precisa
// funcionar com o aparelho no modo avião.
//
// A separação também é o que torna o CACHE possível de raciocinar: o
// `service worker` guarda o casco DESTA aplicação, e o casco desta aplicação
// não arrasta as dezesseis telas da aplicação interna junto.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cabecalhosDoPages } from '../../tools/lib/cabecalhos-pages.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  plugins: [
    react(),
    tailwindcss(),
    // O mesmo padrão de `campo.tsx` quando `VITE_API_URL` não vem no build.
    cabecalhosDoPages({ apiUrl: process.env.VITE_API_URL ?? 'http://localhost:3001/v1' }),
  ],
  resolve: {
    alias: {
      '@aurora/contracts': resolve(raiz, 'packages/contracts/src'),
      '@aurora/ui': resolve(raiz, 'packages/ui/src'),
      '@aurora/app-kit': resolve(raiz, 'packages/app-kit/src'),
      '@aurora/domain': resolve(raiz, 'packages/domain/src'),
    },
  },
  server: { port: 5175 },
});
