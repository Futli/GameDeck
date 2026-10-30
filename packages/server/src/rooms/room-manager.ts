import type { RoomSettings } from '@gamedeck/shared';
import { RoomError } from '../errors.js';
import { Room } from './room.js';

// Без 0/O и 1/I, чтобы код было легко продиктовать.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

/**
 * Реестр всех комнат процесса. Отвечает на вопросы «какая комната по коду»
 * и «в какой комнате этот игрок». Один игрок — одна комната.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly roomOfPlayer = new Map<string, string>();

  constructor(private readonly random: () => number = Math.random) {}

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.roomOfPlayer.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  create(player: { id: string; name: string }, settings?: Partial<RoomSettings>): Room {
    this.leave(player.id);
    const room = new Room(this.newCode(), player, settings);
    this.rooms.set(room.code, room);
    this.roomOfPlayer.set(player.id, room.code);
    return room;
  }

  join(player: { id: string; name: string }, code: string, password?: string): Room {
    const room = this.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Комната не найдена');
    if (this.roomOfPlayer.get(player.id) !== room.code) this.leave(player.id);
    room.addPlayer(player.id, player.name, password);
    this.roomOfPlayer.set(player.id, room.code);
    return room;
  }

  /** Вывести игрока из его комнаты. Возвращает комнату, если в ней кто-то остался. */
  leave(playerId: string): Room | undefined {
    const room = this.roomOf(playerId);
    if (!room) return undefined;
    room.removePlayer(playerId);
    return this.afterRemoval(room, playerId);
  }

  kick(byId: string, targetId: string): Room {
    const room = this.roomOf(byId);
    if (!room) throw new RoomError('NOT_IN_ROOM', 'Вы не в комнате');
    room.kick(byId, targetId);
    this.afterRemoval(room, targetId);
    return room;
  }

  private afterRemoval(room: Room, playerId: string): Room | undefined {
    this.roomOfPlayer.delete(playerId);
    if (room.isEmpty) {
      this.rooms.delete(room.code);
      return undefined;
    }
    return room;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }
}
