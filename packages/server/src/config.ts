/** Все настройки — из переменных окружения, с безопасными значениями по умолчанию. */
export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
  /** Сколько ждать отключившегося игрока, прежде чем убрать его из комнаты. */
  disconnectGraceMs: Number(process.env.DISCONNECT_GRACE_MS ?? 60_000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
