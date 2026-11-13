import type { DiceStyle } from './dice-style.js';
import type { SkinKind, SkinSeed } from './skins/index.js';
import type {
  ColorInput,
  CreateRoomInput,
  JoinRoomInput,
  KickInput,
  MoveInput,
  PlayerColor,
  RoomSettings,
  UpdateSettingsInput,
} from './schemas.js';

/** Игрок в комнате. Сервер шлёт RoomView целиком после каждого изменения. */
export interface PlayerView {
  id: string;
  name: string;
  /** Место за столом 0..5. Клиент поворачивает стол так, чтобы своё место было снизу. */
  seat: number;
  /** Цвет игрока: стакан и кубики на столе рисуются этим цветом. */
  color: PlayerColor;
  /** Скин кубиков: надетый предмет из магазина (слот dice). */
  dice: DiceStyle;
  /** Надетые сгенерированные скины: клиент рисует их по seed. Чего нет — рисуется по умолчанию. */
  skins: EquippedSkins;
  /** Аватар из Telegram; null — игрок из браузера или Telegram не отдал фото. */
  avatarUrl: string | null;
  isHost: boolean;
  connected: boolean;
}

export interface GameView {
  gameId: string;
  /**
   * Состояние игры глазами получателя (для dice-high — DiceHighState,
   * для perudo — PerudoView без чужих кубиков). Каждый игрок получает свою версию.
   */
  state: unknown;
  currentPlayerId: string | null;
  /**
   * Кто должен действовать все вместе, без очереди (бросок кубиков в начале
   * раунда). Пока список не пуст, currentPlayerId — null.
   */
  awaiting: string[];
  /** Сколько осталось на текущий ход (или на общий бросок), мс. null — таймер не идёт. */
  msLeft: number | null;
  /** Банк партии: ставка × число игроков на старте. Ушедший свою ставку не забирает. */
  pot: number;
  winnerId: string | null;
}

/**
 * Комната ожидания между партиями: все подтверждают, что играют.
 * Кто не ответил до конца таймера — исключается, игра идёт без него.
 */
export interface ReadyCheckView {
  /** start — хост позвал всех начинать; rematch — партия кончилась, играем ли ещё. */
  reason: 'start' | 'rematch';
  /** Кто уже подтвердил. */
  ready: string[];
  /** Сколько осталось до исключения тех, кто не ответил, мс. null — ждём без таймера. */
  msLeft: number | null;
  /**
   * Кто-то ушёл: сама партия не начнётся. Хост решает — подождать нового игрока
   * или начать без него, когда все оставшиеся готовы.
   */
  hostDecides: boolean;
}

/** Сколько ждём игроков, мс. Общие для сервера и клиента: клиент рисует по ним полоски таймера. */
export const ROOM_TIMEOUTS = {
  /** Ход в партии: ставка, «не верю», бросок в «Броске кубика». */
  turn: 45_000,
  /** Общий бросок кубиков в начале раунда. */
  roll: 20_000,
  /** Подтвердить участие, когда хост начинает игру (и новичку, вошедшему в комнату ожидания). */
  start: 30_000,
  /** Решить после партии: играть ещё или выйти. */
  rematch: 60_000,
} as const;

export type RoomStatus = 'lobby' | 'playing' | 'finished';

/**
 * Комната глазами одного игрока. Сервер шлёт её целиком после каждого
 * изменения — каждому свою, потому что в играх со скрытой информацией
 * (перудо) чужие кубики в неё не попадают.
 */
export interface RoomView {
  code: string;
  status: RoomStatus;
  /** Пароль наружу не отдаём — только факт, что он есть. */
  settings: Omit<RoomSettings, 'password'> & { hasPassword: boolean };
  players: PlayerView[];
  game: GameView | null;
  /** Идёт сбор подтверждений перед партией (модалка у всех). null — не идёт. */
  readyCheck: ReadyCheckView | null;
}

/**
 * Комната в списке на главной. Только публичное: без игроков по именам,
 * без состояния игры и, конечно, без пароля.
 */
export interface RoomSummary {
  code: string;
  status: RoomStatus;
  gameId: string;
  stake: number;
  hasPassword: boolean;
  hostName: string;
  players: number;
  maxPlayers: number;
}

/** Ответ сервера на любой запрос клиента (Socket.IO acknowledgement). */
export type AckResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export type Ack<T> = (result: AckResult<T>) => void;

export interface SessionInfo {
  /** Секрет для переподключения: клиент хранит его и шлёт в handshake.auth. */
  token: string;
  playerId: string;
}

