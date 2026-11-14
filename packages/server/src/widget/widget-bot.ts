import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { DEFAULT_DICE_STYLE, PLAYER_COLOR_HEX, referralStartParam } from '@gamedeck/shared';
import type { PlayerService } from '../players/player-service.js';
import type { SkinService } from '../skins/skin-service.js';
import { BotApiError, type BotApi } from './bot-api.js';
import { buildWidgetHtml, encodeWidgetState, isWidgetLink, type WidgetRollAnswer } from './build.js';
import { diceFromStyle } from './dice.js';
import { defaultCup, feltMat } from './mat.js';
import { botLang, BOT_TEXTS, type BotLang } from './texts.js';
import type { SentWidget, WidgetMessage, WidgetService } from './widget-service.js';

const userSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  /** Язык приложения Telegram у игрока: на нём бот подписывает виджет и пишет итог броска. */
  language_code: z.string().optional(),
});

/** Из обновления Telegram берём только то, что нужно боту; остальные поля zod отбрасывает. */
const updateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      chat: z.object({ id: z.number().int(), type: z.string() }),
      from: userSchema.optional(),
      text: z.string().optional(),
    })
    .optional(),
  widget_query: z
    .object({
      id: z.string(),
      from: userSchema,
      chat: z.object({ id: z.number().int() }).optional(),
      message_id: z.number().int().optional(),
      data: z.string(),
    })
    .optional(),
  /** Игрок набрал «@бот …» в чате с другом: так приглашение уходит готовым сообщением со скрытой ссылкой. */
  inline_query: z.object({ id: z.string(), from: userSchema, query: z.string() }).optional(),
});

type Update = z.infer<typeof updateSchema>;

interface WidgetBotOptions {
  api: BotApi;
  players: PlayerService;
  skins: SkinService;
  widget: WidgetService;
  /** Ссылка на Mini App для кнопки «Найти игру» и «Подробнее» в окне приза; null — их нет. */
  appUrl: string | null;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  now?: () => number;
  /** Пауза между игроками при замене устаревших виджетов; тесты ставят 0. */
  refreshPauseMs?: number;
  /**
   * Присылать ли виджет в чат (TELEGRAM_CHAT_WIDGET). false — Telegram отключил виджеты: бот не шлёт
   * и не заменяет их, а на просьбу о «Кубике удачи» отвечает кнопкой в Mini App. По умолчанию true.
   */
  chatWidget?: boolean;
}

/** Пауза между попытками, когда Telegram недоступен: растёт от 3 секунд до минуты. */
const RETRY_MIN_MS = 3000;
const RETRY_MAX_MS = 60_000;
/** Как часто переспрашивать getMe: включение inline-режима в BotFather подхватывается без перезапуска. */
const BOT_INFO_TTL_SEC = 10 * 60;
/** Пауза между игроками при замене устаревших виджетов: до ~10 вызовов Bot API в секунду из 30 разрешённых. */
const REFRESH_PAUSE_MS = 200;
/** Версия кнопок под полем ввода. Поменяли состав кнопок — увеличьте, и игроки получат новые при следующем сообщении. */
const KEYBOARD_VERSION = 1;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** «Позвать друга»: кнопка под полем ввода на любом из языков или команда /invite. */
function isInviteRequest(text: string): boolean {
  return /^\/invite(@\w+)?$/.test(text) || Object.values(BOT_TEXTS).some((t) => t.keyboard.invite === text);
}

let cachedVersion: string | null = null;

/**
 * Версия HTML виджета: хеш виджета с сукном и стандартными кубиками на обоих языках. Меняется,
 * когда меняется код виджета, его надписи или упаковка коврика, и не меняется от выката к выкату,
 * если виджет не трогали. По ней бот находит устаревшие виджеты (refreshOutdatedWidgets).
 */
