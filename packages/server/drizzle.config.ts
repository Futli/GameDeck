import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` сравнивает schema.ts с прошлыми миграциями и пишет новый SQL в drizzle/.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
