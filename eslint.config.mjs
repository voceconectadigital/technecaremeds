// Aurora — lint. A regra que mais importa aqui é a última.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `tools/**` e `e2e/fixtures/*.mjs` são scripts de linha de comando: usam
    // `process` e `console` por definição, e não fazem parte do que roda em
    // produção. Os TESTES de e2e (`.spec.ts`) continuam sob as mesmas regras
    // do resto, porque eles são código que a equipe lê e mantém.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'docs/**',
      'tools/**',
      'e2e/fixtures/*.mjs',
      '**/*.config.*',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    /*
     * O SERVICE WORKER NÃO RODA NUMA PÁGINA — roda num worker, com outro
     * conjunto de globais.
     *
     * `self`, `caches`, `clients` e `skipWaiting` não existem em `window`, e
     * `window` não existe aqui. Sem esta declaração, o lint acusa dezessete
     * variáveis inexistentes num arquivo perfeitamente correto — e a saída
     * óbvia seria ignorá-lo, o que tiraria da revisão justamente o arquivo que
     * decide se o aplicativo ABRE sem rede.
     */
    files: ['apps/*/public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: false } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // --- guarda de isolamento multitenant (SPEC v0.2 §37) --------------------
      // unsafeCrossTenant existe para migrations, publicador do outbox e rotinas
      // de plataforma. Em código de domínio ou de aplicação é sempre defeito.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='unsafeCrossTenant']",
          message:
            'unsafeCrossTenant ignora o escopo de tenant. Use withTenant. Se for realmente uma rotina de plataforma, mova para packages/db/src/platform ou apps/workers e adicione a exceção explicitamente neste arquivo.',
        },
        {
          selector:
            "MemberExpression[property.name='query'][object.name='db'], MemberExpression[property.name='query'][object.property.name='db']",
          message:
            'Acesso direto a db.query em tabela de negócio ignora o contexto de tenant. Use withTenant(db, ctx, ...).',
        },
      ],
    },
  },
  {
    // exceções conscientes: infraestrutura de acesso a dados e testes
    files: [
      'packages/db/src/client.ts',
      'packages/db/src/adapters.ts',
      'packages/db/src/migrator.ts',
      // guards.ts só consulta catálogo do sistema (pg_roles), nunca tabela de negócio
      'packages/db/src/guards.ts',
      'packages/db/src/testing/**',
      // Rotina de plataforma: semear cria mais de uma organização por definição.
      // Exige o banco administrativo e recusa rodar sob o papel de aplicação.
      'packages/db/src/seeds/**',
      // Rotina de plataforma: a dispersão do trabalho periódico precisa saber
      // QUAIS organizações varrer, e essa pergunta não tem contexto de tenant
      // por definição. Roda sob `aurora_scheduler` (migration 0041), que lê o
      // identificador das organizações ativas e mais nada — o trabalho em si
      // continua sob `withTenant` e sob a RLS.
      'apps/workers/src/jobs/**',
      '**/__tests__/**',
    ],
    rules: { 'no-restricted-syntax': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  }
);
