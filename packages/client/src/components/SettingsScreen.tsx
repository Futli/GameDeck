import { useT } from '../i18n';
import { setPlayerName, usePlayerName } from '../lib/name';
import { telegramUser } from '../lib/telegram';
import { Avatar } from './Avatar';
import { LanguageSwitch } from './LanguageSwitch';

/** Поле «Ваше имя»: на странице настроек и на экране игры, если имени ещё нет. */
export function NameField() {
  const name = usePlayerName();
  const t = useT();
  return (
    <label className="field">
      <span>{t.lobby.yourName}</span>
      <div className="name-row">
        {telegramUser && <Avatar url={telegramUser.photo_url} name={name} />}
        <input
          value={name}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={24}
          placeholder={t.lobby.namePlaceholder}
        />
      </div>
    </label>
  );
}

/** Настройки игрока: имя за столом и язык интерфейса. Вход — шестерёнка на главной. */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <main className="screen">
      <header className="screen-header">
        <button className="ghost" onClick={onBack}>
          {t.settingsPage.back}
        </button>
        <h2>{t.settingsPage.title}</h2>
      </header>
      <NameField />
      <p className="muted field-hint">{t.settingsPage.nameHint}</p>
      <div className="field">
        <span>{t.language.label}</span>
        <LanguageSwitch />
      </div>
    </main>
  );
}
