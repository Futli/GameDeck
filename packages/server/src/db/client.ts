import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema.js';

/** Общий тип базы: запросы одинаковы для настоящего Postgres и для PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  close(): Promise<void>;
}

// src/db/client.ts и dist/db/client.js лежат на одной глубине, поэтому путь подходит обоим.
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Открыть базу и применить миграции.
 * - `postgres://...` — настоящий PostgreSQL (продакшен, docker compose).
 * - `memory://` — PGlite в памяти (тесты).
 * - любой другой путь — PGlite с файлами в этой папке (запуск без установки Postgres).
 */
export async function openDatabase(url: string): Promise<Database> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return { db: db as unknown as Db, close: () => pool.end() };
  }

  if (!url.includes('://')) mkdirSync(url, { recursive: true });
  const client = new PGlite(url);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close() };
}
