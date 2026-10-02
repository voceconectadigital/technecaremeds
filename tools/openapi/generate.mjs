#!/usr/bin/env node
/**
 * Aurora — OpenAPI gerado a partir dos controllers de verdade.
 *
 * COMO ISTO FUNCIONA, E POR QUE ASSIM
 *
 * O caminho, o método e as permissões vêm dos metadados que o NestJS grava nos
 * decoradores — a MESMA coisa que o roteador usa em produção. Não há uma
 * segunda lista de rotas escrita à mão para o documento sair bonito: se alguém
 * mudar `@Post('quotes')` e não mudar mais nada, o documento muda junto.
 *
 * Os esquemas de entrada e saída vêm de `@aurora/contracts`, que é a fonte
 * compartilhada com o frontend. Rota sem contrato aparece no documento com o
 * corpo não descrito E é contada como pendência no relatório — porque uma
 * cobertura declarada e não medida é pior do que nenhuma.
 *
 * Uso: node tools/openapi/generate.mjs [--check]
 *   --check  não escreve; falha se o arquivo em disco estiver desatualizado
 */
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// O tsconfig da raiz é arquivo de SOLUÇÃO: não tem compilerOptions, e sem
// `experimentalDecorators` o esbuild recusa os decoradores do NestJS. Apontar
// para o tsconfig base é o que faz este script ler os controllers de verdade.
process.env.TSX_TSCONFIG_PATH ??= join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'tsconfig.base.json'
);
require('tsx/cjs');
require('reflect-metadata');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAIDA = join(RAIZ, 'docs', 'openapi.json');
const conferir = process.argv.includes('--check');

/* -------------------------------------------------------------------------- */
/* 1. As rotas, lidas dos controllers                                          */
/* -------------------------------------------------------------------------- */

const CONTROLLERS_DIR = join(RAIZ, 'apps', 'api', 'src');

function arquivosDeController(dir) {
  const achados = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === '__tests__' || entrada.name === 'node_modules') continue;
      achados.push(...arquivosDeController(caminho));
    } else if (entrada.name.endsWith('.controller.ts')) {
      achados.push(caminho);
    }
  }
  return achados.sort();
}

/** Nomes dos metadados do NestJS. São constantes públicas do framework. */
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const METODOS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH'];
const PERMISSIONS_KEY = 'aurora:permissions';
const DYNAMIC_PERMISSIONS_KEY = 'aurora:permissions-dynamic';

function juntar(prefixo, sufixo) {
  const partes = [...String(prefixo).split('/'), ...String(sufixo).split('/')].filter((p) => p && p !== '/');
  return '/' + partes.join('/');
}

function lerRotas() {
  const rotas = [];
  for (const arquivo of arquivosDeController(CONTROLLERS_DIR)) {
    const mod = require(arquivo);
    for (const exportado of Object.values(mod)) {
      if (typeof exportado !== 'function') continue;
      const base = Reflect.getMetadata(PATH_METADATA, exportado);
      if (base === undefined) continue;

      const proto = exportado.prototype;
      for (const nome of Object.getOwnPropertyNames(proto)) {
        if (nome === 'constructor') continue;
        const handler = proto[nome];
        if (typeof handler !== 'function') continue;
        const caminho = Reflect.getMetadata(PATH_METADATA, handler);
        if (caminho === undefined) continue;

        const metodo = METODOS[Reflect.getMetadata(METHOD_METADATA, handler)] ?? 'GET';
        const permissoes = Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? [];
        const dinamica = Reflect.getMetadata(DYNAMIC_PERMISSIONS_KEY, handler);

        rotas.push({
          // A ordem em que o NestJS registra: é ela que decide quem responde
          // quando dois caminhos casam.
          ordem: rotas.length,
          controller: exportado.name,
          handler: nome,
          method: metodo,
          path: juntar(base, caminho),
          permissions: permissoes,
          dynamicPermissions: dinamica,
          arquivo: arquivo.slice(RAIZ.length + 1).replace(/\\/g, '/'),
        });
      }
    }
  }
  return rotas.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
}

/* -------------------------------------------------------------------------- */
/* 2. Os contratos                                                             */
/* -------------------------------------------------------------------------- */

