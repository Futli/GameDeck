import { describe, expect, it } from 'vitest';
import { WIDGET_MAX_STORED_ROLLS, type Rng } from '@gamedeck/shared';
import { eq } from 'drizzle-orm';
import { coinTransactions, playerItems, widgetPlayers } from '../src/db/schema.js';
import { PlayerService } from '../src/players/player-service.js';
import { ShopService } from '../src/shop/shop-service.js';
import type { BotApi } from '../src/widget/bot-api.js';
import { measureWidget, WIDGET_MAX_PACKED, type WidgetState } from '../src/widget/build.js';
import { WidgetBot } from '../src/widget/widget-bot.js';
import { WidgetService } from '../src/widget/widget-service.js';
import { testDatabase } from './helpers.js';

/** Генератор, выдающий кубики по списку по кругу. */
function diceRng(...dice: number[]): Rng {
  let i = 0;
  return () => (dice[i++ % dice.length]! - 0.5) / 6;
}

let nextTelegramId = 700_000;

async function setup(rng: Rng, intervalSec = 60) {
  const { db } = await testDatabase();
  await new ShopService(db).syncCatalog();
  const players = new PlayerService(db, 500);
  const widget = new WidgetService(db, players, rng, intervalSec);
  const user = { id: nextTelegramId++, first_name: 'Лёха' };
  return { db, players, widget, user, playerId: await players.ensureTelegramPlayer(user) };
}

describe('бросок в виджете с настоящим профилем', () => {
  it('начисляет монеты через журнал и запускает таймер', async () => {
    const { db, widget, playerId } = await setup(diceRng(2, 2, 5));

    expect(await widget.roll(playerId, 1000)).toEqual({ d: [2, 2, 5], o: 'pair', c: 18, r: 2, n: 1060, b: 518 });
    expect(await widget.state(playerId, 1000)).toMatchObject({ r: 2, n: 1060, t: 60, b: 518, d: [2, 2, 5] });

    const journal = await db.select().from(coinTransactions).where(eq(coinTransactions.playerId, playerId));
    expect(journal.map((row) => [row.reason, row.amount])).toContainEqual(['widget_roll', 18]);
  });

  it('отказывает, когда бросков нет, и возвращает их по таймеру', async () => {
    const { widget, playerId } = await setup(diceRng(1, 3, 5));
    for (let i = 0; i < WIDGET_MAX_STORED_ROLLS; i++) await widget.roll(playerId, 1000);

    expect(await widget.roll(playerId, 1059)).toEqual({ e: 'NO_ROLLS' });
    expect(await widget.state(playerId, 1059)).toMatchObject({ r: 0, b: 527 });
    expect(await widget.roll(playerId, 1060)).toMatchObject({ r: 0, n: 1120, b: 536 });
  });

  it('два одновременных нажатия не тратят один бросок дважды', async () => {
    const { widget, playerId } = await setup(diceRng(1, 3, 5));
    await widget.roll(playerId, 1000);
    await widget.roll(playerId, 1000);

    const answers = await Promise.all([widget.roll(playerId, 1000), widget.roll(playerId, 1000)]);
    expect(answers.filter((answer) => 'e' in answer)).toHaveLength(1);
    expect((await widget.state(playerId, 1000)).b).toBe(527);
  });

  it('тройка кладёт скин нужной редкости в инвентарь, пока такие есть', async () => {
    // Эпических скинов в каталоге два: после них тройка шестёрок даёт только монеты.
    const { db, widget, playerId } = await setup(diceRng(6, 6, 6));
    const owned = () => db.select().from(playerItems).where(eq(playerItems.playerId, playerId));

    expect(await widget.roll(playerId, 1000)).toMatchObject({ o: 'triple', c: 90, x: 'Выпал эпический скин «Ночь»' });
    expect(await widget.roll(playerId, 1000)).toMatchObject({ x: 'Выпал эпический скин «Золото»' });
    expect(await widget.roll(playerId, 1000)).toMatchObject({ x: 'Все скины редкости «эпический» уже ваши' });
    expect((await owned()).filter((row) => row.source === 'reward').map((row) => row.itemId)).toEqual(
      expect.arrayContaining(['dice-night', 'dice-gold']),
    );
  });

  it('стрит копит модификаторы', async () => {
    const { db, widget, playerId } = await setup(diceRng(3, 4, 5));
    expect(await widget.roll(playerId, 1000)).toMatchObject({ o: 'straight', c: 12, x: 'Выпал модификатор' });
    await widget.roll(playerId, 1000);
    const [row] = await db.select().from(widgetPlayers).where(eq(widgetPlayers.playerId, playerId));
    expect(row!.modifiers).toBe(2);
  });
});

