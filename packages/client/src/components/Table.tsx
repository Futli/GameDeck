import type React from 'react';
import { PLAYER_COLOR_HEX, games, type DiceHighState, type MatchRecord, type RoomView } from '@gamedeck/shared';
import { isSidePosition, screenPosition, seatsWithPlayers } from '../lib/table';
import { Avatar } from './Avatar';
import { Die } from './Die';
import { PerudoCenter } from './perudo/PerudoCenter';
import { PerudoMat } from './perudo/PerudoMat';
import { perudoView } from './perudo/view';

interface Props {
  room: RoomView;
  myId: string;
  lastMatch: MatchRecord | null;
  onKick?: (playerId: string) => void;
}

/** Броски, которые показываем на ковриках: текущего раунда, а если он пуст — прошлого. */
function visibleRolls(state: DiceHighState | undefined): Record<string, number> {
  if (!state) return {};
  if (Object.keys(state.rolls).length > 0) return state.rolls;
  return state.history.at(-1)?.rolls ?? {};
}

/**
 * Стол на 6 мест. Сервер присылает места 0..5, клиент поворачивает стол так,
 * чтобы своё место было снизу. Центр стола — информация о партии.
 */
export function Table({ room, myId, lastMatch, onKick }: Props) {
  const me = room.players.find((p) => p.id === myId);
  const mySeat = me?.seat ?? 0;
  const game = room.game;
  // У каждой игры своё состояние: стол знает, как нарисовать коврик и центр для каждой.
  const state = game?.gameId === 'dice-high' ? (game.state as DiceHighState) : undefined;
  const perudo = perudoView(room);
  const rolls = visibleRolls(state);
  const nameOf = (id: string | null) => room.players.find((p) => p.id === id)?.name ?? '—';

  return (
    <div className="table">
      {seatsWithPlayers(room.players).map(({ seat, player }) => {
        const position = screenPosition(seat, mySeat);
        const side = isSidePosition(position) && 'seat--side';
        if (!player) return <div key={seat} className={['seat', `seat--${position}`, side, 'seat--empty'].filter(Boolean).join(' ')} />;

        const isTurn = game?.currentPlayerId === player.id;
        const isWinner = game?.winnerId === player.id;
        const out =
          room.status === 'playing' &&
          ((state && !state.contenders.includes(player.id)) || (perudo && (perudo.hands[player.id]?.count ?? 0) === 0));
        const change = lastMatch?.players.find((p) => p.playerId === player.id);
        const delta = change ? change.ratingAfter - change.ratingBefore : null;

        return (
          <div
            key={seat}
            className={[
              'seat',
              `seat--${position}`,
              side,
              isTurn && 'seat--turn',
              isWinner && 'seat--winner',
              out && 'seat--out',
              !player.connected && 'seat--offline',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div
              className="mat"
              style={
                {
                  '--light': PLAYER_COLOR_HEX[player.color].light,
                  '--main': PLAYER_COLOR_HEX[player.color].main,
                  '--shade': PLAYER_COLOR_HEX[player.color].shade,
                } as React.CSSProperties
              }
            >
              {rolls[player.id] !== undefined && <Die value={rolls[player.id]!} style={player.dice} />}
              {perudo && room.status !== 'lobby' && <PerudoMat view={perudo} player={player} myId={myId} />}
            </div>
            <div className="seat-name">
              {player.avatarUrl && <Avatar url={player.avatarUrl} name={player.name} />}
              {player.isHost && <span title="Хост">♛ </span>}
              {player.name}
              {player.id === myId && <span className="muted"> (вы)</span>}
              {delta !== null && (
                <span className={delta >= 0 ? 'delta up' : 'delta down'}>
                  {' '}
                  {delta >= 0 ? '+' : ''}
                  {delta}
                </span>
              )}
              {change && change.coins !== 0 && (
                <span className={change.coins > 0 ? 'delta up' : 'delta down'}>
                  {' '}
                  {change.coins > 0 ? '+' : ''}
                  {change.coins} мон.
                </span>
              )}
            </div>
            {onKick && player.id !== myId && (
              <button className="kick" onClick={() => onKick(player.id)} title="Исключить">
                ✕
              </button>
            )}
          </div>
        );
      })}

      <div className="table-center">
        <div className="game-title">{games[room.settings.gameId]?.title ?? room.settings.gameId}</div>
        {room.status === 'lobby' && (
          <div className="muted">
            Ждём игроков: {room.players.length}/{room.settings.maxPlayers}
          </div>
        )}
        {room.status === 'playing' && game && !state && !perudo && <div className="muted">Интерфейс этой игры ещё в работе</div>}
        {room.status !== 'lobby' && perudo && <PerudoCenter view={perudo} nameOf={nameOf} />}
        {room.status === 'playing' && state && (
          <>
            {state.round > 1 && <div className="round">Переброс, раунд {state.round}</div>}
            <div>
              Ходит: <b>{nameOf(game!.currentPlayerId)}</b>
            </div>
          </>
        )}
        {room.status === 'finished' && game && (
          <div className="winner">
            🏆 <b>{nameOf(game.winnerId)}</b>
          </div>
        )}
        {room.settings.stake > 0 && <div className="muted">Ставка: {room.settings.stake}</div>}
      </div>
    </div>
  );
}
