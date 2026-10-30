import {
  GameRuleError,
  MAX_PLAYERS,
  PLAYER_COLORS,
  games,
  type GameModule,
  type PlayerColor,
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
  color: PlayerColor;
  connected: boolean;
}

export interface PlayerInfo {
  id: string;
  name: string;
  /** Желаемый цвет; если занят или не задан — первый свободный. */
  color?: PlayerColor;
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
    host: PlayerInfo,
    settings: Partial<RoomSettings> = {},
  ) {
    this.settings = { ...defaultSettings, ...settings, password: settings.password || null };
    this.hostId = host.id;
    this.players.set(host.id, { id: host.id, name: host.name, seat: 0, color: this.pickColor(host.color), connected: true });
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  addPlayer({ id, name, color }: PlayerInfo, password?: string): void {
    if (this.players.has(id)) return; // повторный вход — не ошибка
    if (this.status === 'playing') throw new RoomError('GAME_IN_PROGRESS', 'Игра уже идёт');
    if (this.settings.password && this.settings.password !== password) {
      throw new RoomError('WRONG_PASSWORD', 'Неверный пароль');
    }
    if (this.players.size >= this.settings.maxPlayers) {
      throw new RoomError('ROOM_FULL', 'Комната заполнена');
    }
    this.players.set(id, { id, name, seat: this.freeSeat(), color: this.pickColor(color), connected: true });
  }

  /** Сменить свой цвет на свободный. Можно и во время игры — это только внешний вид. */
  setColor(id: string, color: PlayerColor): void {
    const player = this.players.get(id);
    if (!player) throw new RoomError('NOT_IN_ROOM', 'Вы не в комнате');
    if (player.color === color) return;
    if (!this.isColorFree(color)) throw new RoomError('COLOR_TAKEN', 'Этот цвет уже занят');
    player.color = color;
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

  startGame(byId: string, rng: Rng): void {
    this.assertHost(byId);
    if (this.status === 'playing') throw new RoomError('GAME_IN_PROGRESS', 'Игра уже идёт');
    const module = games[this.settings.gameId];
    if (!module) throw new RoomError('UNKNOWN_GAME', 'Неизвестная игра');
    if (this.players.size < module.minPlayers) {
      throw new RoomError('NOT_ENOUGH_PLAYERS', `Нужно минимум ${module.minPlayers} игрока`);
    }
    // Порядок ходов — по местам за столом, по часовой стрелке.
    const order = [...this.players.values()].sort((a, b) => a.seat - b.seat).map((p) => p.id);
    this.game = { module, state: module.start(order, rng) };
    this.status = 'playing';
  }

  move(byId: string, move: unknown, rng: Rng): void {
    if (!this.game || this.status !== 'playing') throw new RoomError('NO_GAME', 'Игра не идёт');
    try {
      const { module } = this.game;
      // Ход проверяется схемой именно текущей игры: у перудо и «броска» разные ходы.
      this.game.state = module.applyMove(this.game.state, byId, module.moveSchema.parse(move), rng);
    } catch (err) {
      if (err instanceof GameRuleError) throw new RoomError(err.code, err.message);
      throw err;
    }
    this.syncStatus();
  }

  /**
   * Комната глазами игрока viewerId. Скрытую часть состояния игры (чужие
   * кубики) отрезает сам модуль игры через viewFor. viewerId = null — взгляд
   * постороннего: видно только публичное.
   */
  toView(viewerId: string | null = null): RoomView {
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
        state: game.module.viewFor ? game.module.viewFor(game.state, viewerId) : game.state,
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

  private isColorFree(color: PlayerColor): boolean {
    return ![...this.players.values()].some((p) => p.color === color);
  }

  private pickColor(wanted?: PlayerColor): PlayerColor {
    if (wanted && this.isColorFree(wanted)) return wanted;
    const free = PLAYER_COLORS.find((c) => this.isColorFree(c));
    if (!free) throw new RoomError('ROOM_FULL', 'Комната заполнена');
    return free;
  }

  private freeSeat(): number {
    const taken = new Set([...this.players.values()].map((p) => p.seat));
    for (let seat = 0; seat < MAX_PLAYERS; seat++) if (!taken.has(seat)) return seat;
    throw new RoomError('ROOM_FULL', 'Комната заполнена');
  }
}
