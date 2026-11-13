import { describe, expect, it } from 'vitest';
import { PLAYER_COLOR_HEX, WIDGET_MAX_STORED_ROLLS, generateSkin, type Rng } from '@gamedeck/shared';
import { eq } from 'drizzle-orm';
import { coinTransactions, playerItems, widgetPlayers } from '../src/db/schema.js';
import { PlayerService } from '../src/players/player-service.js';
import { ShopService } from '../src/shop/shop-service.js';
import { SkinService } from '../src/skins/skin-service.js';
import type { BotApi } from '../src/widget/bot-api.js';
import { measureWidget, WIDGET_MAX_PACKED, type WidgetState } from '../src/widget/build.js';
import { matFromSkin } from '../src/widget/mat.js';
import { WidgetBot } from '../src/widget/widget-bot.js';
import {
  REFERRAL_BONUS_ROLLS,
  REFERRAL_DAILY_LIMIT,
  referralCode,
  WidgetService,
} from '../src/widget/widget-service.js';
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
  const skins = new SkinService(db);
  const user = { id: nextTelegramId++, first_name: 'Лёха' };
  return { db, players, skins, widget, user, playerId: await players.ensureTelegramPlayer(user) };
}

describe('бросок в виджете с настоящим профилем', () => {
  it('начисляет монеты через журнал и запускает таймер', async () => {
    const { db, widget, playerId } = await setup(diceRng(2, 2, 5));

    expect(await widget.roll(playerId, 1000)).toEqual({
      d: [2, 2, 5],
      o: 'pair',
      c: 18,
      r: 2,
      n: 1060,
      b: 518,
      a: 0,
      m: 0,
      u: 0,
      x: 'Пара, ×2! +18 монет',
    });
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

    expect(await widget.roll(playerId, 1000)).toMatchObject({
      o: 'triple',
      c: 90,
      x: 'Тройка, ×5! +90 монет. Выпал эпический скин «Ночь»',
    });
    expect(await widget.roll(playerId, 1000)).toMatchObject({
      x: 'Тройка, ×5! +90 монет. Выпал эпический скин «Золото»',
    });
    expect(await widget.roll(playerId, 1000)).toMatchObject({
      x: 'Тройка, ×5! +90 монет. Все скины редкости «эпический» уже ваши',
    });
    expect((await owned()).filter((row) => row.source === 'reward').map((row) => row.itemId)).toEqual(
      expect.arrayContaining(['dice-night', 'dice-gold']),
    );
  });

  it('стрит копит перебросы', async () => {
    const { widget, playerId } = await setup(diceRng(3, 4, 5));
    expect(await widget.roll(playerId, 1000)).toMatchObject({
      o: 'straight',
      c: 12,
      m: 1,
      u: 1,
      x: 'Стрит! +12 монет. Выпал переброс',
    });
    await widget.roll(playerId, 1000);
    expect(await widget.state(playerId, 1000)).toMatchObject({ m: 2, u: 1 });
  });
});

