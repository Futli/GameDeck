import {
  GameRuleError,
  MAX_PLAYERS,
  games,
  type GameModule,
  type RoomSettings,
  type RoomStatus,
  type RoomView,
  type Rng,
} from '@gamedeck/shared';
import { RoomError } from '../errors.js';

interface Player {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
}

interface ActiveGame {
  module: GameModule<unknown, unknown>;
  state: unknown;
}

export const defaultSettings: RoomSettings = {
  gameId: 'dice-high',
  stake: 0,
  password: null,
  maxPlayers: MAX_PLAYERS,
};

/**
 * Одна комната: игроки, хост, настройки и текущая партия.
 * Здесь вся проверка прав («только хост», «не во время игры»), но нет сокетов —
 * поэтому комнату легко тестировать без сети.
 */
export class Room {
  readonly players = new Map<string, Player>();
  hostId: string;
  settings: RoomSettings;
  status: RoomStatus = 'lobby';
  private game: ActiveGame | null = null;

  constructor(
    readonly code: string,
    host: { id: string; name: string },
    settings: Partial<RoomSettings> = {},
  ) {
    this.settings = { ...defaultSettings, ...settings, password: settings.password || null };
    this.hostId = host.id;
    this.players.set(host.id, { id: host.id, name: host.name, seat: 0, connected: true });
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  addPlayer(id: string, name: string, password?: string): void {
    if (this.players.has(id)) return; // повторный вход — не ошибка
    if (this.status === 'playing') throw new RoomError('GAME_IN_PROGRESS', 'Игра уже идёт');
    if (this.settings.password && this.settings.password !== password) {
      throw new RoomError('WRONG_PASSWORD', 'Неверный пароль');
    }
    if (this.players.size >= this.settings.maxPlayers) {
      throw new RoomError('ROOM_FULL', 'Комната заполнена');
    }
    this.players.set(id, { id, name, seat: this.freeSeat(), connected: true });
  }

  /** Убрать игрока (вышел сам, кикнули или не вернулся после обрыва связи). */
  removePlayer(id: string): void {
    if (!this.players.delete(id)) return;

    if (this.game && this.status === 'playing') {
      this.game.state = this.game.module.removePlayer(this.game.state, id);
      this.syncStatus();
    }
    if (this.hostId === id) {
      // Хостом становится следующий по месту за столом.
      const next = [...this.players.values()].sort((a, b) => a.seat - b.seat)[0];
      if (next) this.hostId = next.id;
    }
  }

  setConnected(id: string, connected: boolean): void {
    const player = this.players.get(id);
    if (player) player.connected = connected;
  }

  updateSettings(byId: string, patch: Partial<RoomSettings>): void {
    this.assertHost(byId);
    if (this.status === 'playing') throw new RoomError('GAME_IN_PROGRESS', 'Нельзя менять настройки во время игры');
    const next = { ...this.settings, ...patch };
    if ('password' in patch) next.password = patch.password || null;
    if (next.maxPlayers < this.players.size) {
      throw new RoomError('TOO_MANY_PLAYERS', 'В комнате уже больше игроков, чем новый лимит');
    }
    this.settings = next;
  }

  kick(byId: string, targetId: string): void {
    this.assertHost(byId);
    if (byId === targetId) throw new RoomError('BAD_TARGET', 'Нельзя исключить себя');
    if (!this.players.has(targetId)) throw new RoomError('NOT_FOUND', 'Игрок не найден');
    this.removePlayer(targetId);
  }

  startGame(byId: string): void {
    this.assertHost(byId);
    if (this.status === 'playing') throw new RoomError('GAME_IN_PROGRESS', 'Игра уже идёт');
    const module = games[this.settings.gameId];
    if (!module) throw new RoomError('UNKNOWN_GAME', 'Неизвестная игра');
    if (this.players.size < module.minPlayers) {
      throw new RoomError('NOT_ENOUGH_PLAYERS', `Нужно минимум ${module.minPlayers} игрока`);
    }
    // Порядок ходов — по местам за столом, по часовой стрелке.
    const order = [...this.players.values()].sort((a, b) => a.seat - b.seat).map((p) => p.id);
    this.game = { module, state: module.start(order) };
    this.status = 'playing';
  }

  move(byId: string, move: unknown, rng: Rng): void {
    if (!this.game || this.status !== 'playing') throw new RoomError('NO_GAME', 'Игра не идёт');
    try {
      this.game.state = this.game.module.applyMove(this.game.state, byId, move, rng);
    } catch (err) {
      if (err instanceof GameRuleError) throw new RoomError(err.code, err.message);
      throw err;
    }
    this.syncStatus();
  }

  toView(): RoomView {
    const { password, ...settings } = this.settings;
    const game = this.game;
    return {
      code: this.code,
      status: this.status,
      settings: { ...settings, hasPassword: password !== null },
      players: [...this.players.values()]
        .sort((a, b) => a.seat - b.seat)
        .map((p) => ({ ...p, isHost: p.id === this.hostId })),
      game: game && {
        gameId: game.module.id,
        state: game.state,
        currentPlayerId: game.module.currentPlayer(game.state),
        winnerId: game.module.winner(game.state),
      },
    };
  }

  private syncStatus(): void {
    if (this.game && this.game.module.winner(this.game.state) !== null) this.status = 'finished';
  }

  private assertHost(id: string): void {
    if (id !== this.hostId) throw new RoomError('NOT_HOST', 'Это может сделать только хост');
  }

  private freeSeat(): number {
    const taken = new Set([...this.players.values()].map((p) => p.seat));
    for (let seat = 0; seat < MAX_PLAYERS; seat++) if (!taken.has(seat)) return seat;
    throw new RoomError('ROOM_FULL', 'Комната заполнена');
  }
}
