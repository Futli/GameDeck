import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Тесты импортируют @gamedeck/shared прямо из исходников, без сборки.
    conditions: ['source'],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