describe('переброс кубика', () => {
  /** Игрок с перебросами в запасе: не ждать стрита в каждом тесте. */
  async function setupWithRerolls(rng: Rng, modifiers = 2) {
    const context = await setup(rng);
    await context.db
      .insert(widgetPlayers)
      .values({ playerId: context.playerId, rolls: WIDGET_MAX_STORED_ROLLS, modifiers });
    return context;
  }

  it('доплачивает разницу, когда приз вырос, и тратит один переброс', async () => {
    // Бросок 2-3-6 (11 монет), затем третий кубик перебрасывается в 2: пара 2-3-2, 14 монет.
    const { db, widget, playerId } = await setupWithRerolls(diceRng(2, 3, 6, 2));
    await widget.roll(playerId, 1000);

    expect(await widget.reroll(playerId, 2, 1000)).toMatchObject({
      d: [2, 3, 2],
      o: 'pair',
      c: 3,
      b: 514,
      m: 1,
      u: 0,
      x: 'Пара, ×2! +3 монет',
    });
    expect(await widget.state(playerId, 1000)).toMatchObject({ b: 514, m: 1, u: 0, d: [2, 3, 2] });
    const journal = await db.select().from(coinTransactions).where(eq(coinTransactions.playerId, playerId));
    expect(journal.map((row) => [row.reason, row.amount, row.refId])).toContainEqual([
      'widget_roll',
      3,
      'reroll:2,3,2',
    ]);
  });

  it('не отнимает монеты, когда приз стал меньше', async () => {
    // Пара 5-5-2 (24 монеты), второй кубик перебрасывается в 1: 5-1-2, всего 8 монет.
    const { widget, playerId } = await setupWithRerolls(diceRng(5, 5, 2, 1));
    await widget.roll(playerId, 1000);

    expect(await widget.reroll(playerId, 1, 1000)).toMatchObject({
      d: [5, 1, 2],
      c: 0,
      b: 524,
      x: 'Приз остался прежним',
    });
  });

  it('применяется к броску один раз и только когда есть что и чем перебрасывать', async () => {
    const { widget, playerId } = await setupWithRerolls(diceRng(2, 3, 6, 2));
    // Броска ещё не было.
    expect(await widget.reroll(playerId, 0, 1000)).toEqual({ e: 'NO_MOD' });

    await widget.roll(playerId, 1000);
    await widget.reroll(playerId, 2, 1000);
    // Второй раз к тому же броску нельзя, хотя переброс ещё остался.
    expect(await widget.reroll(playerId, 0, 1000)).toEqual({ e: 'NO_MOD' });
    expect(await widget.state(playerId, 1000)).toMatchObject({ m: 1, u: 0 });

    // Новый бросок снова открывает переброс.
    expect(await widget.roll(playerId, 1000)).toMatchObject({ u: 1 });
  });

  it('без перебросов в запасе отказывает', async () => {
    const { widget, playerId } = await setup(diceRng(2, 3, 6));
    await widget.roll(playerId, 1000);
    expect(await widget.reroll(playerId, 0, 1000)).toEqual({ e: 'NO_MOD' });
  });

  it('тройка после переброса даёт монеты, но не скин, а стрит не даёт новый переброс', async () => {
    // 6-6-2 (28 монет), третий кубик перебрасывается в 6: тройка шестёрок, 90 монет.
    const triple = await setupWithRerolls(diceRng(6, 6, 2, 6), 1);
    await triple.widget.roll(triple.playerId, 1000);
    expect(await triple.widget.reroll(triple.playerId, 2, 1000)).toMatchObject({
      d: [6, 6, 6],
      o: 'triple',
      c: 62,
      x: 'Тройка, ×5! +62 монет',
    });
    const owned = await triple.db.select().from(playerItems).where(eq(playerItems.playerId, triple.playerId));
    expect(owned.filter((row) => row.source === 'reward')).toHaveLength(0);

    // 3-4-1 (8 монет), третий кубик перебрасывается в 5: стрит 3-4-5, 12 монет.
    const straight = await setupWithRerolls(diceRng(3, 4, 1, 5), 1);
    await straight.widget.roll(straight.playerId, 1000);
    expect(await straight.widget.reroll(straight.playerId, 2, 1000)).toMatchObject({ o: 'straight', c: 4, m: 0 });
  });
});

