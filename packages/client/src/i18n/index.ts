import { useSyncExternalStore } from 'react';
import { telegramUser } from '../lib/telegram';
import { en, enErrors } from './en';
import { ru, type Messages } from './ru';

/**
 * Языки интерфейса. Тексты лежат словарями в ru.ts и en.ts: ru — образец,
 * en обязан повторить его форму (тип Messages), поэтому забытый перевод — ошибка TypeScript.
 *
 * Компонент берёт тексты хуком useT(): `const t = useT(); t.lobby.create`.
 * Код вне React (уведомления в socket.ts) — функцией t().
 * Свой словарь (как у обучения) — Record<Lang, …> и useLang() для выбора нужного.
 */
export type Lang = 'ru' | 'en';
export const LANGS: Lang[] = ['ru', 'en'];

const dictionaries: Record<Lang, Messages> = { ru, en };
const LANG_KEY = 'gamedeck.lang';

/**
 * Язык при первом запуске: из Telegram (язык приложения игрока), иначе из браузера.
 * Русский для ru/uk/be — у них Telegram чаще всего на русском, остальным английский.
 */
function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    // нет доступа к хранилищу — определяем заново
  }
  const code = (telegramUser?.language_code ?? navigator.language ?? '').toLowerCase();
  return /^(ru|uk|be|kk)\b/.test(code) ? 'ru' : 'en';
}

let lang: Lang = detectLang();
document.documentElement.lang = lang;
const listeners = new Set<() => void>();

/** Сменить язык: запоминается в браузере, все компоненты на useT()/useLang() перерисуются. */
export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // приватный режим: язык проживёт до закрытия вкладки
  }
  listeners.forEach((listener) => listener());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => lang,
  );
}

/** Тексты на текущем языке для компонента. */
export function useT(): Messages {
  return dictionaries[useLang()];
}

/** Тексты на текущем языке вне React. */
export function t(): Messages {
  return dictionaries[lang];
}

/**
 * Текст ошибки сервера. Сервер пишет по-русски и точнее всего («нужно минимум 3 игрока»),
 * поэтому на русском показываем его как есть, а на английском — перевод по коду ошибки.
 */
export function errorText(code: string, serverMessage: string): string {
  if (lang === 'ru') return serverMessage;
  return enErrors[code] ?? enErrors.INTERNAL!;
}

export type { Messages };
