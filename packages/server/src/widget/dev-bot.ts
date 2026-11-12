/**
 * Бот-прототип для проверки виджета в настоящем Telegram. Это инструмент
 * разработчика, а не часть сервера: запускается руками на своей машине,
 * получает обновления long polling (getUpdates), игроков держит в памяти
 * и настоящие монеты не трогает. Как запускать — docs/widget-guide.md.
 *
 * Токен берётся из WIDGET_BOT_TOKEN, а не из BOT_TOKEN, чтобы случайно
 * не запустить прототип от имени боевого бота: ему нужен отдельный тестовый.
 */
import { DEFAULT_DICE_STYLE, WIDGET_ROLL_INTERVAL_SEC } from '@gamedeck/shared';
import { cryptoRng } from '../app.js';
import { config } from '../config.js';
import { BotApiError, callBotApi } from './bot-api.js';
import { buildWidgetHtml, encodeWidgetState, measureWidget } from './build.js';
import { createDemoPlayer, demoState, playDemoRoll, type DemoPlayer } from './demo.js';
import { feltMat } from './mat.js';

interface Update {
  update_id: number;
  message?: { chat: { id: number; type: string }; from?: { id: number } };
  widget_query?: { id: string; from: { id: number }; chat?: { id: number }; message_id?: number; data: string };
}

const token = process.env.WIDGET_BOT_TOKEN;
if (!token) {
  console.error('Нужен WIDGET_BOT_TOKEN — токен тестового бота от @BotFather.');
  process.exit(1);
}
const intervalSec = Number(process.env.WIDGET_ROLL_INTERVAL_SEC ?? WIDGET_ROLL_INTERVAL_SEC);
if (!Number.isInteger(intervalSec) || intervalSec < 1) {
  console.error('WIDGET_ROLL_INTERVAL_SEC должен быть целым числом секунд, не меньше 1.');
  process.exit(1);
}

const players = new Map<number, DemoPlayer>();
const now = () => Math.floor(Date.now() / 1000);

function playerOf(userId: number): DemoPlayer {
  let player = players.get(userId);
  if (!player) {
    player = createDemoPlayer(config.startingCoins);
    players.set(userId, player);
  }
  return player;
}

const me = await callBotApi<{ username: string }>(token, 'getMe', {});
const botUrl = `https://t.me/${me.username}`;
const html = buildWidgetHtml(
  { mat: feltMat(), dice: DEFAULT_DICE_STYLE, cup: 'red' },
  {
    invite: `https://t.me/share/url?url=${encodeURIComponent(botUrl)}`,
    // Реклама показывается в Mini App, в прототипе её нет — кнопка скрыта.
    ad: null,
    findGame: config.telegramAppUrl,
  },
);
const size = measureWidget(html);
console.log(`@${me.username}: виджет ${size.bytes} байт, ${size.packed} после сжатия. Напишите боту что угодно.`);

/** Любое сообщение в личке — прислать виджет с текущим состоянием игрока. */
async function onMessage(message: NonNullable<Update['message']>): Promise<void> {
  if (message.chat.type !== 'private' || !message.from) return;
  await callBotApi(token!, 'sendWidget', {
    chat_id: message.chat.id,
    html,
    // Подпись видна в списке чатов и в приложениях без поддержки виджетов.
    caption: 'Кубик удачи: бросьте кубики и заберите монеты.',
    allow_queries: true,
    chat_data: encodeWidgetState(demoState(playerOf(message.from.id), now(), intervalSec)),
  });
}

/** Запрос из виджета: «r» — бросок. Ответить нужно на каждый запрос, иначе виджет ждёт 15 секунд. */
async function onWidgetQuery(query: NonNullable<Update['widget_query']>): Promise<void> {
  if (query.data !== 'r') {
    await callBotApi(token!, 'answerWidgetQuery', { widget_query_id: query.id, data: '{"e":"FAILED"}' });
    return;
  }
  const result = playDemoRoll(playerOf(query.from.id), now(), cryptoRng, intervalSec);
  players.set(query.from.id, result.player);
  await callBotApi(token!, 'answerWidgetQuery', { widget_query_id: query.id, data: JSON.stringify(result.answer) });

  // Ответ видит только нажавший виджет. Чтобы состояние пережило перезапуск приложения, оно кладётся в chat_data.
  if (query.chat && query.message_id !== undefined) {
    await callBotApi(token!, 'editMessageWidgetData', {
      chat_id: query.chat.id,
      message_id: query.message_id,
      chat_data: encodeWidgetState(demoState(result.player, now(), intervalSec)),
    }).catch((error: unknown) => {
      // Отказ от броска состояние не меняет, и Telegram отвечает «message is not modified».
      if (!(error instanceof BotApiError && error.message.includes('not modified'))) throw error;
    });
  }
}

let offset = 0;
for (;;) {
  try {
    const updates = await callBotApi<Update[]>(token, 'getUpdates', { offset, timeout: 25 }, 35_000);
    for (const update of updates) {
      offset = update.update_id + 1;
      try {
        if (update.message) await onMessage(update.message);
        if (update.widget_query) await onWidgetQuery(update.widget_query);
      } catch (error) {
        console.error('Не удалось обработать обновление:', error);
      }
    }
  } catch (error) {
    console.error('getUpdates не ответил, повтор через 3 секунды:', error);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
