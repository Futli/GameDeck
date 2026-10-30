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
  winnerId: string | null;
}

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
  'game:start': (ack: Ack<RoomView>) => void;
  'game:move': (input: MoveInput, ack: Ack<RoomView>) => void;
}

export interface ServerToClientEvents {
  session: (session: SessionInfo) => void;
  'room:state': (room: RoomView) => void;
  'room:kicked': (info: { code: string }) => void;
  /** Партия сохранена в базе: места и изменение рейтинга у каждого. */
  'match:recorded': (result: MatchRecord) => void;
}

export interface MatchRecord {
  matchId: string;
  gameId: string;
  players: Array<{ playerId: string; place: number; ratingBefore: number; ratingAfter: number }>;
}

/** Данные, которые Socket.IO хранит на каждом сокете (socket.data). */
export interface SocketData {
  playerId: string;
  token: string;
}
