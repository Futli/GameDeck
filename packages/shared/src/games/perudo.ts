import { z } from 'zod';
import { rollD6 } from './dice-high.js';
import { GameRuleError, type GameModule, type Rng } from './types.js';

/**
 * «Перудо» (оно же Dudo, «кубики лжеца»).
 *
 * У каждого стакан с 5 кубиками. В начале раунда все трясут стаканы и смотрят
 * только свои кубики. Дальше по кругу делают ставки на ВСЕ кубики стола:
 * «на столе минимум четыре пятёрки». Следующий игрок либо повышает ставку,
 * либо говорит «Не верю!» (dudo), либо «Точно!» (calza). Тогда все открывают
 * стаканы и считают.
 *
 * - Единицы («пако») — джокеры: считаются за любой номинал ставки.
 * - «Не верю»: если кубиков меньше ставки, кубик теряет тот, кто ставил,
 *   иначе — тот, кто не поверил.
 * - «Точно»: если кубиков ровно столько, сказавший получает кубик обратно
 *   (не больше 5), иначе теряет кубик.
 * - Тот, у кого изменилось число кубиков, начинает следующий раунд.
 * - Без кубиков — выбыл. Последний со стаканом — победитель.
 * - Палифико: когда у игрока впервые остаётся 1 кубик, следующий раунд особый —
 *   единицы не джокеры, номинал после первой ставки менять нельзя, «точно» нельзя.
 */

export const PERUDO_START_DICE = 5;

export interface PerudoBid {
  playerId: string;
  quantity: number;
  face: number;
}

/** Итог раунда: открытые стаканы. Публичен — его видят все. */
export interface PerudoReveal {
  round: number;
  call: 'dudo' | 'calza';
  callerId: string;
  bid: PerudoBid;
  dice: Record<string, number[]>;
  /** Сколько кубиков нужного номинала нашлось (с учётом джокеров). */
  actual: number;
  loserId: string | null;
  gainerId: string | null;
}

/** Полное состояние живёт только на сервере: в dice лежат чужие кубики. */
export interface PerudoState {
  /** Все игроки в порядке мест за столом, включая выбывших. */
  order: string[];
  /** Кубики под стаканами. Пустой массив — игрок выбыл. СЕКРЕТ. */
  dice: Record<string, number[]>;
  round: number;
  palifico: boolean;
  /** Кто уже вызывал палифико: у каждого оно бывает один раз. */
  palificoUsed: string[];
  /** Кто остался без кубиков, в порядке выбывания. Нужно для мест в рейтинге. */
  eliminated: string[];
  turnId: string | null;
  /** Ставки текущего раунда, последняя — действующая. */
  bids: PerudoBid[];
  lastReveal: PerudoReveal | null;
  winnerId: string | null;
}

/** Стакан игрока, как его видит конкретный зритель. */
export interface PerudoHand {
  count: number;
  /** Свои кубики видны, чужие — null (под стаканом). */
  dice: number[] | null;
}

/** То, что уходит клиенту: вместо dice — стаканы со скрытыми чужими кубиками. */
export interface PerudoView extends Omit<PerudoState, 'dice'> {
  hands: Record<string, PerudoHand>;
  totalDice: number;
}

export const perudoMoveSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bid'),
    quantity: z.number().int().min(1).max(30),
    face: z.number().int().min(1).max(6),
  }),
  z.object({ type: z.literal('dudo') }),
  z.object({ type: z.literal('calza') }),
]);
export type PerudoMove = z.infer<typeof perudoMoveSchema>;

const isActive = (state: PerudoState, id: string) => (state.dice[id]?.length ?? 0) > 0;
const activePlayers = (state: PerudoState) => state.order.filter((id) => isActive(state, id));
const totalDice = (state: PerudoState) =>
  state.order.reduce((sum, id) => sum + (state.dice[id]?.length ?? 0), 0);

