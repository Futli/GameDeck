import {
  DEFAULT_DICE_STYLE,
  GameRuleError,
  MAX_PLAYERS,
  PLAYER_COLORS,
  ROOM_TIMEOUTS,
  games,
  type DiceStyle,
  type EquippedSkins,
  type GameModule,
  type PlayerColor,
  type RoomSettings,
  type RoomStatus,
  type RoomSummary,
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
  skins: EquippedSkins;
  avatarUrl: string | null;
  connected: boolean;
}

export interface PlayerInfo {
  id: string;
  name: string;
  /** Желаемый цвет; если занят или не задан — первый свободный. */
  color?: PlayerColor;
  /** Скин кубиков из надетых предметов; без него — классический. */
  dice?: DiceStyle;
  /** Надетые сгенерированные скины. */
  skins?: EquippedSkins;
  /** Аватар из Telegram. */
  avatarUrl?: string | null;
}

interface ActiveGame {
  module: GameModule<unknown, unknown>;
  state: unknown;
  startedAt: Date;
  /** Места игроков на момент старта — для записи в историю. */
  seats: Map<string, number>;
  /** Кто ушёл посреди партии: они получают последнее место. */
  leavers: string[];
  /** Таймер хода: когда истекает и кого ждём (чтобы не перезапускать его без смены хода). */
  timer: { deadline: number; waitingFor: string } | null;
}

/** Сбор подтверждений перед партией. */
interface ReadyCheck {
  reason: 'start' | 'rematch';
  ready: Set<string>;
  /** Когда исключаем не ответивших; null — таймер не идёт (ждём новых игроков). */
  deadline: number | null;
  /** Сколько игроков было, когда сбор начался. Меньше — значит, кто-то ушёл, и решает хост. */
  expected: number;
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
  private check: ReadyCheck | null = null;
  private pendingResult: MatchResult | null = null;

  constructor(
    readonly code: string,
    host: PlayerInfo,
    settings: Partial<RoomSettings> = {},
    /** Часы для таймеров. В тестах подставляем свои, чтобы не ждать по-настоящему. */
    private readonly clock: () => number = Date.now,
  ) {
    this.settings = { ...defaultSettings, ...settings, password: settings.password || null };
    this.hostId = host.id;
    this.players.set(host.id, {
      id: host.id,
      name: host.name,
      seat: 0,
      color: this.pickColor(host.color),
      dice: host.dice ?? DEFAULT_DICE_STYLE,
      skins: host.skins ?? {},
      avatarUrl: host.avatarUrl ?? null,
      connected: true,
    });
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  addPlayer({ id, name, color, dice, skins, avatarUrl }: PlayerInfo, password?: string): void {
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
      skins: skins ?? {},
      avatarUrl: avatarUrl ?? null,
      connected: true,
    });
    // Новичок в комнате ожидания тоже должен подтвердить участие — и получает на это время.
    if (this.check) {
      this.check.deadline = Math.max(this.check.deadline ?? 0, this.clock() + ROOM_TIMEOUTS.start);
    }
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
    this.check?.ready.delete(id);

    if (this.game && this.status === 'playing') {
      this.game.leavers.push(id);
      this.game.state = this.game.module.removePlayer(this.game.state, id);
      this.syncStatus();
      this.armTimer(false);
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
    // Игроки соглашались на старые условия (например, ставку) — пусть подтвердят заново.
    if (this.check) this.check.ready = new Set([this.hostId]);
  }

  kick(byId: string, targetId: string): void {
    this.assertHost(byId);
    if (byId === targetId) throw new AppError('BAD_TARGET', 'Нельзя исключить себя');
    if (!this.players.has(targetId)) throw new AppError('NOT_FOUND', 'Игрок не найден');
    this.removePlayer(targetId);
  }

  /**
   * Хост начинает игру. Партия стартует не сразу: сначала все подтверждают
   * участие (модалка «Партия начинается»). Если сбор уже идёт, а кто-то ушёл,
   * хост может начать без него, когда все оставшиеся готовы.
   */
  startGame(byId: string, rng: Rng): void {
    this.assertHost(byId);
    if (this.status === 'playing') throw new AppError('GAME_IN_PROGRESS', 'Игра уже идёт');
    const module = this.module();
    if (this.players.size < module.minPlayers) {
      throw new AppError('NOT_ENOUGH_PLAYERS', `Нужно минимум ${module.minPlayers} игрока`);
    }
    if (!this.check) {
      this.openCheck('start', ROOM_TIMEOUTS.start);
      this.check!.ready.add(byId);
      this.startIfEveryoneReady(rng);
      return;
    }
    this.check.ready.add(byId);
    if (!this.everyoneReady()) throw new AppError('NOT_READY', 'Ещё не все подтвердили участие');
    this.begin(rng);
  }

  /** Игрок подтвердил участие в следующей партии. */
  setReady(id: string, rng: Rng): void {
    if (!this.players.has(id)) throw new AppError('NOT_IN_ROOM', 'Вы не в комнате');
    if (!this.check) throw new AppError('NO_READY_CHECK', 'Сейчас нечего подтверждать');
    this.check.ready.add(id);
    this.startIfEveryoneReady(rng);
  }

  /** Ближайший момент, когда комнате нужно проверить таймеры (expire), или null. */
  nextDeadline(): number | null {
    const times = [this.check?.deadline, this.status === 'playing' ? this.game?.timer?.deadline : null];
    const set = times.filter((t): t is number => typeof t === 'number');
    return set.length > 0 ? Math.min(...set) : null;
  }

