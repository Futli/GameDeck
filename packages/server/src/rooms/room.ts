import {
  DEFAULT_DICE_STYLE,
  GameRuleError,
  MAX_PLAYERS,
  PLAYER_COLORS,
  games,
  type DiceStyle,
  type GameModule,
  type PlayerColor,
  type RoomSettings,
  type RoomStatus,
  type RoomView,
  type Rng,
} from '@gamedeck/shared';
import { AppError } from '../errors.js';

interface Player {
  id: string;
  name: string;
  seat: number;
  color: PlayerColor;
  dice: DiceStyle;
  connected: boolean;
}

export interface PlayerInfo {
  id: string;
  name: string;
  /** Желаемый цвет; если занят или не задан — первый свободный. */
  color?: PlayerColor;
  /** Скин кубиков из надетых предметов; без него — классический. */
  dice?: DiceStyle;
}

interface ActiveGame {
  module: GameModule<unknown, unknown>;
  state: unknown;
  startedAt: Date;
  /** Места игроков на момент старта — для записи в историю. */
  seats: Map<string, number>;
  /** Кто ушёл посреди партии: они получают последнее место. */
  leavers: string[];
}

/** Итог партии для записи в базу. Комната отдаёт его один раз. */
export interface MatchResult {
  gameId: string;
  roomCode: string;
  stake: number;
  winnerId: string | null;
  startedAt: Date;
  finishedAt: Date;
  players: Array<{ playerId: string; seat: number; place: number }>;
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
  private pendingResult: MatchResult | null = null;

