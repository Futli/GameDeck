import type { RoomSummary } from '@gamedeck/shared';
import { useEffect, useState } from 'react';
import { api, socket } from '../lib/socket';
import { useT } from '../i18n';

/**
 * Открытые комнаты выбранной игры. Комнаты с паролем сервер в список не присылает: в них входят
 * по коду или по ссылке-приглашению. Список обновляется сам, пока экран открыт.
 */
export function RoomList({
  gameId,
  canJoin,
  onJoin,
}: {
  gameId: string;
  /** Имя ещё не введено — войти нельзя, но комнаты видно. */
  canJoin: boolean;
  onJoin: (code: string) => Promise<void>;
}) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const t = useT();

  useEffect(() => {
    const watch = () =>
      void api
        .watchRooms()
        .then(setRooms)
        .catch(() => {});
    // После обрыва связи сервер забывает подписку — подписываемся снова.
    socket.on('connect', watch);
    socket.on('rooms:list', setRooms);
    if (socket.connected) watch();
    return () => {
      socket.off('connect', watch);
      socket.off('rooms:list', setRooms);
      if (socket.connected) void api.unwatchRooms().catch(() => {});
    };
  }, []);

  const list = rooms?.filter((room) => room.gameId === gameId) ?? [];

  // Пока список не пришёл, место под него уже занято невидимой строкой «комнат нет»:
  // иначе раздел появлялся через мгновение и сдвигал вниз вход по коду.
  return (
    <section className="room-list" aria-label={t.rooms.aria} aria-busy={rooms === null}>
      <div className="divider">{t.rooms.title}</div>
      {list.length === 0 && (
        <p className="muted center room-list__empty" style={rooms === null ? { visibility: 'hidden' } : undefined}>
          {t.rooms.empty}
        </p>
      )}
      {list.map((room) => (
        <RoomCard key={room.code} room={room} disabled={!canJoin} onJoin={() => onJoin(room.code)} />
      ))}
    </section>
  );
}

function RoomCard({ room, disabled, onJoin }: { room: RoomSummary; disabled: boolean; onJoin: () => Promise<void> }) {
  const t = useT();
  const full = room.players >= room.maxPlayers;
  const canJoin = room.status !== 'playing' && !full;

  return (
    <div className={`room-card${canJoin ? '' : ' room-card--busy'}`}>
      <div className="room-card__main">
        <div className="room-card__code">{room.code}</div>
        <div className="room-card__info">
          <div>
            {room.hostName}
            {room.stake > 0 && <span className="muted"> · {t.rooms.stake(room.stake)}</span>}
          </div>
          <div className="muted">
            {room.players}/{room.maxPlayers} ·{' '}
            {full && room.status !== 'playing' ? t.rooms.full : t.rooms.status[room.status]}
          </div>
        </div>
        <button className="primary" disabled={disabled || !canJoin} onClick={() => void onJoin()}>
          {t.rooms.join}
        </button>
      </div>
    </div>
  );
}