export interface ClientToServerEvents {
  'room:create': (input: CreateRoomInput, ack: Ack<RoomView>) => void;
  'room:join': (input: JoinRoomInput, ack: Ack<RoomView>) => void;
  'room:leave': (ack: Ack<null>) => void;
  'room:settings': (input: UpdateSettingsInput, ack: Ack<RoomView>) => void;
  'room:kick': (input: KickInput, ack: Ack<RoomView>) => void;
  'room:color': (input: ColorInput, ack: Ack<RoomView>) => void;
  /** Подписаться на список комнат (главная). Ответ — текущий список, дальше приходит rooms:list. */
  'rooms:watch': (ack: Ack<RoomSummary[]>) => void;
  'rooms:unwatch': (ack: Ack<null>) => void;
  /**
   * Хост начинает игру: открывает сбор подтверждений. Если сбор уже идёт и все
   * оставшиеся готовы — запускает партию сразу, не дожидаясь новых игроков.
   */
  'game:start': (ack: Ack<RoomView>) => void;
  /** «Играю»: подтвердить участие в следующей партии. Отказ — это room:leave. */
  'room:ready': (ack: Ack<RoomView>) => void;
  'game:move': (input: MoveInput, ack: Ack<RoomView>) => void;
}

export interface ServerToClientEvents {
  session: (session: SessionInfo) => void;
  'room:state': (room: RoomView) => void;
  /** Игрока убрали из комнаты: хост исключил или кончилось время на ответ. */
  'room:kicked': (info: { code: string; reason: 'host' | 'timeout' }) => void;
  /** Список комнат изменился. Приходит только тем, кто подписан через rooms:watch. */
  'rooms:list': (rooms: RoomSummary[]) => void;
  /** Партия сохранена в базе: места и изменение рейтинга у каждого. */
  'match:recorded': (result: MatchRecord) => void;
}

export interface MatchRecord {
  matchId: string;
  gameId: string;
  players: Array<{
    playerId: string;
    place: number;
    ratingBefore: number;
    ratingAfter: number;
    /** Сколько монет игрок получил (+) или отдал (−) по ставке этой партии. */
    coins: number;
  }>;
}

/**
 * Строка истории партий игрока (GET /api/me/matches): чем кончилась партия
 * и сколько монет она принесла или забрала.
 */
export interface MatchHistoryEntry {
  matchId: string;
  gameId: string;
  finishedAt: string;
  /** Ставка партии; 0 — играли без ставки. */
  stake: number;
  /** 1 — победа. */
  place: number;
  /** Сколько игроков было за столом. */
  players: number;
  ratingBefore: number;
  ratingAfter: number;
  /** Изменение баланса по этой партии: + выигрыш, − проигранная ставка, 0 — без ставки. */
  coins: number;
}

/** Страница истории: next — finishedAt последней строки для следующего запроса; null — дальше пусто. */
export interface MatchHistoryPage {
  matches: MatchHistoryEntry[];
  next: string | null;
}

/**
 * Профиль текущего игрока для главного экрана (GET /api/me).
 * Счётчики суммируются по всем играм; новичок получает нули.
 */
export interface MyProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** Текущий баланс монет. */
  coins: number;
  gamesPlayed: number;
  wins: number;
  /** Всего выиграно монет на ставках. */
  coinsWon: number;
  /** Всего проиграно монет на ставках (положительное число). */
  coinsLost: number;
  /**
   * Текущий рейтинг по каждой игре, в которую игрок сыграл хотя бы раз;
   * сначала та, в которую он играл больше всего. Новичку — пустой список.
   */
  ratings: GameRating[];
}

/** Рейтинг игрока в одной игре (Эло, у новичка 1000). */
export interface GameRating {
  gameId: string;
  rating: number;
  /** Лучший рейтинг за всё время. */
  peakRating: number;
  gamesPlayed: number;
}

/** Данные, которые Socket.IO хранит на каждом сокете (socket.data). */
export interface SocketData {
  playerId: string;
  token: string;
}

/** Надетые скины по видам: только то, из чего генератор нарисует картинку. */
export type EquippedSkins = Partial<Record<SkinKind, SkinSeed>>;

/** Скин в инвентаре или на витрине. */
export interface SkinView extends SkinSeed {
  id: string;
  /** Порядковый номер выпуска: «№ 1042». */
  serial: number;
  name: string;
  /** false — привязан к владельцу, передать нельзя. */
  tradable: boolean;
  equipped: boolean;
  createdAt: string;
}

export interface SkinTransferView {
  reason: 'mint' | 'gift' | 'sale';
  fromPlayerId: string | null;
  toPlayerId: string | null;
  priceCoins: number | null;
  createdAt: string;
}
