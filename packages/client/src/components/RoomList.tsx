import { games, type RoomSummary } from '@gamedeck/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { api, socket } from '../lib/socket';

const STATUS_TEXT: Record<RoomSummary['status'], string> = {
  lobby: 'ждут игроков',
  playing: 'идёт игра',
  finished: 'партия окончена',
};

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
    <section className="room-list" aria-label="Комнаты">
      <div className="divider">Комнаты</div>
      {rooms.length === 0 && <p className="muted center">Пока никого нет — создайте первую комнату</p>}
      {!name.trim() && rooms.length > 0 && <p className="muted center">Введите имя, чтобы войти в комнату</p>}
      {open.map((room) => (
        <RoomCard key={room.code} room={room} disabled={!name.trim()} onJoin={() => onJoin(room.code)} />
      ))}
      {locked.length > 0 && <div className="room-list__group">🔒 С паролем</div>}
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
            {games[room.gameId]?.title ?? room.gameId}
            {room.stake > 0 && <span className="muted"> · ставка {room.stake}</span>}
          </div>
          <div className="muted">
            {room.hostName} · {room.players}/{room.maxPlayers} ·{' '}
            {full && room.status !== 'playing' ? 'мест нет' : STATUS_TEXT[room.status]}
          </div>
        </div>
        {room.hasPassword ? (
          <button disabled={disabled || !canJoin} onClick={onOpen} aria-expanded={opened}>
            🔒 Войти
          </button>
        ) : (
          <button className="primary" disabled={disabled || !canJoin} onClick={() => void onJoin()}>
            Войти
          </button>
        )}
      </div>
      {opened && canJoin && (
        <form className="room-card__password" onSubmit={submit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль комнаты"
            maxLength={32}
            autoFocus
          />
          <button className="primary" disabled={disabled || !password}>
            Войти
          </button>
        </form>
      )}
    </div>
  );
}
