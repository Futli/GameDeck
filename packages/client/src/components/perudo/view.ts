import type { PerudoReveal, PerudoView, RoomView } from '@gamedeck/shared';

/** Состояние перудо из комнаты, если сейчас (или только что) шло перудо. */
export function perudoView(room: RoomView): PerudoView | undefined {
  return room.game?.gameId === 'perudo' ? (room.game.state as PerudoView) : undefined;
}

/**
 * Открытые стаканы показываем, пока новый раунд не начался первой ставкой,
 * и после конца партии — чтобы все успели посмотреть, кто кого поймал.
 */
export function shownReveal(view: PerudoView): PerudoReveal | null {
  if (!view.lastReveal) return null;
  return view.bids.length === 0 || view.winnerId ? view.lastReveal : null;
}

/** Кубик подходит к ставке: тот же номинал или единица-джокер (кроме палифико). */
export function matchesBid(value: number, face: number, palifico: boolean): boolean {
  return value === face || (value === 1 && face !== 1 && !palifico);
}

/** «4 пятёрки», «1 единица», «2 шестёрки». */
const FACE_NAMES: Record<number, [string, string, string]> = {
  1: ['единица', 'единицы', 'единиц'],
  2: ['двойка', 'двойки', 'двоек'],
  3: ['тройка', 'тройки', 'троек'],
  4: ['четвёрка', 'четвёрки', 'четвёрок'],
  5: ['пятёрка', 'пятёрки', 'пятёрок'],
  6: ['шестёрка', 'шестёрки', 'шестёрок'],
};

export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export const bidText = (quantity: number, face: number) => `${quantity} ${plural(quantity, FACE_NAMES[face]!)}`;
