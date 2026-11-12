// ESLint (flat config) для всего монорепо: `pnpm lint`, автоисправление — `pnpm lint:fix`.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/drizzle/**', 'data/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Неиспользуемое — ошибка, но `_name` можно оставить намеренно.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // verbatimModuleSyntax: типы импортируем через `import type`.
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: [
      'packages/server/**/*.ts',
      'packages/shared/**/*.ts',
      '*.ts',
      '*.js',
      '.claude/**/*.cjs',
      '.github/**/*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/client/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
