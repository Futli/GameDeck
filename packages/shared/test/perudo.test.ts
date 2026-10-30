import { describe, expect, it } from 'vitest';
import { assertValidRaise, perudo, type PerudoState, type PerudoView, type Rng } from '../src/index.js';

/** ГСЧ, который выдаёт заранее заданные значения кубика по очереди (дальше — единицы). */
const dice = (...faces: number[]): Rng => {
  let i = 0;
  return () => ((faces[i++] ?? 1) - 1) / 6;
};

/** Состояние посреди партии: кубики задаём руками, чтобы проверять конкретные ситуации. */
const table = (hands: Record<string, number[]>, over: Partial<PerudoState> = {}): PerudoState => ({
  order: Object.keys(hands),
  dice: hands,
  round: 1,
  palifico: false,
  palificoUsed: [],
  turnId: Object.keys(hands)[0]!,
  bids: [],
  lastReveal: null,
  winnerId: null,
  ...over,
});

const rest = dice(); // для новых раундов, где значения кубиков не важны

describe('perudo', () => {
  it('старт: у каждого 5 кубиков, первым ходит первый по месту', () => {
    const s = perudo.start(['a', 'b'], dice(1, 2, 3, 4, 5, 6, 6, 6, 6, 6));
    expect(s.dice).toEqual({ a: [1, 2, 3, 4, 5], b: [6, 6, 6, 6, 6] });
    expect(perudo.currentPlayer(s)).toBe('a');
    expect(s.round).toBe(1);
  });

  it('правила повышения ставки', () => {
    const bid = (quantity: number, face: number) => ({ playerId: 'x', quantity, face });
    const ok = (prev: ReturnType<typeof bid> | null, q: number, f: number, palifico = false) =>
      expect(() => assertValidRaise(prev, { quantity: q, face: f }, palifico)).not.toThrow();
    const bad = (prev: ReturnType<typeof bid> | null, q: number, f: number, palifico = false) =>
      expect(() => assertValidRaise(prev, { quantity: q, face: f }, palifico)).toThrow();

    bad(null, 2, 1); // начинать с единиц нельзя
    ok(null, 2, 1, true); // а в палифико можно
    ok(bid(3, 4), 4, 2); // больше кубиков — любой номинал
    ok(bid(3, 4), 3, 5); // столько же, номинал выше
    bad(bid(3, 4), 3, 3);
    ok(bid(5, 4), 3, 1); // на единицы — половина с округлением вверх
    bad(bid(5, 4), 2, 1);
    ok(bid(3, 1), 7, 2); // с единиц — вдвое больше плюс один
    bad(bid(3, 1), 6, 6);
    bad(bid(3, 4), 4, 5, true); // в палифико номинал фиксирован
    ok(bid(3, 4), 4, 4, true);
  });

  it('ход по кругу, ставка выше числа кубиков на столе отклоняется', () => {
    let s = table({ a: [2, 2], b: [3, 3], c: [4, 4] });
    expect(() => perudo.applyMove(s, 'a', { type: 'bid', quantity: 7, face: 2 }, rest)).toThrow('всего 6');
    expect(() => perudo.applyMove(s, 'b', { type: 'bid', quantity: 1, face: 2 }, rest)).toThrow('не ваш ход');
    expect(() => perudo.applyMove(s, 'a', { type: 'dudo' }, rest)).toThrow('никто не сделал ставку');

    s = perudo.applyMove(s, 'a', { type: 'bid', quantity: 2, face: 2 }, rest);
    expect(perudo.currentPlayer(s)).toBe('b');
    s = perudo.applyMove(s, 'b', { type: 'bid', quantity: 3, face: 3 }, rest);
    expect(perudo.currentPlayer(s)).toBe('c');
    expect(() => perudo.applyMove(s, 'c', { type: 'bid', quantity: 2, face: 6 }, rest)).toThrow(/больше/);
  });

  it('«не верю», кубиков меньше — теряет поставивший и начинает раунд', () => {
    let s = table({ a: [2, 2, 3, 4, 5], b: [6, 6, 6, 6, 6] });
    s = perudo.applyMove(s, 'a', { type: 'bid', quantity: 3, face: 2 }, rest);
    s = perudo.applyMove(s, 'b', { type: 'dudo' }, rest);

    expect(s.lastReveal).toMatchObject({ call: 'dudo', callerId: 'b', actual: 2, loserId: 'a', gainerId: null });
    expect(s.lastReveal?.dice.a).toEqual([2, 2, 3, 4, 5]);
    expect(s.dice.a).toHaveLength(4);
    expect(s.dice.b).toHaveLength(5);
    expect(s.round).toBe(2);
    expect(s.bids).toEqual([]);
    expect(perudo.currentPlayer(s)).toBe('a');
  });

  it('единицы — джокеры: «не верю» на верную ставку стоит кубика сказавшему', () => {
    let s = table({ a: [1, 1, 3, 4, 5], b: [3, 6, 6, 6, 6] });
    s = perudo.applyMove(s, 'a', { type: 'bid', quantity: 4, face: 3 }, rest);
    s = perudo.applyMove(s, 'b', { type: 'dudo' }, rest);
    expect(s.lastReveal).toMatchObject({ actual: 4, loserId: 'b' });
    expect(s.dice.b).toHaveLength(4);
    expect(perudo.currentPlayer(s)).toBe('b');
  });

  it('«точно»: угадал — кубик возвращается (не больше 5), ошибся — теряешь', () => {
    // Пятёрок с джокерами: 2 + 1 + 1 = 4.
    let s = table({ a: [5, 5, 1], b: [5, 2, 2, 2] });
    s = perudo.applyMove(s, 'a', { type: 'bid', quantity: 4, face: 5 }, rest);
    const exact = perudo.applyMove(s, 'b', { type: 'calza' }, rest);
    expect(exact.lastReveal).toMatchObject({ call: 'calza', actual: 4, gainerId: 'b', loserId: null });
    expect(exact.dice.b).toHaveLength(5);
    expect(perudo.currentPlayer(exact)).toBe('b');

    let full = table({ a: [5, 5, 1], b: [5, 2, 2, 2, 2] });
    full = perudo.applyMove(full, 'a', { type: 'bid', quantity: 4, face: 5 }, rest);
    expect(perudo.applyMove(full, 'b', { type: 'calza' }, rest).dice.b).toHaveLength(5); // больше 5 не бывает

    let wrong = table({ a: [5, 5, 1], b: [5, 2, 2, 2] }, { turnId: 'b' });
    wrong = perudo.applyMove(wrong, 'b', { type: 'bid', quantity: 2, face: 5 }, rest);
    expect(() => perudo.applyMove(wrong, 'b', { type: 'calza' }, rest)).toThrow('не ваш ход');
    const miss = perudo.applyMove(wrong, 'a', { type: 'calza' }, rest);
    expect(miss.lastReveal).toMatchObject({ actual: 4, loserId: 'a' });
    expect(miss.dice.a).toHaveLength(2);
  });

  it('палифико: первый раз с одним кубиком — единицы не джокеры, номинал не меняется', () => {
    let s = table({ a: [3, 3, 3], b: [4, 4] });
    s = perudo.applyMove(s, 'a', { type: 'bid', quantity: 3, face: 4 }, rest);
    s = perudo.applyMove(s, 'b', { type: 'dudo' }, dice(1, 1, 1, 4));
    // Четвёрок всего 2 из заявленных 3 — ставка неверна, кубик теряет a (у него осталось 2, не 1).
    expect(s.lastReveal?.loserId).toBe('a');
    expect(s.palifico).toBe(false);

    // Теперь доводим b до одного кубика.
    s = table({ a: [3, 3, 3], b: [4, 4] }, { turnId: 'b' });
    s = perudo.applyMove(s, 'b', { type: 'bid', quantity: 2, face: 3 }, rest);
    s = perudo.applyMove(s, 'a', { type: 'bid', quantity: 3, face: 3 }, rest);
    s = perudo.applyMove(s, 'b', { type: 'dudo' }, dice(1, 1, 1, 4));
    expect(s.lastReveal?.loserId).toBe('b');
    expect(s.palifico).toBe(true);
    expect(s.palificoUsed).toEqual(['b']);
    expect(perudo.currentPlayer(s)).toBe('b');
    expect(s.dice).toEqual({ a: [1, 1, 1], b: [4] });

    // Единицы a не считаются за четвёрки: ставка «2 четвёрки» неверна.
    expect(() => perudo.applyMove(s, 'b', { type: 'calza' }, rest)).toThrow();
    s = perudo.applyMove(s, 'b', { type: 'bid', quantity: 2, face: 4 }, rest);
    expect(() => perudo.applyMove(s, 'a', { type: 'bid', quantity: 3, face: 5 }, rest)).toThrow('номинал');
    expect(() => perudo.applyMove(s, 'a', { type: 'calza' }, rest)).toThrow('палифико');
    s = perudo.applyMove(s, 'a', { type: 'dudo' }, rest);
    expect(s.lastReveal).toMatchObject({ actual: 1, loserId: 'b' });

    // У b кончились кубики — a победил.
    expect(perudo.winner(s)).toBe('a');
    expect(perudo.currentPlayer(s)).toBeNull();
    expect(() => perudo.applyMove(s, 'a', { type: 'bid', quantity: 1, face: 2 }, rest)).toThrow('окончена');
  });

  it('выбывший пропускается в очереди ходов', () => {
    let s = table({ a: [2], b: [], c: [5, 5] });
    s = perudo.applyMove(s, 'a', { type: 'bid', quantity: 1, face: 5 }, rest);
    expect(perudo.currentPlayer(s)).toBe('c');
  });

  it('чужие кубики не попадают в то, что видит игрок', () => {
    const s = table({ a: [1, 2, 3], b: [4, 5, 6] });
    const view = perudo.viewFor!(s, 'a') as PerudoView;
    expect(view.hands).toEqual({ a: { count: 3, dice: [1, 2, 3] }, b: { count: 3, dice: null } });
    expect(view.totalDice).toBe(6);
    expect(view).not.toHaveProperty('dice');

    const stranger = perudo.viewFor!(s, null) as PerudoView;
    expect(stranger.hands.a?.dice).toBeNull();
    expect(JSON.stringify(stranger)).not.toContain('[1,2,3]');
  });

  it('ушедший игрок: ход передаётся дальше, последний оставшийся побеждает', () => {
    let s = table({ a: [2, 2], b: [3, 3], c: [4, 4] });
    s = perudo.applyMove(s, 'a', { type: 'bid', quantity: 2, face: 2 }, rest);
    s = perudo.removePlayer(s, 'b');
    expect(perudo.currentPlayer(s)).toBe('c');
    expect(s.order).toEqual(['a', 'c']);
    s = perudo.removePlayer(s, 'a');
    expect(perudo.winner(s)).toBe('c');
  });
});
