import { DEFAULT_DICE_STYLE } from '@gamedeck/shared';
import { describe, expect, it } from 'vitest';
import type { PerudoView } from '@gamedeck/shared';
import { RoomManager } from '../src/rooms/room-manager.js';

const alice = { id: 'alice', name: 'Алиса' };
const bob = { id: 'bob', name: 'Боб' };
const carol = { id: 'carol', name: 'Кэрол' };

describe('RoomManager', () => {
  it('создаёт комнату с кодом из 5 символов, создатель — хост', () => {
    const rooms = new RoomManager();
    const room = rooms.create(alice);
    expect(room.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(room.toView().players).toEqual([
      { id: 'alice', name: 'Алиса', seat: 0, color: 'red', dice: DEFAULT_DICE_STYLE, isHost: true, connected: true },
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

    room.startGame('alice', Math.random);
    expect(room.status).toBe('playing');
    expect(() => rooms.join(carol, room.code)).toThrow('Игра уже идёт');

    const six = () => 5 / 6;
    const one = () => 0;
    room.move('alice', { type: 'roll' }, one);
    room.move('bob', { type: 'roll' }, six);
    expect(room.status).toBe('finished');
    expect(room.toView().game?.winnerId).toBe('bob');

    room.startGame('alice', Math.random);
    expect(room.status).toBe('playing');
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
    room.startGame('alice', Math.random);

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
    room.startGame('alice', Math.random);

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
});
