import tseslint from 'typescript-eslint';

const sourceFiles = [
  'backend/**/*.{ts,tsx}',
  'frontend/**/*.{ts,tsx}',
  'packages/**/*.{ts,tsx}',
  'scripts/**/*.{js,mjs,cjs}',
  'test/**/*.{ts,tsx,js,mjs,cjs}',
  '*.{js,mjs,cjs}',
];

const restrictedLayers = (...layers) => ['error', {
  patterns: [{
    regex: `^(?:@enterpriseglue/shared/|(?:\\.\\./)+)(?:${layers.join('|')})(?:/|$)`,
    message: 'This import crosses the shared package Clean Architecture boundary.',
  }],
}];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.artifacts/**',
      'artifacts/**',
      'test/results/**',
    ],
  },
  {
    files: sourceFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'no-debugger': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    files: ['packages/shared/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedLayers('application', 'infrastructure', 'interfaces'),
    },
  },
  {
    files: ['packages/shared/src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedLayers('infrastructure', 'interfaces'),
    },
  },
  {
    files: ['packages/shared/src/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedLayers('interfaces'),
    },
  },
);
