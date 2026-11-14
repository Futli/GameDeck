import { useState, type FormEvent } from 'react';
import { errorText, useT } from '../i18n';
import { api } from '../lib/socket';
import { usePlayerName } from '../lib/name';
import { setState } from '../lib/store';
import { inviteFor, invitePasswordFor, linkRoomCode } from '../lib/telegram';
import { gameTitle } from './GamePicker';
import { RoomList } from './RoomList';
import { NameField } from './SettingsScreen';

/** Публичное о комнате по коду (GET /api/rooms/:code): есть ли пароль и во что играют. */
export interface RoomPreview {
  gameId: string;
  hasPassword: boolean;
}

/** null — комнаты нет. Ошибку сети показываем внизу экрана, как и остальные. */
export async function fetchRoom(code: string): Promise<RoomPreview | null> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as RoomPreview;
}

/** Ошибка входа: текст сервера уже внизу экрана, здесь только пароль. */
const codeOf = (error: unknown) => (error as { code?: string }).code;

/**
 * Экран игры: создать комнату, войти в открытую из списка или по коду.
 * Комнаты с паролем в списке нет: в неё входят по коду, и пароль спрашивается после кода.
 */
export function GameScreen({ gameId, onBack }: { gameId: string; onBack: () => void }) {
  const t = useT();
  const name = usePlayerName();
  const [newPassword, setNewPassword] = useState('');
  // Пришли по ссылке, а войти сразу не вышло (нет имени или пароля) — код уже вписан.
  const [code, setCode] = useState(linkRoomCode);
  const [password, setPassword] = useState('');
  const [askPassword, setAskPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasName = name.trim() !== '';
  // Поле имени показываем, если имени не было при входе на экран, и не убираем, пока игрок печатает:
  // раньше оно исчезало после первой же буквы, и вся форма под ним подпрыгивала вверх.
  const [askName] = useState(!hasName);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (codeOf(error) === 'WRONG_PASSWORD') setAskPassword(true);
      else if (!codeOf(error)) console.error(error);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(() => api.createRoom({ name, settings: { gameId, ...(newPassword ? { password: newPassword } : {}) } }));

  // Сначала код: если у комнаты есть пароль, а его ещё не спросили — спрашиваем, а не получаем отказ.
  const joinByCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const known = password || invitePasswordFor(code);
      if (!askPassword && !known) {
        const room = await fetchRoom(code);
        if (!room) {
          setState({ notice: errorText('ROOM_NOT_FOUND', 'Комната не найдена') });
          return;
        }
        if (room.hasPassword) {
          setAskPassword(true);
          return;
        }
      }
      // Вход по коду — приглашение: новичок засчитается тому, кто поделился ссылкой, или хосту.
      await api.joinRoom({ code, name, invite: inviteFor(code), ...(known ? { password: known } : {}) });
    });
  };

  return (
    <main className="screen">
      <header className="screen-header">
        <button className="ghost" onClick={onBack}>
          {t.gamePage.back}
        </button>
        <h2>{gameTitle(gameId, t)}</h2>
      </header>
      {t.games[gameId] && <p className="muted screen-lead">{t.games[gameId]!.hint}</p>}

      {askName && <NameField />}

      <section className="create-room">
        <label className="field">
          <span>{t.lobby.roomPassword}</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            maxLength={32}
            placeholder={t.lobby.roomPasswordPlaceholder}
          />
        </label>
        <button className="primary" disabled={busy || !hasName} onClick={() => void create()}>
          {t.lobby.create}
        </button>
      </section>

      <RoomList
        gameId={gameId}
        canJoin={hasName && !busy}
        onJoin={(roomCode) => run(() => api.joinRoom({ code: roomCode, name }))}
      />

      <div className="divider">{t.lobby.joinByCode}</div>
      <form className="join" onSubmit={joinByCode}>
        <input
          className="code-input"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setAskPassword(false);
            setPassword('');
          }}
          maxLength={5}
          placeholder="*****"
          aria-label={t.lobby.codeAria}
        />
        {askPassword && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t.lobby.password}
            maxLength={32}
            autoFocus
          />
        )}
        <button disabled={busy || !hasName || code.length !== 5 || (askPassword && !password)}>{t.lobby.join}</button>
      </form>
      {askPassword && <p className="muted center">{t.lobby.passwordNeeded}</p>}
    </main>
  );
}
