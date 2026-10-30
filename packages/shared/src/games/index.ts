import { diceHigh } from './dice-high.js';
import type { GameModule } from './types.js';

export * from './types.js';
export * from './dice-high.js';

/** Реестр игр: новая игра = новый модуль + строчка здесь. */
export const games: Record<string, GameModule<any, any>> = {
  [diceHigh.id]: diceHigh,
};

export const gameIds = Object.keys(games) as [string, ...string[]];
