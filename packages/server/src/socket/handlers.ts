import {
  GameRuleError,
  colorSchema,
  createRoomSchema,
  joinRoomSchema,
  kickSchema,
  updateSettingsSchema,
  type Ack,
  type ClientToServerEvents,
  type Rng,
  type ServerToClientEvents,
  type SocketData,
} from '@gamedeck/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Server } from 'socket.io';
import { ZodError } from 'zod';
import { AppError } from '../errors.js';
import type { Room } from '../rooms/room.js';
import type { RoomManager } from '../rooms/room-manager.js';
import type { PlayerService } from '../players/player-service.js';
import type { StatsService } from '../stats/stats-service.js';

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface HandlerDeps {
  io: GameServer;
  rooms: RoomManager;
  players: PlayerService;
  stats: StatsService;
  rng: Rng;
  disconnectGraceMs: number;
  log: FastifyBaseLogger;
}

/** Канал Socket.IO со всеми вкладками одного игрока. */
const playerChannel = (playerId: string) => `player:${playerId}`;
/** Канал Socket.IO с участниками комнаты. */
const roomChannel = (code: string) => `room:${code}`;

/** Превратить любое исключение в ответ клиенту. Неожиданные ошибки — в лог, наружу — общий текст. */
function toErrorResult(err: unknown, log: FastifyBaseLogger) {
  if (err instanceof AppError || err instanceof GameRuleError) {
    return { ok: false as const, error: { code: err.code, message: err.message } };
  }
  if (err instanceof ZodError) {
    return { ok: false as const, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message ?? 'Неверные данные' } };
  }
  log.error({ err }, 'unexpected handler error');
  return { ok: false as const, error: { code: 'INTERNAL', message: 'Что-то пошло не так' } };
}

