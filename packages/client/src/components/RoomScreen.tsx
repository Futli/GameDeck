import { ROOM_TIMEOUTS, type RoomView } from '@gamedeck/shared';
import { useState } from 'react';
import { api } from '../lib/socket';
import { useClientState } from '../lib/store';
import { inviteLink as makeInviteLink, shareInvite, tg } from '../lib/telegram';
import { HostPanel } from './HostPanel';
import { ReadyCheckModal } from './modals/ReadyCheckModal';
import { RollModal } from './modals/RollModal';
import { TimerBar } from './TimerBar';
import { PerudoControls } from './perudo/PerudoControls';
import { perudoView } from './perudo/view';
import { Table } from './Table';

const ignore = () => {};

export function RoomScreen({ room }: { room: RoomView }) {
  const myId = useClientState((s) => s.playerId) ?? '';
  const telegramAppUrl = useClientState((s) => s.telegramAppUrl);
  const lastMatch = useClientState((s) => s.lastMatch);
  const [copied, setCopied] = useState(false);

  const me = room.players.find((p) => p.id === myId);
  const isHost = me?.isHost ?? false;
  const canEdit = isHost && room.status !== 'playing';
  const myTurn = room.game?.currentPlayerId === myId && room.status === 'playing';
  const perudo = room.status === 'playing' ? perudoView(room) : undefined;
  // Все вместе бросают кубики в начале раунда — ходов по очереди сейчас нет.
  const rolling = room.status === 'playing' && (room.game?.awaiting.length ?? 0) > 0;
  const currentName = room.players.find((p) => p.id === room.game?.currentPlayerId)?.name;

  const inviteLink = makeInviteLink(room.code, telegramAppUrl);
  const copyInvite = async () => {
    // В Telegram — системное «Поделиться»: выбрать чат и отправить ссылку.
    if (tg && telegramAppUrl) return shareInvite(inviteLink, room.code);
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Скопируйте ссылку', inviteLink);
    }
  };

  return (
    <main className="room">
      <header className="room-header">
        <button className="ghost" onClick={() => void api.leaveRoom().catch(ignore)}>
          ← Выйти
        </button>
        <button className="code" onClick={() => void copyInvite()} title="Пригласить в комнату">
          {room.code} {copied ? '✓' : tg && telegramAppUrl ? '↗' : '⧉'}
        </button>
      </header>

      <Table
        room={room}
        myId={myId}
        lastMatch={lastMatch}
        onKick={canEdit ? (id) => void api.kick(id).catch(ignore) : undefined}
      />

      <div className="actions">
        {room.status === 'playing' && room.game?.currentPlayerId && (
          <TimerBar
            msLeft={room.game.msLeft}
            total={ROOM_TIMEOUTS.turn}
            label={myTurn ? 'Ваш ход' : `Ходит ${currentName ?? '—'}`}
          />
        )}
        {perudo && !rolling && <PerudoControls view={perudo} me={me} myTurn={myTurn} />}
        {myTurn && room.game?.gameId === 'dice-high' && (
          <button className="primary big" onClick={() => void api.roll().catch(ignore)}>
            Бросить кубик
          </button>
        )}
        {isHost && room.status !== 'playing' && !room.readyCheck && (
          <button
            className="primary big"
            disabled={room.players.length < 2}
            onClick={() => void api.startGame().catch(ignore)}
          >
            Начать игру
          </button>
        )}
        {!isHost && room.status !== 'playing' && !room.readyCheck && (
          <p className="muted">Хост начнёт игру, когда все соберутся</p>
        )}
      </div>

      {canEdit && !room.readyCheck && <HostPanel room={room} />}

      {/* Модалки потока партии: комната ожидания и общий бросок в начале раунда. */}
      {room.readyCheck && room.status !== 'playing' && (
        <ReadyCheckModal room={room} myId={myId} lastMatch={lastMatch} />
      )}
      {rolling && perudo && <RollModal room={room} view={perudo} myId={myId} />}
    </main>
  );
}
