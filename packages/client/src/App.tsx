import { Lobby } from './components/Lobby';
import { RoomScreen } from './components/RoomScreen';
import { useClientState } from './lib/store';

export function App() {
  const room = useClientState((s) => s.room);
  const connected = useClientState((s) => s.connected);
  const notice = useClientState((s) => s.notice);

  return (
    <div className="app">
      {!connected && <div className="banner">Подключаемся к серверу…</div>}
      {room ? <RoomScreen room={room} /> : <Lobby />}
      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}
