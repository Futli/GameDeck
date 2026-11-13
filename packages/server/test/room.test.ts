import { DEFAULT_DICE_STYLE } from '@gamedeck/shared';
import { describe, expect, it } from 'vitest';
import { ROOM_TIMEOUTS, type PerudoView, type Rng } from '@gamedeck/shared';
import { RoomManager } from '../src/rooms/room-manager.js';
import type { Room } from '../src/rooms/room.js';

const alice = { id: 'alice', name: 'Алиса' };
const bob = { id: 'bob', name: 'Боб' };
const carol = { id: 'carol', name: 'Кэрол' };

/** Хост начинает, остальные подтверждают — партия стартует. */
const startAll = (room: Room, rng: Rng = Math.random) => {
  room.startGame(room.hostId, rng);
  for (const id of room.players.keys()) if (room.status !== 'playing') room.setReady(id, rng);
};

/** Часы, которые двигаем руками: таймеры комнаты срабатывают без настоящего ожидания. */
const fakeClock = () => {
  let now = 1_000_000;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

describe('RoomManager', () => {
  it('создаёт комнату с кодом из 5 символов, создатель — хост', () => {
    const rooms = new RoomManager();
    const room = rooms.create(alice);
    expect(room.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(room.toView().players).toEqual([
      {
        id: 'alice',
        name: 'Алиса',
        seat: 0,
        color: 'red',
        dice: DEFAULT_DICE_STYLE,
        skins: {},
        avatarUrl: null,
        isHost: true,
        connected: true,
      },
    ]);
  });

  it('вход по коду в любом регистре, игроки садятся на свободные места', () => {
    const rooms = new RoomManager();
    const room = rooms.create(alice);
    rooms.join(bob, room.code.toLowerCase());
    expect(room.toView().players.map((p) => [p.id, p.seat])).toEqual([
      ['alice', 0],
      ['bob', 1],
    ]);
  });

  it('проверяет пароль и лимит игроков', () => {
    const rooms = new RoomManager();
    const room = rooms.create(alice, { password: 'secret', maxPlayers: 2 });
    expect(() => rooms.join(bob, room.code, 'nope')).toThrow('Неверный пароль');
    rooms.join(bob, room.code, 'secret');
    expect(() => rooms.join(carol, room.code, 'secret')).toThrow('Комната заполнена');
    expect(room.toView().settings.hasPassword).toBe(true);
    expect(JSON.stringify(room.toView())).not.toContain('secret');
  });

  it('список комнат: сначала без пароля, потом с паролем; пароль наружу не уходит', () => {
    const rooms = new RoomManager();
    const locked = rooms.create(alice, { password: 'secret' });
    const open = rooms.create(bob);
    rooms.create(carol, { password: '' }); // пустой пароль = открытая комната
    const list = rooms.list();
    expect(list.map((r) => r.hasPassword)).toEqual([false, false, true]);
    expect(list.at(-1)).toEqual({
      code: locked.code,
      status: 'lobby',
      gameId: 'dice-high',
      stake: 0,
      hasPassword: true,
      hostName: 'Алиса',
      players: 1,
      maxPlayers: 6,
    });
    expect(JSON.stringify(list)).not.toContain('secret');
    expect(list.map((r) => r.code)).toContain(open.code);
  });

  it('хост уходит — хостом становится следующий; пустая комната удаляется', () => {
    const rooms = new RoomManager();
    const room = rooms.create(alice);
    rooms.join(bob, room.code);
    rooms.leave('alice');
    expect(room.hostId).toBe('bob');
    rooms.leave('bob');
    expect(rooms.get(room.code)).toBeUndefined();
  });

  it('только хост меняет настройки, кикает и стартует', () => {
    const rooms = new RoomManager();
    const room = rooms.create(alice);
    rooms.join(bob, room.code);
    expect(() => room.updateSettings('bob', { stake: 10 })).toThrow('только хост');
    expect(() => rooms.kick('bob', 'alice')).toThrow('только хост');
    expect(() => room.startGame('bob', Math.random)).toThrow('только хост');

    rooms.kick('alice', 'bob');
    expect(rooms.roomOf('bob')).toBeUndefined();
    expect(room.players.size).toBe(1);
  });

  it('игра: старт, ходы по кругу, победитель, затем реванш', () => {
    const rooms = new RoomManager();
    const room = rooms.create(alice);
    rooms.join(bob, room.code);
    expect(() => rooms.join(carol, 'XXXXX')).toThrow('не найдена');

    startAll(room);
    expect(room.status).toBe('playing');
    expect(() => rooms.join(carol, room.code)).toThrow('Игра уже идёт');

    const six = () => 5 / 6;
    const one = () => 0;
    room.move('alice', { type: 'roll' }, one);
    room.move('bob', { type: 'roll' }, six);
    expect(room.status).toBe('finished');
    expect(room.toView().game?.winnerId).toBe('bob');
    // После партии — сразу комната ожидания: играем ещё?
    expect(room.toView().readyCheck).toMatchObject({ reason: 'rematch', ready: [], hostDecides: false });

    room.setReady('bob', Math.random);
    expect(room.status).toBe('finished');
    room.setReady('alice', Math.random);
    expect(room.status).toBe('playing');
    expect(room.toView().readyCheck).toBeNull();
  });

  it('у каждого свой цвет: желаемый, если свободен, иначе первый свободный', () => {
    const rooms = new RoomManager();
    const room = rooms.create({ ...alice, color: 'green' });
    rooms.join({ ...bob, color: 'green' }, room.code);
    rooms.join(carol, room.code);
    expect(room.toView().players.map((p) => [p.id, p.color])).toEqual([
      ['alice', 'green'],
      ['bob', 'red'],
      ['carol', 'blue'],
    ]);

    expect(() => room.setColor('bob', 'green')).toThrow('занят');
    room.setColor('bob', 'purple');
    rooms.leave('alice');
    room.setColor('carol', 'green'); // цвет ушедшего освободился
    expect(room.players.get('carol')?.color).toBe('green');
  });

  it('перудо: каждый видит только свои кубики, ход проверяется схемой игры', () => {
    const rooms = new RoomManager();
    const room = rooms.create(alice, { gameId: 'perudo' });
    rooms.join(bob, room.code);
    startAll(room);
    room.move('alice', { type: 'roll' }, Math.random);
    room.move('bob', { type: 'roll' }, Math.random);

    const forAlice = room.toView('alice').game?.state as PerudoView;
    const forBob = room.toView('bob').game?.state as PerudoView;
    expect(forAlice.hands.alice?.dice).toHaveLength(5);
    expect(forAlice.hands.bob).toEqual({ count: 5, dice: null });
    expect(forBob.hands.alice?.dice).toBeNull();
    expect(forBob.hands.bob?.dice).toHaveLength(5);

    expect(() => room.move('alice', { type: 'roll' }, Math.random)).toThrow();
    room.move('alice', { type: 'bid', quantity: 2, face: 3 }, Math.random);
    expect(room.toView().game?.currentPlayerId).toBe('bob');
  });

  it('после партии комната один раз отдаёт итог с местами; ушедший — последний', () => {
    const rooms = new RoomManager();
    const room = rooms.create(alice, { stake: 50 });
    rooms.join(bob, room.code);
    rooms.join(carol, room.code);
    startAll(room);

    room.move('alice', { type: 'roll' }, () => 0); // 1
    rooms.leave('carol'); // ушла посреди партии
    room.move('bob', { type: 'roll' }, () => 5 / 6); // 6

    const result = room.takeResult();
    expect(result).toMatchObject({ gameId: 'dice-high', stake: 50, winnerId: 'bob' });
    expect(result?.players).toEqual([
      { playerId: 'bob', seat: 1, place: 1 },
      { playerId: 'alice', seat: 0, place: 2 },
      { playerId: 'carol', seat: 2, place: 3 },
    ]);
    expect(room.takeResult()).toBeNull();
  });

  it('старт: модалка у всех, партия начинается, когда подтвердили все', () => {
    const rooms = new RoomManager(Math.random, fakeClock().now);
    const room = rooms.create(alice);
    rooms.join(bob, room.code);
    rooms.join(carol, room.code);

    room.startGame('alice', Math.random);
    expect(room.status).toBe('lobby');
    expect(room.toView().readyCheck).toMatchObject({ reason: 'start', ready: ['alice'], hostDecides: false });
    expect(room.toView().readyCheck?.msLeft).toBe(ROOM_TIMEOUTS.start);

    room.setReady('bob', Math.random);
    expect(room.status).toBe('lobby');
    room.setReady('carol', Math.random);
    expect(room.status).toBe('playing');
    expect(() => room.setReady('carol', Math.random)).toThrow('нечего подтверждать');
  });

  it('кто-то вышел из комнаты ожидания — хост решает: ждать нового или начать без него', () => {
    const rooms = new RoomManager();
    const room = rooms.create(alice, { stake: 10 });
    rooms.join(bob, room.code);
    rooms.join(carol, room.code);
    room.startGame('alice', Math.random);
    room.setReady('bob', Math.random);
    rooms.leave('carol');

    // Все оставшиеся готовы, но сами не стартуем: может, придёт кто-то ещё.
    expect(room.status).toBe('lobby');
    expect(room.toView().readyCheck?.hostDecides).toBe(true);

    // Хост поменял ставку — подтверждать заново.
    room.updateSettings('alice', { stake: 20 });
    expect(room.toView().readyCheck?.ready).toEqual(['alice']);
    expect(() => room.startGame('alice', Math.random)).toThrow('не все');
    room.setReady('bob', Math.random);
    room.startGame('alice', Math.random);
    expect(room.status).toBe('playing');
  });

  it('не подтвердил вовремя — исключён, играем без него', () => {
    const clock = fakeClock();
    const rooms = new RoomManager(Math.random, clock.now);
    const room = rooms.create(alice);
    rooms.join(bob, room.code);
    rooms.join(carol, room.code);
    room.startGame('alice', Math.random);
    room.setReady('bob', Math.random);
    expect(room.nextDeadline()).toBe(clock.now() + ROOM_TIMEOUTS.start);

    clock.advance(ROOM_TIMEOUTS.start - 1);
    expect(rooms.expire(room, Math.random)).toEqual([]);
    clock.advance(1);
    expect(rooms.expire(room, Math.random)).toEqual(['carol']);
    expect(rooms.roomOf('carol')).toBeUndefined();
    expect(room.status).toBe('playing');
  });

  it('таймер хода: за молчащего ходит правило игры, не бросивший кубики исключается', () => {
    const clock = fakeClock();
    const rooms = new RoomManager(Math.random, clock.now);
    const room = rooms.create(alice, { gameId: 'perudo', stake: 30 });
    rooms.join(bob, room.code);
    rooms.join(carol, room.code);
    startAll(room);

    // Начало раунда: все бросают вместе, на это ROOM_TIMEOUTS.roll.
    expect(room.toView().game).toMatchObject({ awaiting: ['alice', 'bob', 'carol'], currentPlayerId: null, pot: 90 });
    room.move('alice', { type: 'roll' }, Math.random);
    clock.advance(ROOM_TIMEOUTS.roll / 2);
    room.move('bob', { type: 'roll' }, Math.random);
    // Бросок одного таймер остальным не продлевает.
    clock.advance(ROOM_TIMEOUTS.roll / 2);
    expect(rooms.expire(room, Math.random)).toEqual(['carol']);
    expect(room.toView().game).toMatchObject({ awaiting: [], currentPlayerId: 'alice' });
    expect(room.toView().game?.msLeft).toBe(ROOM_TIMEOUTS.turn);

    // Алиса молчит: за неё — самая маленькая ставка, ход у Боба.
    clock.advance(ROOM_TIMEOUTS.turn);
    expect(rooms.expire(room, Math.random)).toEqual([]);
    const view = room.toView().game!;
    expect((view.state as PerudoView).bids.at(-1)).toMatchObject({ playerId: 'alice', quantity: 1, face: 2 });
    expect(view.currentPlayerId).toBe('bob');

    // Исключённая по таймеру Кэрол в итоге — среди ушедших: её ставка осталась в банке партии.
    rooms.leave('bob');
    expect(room.takeResult()?.players).toEqual([
      { playerId: 'alice', seat: 0, place: 1 },
      { playerId: 'carol', seat: 2, place: 2 },
      { playerId: 'bob', seat: 1, place: 2 },
    ]);
  });
});
