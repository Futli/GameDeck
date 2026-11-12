import type { PlayerView } from '@gamedeck/shared';
import { describe, expect, it } from 'vitest';
import { seatLayout, tableSize } from '../src/lib/table';

/** Игрок на месте seat; для раскладки важны только id и место. */
const player = (id: string, seat: number) => ({ id, seat }) as PlayerView;

const layout = (players: PlayerView[], viewerId: string) =>
  seatLayout(players, viewerId).map(({ player, position }) => `${player.id}:${position}`);

describe('раскладка стола', () => {
  it('двое сидят друг напротив друга', () => {
    expect(layout([player('a', 0), player('b', 3)], 'a')).toEqual(['a:bottom', 'b:top']);
    expect(tableSize(2)).toBe('duel');
  });

  it('трое: зритель снизу, двое по бокам', () => {
    expect(layout([player('a', 0), player('b', 1), player('c', 4)], 'b')).toEqual(['b:bottom', 'c:left', 'a:right']);
  });

  it('четверо: по одному с каждой стороны', () => {
    const players = [player('a', 0), player('b', 2), player('c', 3), player('d', 5)];
    expect(layout(players, 'c')).toEqual(['c:bottom', 'd:left', 'a:top', 'b:right']);
    expect(tableSize(4)).toBe('cross');
  });

  it('пустые места не занимают позиций, порядок за столом сохраняется', () => {
    const players = [player('e', 5), player('a', 0), player('c', 2), player('b', 1), player('d', 4)];
    expect(layout(players, 'a')).toEqual(['a:bottom', 'b:left-low', 'c:left-high', 'd:right-high', 'e:right-low']);
  });

  it('у всех шестерых свой коврик снизу', () => {
    const players = [0, 1, 2, 3, 4, 5].map((seat) => player(`p${seat}`, seat));
    for (const p of players) expect(seatLayout(players, p.id)[0]!.player.id).toBe(p.id);
    expect(tableSize(6)).toBe('full');
  });

  it('зритель не за столом — снизу первый по месту', () => {
    expect(layout([player('b', 4), player('a', 1)], 'x')).toEqual(['a:bottom', 'b:top']);
  });
});
