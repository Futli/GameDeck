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
 * - Мапуто (в классических правилах — «palifico»): когда у игрока впервые
 *   остаётся 1 кубик, следующий раунд особый — единицы не джокеры, номинал
 *   после первой ставки менять нельзя, «точно» нельзя.
 *
 * Раунд начинается с фазы броска: каждый сам нажимает «Бросить», все трясут
 * стаканы одновременно, без очереди. Ставки начинаются, когда бросили все.
 * Так у стола есть пауза между раундами: все успевают увидеть, кто потерял кубик.
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
  /** Раунд был мапуто: единицы не считались джокерами. */
  maputo: boolean;
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
  /**
   * roll — начало раунда: все бросают кубики одновременно, ставок ещё нет.
   * bid — ставки по кругу.
   */
  phase: 'roll' | 'bid';
  /** Кто уже бросил кубики в этом раунде. До броска кубики игрока — нули. */
  rolled: string[];
  maputo: boolean;
  /** Кто уже вызывал мапуто: у каждого оно бывает один раз. */
  maputoUsed: string[];
  /** Кто остался без кубиков, в порядке выбывания. Нужно для мест в рейтинге. */
  eliminated: string[];
  /** Чей ход в фазе ставок. В фазе броска — кто начнёт торговаться. */
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
  z.object({ type: z.literal('roll') }),
]);
export type PerudoMove = z.infer<typeof perudoMoveSchema>;

const isActive = (state: PerudoState, id: string) => (state.dice[id]?.length ?? 0) > 0;
const activePlayers = (state: PerudoState) => state.order.filter((id) => isActive(state, id));
const totalDice = (state: PerudoState) => state.order.reduce((sum, id) => sum + (state.dice[id]?.length ?? 0), 0);

/** Следующий игрок с кубиками после fromId по кругу (fromId может уже выбыть). */
function nextActive(state: PerudoState, fromId: string, order = state.order): string | null {
  const start = order.indexOf(fromId);
  for (let step = 1; step <= order.length; step++) {
    const id = order[(start + step) % order.length]!;
    if (id !== fromId && isActive(state, id)) return id;
  }
  return null;
}

export function countFace(dice: Record<string, number[]>, face: number, maputo: boolean): number {
  const wild = face !== 1 && !maputo;
  let count = 0;
  for (const hand of Object.values(dice)) {
    for (const value of hand) if (value === face || (wild && value === 1)) count++;
  }
  return count;
}

