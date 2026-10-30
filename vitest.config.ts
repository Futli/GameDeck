import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Тесты импортируют @gamedeck/shared прямо из исходников, без сборки.
  resolve: { conditions: ['source'] },
  // Vite 6+ резолвит серверный (ssr) код отдельно от клиентского, поэтому
  // 'source' добавляем к стандартным серверным условиям Vite.
  ssr: { resolve: { conditions: ['source', 'module', 'node', 'development|production'] } },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // PGlite (Postgres в WebAssembly) стартует несколько секунд.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
