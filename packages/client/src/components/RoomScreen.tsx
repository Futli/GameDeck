import { ROOM_TIMEOUTS, type RoomView } from '@gamedeck/shared';
import { useState } from 'react';
import { api } from '../lib/socket';
import { useClientState } from '../lib/store';
import { inviteLink as makeInviteLink, shareInvite, tg } from '../lib/telegram';
import { useT } from '../i18n';
import { HostPanel } from './HostPanel';
import { ReadyCheckModal } from './modals/ReadyCheckModal';
import { RollModal } from './modals/RollModal';
import { TimerBar } from './TimerBar';
import { PerudoControls } from './perudo/PerudoControls';
import { perudoView } from './perudo/view';
import { Table } from './Table';
import { Coach, Hint, TutorialToggle } from './tutorial/Coach';

const ignore = () => {};

export function RoomScreen({ room }: { room: RoomView }) {
  const myId = useClientState((s) => s.playerId) ?? '';
  const telegramAppUrl = useClientState((s) => s.telegramAppUrl);
  const myReferralCode = useClientState((s) => s.profile?.referralCode ?? null);
  const lastMatch = useClientState((s) => s.lastMatch);
  const [copied, setCopied] = useState(false);
  const t = useT();

  const me = room.players.find((p) => p.id === myId);
  const isHost = me?.isHost ?? false;
  const canEdit = isHost && room.status !== 'playing';
  const myTurn = room.game?.currentPlayerId === myId && room.status === 'playing';
  const perudo = room.status === 'playing' ? perudoView(room) : undefined;
  // Все вместе бросают кубики в начале раунда — ходов по очереди сейчас нет.
  const rolling = room.status === 'playing' && (room.game?.awaiting.length ?? 0) > 0;
  const currentName = room.players.find((p) => p.id === room.game?.currentPlayerId)?.name;

  // У комнаты с паролем он едет в ссылке: друг войдёт, не вводя его.
  const inviteLink = makeInviteLink(room.code, telegramAppUrl, myReferralCode, room.invitePassword);
  const copyInvite = async () => {
    // В Telegram — системное «Поделиться»: выбрать чат и отправить ссылку.
    if (tg && telegramAppUrl) return shareInvite(inviteLink, t.room.shareText(room.code));
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt(t.room.copyLink, inviteLink);
    }
  };

  return (
    <main className="room">
      <header className="room-header">
        <button className="ghost" onClick={() => void api.leaveRoom().catch(ignore)}>
          {t.room.leave}
        </button>
        <TutorialToggle />
        <button className="code" onClick={() => void copyInvite()} title={t.room.invite}>
          {room.code} {copied ? '✓' : tg && telegramAppUrl ? '↗' : '⧉'}
        </button>
      </header>
      <div className="hint-row">
        <Hint id="leave" />
        <Hint id="invite" />
      </div>

      <Table
        room={room}
        myId={myId}
        lastMatch={lastMatch}
        onKick={canEdit ? (id) => void api.kick(id).catch(ignore) : undefined}
      />

      {/* Пока открыто окно комнаты ожидания или броска, подсказка обучения пряталась бы под ним. */}
      {!rolling && !(room.readyCheck && room.status !== 'playing') && <Coach room={room} myId={myId} />}

      <div className="actions">
        {room.status === 'playing' && room.game?.currentPlayerId && (
          <TimerBar
            msLeft={room.game.msLeft}
            total={ROOM_TIMEOUTS.turn}
            label={myTurn ? t.room.yourTurn : t.room.turnOf(currentName ?? '—')}
          />
        )}
        {perudo && !rolling && <PerudoControls view={perudo} me={me} myTurn={myTurn} />}
        {myTurn && room.game?.gameId === 'dice-high' && (
          <button className="primary big" onClick={() => void api.roll().catch(ignore)}>
            {t.room.roll}
          </button>
        )}
        {myTurn && room.game?.gameId === 'dice-high' && <Hint id="roll" />}
        {isHost && room.status !== 'playing' && !room.readyCheck && (
          <button
            className="primary big"
            disabled={room.players.length < 2}
            onClick={() => void api.startGame().catch(ignore)}
          >
            {t.room.start}
          </button>
        )}
        {isHost && room.status !== 'playing' && !room.readyCheck && <Hint id="start" />}
        {!isHost && room.status !== 'playing' && !room.readyCheck && <p className="muted">{t.room.hostWillStart}</p>}
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
