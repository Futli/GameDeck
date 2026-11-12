import { ROOM_TIMEOUTS, games, type MatchRecord, type RoomView } from '@gamedeck/shared';
import { useState } from 'react';
import { api } from '../../lib/socket';
import { Avatar } from '../Avatar';
import { TimerBar } from '../TimerBar';
import { Sheet } from './Sheet';

const ignore = () => {};

/** Итог партии для меня: победа или поражение, сколько монет. */
function Outcome({ room, myId, lastMatch }: { room: RoomView; myId: string; lastMatch: MatchRecord | null }) {
  const winnerId = room.game?.winnerId;
  const winner = room.players.find((p) => p.id === winnerId);
  const coins = lastMatch?.players.find((p) => p.playerId === myId)?.coins ?? 0;
  const won = winnerId === myId;
  return (
    <div className={won ? 'outcome outcome--win' : 'outcome outcome--lose'}>
      <div className="outcome-icon" aria-hidden>
        {won ? '🏆' : '🎲'}
      </div>
      <div className="outcome-text">{won ? 'Победа!' : `Победил ${winner?.name ?? 'другой игрок'}`}</div>
      {coins !== 0 && (
        <div className={coins > 0 ? 'delta up' : 'delta down'}>
          {coins > 0 ? '+' : ''}
          {coins} мон.
        </div>
      )}
    </div>
  );
}

/** Ставку следующей партии меняет хост. Все подтверждают заново. */
function StakeEditor({ stake }: { stake: number }) {
  const [value, setValue] = useState(String(stake));
  const next = Number(value);
  const valid = value !== '' && Number.isInteger(next) && next >= 0;
  return (
    <form
      className="stake-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && next !== stake) void api.updateSettings({ stake: next }).catch(ignore);
      }}
    >
      <span>Ставка</span>
      <input type="number" min={0} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
      <button disabled={!valid || next === stake}>Сменить</button>
    </form>
  );
}

/**
 * Комната ожидания: «Партия начинается» или «Партия окончена — играем ещё?».
 * Каждый видит, кто уже подтвердил. Кто не ответит до конца таймера — выйдет
 * из комнаты, а партия начнётся без него.
 */
export function ReadyCheckModal({
  room,
  myId,
  lastMatch,
}: {
  room: RoomView;
  myId: string;
  lastMatch: MatchRecord | null;
}) {
  const check = room.readyCheck!;
  const me = room.players.find((p) => p.id === myId);
  const isHost = me?.isHost ?? false;
  const ready = new Set(check.ready);
  const iAmReady = ready.has(myId);
  const everyoneReady = room.players.every((p) => ready.has(p.id));
  const game = games[room.settings.gameId];
  const enough = room.players.length >= (game?.minPlayers ?? 2);
  const rematch = check.reason === 'rematch';

  return (
    <Sheet title={rematch ? 'Партия окончена' : 'Партия начинается'} late={rematch}>
      {rematch && <Outcome room={room} myId={myId} lastMatch={lastMatch} />}

      <div className="sheet-info">
        <b>{game?.title ?? room.settings.gameId}</b>
        <span className="muted">{room.settings.stake > 0 ? `ставка ${room.settings.stake} мон.` : 'без ставки'}</span>
      </div>
      {isHost && rematch && <StakeEditor key={room.settings.stake} stake={room.settings.stake} />}

      <ul className="ready-list">
        {room.players.map((p) => (
          <li key={p.id} className={ready.has(p.id) ? 'ready-item ready-item--yes' : 'ready-item'}>
            <Avatar url={p.avatarUrl} name={p.name} />
            <span className="ready-name">
              {p.isHost && '♛ '}
              {p.name}
              {p.id === myId && <span className="muted"> (вы)</span>}
            </span>
            <span className="ready-status">{ready.has(p.id) ? '✓ играет' : 'думает…'}</span>
          </li>
        ))}
      </ul>

      <TimerBar
        msLeft={check.msLeft}
        total={rematch ? ROOM_TIMEOUTS.rematch : ROOM_TIMEOUTS.start}
        label="Кто не ответит — выйдет"
      />
      {check.hostDecides && (
        <p className="muted center">
          {enough
            ? 'Кто-то вышел. Хост может подождать нового игрока или начать без него.'
            : 'Игроков не хватает — ждём, пока кто-нибудь войдёт по коду.'}
        </p>
      )}

      <div className="sheet-actions">
        {!iAmReady && (
          <button className="primary big" onClick={() => void api.ready().catch(ignore)}>
            {rematch ? 'Играть ещё' : 'Играю'}
          </button>
        )}
        {iAmReady && isHost && check.hostDecides && (
          <button
            className="primary big"
            disabled={!everyoneReady || !enough}
            onClick={() => void api.startGame().catch(ignore)}
          >
            Начать без ушедших
          </button>
        )}
        {iAmReady && !(isHost && check.hostDecides) && <p className="muted center">Ждём остальных…</p>}
        <button className="ghost-button" onClick={() => void api.leaveRoom().catch(ignore)}>
          Выйти из комнаты
        </button>
      </div>
    </Sheet>
  );
}