/** Следующий игрок с кубиками после fromId по кругу (fromId может уже выбыть). */
function nextActive(state: PerudoState, fromId: string, order = state.order): string | null {
  const start = order.indexOf(fromId);
  for (let step = 1; step <= order.length; step++) {
    const id = order[(start + step) % order.length]!;
    if (id !== fromId && isActive(state, id)) return id;
  }
  return null;
}

export function countFace(dice: Record<string, number[]>, face: number, palifico: boolean): number {
  const wild = face !== 1 && !palifico;
  let count = 0;
  for (const hand of Object.values(dice)) {
    for (const value of hand) if (value === face || (wild && value === 1)) count++;
  }
  return count;
}

/** Проверка, что ставка next старше prev. Бросает GameRuleError с понятным текстом. */
export function assertValidRaise(prev: PerudoBid | null, next: Omit<PerudoBid, 'playerId'>, palifico: boolean): void {
  const fail = (message: string) => {
    throw new GameRuleError('BAD_BID', message);
  };
  if (!prev) {
    if (next.face === 1 && !palifico) fail('Раунд нельзя начинать со ставки на единицы');
    return;
  }
  if (palifico) {
    if (next.face !== prev.face) fail('В палифико номинал менять нельзя');
    if (next.quantity <= prev.quantity) fail('Нужно больше кубиков');
    return;
  }
  if (prev.face !== 1 && next.face !== 1) {
    const higher = next.quantity > prev.quantity || (next.quantity === prev.quantity && next.face > prev.face);
    if (!higher) fail('Нужно больше кубиков или тот же счёт с номиналом выше');
  } else if (prev.face !== 1) {
    // Переход на единицы: их вдвое меньше, поэтому хватает половины (с округлением вверх).
    const min = Math.ceil(prev.quantity / 2);
    if (next.quantity < min) fail(`Ставка на единицы — минимум ${min}`);
  } else if (next.face === 1) {
    if (next.quantity <= prev.quantity) fail('Нужно больше единиц');
  } else {
    // Уход с единиц: вдвое больше плюс один.
    const min = prev.quantity * 2 + 1;
    if (next.quantity < min) fail(`После единиц — минимум ${min} кубиков`);
  }
}

function rollHands(state: PerudoState, rng: Rng): Record<string, number[]> {
  const dice: Record<string, number[]> = {};
  for (const id of state.order) {
    dice[id] = Array.from({ length: state.dice[id]?.length ?? 0 }, () => rollD6(rng));
  }
  return dice;
}

/** Открыть стаканы, поменять число кубиков и начать новый раунд (или закончить игру). */
function resolveRound(state: PerudoState, callerId: string, call: 'dudo' | 'calza', rng: Rng): PerudoState {
  const bid = state.bids.at(-1)!;
  const actual = countFace(state.dice, bid.face, state.palifico);

  let loserId: string | null = null;
  let gainerId: string | null = null;
  if (call === 'dudo') loserId = actual < bid.quantity ? bid.playerId : callerId;
  else if (actual === bid.quantity) gainerId = callerId;
  else loserId = callerId;

  // Ставивший мог уже уйти из-за стола — тогда кубик терять некому.
  if (loserId && !state.order.includes(loserId)) loserId = null;

  const counts: Record<string, number> = {};
  for (const id of state.order) counts[id] = state.dice[id]?.length ?? 0;
  if (loserId) counts[loserId]! -= 1;
  if (gainerId) counts[gainerId] = Math.min(PERUDO_START_DICE, counts[gainerId]! + 1);

  const reveal: PerudoReveal = { round: state.round, call, callerId, bid, dice: state.dice, actual, loserId, gainerId };
  const sized: PerudoState = {
    ...state,
    dice: Object.fromEntries(state.order.map((id) => [id, new Array<number>(counts[id]!).fill(0)])),
    lastReveal: reveal,
    bids: [],
    eliminated: loserId && counts[loserId] === 0 ? [...state.eliminated, loserId] : state.eliminated,
  };

  const alive = activePlayers(sized);
  if (alive.length === 1) return { ...sized, turnId: null, palifico: false, winnerId: alive[0]! };

  const changed = loserId ?? gainerId ?? callerId;
  const starter = isActive(sized, changed) ? changed : nextActive(sized, changed)!;

  const palifico = loserId !== null && counts[loserId] === 1 && !state.palificoUsed.includes(loserId);
  return {
    ...sized,
    dice: rollHands(sized, rng),
    round: state.round + 1,
    palifico,
    palificoUsed: palifico ? [...state.palificoUsed, loserId!] : state.palificoUsed,
    turnId: starter,
  };
}

