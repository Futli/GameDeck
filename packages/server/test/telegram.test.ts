import type { AddressInfo } from 'node:net';
import type { ClientToServerEvents, RoomView, ServerToClientEvents, SessionInfo } from '@gamedeck/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { PlayerService } from '../src/players/player-service.js';
import { InitDataError, signInitData, verifyInitData, type TelegramUser } from '../src/telegram/init-data.js';
import { testDatabase } from './helpers.js';

const BOT_TOKEN = '123456:TEST-token';
const now = new Date('2026-10-31T12:00:00Z');
const authDate = String(Math.floor(now.getTime() / 1000));

/** Telegram id уникален в базе, поэтому каждому тесту — свой пользователь. */
let nextId = 1000;
const tgUser = (extra: Partial<TelegramUser> = {}): TelegramUser => ({
  id: nextId++,
  first_name: 'Лёха',
  last_name: 'Тестов',
  photo_url: 'https://t.me/i/userpic/320/test.jpg',
  ...extra,
});
const initDataFor = (user: TelegramUser, extra: Record<string, string> = {}) =>
  signInitData({ auth_date: authDate, user: JSON.stringify(user), ...extra }, BOT_TOKEN);

describe('проверка initData', () => {
  const opts = { botToken: BOT_TOKEN, maxAgeSec: 3600, now };

  it('принимает подпись Telegram и достаёт пользователя и start_param', () => {
    const user = tgUser();
    const launch = verifyInitData(initDataFor(user, { start_param: 'K7M2Q', query_id: 'AAE' }), opts);
    expect(launch.user).toEqual(user);
    expect(launch.startParam).toBe('K7M2Q');
  });

  it('отклоняет подделанные поля', () => {
    const raw = new URLSearchParams(initDataFor(tgUser()));
    raw.set('user', JSON.stringify(tgUser({ id: 1 })));
    expect(() => verifyInitData(raw.toString(), opts)).toThrow(InitDataError);
  });

  it('отклоняет подпись чужого бота', () => {
    const raw = signInitData({ auth_date: authDate, user: JSON.stringify(tgUser()) }, '999:other');
    expect(() => verifyInitData(raw, opts)).toThrow(/подпись/);
  });

  it('отклоняет устаревшую initData', () => {
    const later = new Date(now.getTime() + 2 * 3600_000);
    expect(() => verifyInitData(initDataFor(tgUser()), { ...opts, now: later })).toThrow(/устарела/);
  });

  it('отклоняет строку без подписи', () => {
    expect(() => verifyInitData('auth_date=1&user=%7B%7D', opts)).toThrow(/нет подписи/);
  });
});

describe('игрок из Telegram', () => {
  let players: PlayerService;

  beforeAll(async () => {
    players = new PlayerService((await testDatabase()).db, 500);
  });

  it('один telegram id — один профиль, имя и аватар обновляются', async () => {
    const user = tgUser();
    const first = await players.resolveTelegram(user, undefined);
    const second = await players.resolveTelegram({ ...user, first_name: 'Алексей', photo_url: undefined }, undefined);
    expect(second.playerId).toBe(first.playerId);
    // Без старого токена — новая сессия, но игрок тот же.
    expect(second.token).not.toBe(first.token);

    const profile = await players.profile(first.playerId);
    expect(profile).toMatchObject({ displayName: 'Алексей Тестов', avatarUrl: null });
  });

  it('анонимный игрок с токеном привязывается к Telegram и не теряет профиль', async () => {
    const anon = await players.register();
    const linked = await players.resolveTelegram(tgUser(), anon.token);
    expect(linked).toEqual(anon);
    expect(await players.avatarUrl(anon.playerId)).toBe('https://t.me/i/userpic/320/test.jpg');
  });

  it('чужой токен не перепривязывает уже привязанного игрока', async () => {
    const owner = await players.resolveTelegram(tgUser(), undefined);
    const stranger = await players.resolveTelegram(tgUser(), owner.token);
    expect(stranger.playerId).not.toBe(owner.playerId);
  });
});

describe('вход через Telegram по сокету', () => {
  let url: string;
  let close: () => Promise<void>;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const { db } = await testDatabase();
    // maxAgeSec большой: в тесте подпись сделана «на 2026-10-31», а часы идут настоящие.
    const { app } = await buildApp({ db, telegram: { botToken: BOT_TOKEN, maxAgeSec: 10 ** 9 } });
    await app.listen({ host: '127.0.0.1', port: 0 });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    close = () => app.close();
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await close();
  });

  const open = (auth: Record<string, unknown>) => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connect(url, { auth, transports: ['websocket'] });
    sockets.push(socket);
    return socket;
  };

  it('проверенный игрок садится за стол со своим аватаром', async () => {
    const socket = open({ initData: initDataFor(tgUser()) });
    await new Promise<SessionInfo>((resolve) => socket.once('session', resolve));
    const result = await socket.emitWithAck('room:create', { name: 'Лёха' });
    expect(result.ok).toBe(true);
    const room = (result as { data: RoomView }).data;
    expect(room.players[0]?.avatarUrl).toBe('https://t.me/i/userpic/320/test.jpg');
  });

  it('поддельная initData — отказ в подключении', async () => {
    const forged = signInitData({ auth_date: authDate, user: JSON.stringify(tgUser()) }, '999:other');
    const socket = open({ initData: forged });
    const error = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
    expect(error.message).toBe('TELEGRAM_AUTH_FAILED');
  });
});
