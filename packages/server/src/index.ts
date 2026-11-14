import { buildApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db/client.js';
import { createBotApi } from './widget/bot-api.js';
import { WidgetBot } from './widget/widget-bot.js';

// Сначала база (с миграциями), потом приложение: без базы сервер не стартует.
const database = await openDatabase(config.databaseUrl);
// Бот создаётся после приложения, а наградить за первую партию друга нужно уже из приложения.
let bot: WidgetBot | null = null;
const { app, players, skins, widget } = await buildApp({
  db: database.db,
  startingCoins: config.startingCoins,
  serveClient: true,
  logger: { level: config.logLevel },
  disconnectGraceMs: config.disconnectGraceMs,
  widgetRollIntervalSec: config.widgetRollIntervalSec,
  onReferrerRewarded: (referrer) => void bot?.refreshReferrerWidget(referrer),
  telegramAppUrl: config.telegramAppUrl,
  // Кнопку «Открыть виджет в чате» в Mini App показываем, только если бот его присылает.
  chatWidget: Boolean(config.telegramBotToken && config.telegramBotPolling && config.telegramChatWidget),
  telegram: config.telegramBotToken
    ? { botToken: config.telegramBotToken, maxAgeSec: config.telegramInitDataMaxAgeSec }
    : undefined,
});

// Бот с виджетом включается отдельно: ему нужен доступ к api.telegram.org, а игре — нет.
bot =
  config.telegramBotToken && config.telegramBotPolling
    ? new WidgetBot({
        api: createBotApi(config.telegramBotToken, config.telegramProxyUrl),
        players,
        skins,
        widget,
        appUrl: config.telegramAppUrl,
        chatWidget: config.telegramChatWidget,
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
