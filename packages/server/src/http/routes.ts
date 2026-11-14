import { SKIN_KINDS, games, roomCodeSchema } from '@gamedeck/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { PlayerService } from '../players/player-service.js';
import type { RoomManager } from '../rooms/room-manager.js';
import type { ShopService } from '../shop/shop-service.js';
import type { SkinService } from '../skins/skin-service.js';
import type { StatsService } from '../stats/stats-service.js';
import { encodeWidgetState } from '../widget/build.js';
import type { WidgetMessage, WidgetService } from '../widget/widget-service.js';

export interface HttpDeps {
  rooms: RoomManager;
  players: PlayerService;
  stats: StatsService;
  shop: ShopService;
  skins: SkinService;
  widget: WidgetService;
  telegramAppUrl: string | null;
  /** Бот присылает виджет в чат (TELEGRAM_CHAT_WIDGET): клиент показывает «Открыть виджет в чате». */
  chatWidget: boolean;
  /** Первый бросок приглашённого в Mini App принёс награду пригласившему: бот обновит его виджет. */
  onReferrerRewarded?: (referrer: WidgetMessage) => void;
}

const itemBodySchema = z.object({ itemId: z.string().min(1) });
const skinParamsSchema = z.object({ id: z.uuid() });
const unequipBodySchema = z.object({ kind: z.enum(SKIN_KINDS) });
const giftBodySchema = z.object({ toPlayerId: z.uuid() });
const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.iso.datetime().optional(),
});
const widgetLangSchema = z.enum(['ru', 'en']);
const widgetQuerySchema = z.object({ lang: widgetLangSchema });
const widgetBodySchema = z.object({ d: z.string().max(64), lang: widgetLangSchema });
const now = () => Math.floor(Date.now() / 1000);