export function widgetVersion(): string {
  if (cachedVersion === null) {
    const skins = { mat: feltMat(), dice: diceFromStyle(DEFAULT_DICE_STYLE), cup: defaultCup(PLAYER_COLOR_HEX.red) };
    const hash = createHash('sha256');
    for (const lang of ['ru', 'en'] as const) hash.update(buildWidgetHtml(skins, lang));
    cachedVersion = hash.digest('hex').slice(0, 12);
  }
  return cachedVersion;
}

/** Что бот знает о себе из getMe. */
interface BotInfo {
  url: string;
  /** Включён ли inline-режим (BotFather → /setinline): без него приглашение уходит простой ссылкой. */
  inline: boolean;
  checkedAt: number;
}

/**
 * Бот с виджетом «Кубик удачи» внутри основного сервера.
 *
 * Обновления получает long polling: сам спрашивает Telegram методом getUpdates, и тот
 * держит запрос открытым, пока не появится что-то новое. Вебхуку нужен адрес, на который
 * Telegram может прийти сам, а long polling работает и за чужим роутером, и через прокси.
 */
export class WidgetBot {
  private running = false;
  /** Прервать паузу между попытками: нужен, чтобы остановка сервера её не ждала. */
  private wake: (() => void) | null = null;
  private stopped: Promise<void> = Promise.resolve();
  private info: BotInfo | null = null;
  /** Сервер останавливается: замена устаревших виджетов прерывается. */
  private stopping = false;
  private readonly now: () => number;
  private readonly refreshPauseMs: number;
  private readonly chatWidget: boolean;

  constructor(private readonly options: WidgetBotOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.refreshPauseMs = options.refreshPauseMs ?? REFRESH_PAUSE_MS;
    this.chatWidget = options.chatWidget ?? true;
  }

  /** Запустить опрос в фоне. Ошибки сети не роняют сервер: бот ждёт и пробует снова. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = this.poll();
  }

  /** Остановить опрос и дождаться, пока текущий запрос к Telegram закончится. */
  async stop(): Promise<void> {
    this.running = false;
    this.stopping = true;
    this.wake?.();
    await this.stopped;
  }

