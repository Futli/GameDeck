/** Все настройки — из переменных окружения, с безопасными значениями по умолчанию. */
export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
  /** Сколько ждать отключившегося игрока, прежде чем убрать его из комнаты. */
  disconnectGraceMs: Number(process.env.DISCONNECT_GRACE_MS ?? 60_000),
  /**
   * postgres://user:pass@host:5432/db — настоящий PostgreSQL.
   * Любой другой путь — встроенный PGlite с файлами в этой папке (ничего не нужно ставить).
   */
  databaseUrl: process.env.DATABASE_URL ?? './data/pglite',
  /** Сколько монет получает новый игрок. */
  startingCoins: Number(process.env.STARTING_COINS ?? 500),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
