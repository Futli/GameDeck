import type { AddressInfo } from 'node:net';
import type {
  ClientToServerEvents,
  MatchRecord,
  PerudoView,
  RoomSummary,
  RoomView,
  ServerToClientEvents,
  SessionInfo,
} from '@gamedeck/shared';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/client.js';
import type { PlayerService } from '../src/players/player-service.js';
import { widgetPlayers } from '../src/db/schema.js';
import { REFERRAL_BONUS_ROLLS, type WidgetService } from '../src/widget/widget-service.js';
import { testDatabase } from './helpers.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Сквозной тест: настоящий сервер на случайном порту и настоящие клиенты Socket.IO. */
describe('socket protocol', () => {
  let url: string;
  let close: () => Promise<void>;
  let db: Db;
  let widget: WidgetService;
  let players: PlayerService;
  const clients: Client[] = [];

  beforeEach(async () => {
    // Каждый бросок = 6, поэтому первый раунд всегда ничья — проверим переброс.
    let roll = 0;
    const faces = [6, 6, 3, 5];
    db = (await testDatabase()).db;
    const built = await buildApp({
      db,
      rng: () => ((faces[roll++ % faces.length] ?? 1) - 1) / 6,
      disconnectGraceMs: 50,
      // Ставкам нужны монеты; по умолчанию новичок начинает с нуля.
      startingCoins: 500,
    });
    const { app } = built;
    widget = built.widget;
    players = built.players;
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

    // Хост начинает — у всех модалка, партия стартует, когда подтвердит Боб.
    const waiting = await call<RoomView>(a.socket.emitWithAck('game:start'));
    expect(waiting).toMatchObject({ status: 'lobby', readyCheck: { reason: 'start', ready: [a.session.playerId] } });
    expect((await call<RoomView>(b.socket.emitWithAck('room:ready'))).status).toBe('playing');
    const recorded = new Promise<MatchRecord>((resolve) => a.socket.once('match:recorded', resolve));
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
    expect(view.readyCheck).toMatchObject({ reason: 'rematch', ready: [] });

    // После партии сервер пишет её в базу и рассылает изменение рейтинга.
    const record = await recorded;
    const bob = record.players.find((p) => p.playerId === b.session.playerId);
    expect(bob).toMatchObject({ place: 1, ratingBefore: 1000, ratingAfter: 1016 });

    // Профиль Боба на главном экране: имя из формы и сыгранная партия.
    const me = await fetch(`${url}/api/me`, { headers: { authorization: `Bearer ${b.session.token}` } });
    expect(await me.json()).toMatchObject({ displayName: 'Боб', gamesPlayed: 1, wins: 1 });
    expect((await fetch(`${url}/api/me`)).status).toBe(401);
  });

  /** Кто пригласил игрока (null — никто). */
  const referrerOf = async (playerId: string) => {
    const [row] = await db.select().from(widgetPlayers).where(eq(widgetPlayers.playerId, playerId));
    return row?.referredBy ?? null;
  };
  /** Бонусные броски в виджете: ими награждают за приглашённого друга. */
  const bonusRolls = async (playerId: string) => (await widget.state(playerId, 1000)).a;

  it('новичок по ссылке-приглашению засчитывается поделившемуся, награда — после первой партии', async () => {
    const host = await client();
    const sharer = await client();
    const friend = await client();
    const created = await call<RoomView>(host.socket.emitWithAck('room:create', { name: 'Алиса' }));
    await call(sharer.socket.emitWithAck('room:join', { code: created.code, name: 'Вера' }));
    // Ссылкой поделилась Вера, а не хост: засчитывается она.
    const invite = await players.referralCode(sharer.session.playerId);
    await call(friend.socket.emitWithAck('room:join', { code: created.code, name: 'Боб', invite }));
    expect(await referrerOf(friend.session.playerId)).toBe(sharer.session.playerId);
    // Сам вход в комнату награды не даёт.
    expect(await bonusRolls(sharer.session.playerId)).toBe(0);

    // Вера уходит, Алиса и Боб играют партию: 6:6, затем 3:5.
    await call(sharer.socket.emitWithAck('room:leave'));
    await call(host.socket.emitWithAck('game:start'));
    await call(friend.socket.emitWithAck('room:ready'));
    for (let round = 0; round < 2; round++) {
      await call(host.socket.emitWithAck('game:move', { type: 'roll' }));
      await call(friend.socket.emitWithAck('game:move', { type: 'roll' }));
    }

    await expect.poll(() => bonusRolls(sharer.session.playerId)).toBe(REFERRAL_BONUS_ROLLS);
    expect(await bonusRolls(friend.session.playerId)).toBe(REFERRAL_BONUS_ROLLS);
    // Хост никого не приглашал.
    expect(await bonusRolls(host.session.playerId)).toBe(0);
  });

  it('код руками засчитывается хосту, вход из списка комнат — не приглашение', async () => {
    const host = await client();
    const typed = await client();
    const fromList = await client();
    const broken = await client();
    const created = await call<RoomView>(host.socket.emitWithAck('room:create', { name: 'Алиса' }));

    await call(typed.socket.emitWithAck('room:join', { code: created.code, name: 'Боб', invite: 'code' }));
    expect(await referrerOf(typed.session.playerId)).toBe(host.session.playerId);

    await call(fromList.socket.emitWithAck('room:join', { code: created.code, name: 'Вера' }));
    expect(await referrerOf(fromList.session.playerId)).toBeNull();

    const bad = await broken.socket.emitWithAck('room:join', { code: created.code, name: 'Гена', invite: 'ref_x' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
  });

  it('главная Mini App: тот же виджет «Кубик удачи» и броски по HTTP', async () => {
    const a = await client();
    const auth = { authorization: `Bearer ${a.session.token}` };
    expect((await fetch(`${url}/api/me/widget?lang=ru`)).status).toBe(401);

    const page = (await (await fetch(`${url}/api/me/widget?lang=en`, { headers: auth })).json()) as {
      html: string;
      chatData: string;
    };
    expect(page.html).toContain('TelegramWidget');
    expect(page.html).toContain('Roll');
    expect(JSON.parse(page.chatData)).toMatchObject({ r: 3, b: 500 });

    const query = (d: string) =>
      fetch(`${url}/api/me/widget/query`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ d, lang: 'ru' }),
      }).then((r) => r.json() as Promise<{ result: string; chatData: string }>);
    const rolled = await query('r');
    const answer = JSON.parse(rolled.result) as { d: number[]; c: number; b: number };
    expect(answer.d).toHaveLength(3);
    expect(answer.b).toBe(500 + answer.c);
    expect(JSON.parse(rolled.chatData)).toMatchObject({ r: 2, b: answer.b });
    expect(JSON.parse((await query('zz')).result)).toEqual({ e: 'FAILED' });
  });

  it('пароль комнаты приходит сидящим в ней для ссылки-приглашения', async () => {
    const a = await client();
    const b = await client();
    const created = await call<RoomView>(
      a.socket.emitWithAck('room:create', { name: 'Алиса', settings: { password: 'pw' } }),
    );
    expect(created.invitePassword).toBe('pw');
    const joined = await call<RoomView>(
      b.socket.emitWithAck('room:join', { code: created.code, name: 'Боб', password: 'pw' }),
    );
    expect(joined.invitePassword).toBe('pw');
    // Посторонний по HTTP видит только, что пароль есть.
    const preview = (await (await fetch(`${url}/api/rooms/${created.code}`)).json()) as Record<string, unknown>;
    expect(preview).toMatchObject({ hasPassword: true });
    expect(JSON.stringify(preview)).not.toContain('pw"');
  });

  it('главная видит список комнат и его обновления', async () => {
    const a = await client();
    const watcher = await client();
    expect(await call(watcher.socket.emitWithAck('rooms:watch'))).toEqual([]);

    const updated = new Promise<RoomSummary[]>((resolve) => watcher.socket.once('rooms:list', resolve));
    const created = await call<RoomView>(a.socket.emitWithAck('room:create', { name: 'Алиса' }));
    expect(await updated).toMatchObject([{ code: created.code, hostName: 'Алиса', players: 1 }]);

    // Хост поставил пароль — комната пропадает из списка, но по коду с паролем в неё входят.
    const hidden = new Promise<RoomSummary[]>((resolve) => watcher.socket.once('rooms:list', resolve));
    await call(a.socket.emitWithAck('room:settings', { password: 'pw' }));
    expect(await hidden).toEqual([]);

    const wrong = await watcher.socket.emitWithAck('room:join', { code: created.code, name: 'Боб', password: 'x' });
    expect(wrong).toMatchObject({ ok: false, error: { code: 'WRONG_PASSWORD' } });
    await call(watcher.socket.emitWithAck('room:join', { code: created.code, name: 'Боб', password: 'pw' }));
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
    expect(await kicked).toEqual({ code: room.code, reason: 'host' });
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

  it('перудо по сети: чужие кубики не уходят на клиент', async () => {
    const a = await client();
    const b = await client();
    const room = await call<RoomView>(
      a.socket.emitWithAck('room:create', { name: 'Алиса', color: 'blue', settings: { gameId: 'perudo' } }),
    );
    await call(b.socket.emitWithAck('room:join', { code: room.code, name: 'Боб', color: 'blue' }));

    await call(a.socket.emitWithAck('game:start'));
    await call(b.socket.emitWithAck('room:ready'));
    // Раунд начинается с броска: каждый бросает сам, без очереди.
    await call(b.socket.emitWithAck('game:move', { type: 'roll' }));
    const bobState = new Promise<RoomView>((resolve) => b.socket.once('room:state', resolve));
    const forAlice = await call<RoomView>(a.socket.emitWithAck('game:move', { type: 'roll' }));
    const forBob = await bobState;
    const aliceId = a.session.playerId;
    const bobId = b.session.playerId;

    expect(forAlice.players.map((p) => p.color)).toEqual(['blue', 'red']);
    const aliceHands = (forAlice.game?.state as PerudoView).hands;
    const bobHands = (forBob.game?.state as PerudoView).hands;
    expect(aliceHands[aliceId]?.dice).toHaveLength(5);
    expect(aliceHands[bobId]).toEqual({ count: 5, dice: null });
    expect(bobHands[aliceId]?.dice).toBeNull();
    expect(bobHands[bobId]?.dice).toHaveLength(5);

    const badMove = await a.socket.emitWithAck('game:move', { type: 'bid', quantity: 0, face: 9 } as never);
    expect(badMove).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    await call(a.socket.emitWithAck('game:move', { type: 'bid', quantity: 2, face: 3 }));
    const view = await call<RoomView>(b.socket.emitWithAck('game:move', { type: 'dudo' }));
    expect((view.game?.state as PerudoView).lastReveal?.dice[aliceId]).toHaveLength(5);
  });
});
