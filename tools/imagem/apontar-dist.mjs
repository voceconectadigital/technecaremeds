#!/usr/bin/env node
/**
 * Aurora — usado SÓ dentro do Dockerfile, depois do `tsc -b`.
 *
 * No repositório os pacotes do monorepo apontam `main` para `src/index.ts`
 * (desenvolvimento, testes e tsx leem TypeScript direto). A imagem de produção
 * roda `node` puro: cada `@aurora/*` passa a apontar para o JavaScript que o
 * `tsc -b` emitiu em `dist/`. Recusa se algum `dist/index.js` não existir —
 * imagem que sobe e quebra no primeiro `require` é pior que build que falha.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = process.cwd();
const faltando = [];
for (const base of ['packages', 'apps']) {
  for (const nome of readdirSync(join(raiz, base))) {
    const arquivo = join(raiz, base, nome, 'package.json');
    if (!existsSync(arquivo)) continue;
    const pkg = JSON.parse(readFileSync(arquivo, 'utf8'));
    if (typeof pkg.main !== 'string' || !pkg.main.startsWith('src/') || !pkg.main.endsWith('.ts')) continue;
    const dist = pkg.main.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js');
    if (!existsSync(join(raiz, base, nome, dist))) {
      // Só os pacotes que a API e os workers usam são compilados; os do navegador ficam como estão.
      if (base === 'packages' && ['ui', 'app-kit'].includes(nome)) continue;
      if (base === 'apps') continue;
      faltando.push(`${base}/${nome}/${dist}`);
      continue;
    }
    pkg.main = dist;
    if (typeof pkg.types === 'string') pkg.types = dist.replace(/\.js$/, '.d.ts');
    writeFileSync(arquivo, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`${pkg.name} → ${dist}`);
  }
}
if (faltando.length > 0) {
  console.error(`\n✗ pacotes sem JavaScript emitido:\n  ${faltando.join('\n  ')}\n`);
  process.exit(1);
}
