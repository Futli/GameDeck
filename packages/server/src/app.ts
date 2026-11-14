import { randomInt } from 'node:crypto';
import type { Rng } from '@gamedeck/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { Server } from 'socket.io';
import { registerClient } from './http/client.js';
import { registerHttpRoutes } from './http/routes.js';
import type { Db } from './db/client.js';
import { PlayerService } from './players/player-service.js';
import { RoomManager } from './rooms/room-manager.js';
import { ShopService } from './shop/shop-service.js';
import { SkinService } from './skins/skin-service.js';
import { registerSocketHandlers, type GameServer } from './socket/handlers.js';
import { StatsService } from './stats/stats-service.js';
import { WidgetService, type WidgetMessage } from './widget/widget-service.js';

/** Криптостойкий ГСЧ: бросок нельзя предсказать по предыдущим. */
export const cryptoRng: Rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

export interface AppOptions {
  db: Db;
  startingCoins?: number;
  /** Отдавать собранный клиент (packages/client/dist). В тестах не нужно. */
  serveClient?: boolean;
  logger?: FastifyServerOptions['logger'];
  rng?: Rng;
  disconnectGraceMs?: number;
  /** Вход через Telegram Mini App. Без него initData игнорируется. */
  telegram?: { botToken: string; maxAgeSec: number };
  /** https://t.me/<бот>/<приложение> — для ссылок-приглашений. */
  telegramAppUrl?: string | null;
  /** Бот присылает виджет «Кубик удачи» в чат: тогда Mini App предлагает открыть его там. */
  chatWidget?: boolean;
  /** Как часто в виджете копится бросок. По умолчанию WIDGET_ROLL_INTERVAL_SEC. */
  widgetRollIntervalSec?: number;
  /** Пригласивший получил награду за первую партию друга: бот обновит его виджет. */
  onReferrerRewarded?: (referrer: WidgetMessage) => void;
}

/**
 * Собирает приложение, но не запускает его. База передаётся снаружи:
 * index.ts открывает настоящую, тесты — PGlite в памяти. Так тесты могут поднять сервер
 * на случайном порту, а index.ts — на настоящем.
 */
export async function buildApp(options: AppOptions) {
  const app = Fastify({ logger: options.logger ?? false });
  const rooms = new RoomManager();
  const players = new PlayerService(options.db, options.startingCoins);
  const stats = new StatsService(options.db);
  const shop = new ShopService(options.db);
  const skins = new SkinService(options.db);
  const rng = options.rng ?? cryptoRng;
  // Виджет и рефералка живут в одной таблице, поэтому сервис нужен и столу, даже когда бот выключен.
  const widget = new WidgetService(options.db, players, skins, rng, options.widgetRollIntervalSec);
  await shop.syncCatalog();

  // Socket.IO вешается на тот же http-сервер, что и Fastify: один порт для всего.
  const io: GameServer = new Server(app.server, {
    // Клиент сначала держит соединение через HTTP long-polling, затем переходит на WebSocket.
    // Это помогает в сетях, где WebSocket режут прокси.
    transports: ['polling', 'websocket'],
  });

  const disposeSockets = registerSocketHandlers({
    io,
    rooms,
    players,
    skins,
    stats,
    rng,
    disconnectGraceMs: options.disconnectGraceMs ?? 60_000,
    telegram: options.telegram,
    referrals: widget,
    onReferrerRewarded: options.onReferrerRewarded,
    log: app.log,
  });
  registerHttpRoutes(app, {
    rooms,
    players,
    stats,
    shop,
    skins,
    widget,
    telegramAppUrl: options.telegramAppUrl ?? null,
    chatWidget: options.chatWidget ?? false,
    onReferrerRewarded: options.onReferrerRewarded,
  });
  if (options.serveClient) await registerClient(app);

  // Перед остановкой HTTP закрываем все сокеты, иначе server.close() будет ждать их вечно.
  app.addHook('preClose', async () => {
    disposeSockets();
    io.disconnectSockets(true);
    io.engine.close();
  });

  return { app, io, rooms, players, stats, shop, skins, widget };
}
