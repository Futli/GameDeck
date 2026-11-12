import { LANGS, setLang, useLang, useT } from '../i18n';

/** Переключатель языка на главной: две кнопки RU / EN, выбор запоминается в браузере. */
export function LanguageSwitch() {
  const lang = useLang();
  const t = useT();
  return (
    <div className="lang-switch" role="radiogroup" aria-label={t.language.label}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          title={t.language[l]}
          className={lang === l ? 'lang-switch__option lang-switch__option--active' : 'lang-switch__option'}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
