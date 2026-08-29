#!/usr/bin/env node
/**
 * Aurora — sobe a API para os testes de ponta a ponta.
 *
 * Existe porque o `tsconfig.json` da raiz é arquivo de SOLUÇÃO: não tem
 * `compilerOptions`, e sem `experimentalDecorators` o esbuild recusa os
 * decoradores do NestJS. Apontar o `tsconfig` base antes de carregar o `tsx` é
 * o que faz a API subir pela fonte, sem passo de compilação.
 */
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.TSX_TSCONFIG_PATH ??= join(raiz, 'tsconfig.base.json');

const require = createRequire(import.meta.url);
require('tsx/cjs');
require(join(raiz, 'apps', 'api', 'src', 'main.ts'));
