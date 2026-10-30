import { randomInt } from 'node:crypto';
import type { Rng } from '@gamedeck/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { Server } from 'socket.io';
import { registerHttpRoutes } from './http/routes.js';
import { RoomManager } from './rooms/room-manager.js';
import { SessionStore } from './socket/sessions.js';
import { registerSocketHandlers, type GameServer } from './socket/handlers.js';

/** Криптостойкий ГСЧ: бросок нельзя предсказать по предыдущим. */
export const cryptoRng: Rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

export interface AppOptions {
  logger?: FastifyServerOptions['logger'];
  rng?: Rng;
  disconnectGraceMs?: number;
}

/**
 * Собирает приложение, но не запускает его. Так тесты могут поднять сервер
 * на случайном порту, а index.ts — на настоящем.
 */
export function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const rooms = new RoomManager();
  const sessions = new SessionStore();

  // Socket.IO вешается на тот же http-сервер, что и Fastify: один порт для всего.
  const io: GameServer = new Server(app.server, {
    // Клиент сначала держит соединение через HTTP long-polling, затем переходит на WebSocket.
    // Это помогает в сетях, где WebSocket режут прокси.
    transports: ['polling', 'websocket'],
  });

  const disposeSockets = registerSocketHandlers({
    io,
    rooms,
    sessions,
    rng: options.rng ?? cryptoRng,
    disconnectGraceMs: options.disconnectGraceMs ?? 60_000,
    log: app.log,
  });
  registerHttpRoutes(app, rooms);

  // Перед остановкой HTTP закрываем все сокеты, иначе server.close() будет ждать их вечно.
  app.addHook('preClose', async () => {
    disposeSockets();
    io.disconnectSockets(true);
    io.engine.close();
  });

  return { app, io, rooms };
}
