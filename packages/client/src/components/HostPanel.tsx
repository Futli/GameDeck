import { MAX_PLAYERS, type RoomView } from '@gamedeck/shared';
import { useState } from 'react';
import { api } from '../lib/socket';

/** Настройки комнаты. Видны только хосту и только между партиями. */
export function HostPanel({ room }: { room: RoomView }) {
  const [password, setPassword] = useState('');
  const { settings } = room;

  return (
    <details className="panel">
      <summary>Настройки комнаты</summary>
      <label className="field row">
        <span>Игроков максимум</span>
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
        <span>Ставка (монеты)</span>
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
        <span>Пароль {settings.hasPassword ? '(установлен)' : '(нет)'}</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="новый" />
        <button>{password ? 'Задать' : 'Снять'}</button>
      </form>
    </details>
  );
}
