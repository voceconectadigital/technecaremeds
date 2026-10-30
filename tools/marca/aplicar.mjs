#!/usr/bin/env node
/**
 * Aurora — carimba a marca nas superfícies que não são TypeScript.
 *
 * POR QUE UM GERADOR, E NÃO UM `import`
 *
 * O nome do produto aparece em lugares que não conseguem importar nada: o
 * `<title>` de três `index.html`, o manifesto do PWA, o `strings.xml` do Android
 * e o `Info.plist` do iOS. Cada um deles é lido por um sistema diferente — o
 * navegador, a Play Store, o Xcode — e nenhum entende JavaScript.
 *
 * Sem um gerador, "trocar o nome do produto" vira uma caçada a strings em cinco
 * aplicações e dois projetos nativos, e a chance de sobrar uma é alta. A que
 * sobrar vai aparecer justamente onde ninguém olha: a aba do navegador de um
 * cliente, ou a tela de instalação de um aplicativo.
 *
 * Com o gerador, é uma edição em `marca.config.json` seguida de `npm run marca`.
 *
 * `--check` NÃO ESCREVE, e é o que roda no gate. É o mesmo desenho do
 * `openapi:check`: o arquivo gerado é versionado, e a conferência acusa quando
 * alguém edita a superfície em vez da fonte.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const conferir = process.argv.includes('--check');

const marca = JSON.parse(readFileSync(join(RAIZ, 'marca.config.json'), 'utf8'));

const divergencias = [];
const escritos = [];

/**
 * Troca UM trecho num arquivo, e falha se o alvo não existir.
 *
 * Falhar é deliberado: um carimbo que "quase aplica" deixa a superfície com o
 * nome antigo e ninguém fica sabendo. É a mesma regra do gerador da SPEC.
 */
function carimbar(caminho, substituicoes) {
  const arquivo = join(RAIZ, caminho);
  const antes = readFileSync(arquivo, 'utf8');
  let depois = antes;

  for (const [regex, novo] of substituicoes) {
    if (!regex.test(depois)) {
      throw new Error(
        `[marca] ${caminho}: o padrão ${regex} não casou. ` +
          'A superfície mudou de forma e o carimbo precisa ser revisto — ' +
          'silenciar isto deixaria o nome antigo na tela.'
      );
    }
    depois = depois.replace(regex, novo);
  }

  if (antes === depois) return;

  if (conferir) divergencias.push(caminho);
  else {
    writeFileSync(arquivo, depois, 'utf8');
    escritos.push(caminho);
  }
}

/* ---------------------------------------------------- os três `index.html` */

/*
 * TÍTULO, FAVICON E `theme-color` SAEM DO MESMO LUGAR.
 *
 * O título já vinha daqui; o ícone e a cor da barra do navegador estavam
 * escritos à mão em cada `index.html`. Eram três valores que ninguém lembraria
 * de trocar junto com a marca — e o sintoma seria o pior tipo: o cliente abre
 * a aplicação com o nome dele no título, a aba mostra um ícone genérico, e o
 * celular pinta a barra com a cor do produto anterior.
 *
 * `identidadeVisual` é opcional de propósito: um projeto sem logo definida
 * continua funcionando, apenas sem carimbo de ícone.
 */
const visual = marca.identidadeVisual ?? null;

function alvosDeMarca(app) {
  const alvos = [[/<title>[^<]*<\/title>/, `<title>${app.titulo}</title>`]];
  if (!visual) return alvos;

  alvos.push(
    [
      /<meta name="theme-color" content="[^"]*" media="\(prefers-color-scheme: light\)" \/>/,
      `<meta name="theme-color" content="${visual.temaClaro}" media="(prefers-color-scheme: light)" />`,
    ],
    [
      /<meta name="theme-color" content="[^"]*" media="\(prefers-color-scheme: dark\)" \/>/,
      `<meta name="theme-color" content="${visual.temaEscuro}" media="(prefers-color-scheme: dark)" />`,
    ],
    [/<link rel="icon"[^>]*\/>/, `<link rel="icon" type="image/png" href="${visual.logoSimbolo}" />`]
  );
  return alvos;
}

carimbar('apps/web/index.html', alvosDeMarca(marca.aplicacoes.web));

carimbar('apps/portal/index.html', alvosDeMarca(marca.aplicacoes.portal));

carimbar('apps/field/index.html', alvosDeMarca(marca.aplicacoes.campo));

/* ------------------------------------------------------- manifesto do PWA */

{
  const caminho = 'apps/field/public/manifest.webmanifest';
  const arquivo = join(RAIZ, caminho);
  const antes = readFileSync(arquivo, 'utf8');
  const m = JSON.parse(antes);
  m.name = marca.aplicacoes.campo.nomeNaTela;
  m.short_name = marca.aplicacoes.campo.nomeCurto;
  m.description = marca.aplicacoes.campo.descricao;
  const depois = JSON.stringify(m, null, 2) + '\n';
  if (antes !== depois) {
    if (conferir) divergencias.push(caminho);
    else {
      writeFileSync(arquivo, depois, 'utf8');
      escritos.push(caminho);
    }
  }
}

