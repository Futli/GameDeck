import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/socket';
import { adoptProfileName, getPlayerName } from '../lib/name';
import { useClientState } from '../lib/store';
import { inviteFor, invitePasswordFor, linkRoomCode, startLuck } from '../lib/telegram';
import { useT } from '../i18n';
import { GameCards } from './GamePicker';
import { fetchRoom, GameScreen } from './GameScreen';
import { SettingsIcon, SkinsIcon, StatsIcon } from './Icons';
import { LuckScreen } from './LuckScreen';
import { LuckWidget } from './LuckWidget';
import { SettingsScreen } from './SettingsScreen';
import { SkinsScreen } from './SkinsScreen';
import { StatsScreen } from './StatsScreen';

/** Пришли по приглашению — сразу садимся за стол. Один раз, даже в StrictMode. */
let autoJoinDone = false;

/**
 * Где игрок вне комнаты: главная, экран выбранной игры или раздел из правого верхнего угла.
 * На «Кубик удачи» ведёт «Подробнее» из окна приза (в виджете на главной или в чате с ботом).
 */
type Screen =
  | { name: 'main' }
  | { name: 'game'; gameId: string }
  | { name: 'luck'; skinId: string | null }
  | { name: 'skins' }
  | { name: 'stats' }
  | { name: 'settings' };

export function Lobby() {
  const [screen, setScreen] = useState<Screen>(
    startLuck ? { name: 'luck', skinId: startLuck.skinId } : { name: 'main' },
  );
  const profile = useClientState((s) => s.profile);
  const t = useT();
  const home = () => setScreen({ name: 'main' });
  const openLuck = useCallback((skinId: string | null) => setScreen({ name: 'luck', skinId }), []);

  // Профиль пришёл с сервера — подставляем сохранённое там имя (его могли сменить на другом устройстве).
  useEffect(() => {
    if (profile) adoptProfileName(profile.displayName);
  }, [profile]);

  // Ссылка-приглашение: ждём профиль (в нём ник, который игрок мог сменить), и сразу за стол.
  // Пароль комнаты едет в ссылке. Если войти сразу нельзя (нет имени, старая ссылка без пароля),
  // открываем экран игры этой комнаты с вписанным кодом.
  useEffect(() => {
    if (autoJoinDone || !linkRoomCode || !profile) return;
    autoJoinDone = true;
    void (async () => {
      const room = await fetchRoom(linkRoomCode).catch(() => null);
      if (!room) return;
      const password = invitePasswordFor(linkRoomCode);
      const name = getPlayerName();
      const toGame = () => setScreen({ name: 'game', gameId: room.gameId });
      if (!name.trim() || (room.hasPassword && !password)) return toGame();
      await api
        .joinRoom({
          code: linkRoomCode,
          name,
          invite: inviteFor(linkRoomCode),
          ...(password ? { password } : {}),
        })
        .catch(toGame);
    })();
  }, [profile]);

  switch (screen.name) {
    case 'game':
      return <GameScreen gameId={screen.gameId} onBack={home} />;
    case 'luck':
      return <LuckScreen skinId={screen.skinId} onBack={home} onSkins={() => setScreen({ name: 'skins' })} />;
    case 'skins':
      return <SkinsScreen onBack={home} />;
    case 'settings':
      return <SettingsScreen onBack={home} />;
    case 'stats':
      if (profile) return <StatsScreen profile={profile} onBack={home} />;
  }

  return (
    <main className="home">
      <header className="home-header">
        <h1 className="logo">GameDeck</h1>
        <nav className="home-actions">
          <button
            className="icon-button"
            onClick={() => setScreen({ name: 'skins' })}
            aria-label={t.lobby.mySkins}
            title={t.lobby.mySkins}
          >
            <SkinsIcon />
          </button>
          <button
            className="icon-button"
            onClick={() => setScreen({ name: 'stats' })}
            disabled={!profile}
            aria-label={t.lobby.stats}
            title={t.lobby.stats}
          >
            <StatsIcon />
          </button>
          <button
            className="icon-button"
            onClick={() => setScreen({ name: 'settings' })}
            aria-label={t.lobby.settings}
            title={t.lobby.settings}
          >
            <SettingsIcon />
          </button>
        </nav>
      </header>

      <LuckWidget onDetails={openLuck} />
      <button className="ghost luck-rules" onClick={() => openLuck(null)}>
        {t.lobby.luckRules}
      </button>

      <div className="coins-card">
        <span className="coins-card__icon" aria-hidden>
          🪙
        </span>
        <b>{profile?.coins ?? '—'}</b>
        <span className="muted">{t.profile.coins}</span>
      </div>

      <div className="field">
        <span>{t.lobby.whatToPlay}</span>
        <GameCards profile={profile} onPick={(gameId) => setScreen({ name: 'game', gameId })} />
      </div>
    </main>
  );
}
