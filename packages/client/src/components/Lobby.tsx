import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/socket';
import { GamePicker, loadGameChoice, saveGameChoice } from './GamePicker';
import { RoomList } from './RoomList';
import { useClientState } from '../lib/store';
import { Avatar } from './Avatar';
import { ProfileStats } from './ProfileCard';
import { startRoomCode, telegramName, telegramUser } from '../lib/telegram';

const NAME_KEY = 'gamedeck.name';

function initialCode() {
  // Приглашение в браузере — /?room=K7M2Q, в Telegram — t.me/<бот>/<приложение>?startapp=K7M2Q.
  return startRoomCode ?? new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
}

/** Пришли по приглашению из Telegram — сразу садимся за стол. Один раз, даже в StrictMode. */
let autoJoinDone = false;

export function Lobby() {
  // В Telegram имя берём из профиля — вводить ничего не нужно.
  const [name, setName] = useState(() => telegramName ?? localStorage.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState(initialCode);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [gameId, setGameId] = useState(loadGameChoice);
  const [busy, setBusy] = useState(false);
  const profile = useClientState((s) => s.profile);
  const nameEdited = useRef(false);

  // Профиль пришёл с сервера — подставляем сохранённое имя, если игрок ещё ничего не вводил.
  // «Игрок» — имя по умолчанию у новичка, его не подставляем.
  useEffect(() => {
    if (!profile || telegramName || nameEdited.current || profile.displayName === 'Игрок') return;
    setName(profile.displayName);
  }, [profile]);

  const run = async (action: () => Promise<unknown>) => {
    localStorage.setItem(NAME_KEY, name.trim());
    setBusy(true);
    try {
      await action();
    } catch (err) {
      // Текст ошибки сервера уже показан внизу экрана; здесь реагируем только на пароль.
      if ((err as { code?: string }).code === 'WRONG_PASSWORD') setNeedsPassword(true);
      else if (!(err as { code?: string }).code) console.error(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoJoinDone || !telegramName || !startRoomCode) return;
    autoJoinDone = true;
    // Socket.IO придержит запрос, пока соединение не установится.
    void run(() => api.joinRoom({ code: startRoomCode!, name: telegramName! }));
  }, []);

  const join = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.joinRoom({ code, name, ...(password ? { password } : {}) }));
  };

  return (
    <main className="lobby">
      <h1 className="logo">GameDeck</h1>
      <p className="muted">Кости с друзьями в реальном времени</p>

      {telegramUser ? (
        <div className="me">
          <Avatar url={telegramUser.photo_url} name={name} />
          <span>{name}</span>
        </div>
      ) : (
        <label className="field">
          <span>Ваше имя</span>
          <input
            value={name}
            onChange={(e) => {
              nameEdited.current = true;
              setName(e.target.value);
            }}
            maxLength={24}
            placeholder="Например, Лёха"
          />
        </label>
      )}

      {profile && <ProfileStats profile={profile} />}

      <div className="field">
        <span>Во что играем</span>
        <GamePicker
          value={gameId}
          onChange={(id) => {
            setGameId(id);
            saveGameChoice(id);
          }}
        />
      </div>

      <label className="field">
        <span>Пароль комнаты (необязательно)</span>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          maxLength={32}
          placeholder="Без пароля — комната открыта всем"
        />
      </label>

      <button
        className="primary"
        disabled={busy || !name.trim()}
        onClick={() => run(() => api.createRoom({ name, settings: { gameId, ...(newPassword ? { password: newPassword } : {}) } }))}
      >
        Создать комнату
      </button>

      <RoomList
        name={name}
        onJoin={(roomCode, roomPassword) =>
          run(() => api.joinRoom({ code: roomCode, name, ...(roomPassword ? { password: roomPassword } : {}) }))
        }
      />

      <div className="divider">или войти по коду</div>

      <form className="join" onSubmit={join}>
        <input
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={5}
          placeholder="K7M2Q"
          aria-label="Код комнаты"
        />
        {needsPassword && (
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" />
        )}
        <button disabled={busy || !name.trim() || code.length !== 5}>Войти</button>
      </form>
    </main>
  );
}