/** Подключает обработчики событий. Возвращает функцию очистки таймеров (для остановки сервера). */
export function registerSocketHandlers(deps: HandlerDeps): () => void {
  const { io, rooms, players, stats, rng, log } = deps;
  const leaveTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Разослать состояние комнаты. Не одним сообщением на канал комнаты, а
   * каждому игроку своё: в перудо у каждого свой набор видимых кубиков.
   */
  const broadcast = (room: Room | undefined) => {
    if (!room) return;
    for (const id of room.players.keys()) {
      io.to(playerChannel(id)).emit('room:state', room.toView(id));
    }

    // Партия только что закончилась — сохраняем её в базу.
    const result = room.takeResult();
    if (result) {
      // Игру не задерживаем ожиданием базы: итог уже у игроков, рейтинг придёт следом.
      stats
        .recordMatch(result)
        .then((record) => io.to(roomChannel(room.code)).emit('match:recorded', record))
        .catch((err: unknown) => log.error({ err, room: room.code }, 'failed to record match'));
    }
  };

  /** Имя из формы входа сохраняем в профиль, чтобы оно было в таблице лидеров. */
  const saveName = (playerId: string, name: string) => {
    players.rename(playerId, name).catch((err: unknown) => log.error({ err }, 'failed to save name'));
  };

  /**
   * Обёртка для каждого события: найти ack, вызвать обработчик, поймать ошибку.
   * Благодаря ей обработчики ниже — это 2–3 строки чистой логики.
   */
  const handle =
    <T>(fn: (args: unknown[]) => T | Promise<T>) =>
    async (...args: unknown[]) => {
      const ack = args.at(-1);
      if (typeof ack !== 'function') return; // клиент без ack — игнорируем
      try {
        (ack as Ack<T>)({ ok: true, data: await fn(args) });
      } catch (err) {
        (ack as Ack<T>)(toErrorResult(err, log));
      }
    };

  // Middleware: выполняется до 'connection'. Здесь определяем, кто подключился.
  io.use(async (socket, next) => {
    try {
      const session = await players.resolveSession(socket.handshake.auth?.token);
      socket.data.playerId = session.playerId;
      socket.data.token = session.token;
      next();
    } catch (err) {
      log.error({ err }, 'session error');
      next(new Error('SESSION_UNAVAILABLE'));
    }
  });

  io.on('connection', (socket) => {
    const playerId = socket.data.playerId;
    socket.emit('session', { token: socket.data.token, playerId });
    void socket.join(playerChannel(playerId));

    // Переподключение: вернуть игрока в его комнату.
    clearTimeout(leaveTimers.get(playerId));
    leaveTimers.delete(playerId);
    const current = rooms.roomOf(playerId);
    if (current) {
      void socket.join(roomChannel(current.code));
      current.setConnected(playerId, true);
      broadcast(current);
    }

    const enterRoom = (room: Room) => {
      io.in(playerChannel(playerId)).socketsJoin(roomChannel(room.code));
      broadcast(room);
      return room.toView(playerId);
    };

    const exitRoom = (code: string, targetId: string) => {
      io.in(playerChannel(targetId)).socketsLeave(roomChannel(code));
    };

    socket.on(
      'room:create',
      handle(async ([input]) => {
        const { name, color, settings } = createRoomSchema.parse(input);
        const dice = await players.diceStyle(playerId);
        const previous = rooms.roomOf(playerId);
        if (previous) exitRoom(previous.code, playerId);
        const room = rooms.create({ id: playerId, name, color, dice }, settings);
        saveName(playerId, name);
        broadcast(previous);
        return enterRoom(room);
      }),
    );

    socket.on(
      'room:join',
      handle(async ([input]) => {
        const { code, name, password, color } = joinRoomSchema.parse(input);
        const dice = await players.diceStyle(playerId);
        const previous = rooms.roomOf(playerId);
        const room = rooms.join({ id: playerId, name, color, dice }, code, password);
        saveName(playerId, name);
        if (previous && previous !== room) {
          exitRoom(previous.code, playerId);
          broadcast(previous);
        }
        return enterRoom(room);
      }),
    );

    socket.on(
      'room:leave',
      handle(() => {
        const code = rooms.roomOf(playerId)?.code;
        if (code) exitRoom(code, playerId);
        broadcast(rooms.leave(playerId));
        return null;
      }),
    );

    socket.on(
      'room:settings',
      handle(([input]) => {
        const room = requireRoom(rooms, playerId);
        room.updateSettings(playerId, updateSettingsSchema.parse(input));
        broadcast(room);
        return room.toView(playerId);
      }),
    );

    socket.on(
      'room:kick',
      handle(([input]) => {
        const { playerId: targetId } = kickSchema.parse(input);
        const room = rooms.kick(playerId, targetId);
        exitRoom(room.code, targetId);
        io.to(playerChannel(targetId)).emit('room:kicked', { code: room.code });
        broadcast(room);
        return room.toView(playerId);
      }),
    );

    socket.on(
      'room:color',
      handle(([input]) => {
        const { color } = colorSchema.parse(input);
        const room = requireRoom(rooms, playerId);
        room.setColor(playerId, color);
        broadcast(room);
        return room.toView(playerId);
      }),
    );

    socket.on(
      'game:start',
      handle(() => {
        const room = requireRoom(rooms, playerId);
        room.startGame(playerId, rng);
        broadcast(room);
        return room.toView(playerId);
      }),
    );

    socket.on(
      'game:move',
      handle(([input]) => {
        const room = requireRoom(rooms, playerId);
        // Схему хода проверяет комната — она знает, какая игра сейчас идёт.
        room.move(playerId, input, rng);
        broadcast(room);
        return room.toView(playerId);
      }),
    );

    socket.on('disconnect', async () => {
      // У игрока может быть открыто несколько вкладок: офлайн — только когда закрылась последняя.
      const stillOnline = (await io.in(playerChannel(playerId)).fetchSockets()).length > 0;
      const room = rooms.roomOf(playerId);
      if (stillOnline || !room) return;

      room.setConnected(playerId, false);
      broadcast(room);

      // Даём время вернуться (перезагрузка, плохая связь). Не вернулся — уходит из комнаты.
      leaveTimers.set(
        playerId,
        setTimeout(() => {
          leaveTimers.delete(playerId);
          const code = rooms.roomOf(playerId)?.code;
          if (code) exitRoom(code, playerId);
          broadcast(rooms.leave(playerId));
        }, deps.disconnectGraceMs),
      );
    });
  });

  return () => leaveTimers.forEach(clearTimeout);
}

function requireRoom(rooms: RoomManager, playerId: string): Room {
  const room = rooms.roomOf(playerId);
  if (!room) throw new AppError('NOT_IN_ROOM', 'Вы не в комнате');
  return room;
}
