import { describe, expect, it } from 'vitest';
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
      { id: 'alice', name: 'Алиса', seat: 0, isHost: true, connected: true },
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
    expect(() => room.startGame('bob')).toThrow('только хост');

    rooms.kick('alice', 'bob');
    expect(rooms.roomOf('bob')).toBeUndefined();
    expect(room.players.size).toBe(1);
  });

  it('игра: старт, ходы по кругу, победитель, затем реванш', () => {
    const rooms = new RoomManager();
    const room = rooms.create(alice);
    rooms.join(bob, room.code);
    expect(() => rooms.join(carol, 'XXXXX')).toThrow('не найдена');

    room.startGame('alice');
    expect(room.status).toBe('playing');
    expect(() => rooms.join(carol, room.code)).toThrow('Игра уже идёт');

    const six = () => 5 / 6;
    const one = () => 0;
    room.move('alice', { type: 'roll' }, one);
    room.move('bob', { type: 'roll' }, six);
    expect(room.status).toBe('finished');
    expect(room.toView().game?.winnerId).toBe('bob');

    room.startGame('alice');
    expect(room.status).toBe('playing');
  });
});