describe('приглашение друга', () => {
  /** Второй игрок в той же базе. */
  async function friendOf(context: Awaited<ReturnType<typeof setup>>) {
    return context.players.ensureTelegramPlayer({ id: nextTelegramId++, first_name: 'Друг' });
  }

  it('после первого броска друга оба получают бонусные броски, и только один раз', async () => {
    const context = await setup(diceRng(1, 3, 5));
    const { widget, playerId } = context;
    const friendId = await friendOf(context);
    await widget.rememberMessage(playerId, 5, 42);

    expect(await widget.setReferrer(friendId, referralCode(playerId))).toBe(true);
    // Переход по ссылке сам по себе ничего не даёт: награда идёт за бросок.
    expect(await widget.claimReferral(friendId, 1000)).toBeNull();
    expect((await widget.state(playerId, 1000)).a).toBe(0);

    await widget.roll(friendId, 1000);
    expect(await widget.claimReferral(friendId, 1000)).toEqual({ playerId, chatId: 5, messageId: 42 });
    expect((await widget.state(friendId, 1000)).a).toBe(REFERRAL_BONUS_ROLLS);
    expect((await widget.state(playerId, 1000)).a).toBe(REFERRAL_BONUS_ROLLS);

    await widget.roll(friendId, 1000);
    expect(await widget.claimReferral(friendId, 1000)).toBeNull();
    expect((await widget.state(playerId, 1000)).a).toBe(REFERRAL_BONUS_ROLLS);
  });

  it('бонусные броски тратятся после бросков по таймеру', async () => {
    const context = await setup(diceRng(1, 3, 5));
    const { db, widget, playerId } = context;
    await db.insert(widgetPlayers).values({ playerId, rolls: 1, nextAt: new Date(2000 * 1000), bonusRolls: 1 });

    expect(await widget.roll(playerId, 1000)).toMatchObject({ r: 0, a: 1 });
    expect(await widget.roll(playerId, 1000)).toMatchObject({ r: 0, a: 0, n: 2000 });
    expect(await widget.roll(playerId, 1000)).toEqual({ e: 'NO_ROLLS' });
  });

  it('не засчитывает себя, битую ссылку, второго пригласившего и того, кто уже бросал', async () => {
    const context = await setup(diceRng(1, 3, 5));
    const { widget, playerId } = context;
    const friendId = await friendOf(context);
    const otherId = await friendOf(context);

    expect(await widget.setReferrer(playerId, referralCode(playerId))).toBe(false);
    expect(await widget.setReferrer(friendId, 'ref_broken')).toBe(false);
    expect(await widget.setReferrer(friendId, referralCode('00000000-0000-4000-8000-000000000000'))).toBe(false);

    expect(await widget.setReferrer(friendId, referralCode(playerId))).toBe(true);
    expect(await widget.setReferrer(friendId, referralCode(otherId))).toBe(false);

    await widget.roll(otherId, 1000);
    expect(await widget.setReferrer(otherId, referralCode(playerId))).toBe(false);
  });

  it('пригласивший получает награду не больше чем за десять друзей в сутки', async () => {
    const context = await setup(diceRng(1, 3, 5));
    const { widget, playerId } = context;
    const invite = async (now: number) => {
      const friendId = await friendOf(context);
      await widget.setReferrer(friendId, referralCode(playerId));
      await widget.roll(friendId, now);
      await widget.claimReferral(friendId, now);
      return friendId;
    };

    for (let i = 0; i < REFERRAL_DAILY_LIMIT; i++) await invite(1000);
    expect((await widget.state(playerId, 1000)).a).toBe(REFERRAL_DAILY_LIMIT * REFERRAL_BONUS_ROLLS);

    // Одиннадцатый друг свою награду получает, пригласивший — нет.
    const extra = await invite(1000);
    expect((await widget.state(extra, 1000)).a).toBe(REFERRAL_BONUS_ROLLS);
    expect((await widget.state(playerId, 1000)).a).toBe(REFERRAL_DAILY_LIMIT * REFERRAL_BONUS_ROLLS);

    // Через сутки счётчик свободен.
    await invite(1000 + 24 * 60 * 60 + 1);
    expect((await widget.state(playerId, 1000)).a).toBe((REFERRAL_DAILY_LIMIT + 1) * REFERRAL_BONUS_ROLLS);
  });
});

