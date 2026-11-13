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

/** Кубик подходит к ставке: тот же номинал или единица-джокер (кроме мапуто). */
export function matchesBid(value: number, face: number, maputo: boolean): boolean {
  return value === face || (value === 1 && face !== 1 && !maputo);
}
