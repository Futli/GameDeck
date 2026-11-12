import { describe, expect, it } from 'vitest';
import {
  accrueWidgetRolls,
  classifyWidgetRoll,
  rollWidgetDice,
  spendWidgetRoll,
  type WidgetDice,
} from '../src/index.js';

/** Все 216 вариантов броска трёх кубиков. */
function allRolls(): WidgetDice[] {
  const rolls: WidgetDice[] = [];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) rolls.push([a, b, c]);
  return rolls;
}

const count = (match: (roll: ReturnType<typeof classifyWidgetRoll>) => boolean) =>
  allRolls().filter((dice) => match(classifyWidgetRoll(dice))).length;

describe('бросок в виджете', () => {
  it('события делят 216 вариантов так, как обещано игроку', () => {
    expect(count((r) => r.outcome === 'plain')).toBe(96);
    expect(count((r) => r.outcome === 'pair')).toBe(90);
    expect(count((r) => r.outcome === 'straight')).toBe(24);
    expect(count((r) => r.outcome === 'triple')).toBe(6);
  });

  it('скин дают только тройки, редкости относятся как 3 : 2 : 1', () => {
    expect(count((r) => r.skin === 'common')).toBe(3);
    expect(count((r) => r.skin === 'rare')).toBe(2);
    expect(count((r) => r.skin === 'epic')).toBe(1);
    expect(count((r) => r.skin !== null && r.outcome !== 'triple')).toBe(0);
    expect(classifyWidgetRoll([6, 6, 6]).skin).toBe('epic');
  });

  it('модификатор дают только стриты', () => {
    expect(count((r) => r.modifier)).toBe(24);
    expect(count((r) => r.modifier && r.outcome !== 'straight')).toBe(0);
  });

  it('средний бросок приносит 16,04 монеты', () => {
    const total = allRolls().reduce((sum, dice) => sum + classifyWidgetRoll(dice).coins, 0);
    expect(total / 216).toBeCloseTo(16.04, 2);
  });

  it('пара удваивает сумму, тройка умножает на 5', () => {
    expect(classifyWidgetRoll([6, 6, 6])).toMatchObject({ outcome: 'triple', coins: 90 });
    expect(classifyWidgetRoll([1, 1, 1])).toMatchObject({ outcome: 'triple', coins: 15, skin: 'rare' });
    expect(classifyWidgetRoll([2, 5, 2])).toMatchObject({ outcome: 'pair', coins: 18 });
    expect(classifyWidgetRoll([4, 2, 3])).toMatchObject({ outcome: 'straight', coins: 9, modifier: true });
    expect(classifyWidgetRoll([6, 1, 3])).toMatchObject({ outcome: 'plain', coins: 10, skin: null });
  });

  it('кубики бросает переданный rng', () => {
    const values = [0, 0.5, 0.99];
    expect(rollWidgetDice(() => values.shift()!).dice).toEqual([1, 4, 6]);
  });
});

describe('запас бросков', () => {
  const HOUR = 3600;

  it('копится по одному раз в интервал и не больше трёх', () => {
    const empty = { rolls: 0, nextAt: 3 * HOUR };
    expect(accrueWidgetRolls(empty, 2 * HOUR)).toEqual({ rolls: 0, nextAt: 3 * HOUR });
    expect(accrueWidgetRolls(empty, 3 * HOUR)).toEqual({ rolls: 1, nextAt: 6 * HOUR });
    expect(accrueWidgetRolls(empty, 7 * HOUR)).toEqual({ rolls: 2, nextAt: 9 * HOUR });
    expect(accrueWidgetRolls(empty, 100 * HOUR)).toEqual({ rolls: 3, nextAt: null });
  });

  it('отсчёт начинается, когда запас перестал быть полным', () => {
    const full = { rolls: 3, nextAt: null };
    expect(spendWidgetRoll(full, 10 * HOUR)).toEqual({ rolls: 2, nextAt: 13 * HOUR });
    // второй бросок подряд не сдвигает уже идущий отсчёт
    expect(spendWidgetRoll({ rolls: 2, nextAt: 13 * HOUR }, 11 * HOUR)).toEqual({ rolls: 1, nextAt: 13 * HOUR });
  });

  it('без бросков потратить нечего', () => {
    expect(spendWidgetRoll({ rolls: 0, nextAt: 5 * HOUR }, HOUR)).toBeNull();
  });
});