const leaderboardQuerySchema = z.object({
  game: z.enum(Object.keys(games) as [string, ...string[]]).default('dice-high'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * HTTP нужен для того, что не требует постоянного соединения:
 * проверка «жив ли сервер», превью комнаты, профили, рейтинг и магазин.
 */
export function registerHttpRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const { rooms, players, stats, shop, skins, widget } = deps;

  // Ошибки приложения и zod → понятный JSON с кодом, остальное — 500.
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof AppError) {
      const status = err.code === 'UNAUTHORIZED' ? 401 : err.code.endsWith('NOT_FOUND') ? 404 : 400;
      return reply.code(status).send({ error: err.code, message: err.message });
    }
    if (err instanceof z.ZodError)
      return reply.code(400).send({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'INTERNAL' });
  });

  /** Тот же токен, что и в Socket.IO, в заголовке `Authorization: Bearer <token>`. */
  const requirePlayer = async (request: FastifyRequest): Promise<string> => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const playerId = await players.findPlayerId(token);
    if (!playerId) throw new AppError('UNAUTHORIZED', 'Нужна сессия');
    return playerId;
  };

  app.get('/api/health', async () => ({ ok: true, rooms: rooms.size }));

  /** Список комнат для главной: сначала без пароля, потом с паролем. */
  app.get('/api/rooms', async () => ({ rooms: rooms.list() }));
  /** Настройки, которые клиент узнаёт при старте. Так один и тот же образ работает с любым ботом. */
  app.get('/api/config', async () => ({ telegramAppUrl: deps.telegramAppUrl, chatWidget: deps.chatWidget }));

  app.get<{ Params: { code: string } }>('/api/rooms/:code', async (request, reply) => {
    const parsed = roomCodeSchema.safeParse(request.params.code);
    const room = parsed.success ? rooms.get(parsed.data) : undefined;
    if (!room) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' });

    const view = room.toView();
    return {
      code: view.code,
      status: view.status,
      gameId: view.settings.gameId,
      stake: view.settings.stake,
      hasPassword: view.settings.hasPassword,
      players: view.players.length,
      maxPlayers: view.settings.maxPlayers,
    };
  });

  // ─── Игроки и рейтинг ─────────────────────────────────────

  app.get<{ Params: { id: string } }>('/api/players/:id', async (request) => {
    const id = z.uuid().parse(request.params.id);
    const profile = await players.profile(id);
    if (!profile) throw new AppError('PLAYER_NOT_FOUND', 'Игрок не найден');
    return profile;
  });

  /** Свой профиль: имя для формы входа и статистика на главном экране. */
  app.get('/api/me', async (request) => {
    const profile = await players.me(await requirePlayer(request));
    if (!profile) throw new AppError('PLAYER_NOT_FOUND', 'Игрок не найден');
    return profile;
  });

  /** История своих партий для экрана статистики: победы, поражения и монеты по каждой. */
  app.get('/api/me/matches', async (request) => {
    const playerId = await requirePlayer(request);
    const { limit, before } = historyQuerySchema.parse(request.query);
    return stats.history(playerId, { limit, ...(before ? { before: new Date(before) } : {}) });
  });

  // ─── Виджет «Кубик удачи» на главной Mini App ─────────────
  // Тот же HTML, что бот присылает в чат, и те же броски. Клиент вставляет его во фрейм и подменяет
  // window.TelegramWidget: запрос броска вместо бота идёт сюда, а chatData — это то же состояние.

  app.get('/api/me/widget', async (request) => {
    const playerId = await requirePlayer(request);
    const { lang } = widgetQuerySchema.parse(request.query);
    const html = await widget.html(playerId, lang, (error, skin) =>
      request.log.warn({ err: error, skin }, 'widget skins do not fit, simplifying'),
    );
    return { html, chatData: encodeWidgetState(await widget.state(playerId, now(), lang)) };
  });

  app.post('/api/me/widget/query', async (request) => {
    const playerId = await requirePlayer(request);
    const { d, lang } = widgetBodySchema.parse(request.body);
    // «Подробнее» в окне приза: в чате это ссылка на Mini App, а здесь — сам параметр (luck или
    // luck-<id скина>), клиент откроет страницу «Кубик удачи» без перехода по ссылке.
    const { details, ...answer } = { details: undefined, ...(await widget.answer(playerId, d, now(), lang)) };
    // Первый бросок приглашённого приносит бонусные броски ему и пригласившему, как и в чате.
    if (d === 'r' && !('e' in answer)) {
      const referrer = await widget.claimReferral(playerId, now());
      if (referrer) deps.onReferrerRewarded?.(referrer);
    }
    return {
      result: JSON.stringify(details ? { ...answer, l: details } : answer),
      chatData: encodeWidgetState(await widget.state(playerId, now(), lang)),
    };
  });

  app.get('/api/leaderboard', async (request) => {
    const { game, limit } = leaderboardQuerySchema.parse(request.query);
    return { gameId: game, players: await stats.leaderboard(game, limit) };
  });

  // ─── Магазин ──────────────────────────────────────────────

  app.get('/api/shop/catalog', async () => shop.catalog());

  app.get('/api/me/inventory', async (request) => shop.inventory(await requirePlayer(request)));

  app.post('/api/shop/buy', async (request) => {
    const playerId = await requirePlayer(request);
    return shop.buyWithCoins(playerId, itemBodySchema.parse(request.body).itemId);
  });

  app.post('/api/me/equip', async (request) => {
    const playerId = await requirePlayer(request);
    return shop.equip(playerId, itemBodySchema.parse(request.body).itemId);
  });

  // ─── Сгенерированные скины ───────────────────────────────
  // Выпуск скинов (дроп) здесь не открыт: его вызывает сервер, а не клиент.

  app.get('/api/me/skins', async (request) => ({ skins: await skins.list(await requirePlayer(request)) }));

  app.get('/api/skins/:id', async (request) => skins.card(skinParamsSchema.parse(request.params).id));

  app.post('/api/skins/:id/equip', async (request) => {
    const playerId = await requirePlayer(request);
    return { skins: await skins.equip(playerId, skinParamsSchema.parse(request.params).id) };
  });

  app.post('/api/me/skins/unequip', async (request) => {
    const playerId = await requirePlayer(request);
    return { skins: await skins.unequip(playerId, unequipBodySchema.parse(request.body).kind) };
  });

  app.post('/api/skins/:id/gift', async (request) => {
    const playerId = await requirePlayer(request);
    const { id } = skinParamsSchema.parse(request.params);
    return { skins: await skins.gift(playerId, giftBodySchema.parse(request.body).toPlayerId, id) };
  });
}