/** Проверка, что ставка next старше prev. Бросает GameRuleError с понятным текстом. */
export function assertValidRaise(prev: PerudoBid | null, next: Omit<PerudoBid, 'playerId'>, maputo: boolean): void {
  const fail = (message: string) => {
    throw new GameRuleError('BAD_BID', message);
  };
  if (!prev) {
    if (next.face === 1 && !maputo) fail('Раунд нельзя начинать со ставки на единицы');
    return;
  }
  if (maputo) {
    if (next.face !== prev.face) fail('В мапуто номинал менять нельзя');
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

/** Кто ещё не бросил кубики в фазе броска. */
const notRolled = (state: PerudoState) => activePlayers(state).filter((id) => !state.rolled.includes(id));

/** Бросок одного игрока. Когда бросили все — начинаются ставки. */
function rollFor(state: PerudoState, playerId: string, rng: Rng): PerudoState {
  if (state.phase !== 'roll') throw new GameRuleError('ALREADY_ROLLED', 'Кубики в этом раунде уже брошены');
  if (!isActive(state, playerId)) throw new GameRuleError('OUT', 'У вас нет кубиков');
  if (state.rolled.includes(playerId)) throw new GameRuleError('ALREADY_ROLLED', 'Вы уже бросили кубики');
  const hand = state.dice[playerId]!.map(() => rollD6(rng));
  return startBiddingIfReady({
    ...state,
    dice: { ...state.dice, [playerId]: hand },
    rolled: [...state.rolled, playerId],
  });
}

function startBiddingIfReady(state: PerudoState): PerudoState {
  if (state.phase !== 'roll' || state.winnerId || notRolled(state).length > 0) return state;
  // Начинающий мог уйти из-за стола, пока остальные бросали.
  const turnId = state.turnId && isActive(state, state.turnId) ? state.turnId : activePlayers(state)[0]!;
  return { ...state, phase: 'bid', turnId };
}

/** Открыть стаканы, поменять число кубиков и начать новый раунд (или закончить игру). */
function resolveRound(state: PerudoState, callerId: string, call: 'dudo' | 'calza'): PerudoState {
  const bid = state.bids.at(-1)!;
  const actual = countFace(state.dice, bid.face, state.maputo);

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

  const reveal: PerudoReveal = {
    round: state.round,
    call,
    callerId,
    bid,
    maputo: state.maputo,
    dice: state.dice,
    actual,
    loserId,
    gainerId,
  };
  const sized: PerudoState = {
    ...state,
    dice: Object.fromEntries(state.order.map((id) => [id, new Array<number>(counts[id]!).fill(0)])),
    lastReveal: reveal,
    bids: [],
    eliminated: loserId && counts[loserId] === 0 ? [...state.eliminated, loserId] : state.eliminated,
  };

  const alive = activePlayers(sized);
  if (alive.length === 1) return { ...sized, turnId: null, maputo: false, winnerId: alive[0]! };

  const changed = loserId ?? gainerId ?? callerId;
  const starter = isActive(sized, changed) ? changed : nextActive(sized, changed)!;

  const maputo = loserId !== null && counts[loserId] === 1 && !state.maputoUsed.includes(loserId);
  // Новые кубики не бросаем сами: раунд начнётся с фазы броска, каждый нажмёт «Бросить».
  return {
    ...sized,
    round: state.round + 1,
    phase: 'roll',
    rolled: [],
    maputo,
    maputoUsed: maputo ? [...state.maputoUsed, loserId!] : state.maputoUsed,
    turnId: starter,
  };
}

export const perudo: GameModule<PerudoState, PerudoMove> = {
  id: 'perudo',
  title: 'Перудо',
  minPlayers: 2,
  maxPlayers: 6,
  moveSchema: perudoMoveSchema,

  start(playerIds) {
    if (playerIds.length < this.minPlayers) {
      throw new GameRuleError('NOT_ENOUGH_PLAYERS', `Нужно минимум ${this.minPlayers} игрока`);
    }
    // Первый раунд тоже начинается с броска: кубики бросают сами игроки.
    return {
      order: [...playerIds],
      dice: Object.fromEntries(playerIds.map((id) => [id, new Array<number>(PERUDO_START_DICE).fill(0)])),
      round: 1,
      phase: 'roll',
      rolled: [],
      maputo: false,
      maputoUsed: [],
      eliminated: [],
      turnId: playerIds[0]!,
      bids: [],
      lastReveal: null,
      winnerId: null,
    };
  },

  currentPlayer(state) {
    return state.winnerId || state.phase === 'roll' ? null : state.turnId;
  },

  awaiting(state) {
    return state.winnerId || state.phase !== 'roll' ? [] : notRolled(state);
  },

  timeoutMove(state) {
    // Не бросил кубики вовремя — за игрока не бросаем, комната исключит его.
    if (state.phase === 'roll') return null;
    // Молчит на своём ходу: «не верю», а если ставки ещё нет — самая маленькая ставка.
    return state.bids.length > 0 ? { type: 'dudo' } : { type: 'bid', quantity: 1, face: 2 };
  },

  applyMove(state, playerId, move, rng) {
    if (state.winnerId) throw new GameRuleError('GAME_OVER', 'Игра уже окончена');
    if (move.type === 'roll') return rollFor(state, playerId, rng);
    if (state.phase === 'roll') throw new GameRuleError('ROLL_FIRST', 'Сначала все бросают кубики');
    if (state.turnId !== playerId) throw new GameRuleError('NOT_YOUR_TURN', 'Сейчас не ваш ход');

    const current = state.bids.at(-1) ?? null;

    if (move.type === 'bid') {
      if (move.quantity > totalDice(state)) {
        throw new GameRuleError('BAD_BID', `На столе всего ${totalDice(state)} кубиков`);
      }
      assertValidRaise(current, move, state.maputo);
      return {
        ...state,
        bids: [...state.bids, { playerId, quantity: move.quantity, face: move.face }],
        turnId: nextActive(state, playerId),
      };
    }

    if (!current) throw new GameRuleError('NO_BID', 'Ещё никто не сделал ставку');
    if (current.playerId === playerId) throw new GameRuleError('OWN_BID', 'Нельзя спорить со своей ставкой');
    if (move.type === 'calza' && state.maputo) {
      throw new GameRuleError('NO_CALZA', 'В мапуто «точно» говорить нельзя');
    }
    return resolveRound(state, playerId, move.type);
  },

  removePlayer(state, playerId) {
    if (state.winnerId || !state.order.includes(playerId)) return state;

    const { [playerId]: _gone, ...dice } = state.dice;
    const next: PerudoState = {
      ...state,
      order: state.order.filter((id) => id !== playerId),
      dice,
      maputoUsed: state.maputoUsed.filter((id) => id !== playerId),
      rolled: state.rolled.filter((id) => id !== playerId),
    };
    const alive = activePlayers(next);
    if (alive.length === 1) return { ...next, turnId: null, winnerId: alive[0]! };
    // Ушёл тот, чей ход, — ход переходит к следующему по кругу (считаем по старому порядку).
    if (state.turnId === playerId) next.turnId = nextActive(next, playerId, state.order);
    // Ушёл последний, кого ждали в фазе броска, — начинаем ставки.
    return startBiddingIfReady(next);
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
      // До броска своих кубиков ещё нет: в состоянии лежат нули.
      const visible = id === viewerId && !state.winnerId && state.rolled.includes(id);
      hands[id] = { count: own.length, dice: visible ? own : null };
    }
    return { ...rest, hands, totalDice: totalDice(state) };
  },
};