const contratos = require(join(RAIZ, 'packages', 'contracts', 'src', 'index.ts'));
const { allOperations, operationForRoute, normalizePath, toJsonSchema } = contratos;

/* -------------------------------------------------------------------------- */
/* 3. O documento                                                              */
/* -------------------------------------------------------------------------- */

/**
 * O prefixo `/v1` é aplicado pelo bootstrap, com uma exceção declarada lá: a
 * rota do QR fica fora, porque o endereço vai impresso numa etiqueta física.
 * Repetir a regra aqui manteria as duas em sincronia só por sorte.
 */
const FORA_DO_PREFIXO = ['/q/:token'];

function comPrefixo(path) {
  return FORA_DO_PREFIXO.includes(path) ? path : '/v1' + path;
}

/** `/customers/:id` -> `/customers/{id}`, que é como o OpenAPI escreve. */
function chaves(path) {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function parametrosDeCaminho(path, esquemaParams) {
  const nomes = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const props = esquemaParams ? (toJsonSchema(esquemaParams).properties ?? {}) : {};
  return nomes.map((nome) => ({
    name: nome,
    in: 'path',
    required: true,
    schema: props[nome] ?? { type: 'string' },
  }));
}

function parametrosDeConsulta(esquemaQuery) {
  if (!esquemaQuery) return [];
  const js = toJsonSchema(esquemaQuery);
  const obrigatorios = new Set(js.required ?? []);
  return Object.entries(js.properties ?? {}).map(([nome, esquema]) => ({
    name: nome,
    in: 'query',
    required: obrigatorios.has(nome),
    schema: esquema,
  }));
}

const RESPOSTAS_DE_ERRO = {
  unauthenticated: [401, 'Sem credencial, ou credencial que não resolve um vínculo ativo'],
  forbidden: [403, 'Falta permissão; a resposta nomeia qual'],
  not_found: [404, 'Não existe, ou está fora do alcance de quem perguntou'],
  conflict: [409, 'O estado atual não permite a operação'],
  validation_failed: [422, 'Entrada inválida; `details.field` aponta o campo'],
  rate_limited: [429, 'Excedeu o limite de chamadas'],
  internal_error: [500, 'Falha não prevista; `request_id` localiza a linha do log'],
};

function respostas(op) {
  const problema = { $ref: '#/components/schemas/ProblemDetails' };
  const erro = (descricao) => ({
    description: descricao,
    content: { 'application/problem+json': { schema: problema } },
  });

  const r = {
    [String(op?.status ?? (op?.method === 'POST' ? 201 : 200))]: {
      description: 'Sucesso',
      content: op?.produces
        ? { [op.produces]: { schema: { type: 'string', format: 'binary' } } }
        : op
          ? { 'application/json': { schema: toJsonSchema(op.response) } }
          : { 'application/json': { schema: {} } },
    },
  };

  // Universais: toda rota autenticada pode responder isto.
  if (!op?.public) {
    r['401'] = erro(RESPOSTAS_DE_ERRO.unauthenticated[1]);
    r['403'] = erro(RESPOSTAS_DE_ERRO.forbidden[1]);
  }
  r['422'] = erro(RESPOSTAS_DE_ERRO.validation_failed[1]);
  r['500'] = erro(RESPOSTAS_DE_ERRO.internal_error[1]);

  for (const codigo of op?.errors ?? []) {
    const [status, descricao] = RESPOSTAS_DE_ERRO[codigo] ?? [];
    if (status) r[String(status)] = erro(descricao);
  }
  return r;
}

function gerar() {
  const rotas = lerRotas();
  const paths = {};
  const semContrato = [];
  const contratosOrfaos = [];
  const divergencias = [];

  for (const rota of rotas) {
    const op = operationForRoute(rota.method, rota.path);
    if (!op) semContrato.push(rota);

    if (op && op.permissions) {
      const declarado = [...op.permissions].sort().join(',');
      const real = [...rota.permissions].sort().join(',');
      if (declarado !== real) {
        divergencias.push(
          `${op.operationId}: contrato exige [${declarado || '—'}], o guard exige [${real || '—'}]`
        );
      }
    }

    const url = chaves(comPrefixo(rota.path));
    paths[url] ??= {};
    paths[url][rota.method.toLowerCase()] = {
      operationId: op?.operationId ?? `${rota.controller}.${rota.handler}`,
      summary: op?.summary ?? `(sem contrato) ${rota.controller}.${rota.handler}`,
      ...(op?.description ? { description: op.description } : {}),
      tags: [rota.controller.replace(/Controller$/, '')],
      ...(rota.permissions.length
        ? { 'x-aurora-permissions': rota.permissions }
        : { 'x-aurora-public': true }),
      'x-aurora-source': rota.arquivo,
      ...(rota.dynamicPermissions ? { 'x-aurora-permission-note': rota.dynamicPermissions } : {}),
      ...(op ? {} : { 'x-aurora-contract': 'ausente' }),
      parameters: [...parametrosDeCaminho(rota.path, op?.params), ...parametrosDeConsulta(op?.query)],
      ...(op?.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: toJsonSchema(op.body) } },
            },
          }
        : {}),
      responses: respostas(op),
      ...(rota.permissions.length ? { security: [{ bearer: [] }] } : { security: [] }),
    };
  }

  /*
   * ROTA LITERAL ENGOLIDA POR ROTA COM PARÂMETRO.
   *
   * Até o Express 4, os parâmetros de identificador traziam a forma embutida
   * — `:id([0-9a-fA-F-]{36})` — e "price" simplesmente não casava com um
   * uuid. O Express 5 usa path-to-regexp 8, que REMOVEU regex embutida (era
   * vetor de ReDoS), e a desambiguação passou a depender da ORDEM DE
   * DECLARAÇÃO.
   *
   * Ordem de declaração é uma garantia que ninguém enxerga lendo um arquivo:
   * mover um método trinta linhas para baixo, num refactor inocente, torna uma
   * rota inalcançável — e o sintoma é um 404 ou, pior, o handler ERRADO
   * respondendo. Foi o que aconteceu com `/quotes/price` e
   * `/documents/by-asset` na migração.
   *
   * Por isso a garantia virou esta conferência: toda rota literal precisa ser
   * declarada ANTES de qualquer rota com parâmetro que a cobriria.
   */
  const sombreadas = [];
  const porMetodo = new Map();
  for (const rota of rotas) {
    const lista = porMetodo.get(rota.method) ?? [];
    lista.push(rota);
    porMetodo.set(rota.method, lista);
  }

  for (const [metodo, lista] of porMetodo) {
    // `rotas` está ordenada por caminho; a ordem que importa é a de
    // DECLARAÇÃO, que é a de registro no roteador.
    const naOrdem = lista.slice().sort((x, y) => x.ordem - y.ordem);

    for (let i = 0; i < naOrdem.length; i++) {
      const anterior = naOrdem[i];
      const segsA = anterior.path.split('/').filter(Boolean);
      if (!segsA.some((s) => s.startsWith(':'))) continue;

      for (let j = i + 1; j < naOrdem.length; j++) {
        const depois = naOrdem[j];
        const segsD = depois.path.split('/').filter(Boolean);
        if (segsA.length !== segsD.length) continue;

        // A anterior cobre a posterior quando cada segmento ou é idêntico ou
        // é um parâmetro que aceita qualquer coisa.
        const cobre = segsA.every((sa, k) => sa.startsWith(':') || sa === segsD[k]);
        // Só é problema se a posterior for MAIS específica (tem literal onde a
        // anterior tem parâmetro) — senão são a mesma rota, e isso é outro erro.
        const maisEspecifica = segsA.some((sa, k) => sa.startsWith(':') && !segsD[k].startsWith(':'));

        if (cobre && maisEspecifica) {
          sombreadas.push(
            `${metodo} ${depois.path} (${depois.controller}.${depois.handler}) nunca é alcançada: ` +
              `${metodo} ${anterior.path} (${anterior.controller}.${anterior.handler}) é declarada antes e a cobre`
          );
        }
      }
    }
  }

  /*
   * ESCRITA GUARDADA POR PERMISSÃO DE LEITURA.
   *
   * Uma rota que altera dado e exige apenas `algo.read` entrega a escrita a
   * todo papel de leitura — incluindo o Auditor, que a SPEC §21 descreve como
   * "somente leitura em tudo. Nenhuma escrita". É um erro fácil de cometer
   * (copiar o decorador da rota de leitura ao lado) e impossível de ver lendo
   * um arquivo por vez.
   *
   * Há um caso legítimo: a rota de transição, onde a permissão real é a da
   * ARESTA do grafo e é verificada no domínio. Esse caso precisa ser DECLARADO
   * no contrato — exceção declarada é exceção revisada.
   */
  const escritaComLeitura = [];
  for (const rota of rotas) {
    if (rota.method === 'GET') continue;
    if (rota.permissions.length === 0) continue;
    if (!rota.permissions.every((k) => k.includes('.read'))) continue;
    if (rota.dynamicPermissions) continue;
    escritaComLeitura.push(
      `${rota.method} ${rota.path} exige apenas [${rota.permissions.join(', ')}]  (${rota.controller}.${rota.handler})`
    );
  }

  for (const op of allOperations()) {
    const existe = rotas.some(
      (r) => r.method === op.method && normalizePath(r.path) === normalizePath(op.path)
    );
    if (!existe) contratosOrfaos.push(`${op.operationId} (${op.method} ${op.path})`);
  }

  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'Aurora CMMS',
      version: '0.2.0',
      description:
        'Gerado a partir dos controllers e de `@aurora/contracts`. Não edite à mão: ' +
        'rode `npm run openapi`. Erros seguem o RFC 9457 com `code`, `message` e `request_id`.',
    },
    servers: [{ url: '{host}', variables: { host: { default: 'http://localhost:3000' } } }],
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description:
            'A credencial identifica a PESSOA. A organização vem do vínculo — nunca de ' +
            'um campo enviado pelo cliente. Com vínculo em mais de uma organização, o ' +
            'cabeçalho `x-aurora-organization` escolhe entre as que a pessoa já tem.',
        },
      },
      schemas: { ProblemDetails: toJsonSchema(contratos.ProblemDetails) },
    },
    security: [{ bearer: [] }],
    paths,
  };

  return { doc, rotas, semContrato, contratosOrfaos, divergencias, escritaComLeitura, sombreadas };
}

