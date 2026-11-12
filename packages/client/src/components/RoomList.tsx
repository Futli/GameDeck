import type { RoomSummary } from '@gamedeck/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { api, socket } from '../lib/socket';
import { useT } from '../i18n';
import { gameTitle } from './GamePicker';

/**
 * Уже созданные комнаты на главной. Сервер присылает их отсортированными:
 * сначала открытые, потом с паролем. Список обновляется сам, пока экран открыт.
 */
export function RoomList({
  name,
  onJoin,
}: {
  name: string;
  onJoin: (code: string, password?: string) => Promise<void>;
}) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
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

  if (rooms === null) return null;

  const open = rooms.filter((r) => !r.hasPassword);
  const locked = rooms.filter((r) => r.hasPassword);

  return (
    <section className="room-list" aria-label={t.rooms.aria}>
      <div className="divider">{t.rooms.title}</div>
      {rooms.length === 0 && <p className="muted center">{t.rooms.empty}</p>}
      {!name.trim() && rooms.length > 0 && <p className="muted center">{t.rooms.enterName}</p>}
      {open.map((room) => (
        <RoomCard key={room.code} room={room} disabled={!name.trim()} onJoin={() => onJoin(room.code)} />
      ))}
      {locked.length > 0 && <div className="room-list__group">{t.rooms.withPassword}</div>}
      {locked.map((room) => (
        <RoomCard
          key={room.code}
          room={room}
          disabled={!name.trim()}
          opened={opened === room.code}
          onOpen={() => setOpened(opened === room.code ? null : room.code)}
          onJoin={(password) => onJoin(room.code, password)}
        />
      ))}
    </section>
  );
}

function RoomCard({
  room,
  disabled,
  opened = false,
  onOpen,
  onJoin,
}: {
  room: RoomSummary;
  disabled: boolean;
  opened?: boolean;
  onOpen?: () => void;
  onJoin: (password?: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const t = useT();
  const full = room.players >= room.maxPlayers;
  const canJoin = room.status !== 'playing' && !full;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onJoin(password);
  };

  return (
    <div className={`room-card${canJoin ? '' : ' room-card--busy'}`}>
      <div className="room-card__main">
        <div className="room-card__code">{room.code}</div>
        <div className="room-card__info">
          <div>
            {gameTitle(room.gameId, t)}
            {room.stake > 0 && <span className="muted"> · {t.rooms.stake(room.stake)}</span>}
          </div>
          <div className="muted">
            {room.hostName} · {room.players}/{room.maxPlayers} ·{' '}
            {full && room.status !== 'playing' ? t.rooms.full : t.rooms.status[room.status]}
          </div>
        </div>
        {room.hasPassword ? (
          <button disabled={disabled || !canJoin} onClick={onOpen} aria-expanded={opened}>
            🔒 {t.rooms.join}
          </button>
        ) : (
          <button className="primary" disabled={disabled || !canJoin} onClick={() => void onJoin()}>
            {t.rooms.join}
          </button>
        )}
      </div>
      {opened && canJoin && (
        <form className="room-card__password" onSubmit={submit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t.rooms.passwordPlaceholder}
            maxLength={32}
            autoFocus
          />
          <button className="primary" disabled={disabled || !password}>
            {t.rooms.join}
          </button>
        </form>
      )}
    </div>
  );
}