describe('бот с виджетом', () => {
  /** Вместо Telegram — запись вызовов: проверяем, что бот говорит Bot API, а не сам Bot API. */
  function fakeApi() {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const api: BotApi = {
      call: async <T>(method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return (method === 'sendWidget' ? { message_id: 42 } : true) as T;
      },
    };
    return { api, calls };
  }
  const log = { info() {}, warn() {}, error() {} };

  it('на сообщение в личке присылает виджет, а на запрос броска отвечает и обновляет состояние', async () => {
    const { db, players, widget, user, playerId } = await setup(diceRng(4, 4, 4));
    const { api, calls } = fakeApi();
    const bot = new WidgetBot({ api, players, widget, appUrl: 'https://t.me/example_bot/play', log, now: () => 1000 });

    await bot.handleUpdate({ update_id: 1, message: { chat: { id: 5, type: 'private' }, from: user } });
    const sent = calls[0]!;
    expect(sent.method).toBe('sendWidget');
    expect(sent.params).toMatchObject({ chat_id: 5, allow_queries: true });
    expect(measureWidget(sent.params.html as string).packed).toBeLessThanOrEqual(WIDGET_MAX_PACKED);
    expect(sent.params.html).toContain('https://t.me/example_bot/play');
    expect(JSON.parse(sent.params.chat_data as string)).toMatchObject({ r: 3, b: 500 } satisfies Partial<WidgetState>);
    const [row] = await db.select().from(widgetPlayers).where(eq(widgetPlayers.playerId, playerId));
    expect(row).toMatchObject({ chatId: 5, messageId: 42 });

    await bot.handleUpdate({
      update_id: 2,
      widget_query: { id: 'q1', from: user, chat: { id: 5 }, message_id: 42, data: 'r' },
    });
    const [answer, edit] = calls.slice(1);
    expect(answer).toMatchObject({ method: 'answerWidgetQuery', params: { widget_query_id: 'q1' } });
    expect(JSON.parse(answer!.params.data as string)).toMatchObject({ d: [4, 4, 4], c: 60, b: 560 });
    expect(edit).toMatchObject({ method: 'editMessageWidgetData', params: { chat_id: 5, message_id: 42 } });
    expect(JSON.parse(edit!.params.chat_data as string)).toMatchObject({ r: 2, b: 560, d: [4, 4, 4] });
  });

  it('не отвечает в группах и отвечает ошибкой на незнакомый запрос', async () => {
    const { players, widget, user } = await setup(diceRng(1, 2, 4));
    const { api, calls } = fakeApi();
    const bot = new WidgetBot({ api, players, widget, appUrl: null, log, now: () => 1000 });

    await bot.handleUpdate({ update_id: 1, message: { chat: { id: -9, type: 'group' }, from: user } });
    expect(calls).toHaveLength(0);

    await bot.handleUpdate({ update_id: 2, widget_query: { id: 'q2', from: user, data: 'x' } });
    expect(calls).toEqual([{ method: 'answerWidgetQuery', params: { widget_query_id: 'q2', data: '{"e":"FAILED"}' } }]);
  });
});
