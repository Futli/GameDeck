import {
  accrueWidgetRolls,
  rollWidgetDice,
  spendWidgetRoll,
  WIDGET_MAX_STORED_ROLLS,
  type Rng,
  type WidgetDice,
  type WidgetRollBank,
  type WidgetRollOutcome,
  type WidgetSkinRarity,
} from '@gamedeck/shared';
import type { WidgetState } from './build.js';

/**
 * Игрок прототипа. Живёт в памяти процесса и с настоящим профилем GameDeck
 * не связан: монеты здесь только показываются, в базу ничего не пишется.
 */
export interface DemoPlayer {
  bank: WidgetRollBank;
  coins: number;
  /** Кубики последнего броска, null — игрок ещё не бросал. */
  dice: WidgetDice | null;
}

/**
 * Ответ бота на запрос броска — то, что получает виджет из TelegramWidget.request().
 * Имена короткие по той же причине, что и у WidgetState: лимит 1 КБ.
 */
export type WidgetRollAnswer =
  | {
      d: WidgetDice;
      o: WidgetRollOutcome;
      /** Сколько монет принёс бросок. */
      c: number;
      /** Запас бросков, время следующего и баланс после броска. */
      r: number;
      n: number;
      b: number;
      /** Что выпало сверх монет, готовой фразой. */
      x?: string;
    }
  | { e: 'NO_ROLLS' };

const SKIN_TEXT: Record<WidgetSkinRarity, string> = {
  common: 'Выпал обычный скин',
  rare: 'Выпал редкий скин',
  epic: 'Выпал эпический скин',
};

export function createDemoPlayer(coins: number): DemoPlayer {
  return { bank: { rolls: WIDGET_MAX_STORED_ROLLS, nextAt: null }, coins, dice: null };
}

/** Состояние для chat_data на момент now (unix, секунды). */
export function demoState(player: DemoPlayer, now: number, intervalSec: number): WidgetState {
  const bank = accrueWidgetRolls(player.bank, now, intervalSec);
  return {
    r: bank.rolls,
    n: bank.nextAt ?? 0,
    t: intervalSec,
    b: player.coins,
    w: 0,
    l: 0,
    c: 0,
    ...(player.dice ? { d: player.dice } : {}),
    p: 'Прототип: монеты ненастоящие',
  };
}

/**
 * Бросок по запросу виджета. Решает сервер: досчитывает запас, тратит бросок,
 * бросает кубики и начисляет монеты. Виджету остаётся показать ответ.
 */
export function playDemoRoll(
  player: DemoPlayer,
  now: number,
  rng: Rng,
  intervalSec: number,
): { player: DemoPlayer; answer: WidgetRollAnswer } {
  const accrued = accrueWidgetRolls(player.bank, now, intervalSec);
  const bank = spendWidgetRoll(accrued, now, intervalSec);
  if (!bank) return { player: { ...player, bank: accrued }, answer: { e: 'NO_ROLLS' } };

  const roll = rollWidgetDice(rng);
  const coins = player.coins + roll.coins;
  const extra = roll.skin ? SKIN_TEXT[roll.skin] : roll.modifier ? 'Выпал модификатор' : undefined;
  return {
    player: { bank, coins, dice: roll.dice },
    answer: {
      d: roll.dice,
      o: roll.outcome,
      c: roll.coins,
      r: bank.rolls,
      n: bank.nextAt ?? 0,
      b: coins,
      ...(extra ? { x: extra } : {}),
    },
  };
}
