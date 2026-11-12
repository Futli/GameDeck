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
  /**
   * Токен бота от @BotFather. Нужен только для проверки подписи initData:
   * сервер не обращается к api.telegram.org, поэтому блокировки ему не мешают.
   * Без токена вход через Telegram выключен — играть можно анонимно из браузера.
   */
  telegramBotToken: process.env.BOT_TOKEN || null,
  /** Сколько initData считается свежей (сутки — как у популярных Mini App). */
  telegramInitDataMaxAgeSec: Number(process.env.TELEGRAM_INIT_DATA_MAX_AGE ?? 86_400),
  /** Ссылка на Mini App вида https://t.me/<бот>/<short name>. Из неё клиент делает приглашения в комнату. */
  telegramAppUrl: process.env.TELEGRAM_APP_URL || null,
};