  constructor(
    readonly code: string,
    host: PlayerInfo,
    settings: Partial<RoomSettings> = {},
  ) {
    this.settings = { ...defaultSettings, ...settings, password: settings.password || null };
    this.hostId = host.id;
    this.players.set(host.id, {
      id: host.id,
      name: host.name,
      seat: 0,
      color: this.pickColor(host.color),
      dice: host.dice ?? DEFAULT_DICE_STYLE,
      connected: true,
    });
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  addPlayer({ id, name, color, dice }: PlayerInfo, password?: string): void {
    if (this.players.has(id)) return; // повторный вход — не ошибка
    if (this.status === 'playing') throw new AppError('GAME_IN_PROGRESS', 'Игра уже идёт');
    if (this.settings.password && this.settings.password !== password) {
      throw new AppError('WRONG_PASSWORD', 'Неверный пароль');
    }
    if (this.players.size >= this.settings.maxPlayers) {
      throw new AppError('ROOM_FULL', 'Комната заполнена');
    }
    this.players.set(id, {
      id,
      name,
      seat: this.freeSeat(),
      color: this.pickColor(color),
      dice: dice ?? DEFAULT_DICE_STYLE,
      connected: true,
    });
  }

  /** Сменить свой цвет на свободный. Можно и во время игры — это только внешний вид. */
  setColor(id: string, color: PlayerColor): void {
    const player = this.players.get(id);
    if (!player) throw new AppError('NOT_IN_ROOM', 'Вы не в комнате');
    if (player.color === color) return;
    if (!this.isColorFree(color)) throw new AppError('COLOR_TAKEN', 'Этот цвет уже занят');
    player.color = color;
  }

  /** Убрать игрока (вышел сам, кикнули или не вернулся после обрыва связи). */
  removePlayer(id: string): void {
    if (!this.players.delete(id)) return;

    if (this.game && this.status === 'playing') {
      this.game.leavers.push(id);
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
    if (this.status === 'playing') throw new AppError('GAME_IN_PROGRESS', 'Нельзя менять настройки во время игры');
    const next = { ...this.settings, ...patch };
    if ('password' in patch) next.password = patch.password || null;
    if (next.maxPlayers < this.players.size) {
      throw new AppError('TOO_MANY_PLAYERS', 'В комнате уже больше игроков, чем новый лимит');
    }
    this.settings = next;
  }

  kick(byId: string, targetId: string): void {
    this.assertHost(byId);
    if (byId === targetId) throw new AppError('BAD_TARGET', 'Нельзя исключить себя');
    if (!this.players.has(targetId)) throw new AppError('NOT_FOUND', 'Игрок не найден');
    this.removePlayer(targetId);
  }

  startGame(byId: string, rng: Rng): void {
    this.assertHost(byId);
    if (this.status === 'playing') throw new AppError('GAME_IN_PROGRESS', 'Игра уже идёт');
    const module = games[this.settings.gameId];
    if (!module) throw new AppError('UNKNOWN_GAME', 'Неизвестная игра');
    if (this.players.size < module.minPlayers) {
      throw new AppError('NOT_ENOUGH_PLAYERS', `Нужно минимум ${module.minPlayers} игрока`);
    }
    // Порядок ходов — по местам за столом, по часовой стрелке.
    const order = [...this.players.values()].sort((a, b) => a.seat - b.seat).map((p) => p.id);
    const players = [...this.players.values()];
    this.game = {
      module,
      state: module.start(order, rng),
      startedAt: new Date(),
      seats: new Map(players.map((p) => [p.id, p.seat])),
      leavers: [],
    };
    this.pendingResult = null;
    this.status = 'playing';
  }

  move(byId: string, move: unknown, rng: Rng): void {
    if (!this.game || this.status !== 'playing') throw new AppError('NO_GAME', 'Игра не идёт');
    try {
      const { module } = this.game;
      // Ход проверяется схемой именно текущей игры: у перудо и «броска» разные ходы.
      this.game.state = module.applyMove(this.game.state, byId, module.moveSchema.parse(move), rng);
    } catch (err) {
      if (err instanceof GameRuleError) throw new AppError(err.code, err.message);
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

  /** Забрать итог только что закончившейся партии (или null). Второй вызов вернёт null. */
  takeResult(): MatchResult | null {
    const result = this.pendingResult;
    this.pendingResult = null;
    return result;
  }

  private syncStatus(): void {
    const game = this.game;
    if (!game || this.status !== 'playing') return;
    const winnerId = game.module.winner(game.state);
    if (winnerId === null) return;

    this.status = 'finished';
    // Места: по правилам игры, затем все, кого правила не расставили, затем ушедшие.
    const leavers = new Set(game.leavers);
    const groups = game.module
      .standings(game.state)
      .map((group) => group.filter((id) => !leavers.has(id)))
      .filter((group) => group.length > 0);
    const placed = new Set(groups.flat());
    const rest = [...game.seats.keys()].filter((id) => !placed.has(id) && !leavers.has(id));
    if (rest.length > 0) groups.push(rest);
    if (leavers.size > 0) groups.push([...leavers]);

    const players: MatchResult['players'] = [];
    let place = 1;
    for (const group of groups) {
      for (const playerId of group) players.push({ playerId, seat: game.seats.get(playerId)!, place });
      place += group.length; // «спортивная» нумерация: 1, 2, 2, 4
    }
    this.pendingResult = {
      gameId: game.module.id,
      roomCode: this.code,
      stake: this.settings.stake,
      winnerId,
      startedAt: game.startedAt,
      finishedAt: new Date(),
      players,
    };
  }

  private assertHost(id: string): void {
    if (id !== this.hostId) throw new AppError('NOT_HOST', 'Это может сделать только хост');
  }

  private isColorFree(color: PlayerColor): boolean {
    return ![...this.players.values()].some((p) => p.color === color);
  }

  private pickColor(wanted?: PlayerColor): PlayerColor {
    if (wanted && this.isColorFree(wanted)) return wanted;
    const free = PLAYER_COLORS.find((c) => this.isColorFree(c));
    if (!free) throw new AppError('ROOM_FULL', 'Комната заполнена');
    return free;
  }

  private freeSeat(): number {
    const taken = new Set([...this.players.values()].map((p) => p.seat));
    for (let seat = 0; seat < MAX_PLAYERS; seat++) if (!taken.has(seat)) return seat;
    throw new AppError('ROOM_FULL', 'Комната заполнена');
  }
}