  /**
   * Время вышло. Не ответившие в комнате ожидания и не бросившие кубики
   * исключаются; тому, кто молчит на своём ходу, ход делает правило игры
   * (timeoutMove). Возвращает тех, кого убрали из комнаты.
   */
  expire(now: number, rng: Rng): string[] {
    const removed: string[] = [];
    const remove = (ids: string[]) =>
      ids.forEach((id) => {
        this.removePlayer(id);
        removed.push(id);
      });

    const check = this.check;
    if (check?.deadline != null && now >= check.deadline) {
      remove([...this.players.keys()].filter((id) => !check.ready.has(id)));
      check.deadline = null;
      // Не успевших исключили — играем без них, если хватает игроков.
      if (this.players.size >= this.module().minPlayers && this.everyoneReady()) this.begin(rng);
    }

    const game = this.game;
    if (this.status === 'playing' && game?.timer && now >= game.timer.deadline) {
      const awaiting = game.module.awaiting?.(game.state) ?? [];
      const current = game.module.currentPlayer(game.state);
      if (awaiting.length > 0) remove(awaiting.filter((id) => this.players.has(id)));
      else if (current) {
        const move = game.module.timeoutMove?.(game.state, current) ?? null;
        if (move) this.move(current, move, rng);
        else remove([current]);
      }
    }
    return removed;
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
    this.armTimer(true);
  }

  /**
   * Комната глазами игрока viewerId. Скрытую часть состояния игры (чужие
   * кубики) отрезает сам модуль игры через viewFor. viewerId = null — взгляд
   * постороннего: видно только публичное.
   */
  toView(viewerId: string | null = null): RoomView {
    const { password, ...settings } = this.settings;
    const game = this.game;
    const now = this.clock();
    const left = (deadline: number | null | undefined) => (deadline == null ? null : Math.max(0, deadline - now));
    const check = this.check;
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
        awaiting: game.module.awaiting?.(game.state) ?? [],
        msLeft: this.status === 'playing' ? left(game.timer?.deadline) : null,
        pot: this.settings.stake * game.seats.size,
        winnerId: game.module.winner(game.state),
      },
      readyCheck: check && {
        reason: check.reason,
        ready: [...check.ready].filter((id) => this.players.has(id)),
        msLeft: left(check.deadline),
        hostDecides: this.players.size < check.expected,
      },
    };
  }

  /** Короткая карточка для списка комнат на главной. */
  toSummary(): RoomSummary {
    return {
      code: this.code,
      status: this.status,
      gameId: this.settings.gameId,
      stake: this.settings.stake,
      hasPassword: this.settings.password !== null,
      hostName: this.players.get(this.hostId)?.name ?? '',
      players: this.players.size,
      maxPlayers: this.settings.maxPlayers,
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
    // Сразу открываем комнату ожидания: играем ещё или выходим.
    this.openCheck('rematch', ROOM_TIMEOUTS.rematch);
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

  private module(): GameModule<unknown, unknown> {
    const module = games[this.settings.gameId];
    if (!module) throw new AppError('UNKNOWN_GAME', 'Неизвестная игра');
    return module;
  }

  private openCheck(reason: ReadyCheck['reason'], timeout: number): void {
    this.check = { reason, ready: new Set(), deadline: this.clock() + timeout, expected: this.players.size };
  }

  private everyoneReady(): boolean {
    return [...this.players.keys()].every((id) => this.check?.ready.has(id));
  }

  /** Все на месте и все готовы — начинаем сами. Если кто-то ушёл, ждём решения хоста. */
  private startIfEveryoneReady(rng: Rng): void {
    const check = this.check;
    if (!check || this.players.size < check.expected) return;
    if (this.players.size >= this.module().minPlayers && this.everyoneReady()) this.begin(rng);
  }

  /** Раздать места и начать партию. Права и число игроков уже проверены. */
  private begin(rng: Rng): void {
    const module = this.module();
    // Порядок ходов — по местам за столом, по часовой стрелке.
    const players = [...this.players.values()].sort((a, b) => a.seat - b.seat);
    this.game = {
      module,
      state: module.start(
        players.map((p) => p.id),
        rng,
      ),
      startedAt: new Date(),
      seats: new Map(players.map((p) => [p.id, p.seat])),
      leavers: [],
      timer: null,
    };
    this.check = null;
    this.pendingResult = null;
    this.status = 'playing';
    this.armTimer(true);
  }

  /**
   * Завести таймер хода. Ход перешёл (fresh) или сменился тот, кого ждём, — время
   * заново. Пока все вместе бросают кубики, каждый бросок таймер не продлевает.
   */
  private armTimer(fresh: boolean): void {
    const game = this.game;
    if (!game) return;
    if (this.status !== 'playing') {
      game.timer = null;
      return;
    }
    const together = (game.module.awaiting?.(game.state) ?? []).length > 0;
    const waitingFor = together ? '*' : (game.module.currentPlayer(game.state) ?? '');
    if (game.timer?.waitingFor === waitingFor && !(fresh && !together)) return;
    game.timer = {
      waitingFor,
      deadline: this.clock() + (together ? ROOM_TIMEOUTS.roll : ROOM_TIMEOUTS.turn),
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
