import { buildApp, cryptoRng } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db/client.js';
import { createBotApi } from './widget/bot-api.js';
import { WidgetBot } from './widget/widget-bot.js';
import { WidgetService } from './widget/widget-service.js';

// Сначала база (с миграциями), потом приложение: без базы сервер не стартует.
const database = await openDatabase(config.databaseUrl);
const { app, players, skins } = await buildApp({
  db: database.db,
  startingCoins: config.startingCoins,
  serveClient: true,
  logger: { level: config.logLevel },
  disconnectGraceMs: config.disconnectGraceMs,
  telegramAppUrl: config.telegramAppUrl,
  telegram: config.telegramBotToken
    ? { botToken: config.telegramBotToken, maxAgeSec: config.telegramInitDataMaxAgeSec }
    : undefined,
});

// Бот с виджетом включается отдельно: ему нужен доступ к api.telegram.org, а игре — нет.
const bot =
  config.telegramBotToken && config.telegramBotPolling
    ? new WidgetBot({
        api: createBotApi(config.telegramBotToken, config.telegramProxyUrl),
        players,
        skins,
        widget: new WidgetService(database.db, players, cryptoRng, config.widgetRollIntervalSec),
        appUrl: config.telegramAppUrl,
        log: app.log,
      })
    : null;

// Корректная остановка по Ctrl+C / systemd: закрыть сокеты, затем HTTP.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(() => bot?.stop())
      .then(() => database.close())
      .then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
  bot?.start();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