/* -------------------------------------------------------------------------- */

const { doc, rotas, semContrato, contratosOrfaos, divergencias, escritaComLeitura, sombreadas } = gerar();
const texto = JSON.stringify(doc, null, 2) + '\n';

const comContrato = rotas.length - semContrato.length;
console.log(`rotas nos controllers: ${rotas.length}`);
console.log(
  `com contrato: ${comContrato} (${Math.round((comContrato / rotas.length) * 100)}%) — sem contrato: ${semContrato.length}`
);

if (divergencias.length) {
  console.log('\n✗ contrato e guard discordam:');
  divergencias.forEach((d) => console.log('  · ' + d));
}
if (sombreadas.length) {
  console.log('\n✗ rota literal inalcançável (ordem de declaração):');
  sombreadas.forEach((x) => console.log('  · ' + x));
}
if (escritaComLeitura.length) {
  console.log('\n✗ escrita guardada por permissão de leitura:');
  escritaComLeitura.forEach((e) => console.log('  · ' + e));
}
if (contratosOrfaos.length) {
  console.log('\n✗ contrato sem rota correspondente:');
  contratosOrfaos.forEach((c) => console.log('  · ' + c));
}

const quebrado =
  divergencias.length > 0 ||
  contratosOrfaos.length > 0 ||
  escritaComLeitura.length > 0 ||
  sombreadas.length > 0;

if (conferir) {
  const atual = existsSync(SAIDA) ? readFileSync(SAIDA, 'utf8') : '';
  if (atual !== texto) {
    console.log('\n✗ docs/openapi.json está desatualizado — rode `npm run openapi`');
    process.exit(1);
  }
  console.log('\n✓ docs/openapi.json em dia');
  process.exit(quebrado ? 1 : 0);
}

mkdirSync(dirname(SAIDA), { recursive: true });
writeFileSync(SAIDA, texto);
console.log(`\n✓ ${SAIDA.slice(RAIZ.length + 1)} escrito`);
process.exit(quebrado ? 1 : 0);
