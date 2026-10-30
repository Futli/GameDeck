import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Тесты импортируют @gamedeck/shared прямо из исходников, без сборки.
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // PGlite (Postgres в WebAssembly) стартует несколько секунд.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
