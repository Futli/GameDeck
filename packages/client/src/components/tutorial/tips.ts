import type { RoomView } from '@gamedeck/shared';
import { perudoView, shownReveal } from '../perudo/view';
import type { TipId, TipParams } from './texts';

/**
 * Какие подсказки подходят к тому, что сейчас на столе, в порядке важности.
 * Чистая функция от RoomView: обучение не хранит своей копии игры, а смотрит
 * на то же состояние, что прислал сервер, поэтому не может с ним разойтись.
 */
export function relevantTips(room: RoomView, myId: string): TipId[] {
  const me = room.players.find((p) => p.id === myId);
  if (room.status === 'lobby') return [me?.isHost ? 'waiting-host' : 'waiting-guest'];
  if (room.status === 'finished') return ['finished'];

  const perudo = perudoView(room);
  if (!perudo) return room.game?.gameId === 'dice-high' ? ['dice-high'] : [];

  const tips: TipId[] = [];
  // Вскрытие объясняем первым: оно висит на столе, пока никто не сделал новую ставку.
  if (shownReveal(perudo)) tips.push('reveal');
  if ((perudo.hands[myId]?.count ?? 0) === 0) return [...tips, 'eliminated'];

  // В палифико единицы не джокеры, поэтому вместо подсказки про джокеров — про особый раунд.
  tips.push('perudo-goal', perudo.palifico ? 'palifico' : 'perudo-jokers');
  if (room.game?.currentPlayerId === myId) tips.push(perudo.bids.length === 0 ? 'first-bid' : 'raise');
  else tips.push('others-turn');
  return tips;
}

/** Первая подсказка, которую игрок ещё не закрыл; null — объяснять сейчас нечего. */
export function pickTip(room: RoomView, myId: string, seen: ReadonlySet<TipId>): TipId | null {
  return relevantTips(room, myId).find((id) => !seen.has(id)) ?? null;
}

/** Числа для текста подсказки. */
export function tipParams(room: RoomView): TipParams {
  const perudo = perudoView(room);
  const totalDice = perudo?.totalDice ?? 0;
  // С джокерами под номинал подходят две грани из шести, в палифико — одна.
  const share = perudo?.palifico ? 6 : 3;
  const turnName = room.players.find((p) => p.id === room.game?.currentPlayerId)?.name ?? '—';
  return { totalDice, expected: Math.round(totalDice / share), turnName };
}
