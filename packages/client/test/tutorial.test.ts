import { perudo, type PerudoState, type PlayerView, type RoomView } from '@gamedeck/shared';
import { describe, expect, it } from 'vitest';
import type { TipId } from '../src/components/tutorial/texts';
import { pickTip, relevantTips, tipParams } from '../src/components/tutorial/tips';

const player = (id: string, seat: number, isHost = false): PlayerView => ({
  id,
  name: id.toUpperCase(),
  seat,
  color: 'red',
  dice: {} as PlayerView['dice'],
  skins: {},
  avatarUrl: null,
  isHost,
  connected: true,
});

const players = [player('a', 0, true), player('b', 1)];
const settings = { gameId: 'perudo', hasPassword: false } as RoomView['settings'];

const lobby = (): RoomView => ({ code: 'K7M2Q', status: 'lobby', settings, players, game: null });

/** Комната с партией перудо глазами viewer: вид получен настоящим viewFor, как на сервере. */
const playing = (state: PerudoState, viewer: string): RoomView => ({
  code: 'K7M2Q',
  status: 'playing',
  settings,
  players,
  game: { gameId: 'perudo', state: perudo.viewFor(state, viewer), currentPlayerId: state.turnId, winnerId: null },
});

const table = (over: Partial<PerudoState> = {}): PerudoState => ({
  order: ['a', 'b'],
  dice: { a: [2, 3, 4, 5, 6], b: [1, 1, 2, 2, 3] },
  round: 1,
  palifico: false,
  palificoUsed: [],
  eliminated: [],
  turnId: 'a',
  bids: [],
  lastReveal: null,
  winnerId: null,
  ...over,
});

const none = new Set<TipId>();

describe('обучение: какая подсказка сейчас', () => {
  it('в лобби хосту объясняет, как позвать друзей и начать, гостю — что ждём', () => {
    expect(pickTip(lobby(), 'a', none)).toBe('waiting-host');
    expect(pickTip(lobby(), 'b', none)).toBe('waiting-guest');
  });

  it('в начале партии сначала цель игры, потом джокеры, потом первая ставка', () => {
    const room = playing(table(), 'a');
    expect(relevantTips(room, 'a')).toEqual(['perudo-goal', 'perudo-jokers', 'first-bid']);
    expect(pickTip(room, 'a', new Set<TipId>(['perudo-goal']))).toBe('perudo-jokers');
    expect(pickTip(room, 'a', new Set<TipId>(['perudo-goal', 'perudo-jokers']))).toBe('first-bid');
  });

  it('не в свой ход — подсказка про чужой ход, после ставки — как перебить', () => {
    expect(relevantTips(playing(table(), 'b'), 'b').at(-1)).toBe('others-turn');
    const afterBid = table({ turnId: 'b', bids: [{ playerId: 'a', quantity: 2, face: 3 }] });
    expect(relevantTips(playing(afterBid, 'b'), 'b').at(-1)).toBe('raise');
  });

  it('вскрытие объясняется первым, в палифико вместо джокеров — особый раунд', () => {
    const reveal = {
      round: 1,
      call: 'dudo' as const,
      callerId: 'b',
      bid: { playerId: 'a', quantity: 9, face: 6 },
      palifico: false,
      dice: { a: [2, 3, 4, 5, 6], b: [1, 1, 2, 2, 3] },
      actual: 3,
      loserId: 'a',
      gainerId: null,
    };
    const state = table({ round: 2, palifico: true, dice: { a: [6], b: [1, 2, 3, 4, 5] }, lastReveal: reveal });
    expect(relevantTips(playing(state, 'a'), 'a')).toEqual(['reveal', 'perudo-goal', 'palifico', 'first-bid']);
  });

  it('выбывшему — только про выбывание', () => {
    const state = table({ dice: { a: [], b: [1, 2, 3] }, turnId: 'b', eliminated: ['a'] });
    expect(relevantTips(playing(state, 'a'), 'a')).toEqual(['eliminated']);
  });

  it('когда всё прочитано, подсказки нет', () => {
    const room = playing(table(), 'a');
    expect(pickTip(room, 'a', new Set(relevantTips(room, 'a')))).toBeNull();
  });

  it('ориентир для ставки: треть кубиков с джокерами, шестая часть в палифико', () => {
    expect(tipParams(playing(table(), 'a'))).toMatchObject({ totalDice: 10, expected: 3, turnName: 'A' });
    const palifico = table({ palifico: true, dice: { a: [6], b: [1, 2, 3, 4, 5, 6, 6] } });
    expect(tipParams(playing(palifico, 'a')).expected).toBe(1);
  });
});
