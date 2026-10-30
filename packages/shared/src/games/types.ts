import type { z } from 'zod';

/** Источник случайности. В проде — crypto, в тестах — заранее заданная последовательность. */
export type Rng = () => number;

/** Ошибка правил игры: «не твой ход», «игра уже окончена» и т.п. */
export class GameRuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GameRuleError';
  }
}

/**
 * Общий интерфейс всех игр. Модуль игры — набор чистых функций без I/O:
 * получает состояние и ход, возвращает новое состояние. Комнаты и сокеты
 * ничего не знают о правилах конкретной игры.
 */
export interface GameModule<State, Move> {
  readonly id: string;
  readonly title: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** zod-схема хода: сервер проверяет ход клиента именно этой игры до applyMove. */
  readonly moveSchema: z.ZodType<Move>;
  /** Начальное состояние. Порядок playerIds — порядок ходов. rng — для стартового броска. */
  start(playerIds: readonly string[], rng: Rng): State;
  /** Чей сейчас ход, или null, если игра окончена. */
  currentPlayer(state: State): string | null;
  /** Применить ход. Бросает GameRuleError, если ход недопустим. */
  applyMove(state: State, playerId: string, move: Move, rng: Rng): State;
  /** Игрок покинул игру: убрать его из очереди ходов. */
  removePlayer(state: State, playerId: string): State;
  /** Победитель, или null, пока игра идёт. */
  winner(state: State): string | null;
  /**
   * Что из состояния можно показать конкретному игроку. Нужно играм со
   * скрытой информацией (кубики под стаканом в перудо): чужие секреты не
   * должны уйти по сети даже в виде JSON, который клиент «просто не рисует».
   * Если не задано — состояние публичное и уходит всем как есть.
   */
  viewFor?(state: State, viewerId: string | null): unknown;
}
