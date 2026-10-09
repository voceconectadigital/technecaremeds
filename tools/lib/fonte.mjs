/**
 * Aurora — de onde as ferramentas de linha de comando carregam o código.
 *
 * Na máquina de quem escreve o código e na CI, os pacotes são TypeScript e o
 * `tsx` traduz na hora. Na IMAGEM DE PRODUÇÃO (Dockerfile) não há `tsx` — nem
 * deve haver: o que roda lá é o JavaScript que o `tsc -b` emitiu em `dist/`.
 *
 * `AURORA_COMPILADO=1` (definido só no Dockerfile) troca `src/*.ts` por
 * `dist/*.js`. É a ÚNICA diferença: o mesmo comando, as mesmas conferências de
 * destino, o mesmo migrador.
 */
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';

export const COMPILADO = process.env.AURORA_COMPILADO === '1';

/**
 * Carrega um módulo-fonte do monorepo pelo caminho TypeScript.
 * @param {string} raiz  raiz do repositório
 * @param {...string} segmentos  ex.: 'packages', 'db', 'src', 'index.ts'
 */
export function carregarFonte(raiz, ...segmentos) {
  const require = createRequire(join(raiz, 'package.json'));
  if (!COMPILADO) {
    require('tsx/cjs');
    return require(join(raiz, ...segmentos));
  }
  const i = segmentos.lastIndexOf('src');
  if (i < 0) throw new Error(`fonte sem src/: ${segmentos.join(sep)}`);
  const compilado = [...segmentos.slice(0, i), 'dist', ...segmentos.slice(i + 1)];
  compilado[compilado.length - 1] = compilado[compilado.length - 1].replace(/\.ts$/, '.js');
  return require(join(raiz, ...compilado));
}
