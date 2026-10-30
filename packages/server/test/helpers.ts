import { afterAll } from 'vitest';
import { openDatabase, type Database } from '../src/db/client.js';

/**
 * Одна PGlite-база в памяти на тестовый файл: старт PGlite занимает несколько секунд,
 * поэтому не пересоздаём её на каждый тест. Тесты не мешают друг другу,
 * потому что каждый работает со своими, только что созданными игроками.
 */
let shared: Promise<Database> | undefined;

export function testDatabase(): Promise<Database> {
  if (!shared) {
    shared = openDatabase('memory://');
    afterAll(async () => (await shared!).close());
  }
  return shared;
}
