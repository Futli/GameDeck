import type { PlayerView } from '@gamedeck/shared';

/**
 * Позиция коврика на экране. Боковые позиции бывают одиночные (`left`, `right` — по центру стороны)
 * и парные (`left-low` + `left-high`, когда на стороне сидят двое).
 */
export type ScreenPosition =
  'bottom' | 'left' | 'left-low' | 'left-high' | 'top' | 'right' | 'right-high' | 'right-low';

/**
 * Раскладка по числу игроков, по часовой стрелке начиная снизу. Пустых мест на столе нет:
 * двое сидят друг напротив друга, трое — снизу и по бокам, четверо — по одному на сторону,
 * пятеро — снизу и по двое на боках, шестеро — ещё один сверху.
 */
const LAYOUTS: Record<number, ScreenPosition[]> = {
  1: ['bottom'],
  2: ['bottom', 'top'],
  3: ['bottom', 'left', 'right'],
  4: ['bottom', 'left', 'top', 'right'],
  5: ['bottom', 'left-low', 'left-high', 'right-high', 'right-low'],
  6: ['bottom', 'left-low', 'left-high', 'top', 'right-high', 'right-low'],
};

/** Размер стола: у дуэли нет боковых колонок, у стола на 3–4 — по одному месту на боку, на 5–6 — по два. */
export type TableSize = 'duel' | 'cross' | 'full';
export const tableSize = (count: number): TableSize => (count <= 2 ? 'duel' : count <= 4 ? 'cross' : 'full');

/** Боковые места: коврик стоит вертикально, длинной стороной вдоль края стола. */
export const isSidePosition = (position: ScreenPosition) => position.startsWith('left') || position.startsWith('right');

/**
 * Рассадить игроков на экране. Порядок за столом (по `seat`) у всех одинаковый, а стол повёрнут так,
 * чтобы зритель был снизу. Если зрителя за столом нет, снизу первый по месту.
 */
export function seatLayout(
  players: PlayerView[],
  viewerId: string,
): Array<{ player: PlayerView; position: ScreenPosition }> {
  const bySeat = [...players].sort((a, b) => a.seat - b.seat);
  const me = Math.max(
    0,
    bySeat.findIndex((p) => p.id === viewerId),
  );
  const rotated = [...bySeat.slice(me), ...bySeat.slice(0, me)];
  const positions = LAYOUTS[rotated.length] ?? LAYOUTS[6]!;
  return rotated.map((player, i) => ({ player, position: positions[i]! }));
}
