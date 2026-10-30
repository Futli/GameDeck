export interface EloEntry {
  id: string;
  rating: number;
  /** 1 — первое место. Одинаковые места — ничья между этими игроками. */
  place: number;
}

/**
 * Многопользовательский Elo: партия на N игроков считается как набор дуэлей
 * «каждый с каждым». Выше по месту — победа (1), равные места — ничья (0.5).
 * K делится на N−1, чтобы партия на шестерых не двигала рейтинг в 5 раз сильнее дуэли.
 */
export function multiplayerElo(entries: readonly EloEntry[], k = 32): Map<string, number> {
  const result = new Map<string, number>();
  const kPerDuel = k / Math.max(1, entries.length - 1);

  for (const me of entries) {
    let delta = 0;
    for (const other of entries) {
      if (other === me) continue;
      const expected = 1 / (1 + 10 ** ((other.rating - me.rating) / 400));
      const actual = me.place < other.place ? 1 : me.place === other.place ? 0.5 : 0;
      delta += kPerDuel * (actual - expected);
    }
    result.set(me.id, Math.round(me.rating + delta));
  }
  return result;
}
