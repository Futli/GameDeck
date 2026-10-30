import { z } from 'zod';
import { GameRuleError, type GameModule, type Rng } from './types.js';

/**
 * «Бросок кубика»: каждый по очереди бросает один d6, побеждает наибольшее
 * значение. При ничьей среди лидеров перебрасывают только лидеры.
 */
export interface DiceHighState {
  /** Номер раунда, с 1. Раунд > 1 — переброс между лидерами. */
  round: number;
  /** Кто участвует в текущем раунде, в порядке ходов. */
  contenders: string[];
  /** Индекс в contenders того, кто ходит сейчас. */
  turnIndex: number;
  /** Броски текущего раунда. */
  rolls: Record<string, number>;
  /** Завершённые раунды — для истории на столе. */
  history: Array<{ round: number; rolls: Record<string, number> }>;
  winnerId: string | null;
}

export const diceHighMoveSchema = z.object({ type: z.literal('roll') });
export type DiceHighMove = z.infer<typeof diceHighMoveSchema>;

export const rollD6 = (rng: Rng): number => Math.floor(rng() * 6) + 1;

function finishRoundIfComplete(state: DiceHighState): DiceHighState {
  if (state.turnIndex < state.contenders.length) return state;

  const values = state.contenders.map((id) => state.rolls[id] ?? 0);
  const best = Math.max(...values);
  const leaders = state.contenders.filter((id) => state.rolls[id] === best);
  const history = [...state.history, { round: state.round, rolls: state.rolls }];

  if (leaders.length === 1) {
    return { ...state, history, rolls: {}, winnerId: leaders[0]! };
  }
  return {
    ...state,
    round: state.round + 1,
    contenders: leaders,
    turnIndex: 0,
    rolls: {},
    history,
  };
}

export const diceHigh: GameModule<DiceHighState, DiceHighMove> = {
  id: 'dice-high',
  title: 'Бросок кубика',
  minPlayers: 2,
  maxPlayers: 6,
  moveSchema: diceHighMoveSchema,

  start(playerIds) {
    if (playerIds.length < this.minPlayers) {
      throw new GameRuleError('NOT_ENOUGH_PLAYERS', `Нужно минимум ${this.minPlayers} игрока`);
    }
    return {
      round: 1,
      contenders: [...playerIds],
      turnIndex: 0,
      rolls: {},
      history: [],
      winnerId: null,
    };
  },

  currentPlayer(state) {
    if (state.winnerId) return null;
    return state.contenders[state.turnIndex] ?? null;
  },

  applyMove(state, playerId, move, rng) {
    if (state.winnerId) throw new GameRuleError('GAME_OVER', 'Игра уже окончена');
    if (this.currentPlayer(state) !== playerId) {
      throw new GameRuleError('NOT_YOUR_TURN', 'Сейчас не ваш ход');
    }
    if (move.type !== 'roll') throw new GameRuleError('BAD_MOVE', 'Неизвестный ход');

    return finishRoundIfComplete({
      ...state,
      rolls: { ...state.rolls, [playerId]: rollD6(rng) },
      turnIndex: state.turnIndex + 1,
    });
  },

  removePlayer(state, playerId) {
    const index = state.contenders.indexOf(playerId);
    if (state.winnerId || index === -1) return state;

    const contenders = state.contenders.filter((id) => id !== playerId);
    const { [playerId]: _removed, ...rolls } = state.rolls;
    // Если ушедший уже ходил в этом раунде, очередь сдвигается на одного назад.
    const turnIndex = index < state.turnIndex ? state.turnIndex - 1 : state.turnIndex;

    if (contenders.length === 1) {
      return { ...state, contenders, rolls, turnIndex: 0, winnerId: contenders[0]! };
    }
    return finishRoundIfComplete({ ...state, contenders, rolls, turnIndex });
  },

  winner(state) {
    return state.winnerId;
  },
};