describe('бот с виджетом', () => {
  /** Вместо Telegram — запись вызовов: проверяем, что бот говорит Bot API, а не сам Bot API. */
  function fakeApi(supportsInline = false) {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const api: BotApi = {
      call: async <T>(method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        if (method === 'getMe') return { username: 'example_bot', supports_inline_queries: supportsInline } as T;
        return (method === 'sendWidget' ? { message_id: 42 } : true) as T;
      },
    };
    return { api, calls };
  }
  const log = { info() {}, warn() {}, error() {} };

  it('на сообщение в личке присылает виджет, а на запрос броска отвечает и обновляет состояние', async () => {
    const { db, players, skins, widget, user, playerId } = await setup(diceRng(4, 4, 4));
    const { api, calls } = fakeApi();
    const bot = new WidgetBot({
      api,
      players,
      skins,
      widget,
      appUrl: 'https://t.me/example_bot/play',
      log,
      now: () => 1000,
    });

    await bot.handleUpdate({ update_id: 1, message: { chat: { id: 5, type: 'private' }, from: user } });
    // Первым бот спрашивает своё имя: оно нужно для реферальной ссылки.
    expect(calls[0]!.method).toBe('getMe');
    const sent = calls[1]!;
    expect(sent.method).toBe('sendWidget');
    expect(sent.params).toMatchObject({ chat_id: 5, allow_queries: true });
    expect(measureWidget(sent.params.html as string).packed).toBeLessThanOrEqual(WIDGET_MAX_PACKED);
    expect(sent.params.html).toContain('https://t.me/example_bot/play');
    const referral = `https://t.me/example_bot?start=${referralCode(playerId)}`;
    expect(sent.params.html).toContain(`https://t.me/share/url?url=${encodeURIComponent(referral)}`);
    expect(JSON.parse(sent.params.chat_data as string)).toMatchObject({ r: 3, b: 500 } satisfies Partial<WidgetState>);
    const [row] = await db.select().from(widgetPlayers).where(eq(widgetPlayers.playerId, playerId));
    expect(row).toMatchObject({ chatId: 5, messageId: 42 });

    await bot.handleUpdate({
      update_id: 2,
      widget_query: { id: 'q1', from: user, chat: { id: 5 }, message_id: 42, data: 'r' },
    });
    const [answer, edit] = calls.slice(2);
    expect(answer).toMatchObject({ method: 'answerWidgetQuery', params: { widget_query_id: 'q1' } });
    expect(JSON.parse(answer!.params.data as string)).toMatchObject({ d: [4, 4, 4], c: 60, b: 560 });
    expect(edit).toMatchObject({ method: 'editMessageWidgetData', params: { chat_id: 5, message_id: 42 } });
    expect(JSON.parse(edit!.params.chat_data as string)).toMatchObject({ r: 2, b: 560, d: [4, 4, 4] });
  });

  it('надетый сгенерированный коврик едет в виджет вместо сукна и влезает в лимит', async () => {
    const { players, skins, widget, user, playerId } = await setup(diceRng(1, 2, 4));
    const mat = await skins.mint(playerId, 'mat', 'epic', { source: 'admin' });
    await skins.equip(playerId, mat.id);
    const { api, calls } = fakeApi();
    const bot = new WidgetBot({ api, players, skins, widget, appUrl: null, log, now: () => 1000 });

    await bot.handleUpdate({ update_id: 1, message: { chat: { id: 7, type: 'private' }, from: user } });
    const html = calls.find((call) => call.method === 'sendWidget')!.params.html as string;
    expect(html).toContain(matFromSkin(generateSkin(mat).render(), PLAYER_COLOR_HEX.red.main).pixels);
    expect(measureWidget(html).packed).toBeLessThanOrEqual(WIDGET_MAX_PACKED);
  });

  it('с inline-режимом зовёт друга готовым сообщением, где ссылка спрятана за текстом', async () => {
    const { players, skins, widget, user, playerId } = await setup(diceRng(1, 2, 4));
    const { api, calls } = fakeApi(true);
    const bot = new WidgetBot({ api, players, skins, widget, appUrl: null, log, now: () => 1000 });
    const referral = `https://t.me/example_bot?start=${referralCode(playerId)}`;

    // Кнопка уходит из виджета под него: внутри виджета есть только «Поделиться» с голым адресом.
    await bot.handleUpdate({ update_id: 1, message: { chat: { id: 5, type: 'private' }, from: user } });
    const sent = calls.find((call) => call.method === 'sendWidget')!;
    expect(sent.params.html).not.toContain('share/url');
    expect(sent.params.reply_markup).toEqual({
      inline_keyboard: [
        [
          {
            text: 'Позвать друга',
            switch_inline_query_chosen_chat: { query: '', allow_user_chats: true, allow_group_chats: true },
          },
        ],
      ],
    });

    await bot.handleUpdate({ update_id: 2, inline_query: { id: 'iq1', from: user, query: '' } });
    const answer = calls.find((call) => call.method === 'answerInlineQuery')!;
    expect(answer.params).toMatchObject({ inline_query_id: 'iq1', is_personal: true });
    const [result] = answer.params.results as Array<{
      input_message_content: { message_text: string; parse_mode: string };
      reply_markup: unknown;
    }>;
    expect(result!.input_message_content.parse_mode).toBe('HTML');
    expect(result!.input_message_content.message_text).toContain(`<a href="${referral}">«Кубике удачи»</a>`);
    expect(result!.reply_markup).toEqual({ inline_keyboard: [[{ text: '🎲 Бросить кубики', url: referral }]] });

    // Язык приглашения — язык Telegram у пригласившего.
    await bot.handleUpdate({
      update_id: 3,
      inline_query: { id: 'iq2', from: { ...user, language_code: 'en' }, query: '' },
    });
    const english = calls.filter((call) => call.method === 'answerInlineQuery')[1]!;
    expect(JSON.stringify(english.params.results)).toContain(`<a href=\\"${referral}\\">Lucky Dice</a>`);
  });

  it('по реферальной ссылке запоминает пригласившего и после броска друга обновляет его виджет', async () => {
    const { db, players, skins, widget, user, playerId } = await setup(diceRng(1, 3, 5));
    const friend = { id: nextTelegramId++, first_name: 'Друг' };
    const { api, calls } = fakeApi();
    const bot = new WidgetBot({ api, players, skins, widget, appUrl: null, log, now: () => 1000 });

    await bot.handleUpdate({ update_id: 1, message: { chat: { id: 5, type: 'private' }, from: user } });
    await bot.handleUpdate({
      update_id: 2,
      message: { chat: { id: 6, type: 'private' }, from: friend, text: `/start ${referralCode(playerId)}` },
    });
    const friendId = await players.ensureTelegramPlayer(friend);
    const [row] = await db.select().from(widgetPlayers).where(eq(widgetPlayers.playerId, friendId));
    expect(row!.referredBy).toBe(playerId);

    calls.length = 0;
    await bot.handleUpdate({
      update_id: 3,
      widget_query: { id: 'q1', from: friend, chat: { id: 6 }, message_id: 42, data: 'r' },
    });
    const edits = calls.filter((call) => call.method === 'editMessageWidgetData');
    // Сначала виджет пригласившего (чат 5), потом виджет друга (чат 6): у обоих по три бонусных броска.
    expect(edits.map((call) => call.params.chat_id)).toEqual([5, 6]);
    expect(edits.map((call) => JSON.parse(call.params.chat_data as string).a)).toEqual([3, 3]);
  });

  it('по запросу m0–m2 перебрасывает кубик', async () => {
    const { db, players, skins, widget, user, playerId } = await setup(diceRng(2, 3, 6, 2));
    await db.insert(widgetPlayers).values({ playerId, rolls: WIDGET_MAX_STORED_ROLLS, modifiers: 1 });
    const { api, calls } = fakeApi();
    const bot = new WidgetBot({ api, players, skins, widget, appUrl: null, log, now: () => 1000 });

    await bot.handleUpdate({ update_id: 1, widget_query: { id: 'q1', from: user, data: 'r' } });
    await bot.handleUpdate({ update_id: 2, widget_query: { id: 'q2', from: user, data: 'm2' } });
    expect(JSON.parse(calls.at(-1)!.params.data as string)).toMatchObject({ d: [2, 3, 2], c: 3, m: 0 });
  });

  it('игроку с английским Telegram отвечает по-английски', async () => {
    const { players, skins, widget, user } = await setup(diceRng(4, 4, 4));
    const { api, calls } = fakeApi();
    const bot = new WidgetBot({ api, players, skins, widget, appUrl: null, log, now: () => 1000 });
    const english = { ...user, language_code: 'en' };

    await bot.handleUpdate({ update_id: 1, message: { chat: { id: 5, type: 'private' }, from: english } });
    const sent = calls.find((c) => c.method === 'sendWidget')!;
    expect(sent.params.caption).toBe('Lucky Dice: roll the dice and collect coins.');
    expect(sent.params.html).not.toMatch(/[А-Яа-яЁё]/);

    await bot.handleUpdate({ update_id: 2, widget_query: { id: 'q1', from: english, data: 'r' } });
    const answer = calls.find((c) => c.method === 'answerWidgetQuery')!;
    expect(JSON.parse(answer.params.data as string)).toMatchObject({
      x: 'Triple, ×5! +60 coins. You got a common skin “Oak table”',
    });
  });

  it('не отвечает в группах и отвечает ошибкой на незнакомый запрос', async () => {
    const { players, skins, widget, user } = await setup(diceRng(1, 2, 4));
    const { api, calls } = fakeApi();
    const bot = new WidgetBot({ api, players, skins, widget, appUrl: null, log, now: () => 1000 });

    await bot.handleUpdate({ update_id: 1, message: { chat: { id: -9, type: 'group' }, from: user } });
    expect(calls).toHaveLength(0);

    await bot.handleUpdate({ update_id: 2, widget_query: { id: 'q2', from: user, data: 'x' } });
    expect(calls).toEqual([{ method: 'answerWidgetQuery', params: { widget_query_id: 'q2', data: '{"e":"FAILED"}' } }]);
  });
});
