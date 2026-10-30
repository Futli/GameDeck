import type { AddressInfo } from 'node:net';
import type { ClientToServerEvents, RoomView, ServerToClientEvents, SessionInfo } from '@gamedeck/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Сквозной тест: настоящий сервер на случайном порту и настоящие клиенты Socket.IO. */
describe('socket protocol', () => {
  let url: string;
  let close: () => Promise<void>;
  const clients: Client[] = [];

  beforeEach(async () => {
    // Каждый бросок = 6, поэтому первый раунд всегда ничья — проверим переброс.
    let roll = 0;
    const faces = [6, 6, 3, 5];
    const { app } = buildApp({ rng: () => ((faces[roll++ % faces.length] ?? 1) - 1) / 6, disconnectGraceMs: 50 });
    await app.listen({ host: '127.0.0.1', port: 0 });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    close = () => app.close();
  });

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.disconnect());
    await close();
  });

  const client = async (token?: string) => {
    const socket: Client = connect(url, { auth: token ? { token } : {}, transports: ['websocket'] });
    clients.push(socket);
    // Подписываемся до подключения: при переподключении состояние комнаты приходит сразу за session.
    const firstState = new Promise<RoomView>((resolve) => socket.once('room:state', resolve));
    const session = await new Promise<SessionInfo>((resolve) => socket.once('session', resolve));
    return { socket, session, firstState };
  };

  const call = async <T>(promise: Promise<{ ok: true; data: T } | { ok: false; error: { code: string } }>) => {
    const result = await promise;
    if (!result.ok) throw new Error(result.error.code);
    return result.data;
  };

  it('полная партия: создать, войти, сыграть, узнать победителя', async () => {
    const a = await client();
    const b = await client();

    const created = await call<RoomView>(a.socket.emitWithAck('room:create', { name: 'Алиса' }));
    const bobSees = new Promise<RoomView>((resolve) => b.socket.on('room:state', resolve));
    await call(b.socket.emitWithAck('room:join', { code: created.code, name: 'Боб' }));
    expect((await bobSees).players).toHaveLength(2);

    const notHost = await b.socket.emitWithAck('game:start');
    expect(notHost).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });

    await call(a.socket.emitWithAck('game:start'));
    const outOfTurn = await b.socket.emitWithAck('game:move', { type: 'roll' });
    expect(outOfTurn).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });

    // Раунд 1: 6 и 6 — ничья. Раунд 2: 3 и 5 — побеждает Боб.
    await call(a.socket.emitWithAck('game:move', { type: 'roll' }));
    let view = await call<RoomView>(b.socket.emitWithAck('game:move', { type: 'roll' }));
    expect(view.game?.winnerId).toBeNull();
    await call(a.socket.emitWithAck('game:move', { type: 'roll' }));
    view = await call<RoomView>(b.socket.emitWithAck('game:move', { type: 'roll' }));

    expect(view.status).toBe('finished');
    expect(view.game?.winnerId).toBe(b.session.playerId);
  });

  it('отклоняет кривые данные через zod', async () => {
    const a = await client();
    const result = await a.socket.emitWithAck('room:create', { name: '' });
    expect(result).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
  });

  it('переподключение по токену возвращает игрока в комнату', async () => {
    const a = await client();
    const room = await call<RoomView>(a.socket.emitWithAck('room:create', { name: 'Алиса' }));
    a.socket.disconnect();

    const again = await client(a.session.token);
    expect(again.session.playerId).toBe(a.session.playerId);
    const state = await again.firstState;
    expect(state.code).toBe(room.code);
    expect(state.players[0]?.connected).toBe(true);
  });

  it('кикнутый игрок получает room:kicked', async () => {
    const a = await client();
    const b = await client();
    const room = await call<RoomView>(a.socket.emitWithAck('room:create', { name: 'Алиса' }));
    await call(b.socket.emitWithAck('room:join', { code: room.code, name: 'Боб' }));

    const kicked = new Promise((resolve) => b.socket.once('room:kicked', resolve));
    await call(a.socket.emitWithAck('room:kick', { playerId: b.session.playerId }));
    expect(await kicked).toEqual({ code: room.code });
  });

  it('отключившийся игрок помечается офлайн, а после паузы уходит из комнаты', async () => {
    const a = await client();
    const b = await client();
    const room = await call<RoomView>(a.socket.emitWithAck('room:create', { name: 'Алиса' }));
    await call(b.socket.emitWithAck('room:join', { code: room.code, name: 'Боб' }));

    const states: RoomView[] = [];
    a.socket.on('room:state', (s) => states.push(s));
    b.socket.disconnect();

    await expect.poll(() => states.at(-1)?.players.length, { timeout: 1000 }).toBe(1);
    expect(states[0]?.players.find((p) => p.id === b.session.playerId)?.connected).toBe(false);
  });
});
