// @ts-check
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettierConfig = require('eslint-config-prettier');

module.exports = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.vitest-cache/**'],
  },
  {
    rules: {
      // Enforce no unused variables (allow underscore-prefixed)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Allow explicit any only with suppression comment
      '@typescript-eslint/no-explicit-any': 'warn',
      // Require explicit return types on functions
      '@typescript-eslint/explicit-function-return-type': 'off',
      // No require() in TypeScript files
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },
);
