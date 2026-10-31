import type { RoomView } from '@gamedeck/shared';
import { useState } from 'react';
import { api } from '../lib/socket';
import { useClientState } from '../lib/store';
import { inviteLink as makeInviteLink, shareInvite, tg } from '../lib/telegram';
import { HostPanel } from './HostPanel';
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

      <Table room={room} myId={myId} lastMatch={lastMatch} onKick={canEdit ? (id) => void api.kick(id).catch(ignore) : undefined} />

      <div className="actions">
        {myTurn && (
          <button className="primary big" onClick={() => void api.roll().catch(ignore)}>
            Бросить кубик
          </button>
        )}
        {isHost && room.status !== 'playing' && (
          <button
            className="primary big"
            disabled={room.players.length < 2}
            onClick={() => void api.startGame().catch(ignore)}
          >
            {room.status === 'finished' ? 'Ещё партию' : 'Начать игру'}
          </button>
        )}
        {!isHost && room.status !== 'playing' && <p className="muted">Хост начнёт игру, когда все соберутся</p>}
      </div>

      {canEdit && <HostPanel room={room} />}
    </main>
  );
}
