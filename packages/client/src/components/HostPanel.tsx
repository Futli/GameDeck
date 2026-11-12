import { MAX_PLAYERS, games, type RoomView } from '@gamedeck/shared';
import { useState } from 'react';
import { api } from '../lib/socket';
import { useT } from '../i18n';
import { gameTitle } from './GamePicker';

/** Настройки комнаты. Видны только хосту и только между партиями. */
export function HostPanel({ room }: { room: RoomView }) {
  const [password, setPassword] = useState('');
  const { settings } = room;
  const t = useT();

  return (
    <details className="panel">
      <summary>{t.settings.title}</summary>
      <label className="field row">
        <span>{t.settings.game}</span>
        <select
          value={settings.gameId}
          onChange={(e) => void api.updateSettings({ gameId: e.target.value }).catch(() => {})}
        >
          {Object.values(games).map((g) => (
            <option key={g.id} value={g.id}>
              {gameTitle(g.id, t)}
            </option>
          ))}
        </select>
      </label>
      <label className="field row">
        <span>{t.settings.maxPlayers}</span>
        <select
          value={settings.maxPlayers}
          onChange={(e) => void api.updateSettings({ maxPlayers: Number(e.target.value) }).catch(() => {})}
        >
          {Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 2).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="field row">
        <span>{t.settings.stake}</span>
        <input
          type="number"
          min={0}
          defaultValue={settings.stake}
          onBlur={(e) => void api.updateSettings({ stake: Number(e.target.value) || 0 }).catch(() => {})}
        />
      </label>
      <form
        className="field row"
        onSubmit={(e) => {
          e.preventDefault();
          void api.updateSettings({ password: password || null }).catch(() => {});
          setPassword('');
        }}
      >
        <span>{t.settings.password(settings.hasPassword)}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t.settings.newPassword}
        />
        <button>{password ? t.settings.setPassword : t.settings.removePassword}</button>
      </form>
    </details>
  );
}
