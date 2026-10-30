import { roomCodeSchema } from '@gamedeck/shared';
import type { FastifyInstance } from 'fastify';
import type { RoomManager } from '../rooms/room-manager.js';

/**
 * HTTP нужен для того, что не требует постоянного соединения:
 * проверка «жив ли сервер» и превью комнаты по ссылке-приглашению.
 */
export function registerHttpRoutes(app: FastifyInstance, rooms: RoomManager): void {
  app.get('/api/health', async () => ({ ok: true, rooms: rooms.size }));

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
}
