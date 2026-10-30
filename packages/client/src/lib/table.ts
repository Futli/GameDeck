import { MAX_PLAYERS, type PlayerView } from '@gamedeck/shared';

/**
 * Позиции мест на экране по часовой стрелке, начиная снизу:
 * один снизу, два слева (снизу вверх), один сверху, два справа (сверху вниз).
 * Экранная позиция 0 — всегда «я», так у каждого свой коврик снизу.
 */
export const SCREEN_POSITIONS = ['bottom', 'left-low', 'left-high', 'top', 'right-high', 'right-low'] as const;

/** Боковые места: коврик стоит вертикально, длинной стороной вдоль края стола. */
export const isSidePosition = (position: ScreenPosition) => position.startsWith('left') || position.startsWith('right');
export type ScreenPosition = (typeof SCREEN_POSITIONS)[number];

/** Повернуть стол: место за столом (seat) → позиция на экране для этого зрителя. */
export function screenPosition(seat: number, mySeat: number): ScreenPosition {
  return SCREEN_POSITIONS[(seat - mySeat + MAX_PLAYERS) % MAX_PLAYERS]!;
}

/** Все 6 мест: занятые игроками и пустые. */
export function seatsWithPlayers(players: PlayerView[]): Array<{ seat: number; player: PlayerView | null }> {
  return Array.from({ length: MAX_PLAYERS }, (_, seat) => ({
    seat,
    player: players.find((p) => p.seat === seat) ?? null,
  }));
}
