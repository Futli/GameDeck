import { describe, expect, it } from 'vitest';
import { diceHigh, type Rng } from '../src/index.js';

/** ГСЧ, который выдаёт заранее заданные значения кубика по очереди. */
const dice = (...faces: number[]): Rng => {
  let i = 0;
  return () => ((faces[i++] ?? 1) - 1) / 6;
};

const playAll = (state: ReturnType<typeof diceHigh.start>, rng: Rng) => {
  let s = state;
  while (diceHigh.currentPlayer(s)) s = diceHigh.applyMove(s, diceHigh.currentPlayer(s)!, { type: 'roll' }, rng);
  return s;
};

describe('dice-high', () => {
  it('ходы идут по кругу в порядке мест', () => {
    let s = diceHigh.start(['a', 'b', 'c'], Math.random);
    const rng = dice(1, 2, 3);
    expect(diceHigh.currentPlayer(s)).toBe('a');
    s = diceHigh.applyMove(s, 'a', { type: 'roll' }, rng);
    expect(diceHigh.currentPlayer(s)).toBe('b');
    s = diceHigh.applyMove(s, 'b', { type: 'roll' }, rng);
    expect(diceHigh.currentPlayer(s)).toBe('c');
  });

  it('побеждает наибольшее значение', () => {
    const s = playAll(diceHigh.start(['a', 'b', 'c'], Math.random), dice(2, 6, 4));
    expect(diceHigh.winner(s)).toBe('b');
    expect(diceHigh.currentPlayer(s)).toBeNull();
    expect(s.history).toEqual([{ round: 1, rolls: { a: 2, b: 6, c: 4 } }]);
  });

  it('при ничьей перебрасывают только лидеры', () => {
    let s = diceHigh.start(['a', 'b', 'c'], Math.random);
    const rng = dice(5, 3, 5, /* переброс: */ 2, 4);
    for (const id of ['a', 'b', 'c']) s = diceHigh.applyMove(s, id, { type: 'roll' }, rng);

    expect(s.round).toBe(2);
    expect(s.contenders).toEqual(['a', 'c']);
    expect(diceHigh.currentPlayer(s)).toBe('a');

    s = playAll(s, rng);
    expect(diceHigh.winner(s)).toBe('c');
  });

  it('не даёт ходить вне очереди', () => {
    const s = diceHigh.start(['a', 'b'], Math.random);
    expect(() => diceHigh.applyMove(s, 'b', { type: 'roll' }, dice(1))).toThrow('Сейчас не ваш ход');
  });

  it('не даёт ходить после победы', () => {
    const s = playAll(diceHigh.start(['a', 'b'], Math.random), dice(6, 1));
    expect(() => diceHigh.applyMove(s, 'a', { type: 'roll' }, dice(1))).toThrow('Игра уже окончена');
  });

  it('если остался один игрок, он побеждает', () => {
    const s = diceHigh.removePlayer(diceHigh.start(['a', 'b'], Math.random), 'a');
    expect(diceHigh.winner(s)).toBe('b');
  });

  it('уход сходившего игрока не сбивает очередь', () => {
    let s = diceHigh.start(['a', 'b', 'c'], Math.random);
    s = diceHigh.applyMove(s, 'a', { type: 'roll' }, dice(3));
    s = diceHigh.removePlayer(s, 'a');
    expect(diceHigh.currentPlayer(s)).toBe('b');
  });

  it('уход последнего в раунде завершает раунд', () => {
    let s = diceHigh.start(['a', 'b', 'c'], Math.random);
    const rng = dice(2, 5);
    s = diceHigh.applyMove(s, 'a', { type: 'roll' }, rng);
    s = diceHigh.applyMove(s, 'b', { type: 'roll' }, rng);
    s = diceHigh.removePlayer(s, 'c');
    expect(diceHigh.winner(s)).toBe('b');
  });
});
