import { games, roomCodeSchema } from '@gamedeck/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { PlayerService } from '../players/player-service.js';
import type { RoomManager } from '../rooms/room-manager.js';
import type { ShopService } from '../shop/shop-service.js';
import type { StatsService } from '../stats/stats-service.js';

export interface HttpDeps {
  rooms: RoomManager;
  players: PlayerService;
  stats: StatsService;
  shop: ShopService;
  telegramAppUrl: string | null;
}

const itemBodySchema = z.object({ itemId: z.string().min(1) });
const leaderboardQuerySchema = z.object({
  game: z.enum(Object.keys(games) as [string, ...string[]]).default('dice-high'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * HTTP нужен для того, что не требует постоянного соединения:
 * проверка «жив ли сервер», превью комнаты, профили, рейтинг и магазин.
 */
export function registerHttpRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const { rooms, players, stats, shop } = deps;

  // Ошибки приложения и zod → понятный JSON с кодом, остальное — 500.
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof AppError) {
      const status = err.code === 'UNAUTHORIZED' ? 401 : err.code.endsWith('NOT_FOUND') ? 404 : 400;
      return reply.code(status).send({ error: err.code, message: err.message });
    }
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
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

  /** Настройки, которые клиент узнаёт при старте. Так один и тот же образ работает с любым ботом. */
  app.get('/api/config', async () => ({ telegramAppUrl: deps.telegramAppUrl }));

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
}
