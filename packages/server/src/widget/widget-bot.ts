import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { PlayerService } from '../players/player-service.js';
import { BotApiError, type BotApi } from './bot-api.js';
import { buildWidgetHtml, encodeWidgetState, type WidgetRollAnswer } from './build.js';
import { feltMat } from './mat.js';
import type { WidgetService } from './widget-service.js';

const userSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

/** Из обновления Telegram берём только то, что нужно боту; остальные поля zod отбрасывает. */
const updateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      chat: z.object({ id: z.number().int(), type: z.string() }),
      from: userSchema.optional(),
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
});

type Update = z.infer<typeof updateSchema>;

interface WidgetBotOptions {
  api: BotApi;
  players: PlayerService;
  widget: WidgetService;
  /** Ссылка на Mini App для кнопки «Найти игру»; null — кнопки нет. */
  appUrl: string | null;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  now?: () => number;
}

/** Пауза между попытками, когда Telegram недоступен: растёт от 3 секунд до минуты. */
const RETRY_MIN_MS = 3000;
const RETRY_MAX_MS = 60_000;

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
  private inviteUrl: string | null = null;
  private readonly now: () => number;

  constructor(private readonly options: WidgetBotOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
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
    this.wake?.();
    await this.stopped;
  }

  private async poll(): Promise<void> {
    const { api, log } = this.options;
    let offset = 0;
    let retryMs = RETRY_MIN_MS;
    while (this.running) {
      try {
        if (this.inviteUrl === null) {
          const me = await api.call<{ username: string }>('getMe', {});
          this.inviteUrl = `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${me.username}`)}`;
          log.info({ bot: me.username }, 'widget bot started');
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

  /** Обработать одно обновление. Открыт для тестов: они подают обновления без сети. */
  async handleUpdate(update: Update): Promise<void> {
    if (update.message) await this.onMessage(update.message);
    if (update.widget_query) await this.onWidgetQuery(update.widget_query);
  }

  /** Любое сообщение в личке — прислать виджет с текущим состоянием игрока. */
  private async onMessage(message: NonNullable<Update['message']>): Promise<void> {
    const { api, players, widget, appUrl } = this.options;
    if (message.chat.type !== 'private' || !message.from) return;

    const playerId = await players.ensureTelegramPlayer(message.from);
    // HTML у отправленного виджета не меняется, поэтому скины подставляются в момент отправки.
    const html = buildWidgetHtml(
      { mat: feltMat(), dice: await players.diceStyle(playerId), cup: 'red' },
      // Реклама и приглашения с наградой ещё не сделаны: кнопка рекламы скрыта, «позвать друга» делится ботом.
      { invite: this.inviteUrl, ad: null, findGame: appUrl },
    );
    const sent = await api.call<{ message_id: number }>('sendWidget', {
      chat_id: message.chat.id,
      html,
      // Подпись видна в списке чатов и в приложениях без поддержки виджетов.
      caption: 'Кубик удачи: бросьте кубики и заберите монеты.',
      allow_queries: true,
      chat_data: encodeWidgetState(await widget.state(playerId, this.now())),
    });
    await widget.rememberMessage(playerId, message.chat.id, sent.message_id);
  }

  /** Запрос из виджета. Ответить нужно на каждый, иначе виджет ждёт 15 секунд и показывает ошибку. */
  private async onWidgetQuery(query: NonNullable<Update['widget_query']>): Promise<void> {
    const { api, players, widget } = this.options;
    const playerId = await players.ensureTelegramPlayer(query.from);

    let answer: WidgetRollAnswer | { e: 'FAILED' } = { e: 'FAILED' };
    try {
      // «r» — бросок, других запросов у виджета пока нет.
      if (query.data === 'r') answer = await widget.roll(playerId, this.now());
    } finally {
      await api.call('answerWidgetQuery', { widget_query_id: query.id, data: JSON.stringify(answer) });
    }

    // Ответ видит только нажавший виджет и только сейчас. Чтобы состояние пережило
    // перезапуск приложения, оно кладётся в chat_data сообщения.
    if (query.chat && query.message_id !== undefined) {
      await api
        .call('editMessageWidgetData', {
          chat_id: query.chat.id,
          message_id: query.message_id,
          chat_data: encodeWidgetState(await widget.state(playerId, this.now())),
        })
        .catch((error: unknown) => {
          // Отказ в броске состояние не меняет, и Telegram отвечает «message is not modified».
          if (!(error instanceof BotApiError && error.description.includes('not modified'))) throw error;
        });
    }
  }
}
