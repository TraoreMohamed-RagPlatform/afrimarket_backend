const js = require('@eslint/js');
const globals = require('globals');
const nodePlugin = require('eslint-plugin-n');

module.exports = [
  {
    ignores: ['node_modules/', 'coverage/', 'uploads/', 'prisma/migrations/'],
  },
  js.configs.recommended,
  nodePlugin.configs['flat/recommended-script'],
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // Un paramètre ou une variable volontairement inutilisé commence par « _ ».
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'require-await': 'error',
      eqeqeq: ['error', 'always'],
      // Interdit d'utiliser une variable avant sa déclaration (plantage au démarrage).
      'no-use-before-define': ['error', { functions: false }],
      'no-var': 'error',
      'prefer-const': 'error',
      // process.exit est réservé au démarrage (configuration invalide).
      'n/no-process-exit': 'off',
    },
  },
  {
    // Tests et configuration : ils utilisent les devDependencies, ce qui est normal.
    files: ['**/__tests__/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.jest } },
    rules: { 'n/no-unpublished-require': 'off' },
  },
];