/* -------------------------------------------------- Android e iOS
 *
 * O `app_name` do Android e o `CFBundleDisplayName` do iOS são o rótulo abaixo
 * do ícone, na tela inicial do aparelho. O identificador do pacote NÃO é
 * carimbado aqui de propósito: ele está em `$naoDefinitivo` na configuração
 * porque congelá-lo antes de o cliente decidir o nome é irreversível.
 */

carimbar('apps/field/android/app/src/main/res/values/strings.xml', [
  [
    /<string name="app_name">[^<]*<\/string>/,
    `<string name="app_name">${marca.aplicacoes.campo.nomeNaTela}</string>`,
  ],
  [
    /<string name="title_activity_main">[^<]*<\/string>/,
    `<string name="title_activity_main">${marca.aplicacoes.campo.nomeNaTela}</string>`,
  ],
]);

carimbar('apps/field/ios/App/App/Info.plist', [
  [
    /(<key>CFBundleDisplayName<\/key>\s*\n\s*<string>)[^<]*(<\/string>)/,
    `$1${marca.aplicacoes.campo.nomeNaTela}$2`,
  ],
]);

/* --------------------------------------------------- o módulo do TypeScript */

const moduloTela = `/**
 * Aurora — a marca, para o código que roda na tela.
 *
 * ARQUIVO GERADO por \`npm run marca\` a partir de \`marca.config.json\`.
 * Não edite à mão: a próxima geração desfaz.
 *
 * A marca visível é a do CLIENTE; "Aurora" é o nome técnico interno e não
 * aparece em tela nenhuma. Por isso tudo o que o usuário lê mora num lugar só,
 * e por isso existe uma prova que recusa o nome escrito à mão numa tela.
 *
 * As logos são CAMINHOS, e não imagens importadas: o arquivo é servido do
 * diretório público de cada aplicação, então trocar a marca é trocar dois
 * arquivos e uma linha de configuração — sem recompilar nada.
 */

export const MARCA = ${JSON.stringify(
  {
    produto: marca.produto,
    descricao: marca.descricao,
    logoHorizontal: marca.identidadeVisual?.logoHorizontal ?? null,
    logoSimbolo: marca.identidadeVisual?.logoSimbolo ?? null,
    logoHorizontalEscuro: marca.identidadeVisual?.logoHorizontalEscuro ?? null,
    logoSimboloEscuro: marca.identidadeVisual?.logoSimboloEscuro ?? null,
    web: marca.aplicacoes.web,
    portal: marca.aplicacoes.portal,
    campo: marca.aplicacoes.campo,
  },
  null,
  2
)} as const;
`;

/*
 * A marca para o SERVIDOR (29/10/2026): os PDFs e as planilhas que a API gera para o cliente
 * diziam "sistema ... Aurora", o nome técnico interno. A API não importa o app-kit (é da tela),
 * então a mesma fonte gera um módulo pequeno em `@aurora/config`.
 */
const moduloDoServidor = `/**
 * Aurora — a marca, para o código do SERVIDOR (PDFs e planilhas que vão ao cliente).
 *
 * ARQUIVO GERADO por \`npm run marca\` a partir de \`marca.config.json\`.
 * Não edite à mão: a próxima geração desfaz.
 */

export const MARCA_DO_PRODUTO = ${JSON.stringify(
  { produto: marca.produto, descricao: marca.descricao },
  null,
  2
)} as const;
`;

for (const [caminho, modulo] of [
  ['packages/app-kit/src/marca.gerada.ts', moduloTela],
  ['packages/config/src/marca.gerada.ts', moduloDoServidor],
]) {
  const arquivo = join(RAIZ, caminho);
  let antes = '';
  try {
    antes = readFileSync(arquivo, 'utf8');
  } catch {
    /* primeira geração */
  }
  if (antes !== modulo) {
    if (conferir) divergencias.push(caminho);
    else {
      writeFileSync(arquivo, modulo, 'utf8');
      escritos.push(caminho);
    }
  }
}

/* ------------------------------------------------------------------ saída */

if (conferir) {
  if (divergencias.length > 0) {
    console.error('✗ a marca nas superfícies não corresponde a marca.config.json:');
    divergencias.forEach((d) => console.error('  · ' + d));
    console.error('\n  Rode `npm run marca`. Se a intenção era mudar o nome, mude-o na');
    console.error('  configuração — editar a superfície deixa as outras para trás.');
    process.exit(1);
  }
  console.log(`✓ marca em dia — produto: ${marca.produto} (${marca.$naoDefinitivo.situacao})`);
} else {
  console.log(`marca aplicada — produto: ${marca.produto}`);
  escritos.forEach((e) => console.log('  ✓ ' + e));
  if (escritos.length === 0) console.log('  (nada a mudar)');
}