export const perudo: GameModule<PerudoState, PerudoMove> = {
  id: 'perudo',
  title: 'Перудо',
  minPlayers: 2,
  maxPlayers: 6,
  moveSchema: perudoMoveSchema,

  start(playerIds, rng) {
    if (playerIds.length < this.minPlayers) {
      throw new GameRuleError('NOT_ENOUGH_PLAYERS', `Нужно минимум ${this.minPlayers} игрока`);
    }
    const blank: PerudoState = {
      order: [...playerIds],
      dice: Object.fromEntries(playerIds.map((id) => [id, new Array<number>(PERUDO_START_DICE).fill(0)])),
      round: 1,
      palifico: false,
      palificoUsed: [],
      eliminated: [],
      turnId: playerIds[0]!,
      bids: [],
      lastReveal: null,
      winnerId: null,
    };
    return { ...blank, dice: rollHands(blank, rng) };
  },

  currentPlayer(state) {
    return state.winnerId ? null : state.turnId;
  },

  applyMove(state, playerId, move, rng) {
    if (state.winnerId) throw new GameRuleError('GAME_OVER', 'Игра уже окончена');
    if (state.turnId !== playerId) throw new GameRuleError('NOT_YOUR_TURN', 'Сейчас не ваш ход');

    const current = state.bids.at(-1) ?? null;

    if (move.type === 'bid') {
      if (move.quantity > totalDice(state)) {
        throw new GameRuleError('BAD_BID', `На столе всего ${totalDice(state)} кубиков`);
      }
      assertValidRaise(current, move, state.palifico);
      return {
        ...state,
        bids: [...state.bids, { playerId, quantity: move.quantity, face: move.face }],
        turnId: nextActive(state, playerId),
      };
    }

    if (!current) throw new GameRuleError('NO_BID', 'Ещё никто не сделал ставку');
    if (current.playerId === playerId) throw new GameRuleError('OWN_BID', 'Нельзя спорить со своей ставкой');
    if (move.type === 'calza' && state.palifico) {
      throw new GameRuleError('NO_CALZA', 'В палифико «точно» говорить нельзя');
    }
    return resolveRound(state, playerId, move.type, rng);
  },

  removePlayer(state, playerId) {
    if (state.winnerId || !state.order.includes(playerId)) return state;

    const { [playerId]: _gone, ...dice } = state.dice;
    const next: PerudoState = {
      ...state,
      order: state.order.filter((id) => id !== playerId),
      dice,
      palificoUsed: state.palificoUsed.filter((id) => id !== playerId),
    };
    const alive = activePlayers(next);
    if (alive.length === 1) return { ...next, turnId: null, winnerId: alive[0]! };
    // Ушёл тот, чей ход, — ход переходит к следующему по кругу (считаем по старому порядку).
    if (state.turnId === playerId) next.turnId = nextActive(next, playerId, state.order);
    return next;
  },

  winner(state) {
    return state.winnerId;
  },

  standings(state) {
    // Победитель, затем выбывшие: кто продержался дольше, тот выше.
    const groups = state.winnerId ? [[state.winnerId]] : [];
    return [...groups, ...[...state.eliminated].reverse().map((id) => [id])];
  },

  viewFor(state, viewerId): PerudoView {
    const { dice, ...rest } = state;
    const hands: Record<string, PerudoHand> = {};
    for (const id of state.order) {
      const own = dice[id] ?? [];
      // После финала новых кубиков не бросали — последние открытые лежат в lastReveal.
      hands[id] = { count: own.length, dice: id === viewerId && !state.winnerId ? own : null };
    }
    return { ...rest, hands, totalDice: totalDice(state) };
  },
};
