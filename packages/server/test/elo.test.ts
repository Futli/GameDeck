import { describe, expect, it } from 'vitest';
import { multiplayerElo } from '../src/stats/elo.js';

describe('multiplayerElo', () => {
  it('дуэль равных: победитель +16, проигравший −16', () => {
    const r = multiplayerElo([
      { id: 'a', rating: 1000, place: 1 },
      { id: 'b', rating: 1000, place: 2 },
    ]);
    expect(r.get('a')).toBe(1016);
    expect(r.get('b')).toBe(984);
  });

  it('победа над сильным даёт больше, чем над слабым', () => {
    const vsStrong = multiplayerElo([
      { id: 'a', rating: 1000, place: 1 },
      { id: 'b', rating: 1400, place: 2 },
    ]).get('a')!;
    const vsWeak = multiplayerElo([
      { id: 'a', rating: 1000, place: 1 },
      { id: 'b', rating: 600, place: 2 },
    ]).get('a')!;
    expect(vsStrong - 1000).toBeGreaterThan(vsWeak - 1000);
  });

  it('партия на шестерых: сумма изменений около нуля, первый растёт, последний падает', () => {
    const entries = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, rating: 1000, place: i + 1 }));
    const r = multiplayerElo(entries);
    const total = entries.reduce((sum, e) => sum + r.get(e.id)! - 1000, 0);
    expect(Math.abs(total)).toBeLessThanOrEqual(3);
    expect(r.get('a')).toBe(1016);
    expect(r.get('f')).toBe(984);
  });

  it('равные места — ничья, рейтинг не меняется', () => {
    const r = multiplayerElo([
      { id: 'a', rating: 1000, place: 1 },
      { id: 'b', rating: 1000, place: 1 },
    ]);
    expect(r.get('a')).toBe(1000);
  });
});
