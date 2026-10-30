import { diceHigh, type DiceHighMove } from './dice-high.js';
import { perudo, type PerudoMove } from './perudo.js';
import type { GameModule } from './types.js';

export * from './types.js';
export * from './dice-high.js';
export * from './perudo.js';

/** Реестр игр: новая игра = новый модуль + строчка здесь. */
export const games: Record<string, GameModule<any, any>> = {
  [diceHigh.id]: diceHigh,
  [perudo.id]: perudo,
};

export const gameIds = Object.keys(games) as [string, ...string[]];

/** Любой ход любой игры — для типизации протокола. Проверяет ход схема конкретной игры. */
export type GameMove = DiceHighMove | PerudoMove;