  private async poll(): Promise<void> {
    const { api, log } = this.options;
    let offset = 0;
    let retryMs = RETRY_MIN_MS;
    while (this.running) {
      try {
        if (this.info === null) {
          log.info({ bot: (await this.botInfo()).url }, 'widget bot started');
          await this.setCommands();
          // В фоне: опрос не ждёт, пока бот обойдёт всех игроков. Виджеты в чате выключены — заменять нечего:
          // новый виджет всё равно не дойдёт, а старый игрок увидит в Mini App.
          if (this.chatWidget) {
            void this.refreshOutdatedWidgets().catch((error: unknown) => {
              log.error({ err: error }, 'widget bot: outdated widgets were not refreshed');
            });
          }
        }
        // timeout 5 секунд, а не 25: при остановке сервера не приходится долго ждать ответа.
        const updates = await api.call<unknown[]>('getUpdates', { offset, timeout: 5 }, 15_000);
        retryMs = RETRY_MIN_MS;
        for (const raw of updates) {
          const update = updateSchema.safeParse(raw);
          if (!update.success) {
            // Без update_id сдвинуть offset нельзя, но Telegram всегда его присылает.
            const id = z.object({ update_id: z.number().int() }).safeParse(raw);
            if (id.success) offset = id.data.update_id + 1;
            log.warn({ issues: update.error.issues }, 'widget bot: unexpected update');
            continue;
          }
          offset = update.data.update_id + 1;
          await this.handleUpdate(update.data).catch((error: unknown) => {
            log.error({ err: error }, 'widget bot: update failed');
          });
        }
      } catch (error) {
        if (!this.running) return;
        // Только текст ошибки: стек при каждой попытке забил бы журнал.
        const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
        const reason = (error instanceof Error ? error.message : String(error)) + cause;
        log.warn({ reason, retryInSec: retryMs / 1000 }, 'widget bot: Telegram is unreachable, retrying');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, retryMs);
          this.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        this.wake = null;
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      }
    }
  }

  /**
   * Команды в меню бота «/»: /dice присылает виджет заново, /invite — личную ссылку для друга.
   * Те же действия — кнопки под полем ввода (ensureKeyboard). Не получилось — не беда: бот работает и без меню.
   */
  private async setCommands(): Promise<void> {
    for (const lang of ['en', 'ru'] as const) {
      await this.options.api
        .call('setMyCommands', {
          commands: [
            { command: 'dice', description: this.chatWidget ? BOT_TEXTS[lang].diceCommand : BOT_TEXTS[lang].diceInApp },
            { command: 'invite', description: BOT_TEXTS[lang].inviteCommand },
          ],
          ...(lang === 'ru' ? { language_code: 'ru' } : {}),
        })
        .catch((error: unknown) => this.options.log.warn({ err: error }, 'widget bot: commands were not set'));
    }
  }

  private async botInfo(): Promise<BotInfo> {
    const now = this.now();
    if (this.info === null || now - this.info.checkedAt >= BOT_INFO_TTL_SEC) {
      const me = await this.options.api.call<{ username: string; supports_inline_queries?: boolean }>('getMe', {});
      this.info = { url: `https://t.me/${me.username}`, inline: me.supports_inline_queries === true, checkedAt: now };
    }
    return this.info;
  }

  /** Личная ссылка игрока: по ней бот узнаёт, кто пригласил друга. */
  private async referralLink(playerId: string): Promise<string> {
    return `${(await this.botInfo()).url}?start=${referralStartParam(await this.options.players.referralCode(playerId))}`;
  }

  /** Обработать одно обновление. Открыт для тестов: они подают обновления без сети. */
  async handleUpdate(update: Update): Promise<void> {
    if (update.message) await this.onMessage(update.message);
    if (update.widget_query) await this.onWidgetQuery(update.widget_query);
    if (update.inline_query) await this.onInlineQuery(update.inline_query);
  }

  /**
   * Сообщение в личке. «👋 Позвать друга» (или /invite) — прислать личную ссылку для друга.
   * Всё остальное — прислать виджет с текущим состоянием игрока: кнопка «🎲 Кубик удачи», /dice,
   * /start (в том числе по ссылке с параметром) или просто сообщение. Прежний виджет бот удаляет,
   * чтобы в чате был один живой стол, а не стопка устаревших.
   */
  private async onMessage(message: NonNullable<Update['message']>): Promise<void> {
    const { players, widget } = this.options;
    if (message.chat.type !== 'private' || !message.from) return;

    const playerId = await players.ensureTelegramPlayer(message.from);
    const lang = botLang(message.from.language_code);
    const text = message.text?.trim() ?? '';
    // Переход по реферальной ссылке приходит как «/start ref_…».
    const startParam = /^\/start\s+(\S+)/.exec(text)?.[1];
    if (startParam) await widget.setReferrer(playerId, startParam);

    await this.ensureKeyboard(playerId, message.chat.id, lang);
    if (isInviteRequest(text)) await this.sendInvite(playerId, message.chat.id, lang);
    else if (this.chatWidget) await this.sendWidget(playerId, message.chat.id, lang);
    else await this.sendLuckInApp(message.chat.id, lang);
  }

  /**
   * Виджеты в чате выключены (TELEGRAM_CHAT_WIDGET=0): вместо стола — кнопка, которая открывает Mini App.
   * Там на главной тот же виджет. Без адреса Mini App (TELEGRAM_APP_URL) — только текст.
   */
  private async sendLuckInApp(chatId: number, lang: BotLang): Promise<void> {
    const { api, appUrl } = this.options;
    const t = BOT_TEXTS[lang];
    await api.call('sendMessage', {
      chat_id: chatId,
      text: t.luckInApp,
      ...(appUrl
        ? { reply_markup: { inline_keyboard: [[{ text: t.openLuck, url: `${appUrl}?startapp=luck` }]] } }
        : {}),
    });
  }

  /**
   * Кнопки под полем ввода (reply-клавиатура). Telegram помнит их в чате, пока бот не пришлёт другие,
   * поэтому хватает одного раза на игрока. Клавиатуру нельзя прицепить к виджету: под ним уже стоят
   * кнопки «Найти игру» и «Позвать друга», а у сообщения клавиатура одна. Поэтому она приходит
   * коротким сообщением перед виджетом, и только в ответ на сообщение игрока, а не при обновлении.
   */
  private async ensureKeyboard(playerId: string, chatId: number, lang: BotLang): Promise<void> {
    const { api, widget, log } = this.options;
    if ((await widget.keyboardVersion(playerId)) >= KEYBOARD_VERSION) return;
    const t = BOT_TEXTS[lang];
    try {
      await api.call('sendMessage', {
        chat_id: chatId,
        text: t.keyboardHello,
        disable_notification: true,
        reply_markup: {
          keyboard: [[{ text: t.keyboard.dice }, { text: t.keyboard.invite }]],
          resize_keyboard: true,
          is_persistent: true,
        },
      });
      await widget.rememberKeyboard(playerId, KEYBOARD_VERSION);
    } catch (error) {
      // Без кнопок бот работает: виджет игрок всё равно получит, а попытка повторится в следующий раз.
      log.warn({ err: error }, 'widget bot: keyboard was not sent');
    }
  }

  /** «Позвать друга»: личная ссылка текстом и кнопка, которая отправляет приглашение другу. */
  private async sendInvite(playerId: string, chatId: number, lang: BotLang): Promise<void> {
    await this.options.api.call('sendMessage', {
      chat_id: chatId,
      text: BOT_TEXTS[lang].inviteLink(await this.referralLink(playerId)),
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[await this.inviteButton(playerId, lang)]] },
    });
  }

  /**
   * Кнопка «Позвать друга». Ссылку за текстом умеет только inline-режим: кнопка открывает выбор чата,
   * и бот подставляет готовое сообщение (onInlineQuery). Без inline-режима (BotFather → /setinline)
   * кнопка открывает «Поделиться» с голым адресом.
   */
  private async inviteButton(playerId: string, lang: BotLang): Promise<Record<string, unknown>> {
    const t = BOT_TEXTS[lang];
    return (await this.botInfo()).inline
      ? {
          text: t.invite.button,
          switch_inline_query_chosen_chat: { query: '', allow_user_chats: true, allow_group_chats: true },
        }
      : {
          text: t.invite.button,
          url: `https://t.me/share/url?url=${encodeURIComponent(await this.referralLink(playerId))}`,
        };
  }

  /**
   * Кнопки Telegram под столом: «Найти игру» открывает Mini App, «Позвать друга» делится личной ссылкой.
   * В HTML виджета их нет: им не нужен стол, а байты лимита нужны столу.
   */
  private async widgetButtons(playerId: string, lang: BotLang): Promise<Array<Record<string, unknown>>> {
    const { appUrl } = this.options;
    return [
      ...(appUrl ? [{ text: BOT_TEXTS[lang].findGame, url: appUrl }] : []),
      await this.inviteButton(playerId, lang),
    ];
  }

  /**
   * Прислать игроку виджет и удалить прежний. silent — без звука уведомления: так приходит виджет,
   * который бот заменил сам после выката. keepPrevious — прежний уже удалён.
   */
  private async sendWidget(
    playerId: string,
    chatId: number,
    lang: BotLang,
    { silent = false, keepPrevious = false } = {},
  ): Promise<void> {
    const { api, widget, log } = this.options;
    // HTML у отправленного виджета не меняется, поэтому скины подставляются в момент отправки.
    const html = await widget.html(playerId, lang, (error, skin) =>
      log.warn({ err: error, skin }, 'widget skins do not fit, simplifying'),
    );

    const previous = keepPrevious ? null : await widget.lastMessage(playerId);
    const sent = await api.call<{ message_id: number }>('sendWidget', {
      chat_id: chatId,
      html,
      // Подпись видна под виджетом, в списке чатов и в приложениях без поддержки виджетов.
      caption: BOT_TEXTS[lang].caption,
      allow_queries: true,
      chat_data: encodeWidgetState(await widget.state(playerId, this.now(), lang)),
      reply_markup: { inline_keyboard: [await this.widgetButtons(playerId, lang)] },
      ...(silent ? { disable_notification: true } : {}),
    });
    await widget.rememberMessage(playerId, chatId, sent.message_id, lang, widgetVersion());
    // Бот может удалить своё сообщение в личке в течение 48 часов; старше — останется, это не ошибка.
    if (previous && previous.chatId === chatId) {
      await api
        .call('deleteMessage', { chat_id: previous.chatId, message_id: previous.messageId })
        .catch(() => undefined);
    }
  }

  /**
   * Заменить виджеты, отправленные до выката нового виджета. HTML отправленного виджета изменить нельзя
   * (такого метода в Bot API нет), поэтому бот присылает новый, как по /dice, только сам.
   *
   * - Прежний удаётся удалить (ему меньше 48 часов, игрок недавно играл) — вместо него приходит
   *   новый без звука уведомления. В чате по-прежнему один стол.
   * - Удалить нельзя (старше 48 часов) — бот только меняет подпись: «стол устарел, нажмите
   *   Кубик удачи». Правка подписи приходит без уведомления: давно не игравшего игрока бот не будит.
   * - Игрок сам удалил виджет или заблокировал бота — ничего не приходит.
   *
   * Зовётся один раз после старта. Идёт по одному игроку с паузой, чтобы не упереться в лимит Telegram
   * на рассылку (около 30 сообщений в секунду на бота), и ждёт, если Telegram попросил подождать.
   */
  async refreshOutdatedWidgets(): Promise<{ replaced: number; captioned: number }> {
    const { widget, log } = this.options;
    const version = widgetVersion();
    const outdated = await widget.outdatedMessages(version);
    const result = { replaced: 0, captioned: 0 };
    if (outdated.length === 0) return result;
    log.info({ count: outdated.length, version }, 'widget bot: replacing outdated widgets');
    for (const old of outdated) {
      if (this.stopping) break;
      try {
        const done = await this.replaceOutdated(old, version);
        if (done) result[done]++;
      } catch (error) {
        // Не вышло (например, Telegram недоступен) — версия не отмечена, бот попробует после следующего старта.
        log.warn({ err: error, playerId: old.playerId }, 'widget bot: outdated widget was not replaced');
      }
      await sleep(this.refreshPauseMs);
    }
    log.info(result, 'widget bot: outdated widgets handled');
    return result;
  }

  private async replaceOutdated(old: SentWidget, version: string): Promise<'replaced' | 'captioned' | null> {
    const { widget } = this.options;
    // Пока шла замена, игрок мог сам попросить новый виджет: тогда менять нечего.
    const current = await widget.lastMessage(old.playerId);
    if (!current || current.messageId !== old.messageId || current.version === version) return null;

    const deleted = await this.callPaced('deleteMessage', { chat_id: old.chatId, message_id: old.messageId }).then(
      () => true,
      (error: unknown) => {
        if (error instanceof BotApiError && error.code === 429) throw error;
        return false;
      },
    );
    if (deleted) {
      await this.sendWidget(old.playerId, old.chatId, old.lang, { silent: true, keepPrevious: true });
      return 'replaced';
    }

    const captioned = await this.callPaced('editMessageCaption', {
      chat_id: old.chatId,
      message_id: old.messageId,
      caption: BOT_TEXTS[old.lang].outdatedCaption,
      // Без reply_markup правка подписи убрала бы кнопки под виджетом.
      reply_markup: { inline_keyboard: [await this.widgetButtons(old.playerId, old.lang)] },
    }).then(
      () => true,
      () => false,
    );
    await widget.markWidgetVersion(old.playerId, version);
    return captioned ? 'captioned' : null;
  }

  /** Вызов Bot API, который ждёт и повторяет, если Telegram ответил 429 «слишком часто». */
  private async callPaced(method: string, params: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.options.api.call(method, params);
      } catch (error) {
        if (!(error instanceof BotApiError && error.code === 429) || attempt >= 3 || this.stopping) throw error;
        await sleep((error.retryAfter ?? 5) * 1000);
      }
    }
  }

  /**
   * Приглашение через inline-режим: одно готовое сообщение, где личная ссылка спрятана за словами,
   * и кнопка с той же ссылкой. Ответ личный (is_personal): у каждого игрока своя ссылка.
   */
  private async onInlineQuery(query: NonNullable<Update['inline_query']>): Promise<void> {
    const { api, players } = this.options;
    const playerId = await players.ensureTelegramPlayer(query.from);
    const link = await this.referralLink(playerId);
    const t = BOT_TEXTS[botLang(query.from.language_code)].invite;
    await api.call('answerInlineQuery', {
      inline_query_id: query.id,
      is_personal: true,
      cache_time: 300,
      results: [
        {
          type: 'article',
          id: 'invite',
          title: t.title,
          description: t.description,
          input_message_content: {
            message_text: t.message(link),
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          },
          reply_markup: { inline_keyboard: [[{ text: t.play, url: link }]] },
        },
      ],
    });
  }

  /** Запрос из виджета. Ответить нужно на каждый, иначе виджет ждёт 15 секунд и показывает ошибку. */
  private async onWidgetQuery(query: NonNullable<Update['widget_query']>): Promise<void> {
    const { api, players, widget } = this.options;
    const playerId = await players.ensureTelegramPlayer(query.from);
    const lang = botLang(query.from.language_code);

    let answer: WidgetRollAnswer | { e: 'FAILED' } = { e: 'FAILED' };
    try {
      // «Подробнее» в окне приза ведёт в Mini App: сервис говорит куда, ссылку собирает бот.
      const { details, ...result } = {
        details: undefined,
        ...(await widget.answer(playerId, query.data, this.now(), lang)),
      };
      const link = details && this.options.appUrl ? `${this.options.appUrl}?startapp=${details}` : null;
      answer = link && isWidgetLink(link) ? { ...result, l: link } : result;
    } finally {
      await api.call('answerWidgetQuery', { widget_query_id: query.id, data: JSON.stringify(answer) });
    }

    // Первый бросок приглашённого приносит бонусные броски ему и пригласившему.
    // Пригласивший не нажимал ничего, поэтому его виджет обновляется через chat_data.
    const referrer = query.data === 'r' && !('e' in answer) ? await widget.claimReferral(playerId, this.now()) : null;
    if (referrer) await this.refreshReferrerWidget(referrer);

    // Ответ видит только нажавший виджет и только сейчас. Чтобы состояние пережило
    // перезапуск приложения, оно кладётся в chat_data сообщения.
    if (query.chat && query.message_id !== undefined) {
      await api
        .call('editMessageWidgetData', {
          chat_id: query.chat.id,
          message_id: query.message_id,
          chat_data: encodeWidgetState(await widget.state(playerId, this.now(), lang)),
        })
        .catch((error: unknown) => {
          // Отказ в броске состояние не меняет, и Telegram отвечает «message is not modified».
          if (!(error instanceof BotApiError && error.description.includes('not modified'))) throw error;
        });
    }
  }

  /**
   * Показать пригласившему награду за друга. Он ничего не нажимал, поэтому бот сам обновляет
   * его последний виджет через chat_data. Зовётся и после броска друга в виджете, и после
   * первой партии друга за столом.
   */
  async refreshReferrerWidget(referrer: WidgetMessage): Promise<void> {
    // Виджеты в чате выключены: награду пригласивший увидит в Mini App.
    if (!this.chatWidget) return;
    await this.options.api
      .call('editMessageWidgetData', {
        chat_id: referrer.chatId,
        message_id: referrer.messageId,
        chat_data: encodeWidgetState(await this.options.widget.state(referrer.playerId, this.now(), referrer.lang)),
      })
      .catch((error: unknown) => {
        // Награда уже в базе; не обновился старый виджет — игрок увидит её в следующем.
        this.options.log.warn({ err: error }, 'widget bot: referrer widget was not refreshed');
      });
  }
}
