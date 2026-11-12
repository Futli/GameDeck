import { rollD6 } from './games/dice-high.js';
import type { Rng } from './games/types.js';

/**
 * Бросок в виджете Telegram: три кубика, награда падает игроку на баланс.
 * Правила — чистые функции, как у игр: сервер бросает кубики сам и по ним
 * решает, что получил игрок. Виджет только показывает готовый результат.
 *
 * Приз целиком определяется кубиками, скрытых розыгрышей нет: игрок видит
 * кубики и по таблице может сам проверить, что ему положено.
 * События не пересекаются (всего 6³ = 216 вариантов):
 *
 * | событие                    | вариантов | шанс   | приз                          |
 * | все разные, не подряд      | 96        | 44,44% | сумма                         |
 * | пара                       | 90        | 41,67% | сумма ×2                      |
 * | стрит (три числа подряд)   | 24        | 11,11% | сумма и модификатор           |
 * | тройка 2-2-2, 3-3-3, 4-4-4 | 3         | 1,39%  | сумма ×5 и обычный скин       |
 * | тройка 1-1-1, 5-5-5        | 2         | 0,93%  | сумма ×5 и редкий скин        |
 * | три шестёрки               | 1         | 0,46%  | сумма ×5 и эпический скин     |
 *
 * Средний бросок приносит 16,04 монеты.
 */
export type WidgetRollOutcome = 'plain' | 'pair' | 'straight' | 'triple';

export type WidgetSkinRarity = 'common' | 'rare' | 'epic';

export type WidgetDice = readonly [number, number, number];

export interface WidgetRoll {
  dice: WidgetDice;
  outcome: WidgetRollOutcome;
  /** Сколько монет получает игрок. */
  coins: number;
  /** Редкость выпавшего скина, null — скин не выпал. */
  skin: WidgetSkinRarity | null;
  /** Выпал ли модификатор (переброс). */
  modifier: boolean;
}

/** Во сколько раз событие умножает сумму кубиков. */
export const WIDGET_MULTIPLIER: Record<WidgetRollOutcome, number> = { plain: 1, pair: 2, straight: 1, triple: 5 };

/** Редкость скина по значению тройки: чем реже редкость, тем меньше троек её дают (3 : 2 : 1). */
const TRIPLE_SKIN: Record<number, WidgetSkinRarity> = {
  1: 'rare',
  2: 'common',
  3: 'common',
  4: 'common',
  5: 'rare',
  6: 'epic',
};

/** Что означают выпавшие кубики. Порядок кубиков не важен. */
export function classifyWidgetRoll(dice: WidgetDice): WidgetRoll {
  const [low, mid, high] = [...dice].sort((a, b) => a - b) as [number, number, number];
  const sum = low + mid + high;

  let outcome: WidgetRollOutcome = 'plain';
  if (low === high) outcome = 'triple';
  else if (low === mid || mid === high) outcome = 'pair';
  else if (mid === low + 1 && high === mid + 1) outcome = 'straight';

  return {
    dice,
    outcome,
    coins: sum * WIDGET_MULTIPLIER[outcome],
    skin: outcome === 'triple' ? TRIPLE_SKIN[low]! : null,
    modifier: outcome === 'straight',
  };
}

/** Бросить три кубика. rng — crypto на сервере, заданная последовательность в тестах. */
export function rollWidgetDice(rng: Rng): WidgetRoll {
  return classifyWidgetRoll([rollD6(rng), rollD6(rng), rollD6(rng)]);
}

/** Раз в сколько секунд игроку приходит бесплатный бросок. */
export const WIDGET_ROLL_INTERVAL_SEC = 3 * 60 * 60;
/** Сколько бросков копится, пока игрок не заходит. */
export const WIDGET_MAX_STORED_ROLLS = 3;

export interface WidgetRollBank {
  /** Сколько бросков доступно сейчас. */
  rolls: number;
  /** Когда придёт следующий бросок (unix-время в секундах), null — запас полон. */
  nextAt: number | null;
}

/**
 * Пересчитать запас бросков на момент now. Броски не начисляются по таймеру
 * в фоне: сервер хранит запас и время, с которого идёт отсчёт, и досчитывает
 * накопившееся в тот момент, когда игрок пришёл. Полный запас отсчёт не ведёт.
 */
export function accrueWidgetRolls(
  bank: WidgetRollBank,
  now: number,
  intervalSec: number = WIDGET_ROLL_INTERVAL_SEC,
): WidgetRollBank {
  let { rolls, nextAt } = bank;
  while (rolls < WIDGET_MAX_STORED_ROLLS && nextAt !== null && nextAt <= now) {
    rolls++;
    nextAt += intervalSec;
  }
  return { rolls, nextAt: rolls < WIDGET_MAX_STORED_ROLLS ? (nextAt ?? now + intervalSec) : null };
}

/** Потратить один бросок. Вызывать после accrueWidgetRolls; null — бросков нет. */
export function spendWidgetRoll(
  bank: WidgetRollBank,
  now: number,
  intervalSec: number = WIDGET_ROLL_INTERVAL_SEC,
): WidgetRollBank | null {
  if (bank.rolls < 1) return null;
  // Отсчёт до следующего броска начинается, когда запас перестал быть полным.
  return { rolls: bank.rolls - 1, nextAt: bank.nextAt ?? now + intervalSec };
}

/** Что дал переброс одного кубика модификатором. */
export interface WidgetReroll {
  dice: WidgetDice;
  /** Событие по новым кубикам: виджет называет его игроку. */
  outcome: WidgetRollOutcome;
  /** Сколько монет добавил переброс; 0 — стало не лучше, прежний приз остаётся. */
  gain: number;
}

/**
 * Перебросить один кубик последнего броска (index — 0, 1 или 2).
 *
 * Переброс может только улучшить приз: игрок получает разницу, если новая комбинация
 * дороже, и ничего не теряет, если дешевле. И он меняет только монеты: скин и новый
 * модификатор определяются первым результатом броска. Модификаторы продаются за Stars,
 * а скины — на рынке, поэтому шанс на скин нельзя ни купить, ни усилить.
 */
export function rerollWidgetDie(dice: WidgetDice, index: number, rng: Rng): WidgetReroll {
  if (!Number.isInteger(index) || index < 0 || index > 2) throw new RangeError('Номер кубика — 0, 1 или 2');
  const rerolled = dice.map((value, i) => (i === index ? rollD6(rng) : value)) as unknown as WidgetDice;
  const after = classifyWidgetRoll(rerolled);
  return { dice: rerolled, outcome: after.outcome, gain: Math.max(0, after.coins - classifyWidgetRoll(dice).coins) };
}
