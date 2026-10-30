import { useState, type FormEvent } from 'react';
import { api } from '../lib/socket';

const NAME_KEY = 'gamedeck.name';

function initialCode() {
  // Ссылка-приглашение выглядит как /?room=K7M2Q
  return new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
}

export function Lobby() {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState(initialCode);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const join = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.joinRoom({ code, name, ...(password ? { password } : {}) }));
  };

  return (
    <main className="lobby">
      <h1 className="logo">GameDeck</h1>
      <p className="muted">Кости с друзьями в реальном времени</p>

      <label className="field">
        <span>Ваше имя</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Например, Лёха" />
      </label>

      <button className="primary" disabled={busy || !name.trim()} onClick={() => run(() => api.createRoom({ name }))}>
        Создать комнату
      </button>

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
