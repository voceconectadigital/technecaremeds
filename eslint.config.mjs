// Aurora — lint. A regra que mais importa aqui é a última.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'docs/**', 'tools/**', '**/*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
          selector: "MemberExpression[property.name='query'][object.name='db']",
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
      '**/__tests__/**',
    ],
    rules: { 'no-restricted-syntax': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  }
);
